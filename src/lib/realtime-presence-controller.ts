import type { RealtimeChannel } from "@supabase/supabase-js";
import { atlasSupabase, getAtlasAuthIdentity, subscribeToAtlasAuth, type AtlasAuthIdentity } from "./atlas-places";

export type PresenceConnectionState = "disabled" | "signed-out" | "connecting" | "live" | "offline";

export type RealtimePresenceSnapshot = {
  state: PresenceConnectionState;
  onlineCount: number;
  signedIn: boolean;
  identity: AtlasAuthIdentity | null;
};

export type PresenceActivityKind = "sign_in" | "active" | "heartbeat" | "resume";

type RealtimePresenceControllerOptions = {
  onChange: (snapshot: RealtimePresenceSnapshot) => void;
  onActivity?: (kind: PresenceActivityKind) => void | Promise<void>;
};

type PresencePayload = {
  viewer_key?: unknown;
  signed_in?: unknown;
  online_at?: unknown;
};

const CHANNEL_TOPIC = "nav-kurd-online-v3";
const HEARTBEAT_MS = 55_000;
const ACTIVITY_THROTTLE_MS = 18_000;
const RECONNECT_DELAY_MS = 1_500;
const RECONNECT_MAX_DELAY_MS = 30_000;
const DEVICE_KEY_STORAGE = "nav-kurd-presence-device-v1";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function persistedDeviceKey(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY_STORAGE)?.trim();
    if (existing) return existing;
    const created = randomId();
    window.localStorage.setItem(DEVICE_KEY_STORAGE, created);
    return created;
  } catch {
    return randomId();
  }
}

async function shortHash(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).slice(0, 10).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return value.replace(/[^a-z0-9]/giu, "").slice(-20) || randomId().slice(0, 20);
  }
}

function countUniqueViewers(state: Record<string, PresencePayload[]>): number {
  const viewers = new Set<string>();
  for (const [presenceKey, rows] of Object.entries(state)) {
    if (!Array.isArray(rows) || rows.length === 0) {
      viewers.add(presenceKey);
      continue;
    }
    for (const row of rows) {
      const viewerKey = typeof row.viewer_key === "string" && row.viewer_key.trim() ? row.viewer_key.trim() : presenceKey;
      viewers.add(viewerKey);
    }
  }
  return viewers.size;
}

export function installRealtimePresenceController(options: RealtimePresenceControllerOptions) {
  const deviceKey = persistedDeviceKey();
  const tabKey = randomId();
  let identity: AtlasAuthIdentity | null = null;
  let viewerKey = `guest:${deviceKey}`;
  let channel: RealtimeChannel | null = null;
  let activePresenceKey: string | null = null;
  let connectInFlight: Promise<void> | null = null;
  let identityRefreshInFlight: Promise<void> | null = null;
  let state: PresenceConnectionState = atlasSupabase ? "connecting" : "disabled";
  let onlineCount = 0;
  let heartbeatTimer = 0;
  let reconnectTimer = 0;
  let reconnectAttempt = 0;
  let lastActivityAt = 0;
  let destroyed = false;
  let joinEpoch = 0;

  const emit = (): void => {
    options.onChange({ state, onlineCount, signedIn: Boolean(identity), identity });
  };

  const setState = (next: PresenceConnectionState): void => {
    state = next;
    emit();
  };

  const clearTimers = (): void => {
    window.clearInterval(heartbeatTimer);
    window.clearTimeout(reconnectTimer);
    heartbeatTimer = 0;
    reconnectTimer = 0;
  };

  const currentPayload = (): PresencePayload => ({
    viewer_key: viewerKey,
    signed_in: Boolean(identity),
    online_at: new Date().toISOString()
  });

  const syncCount = (): void => {
    if (!channel) return;
    const presenceState = channel.presenceState() as Record<string, PresencePayload[]>;
    onlineCount = countUniqueViewers(presenceState);
    emit();
  };

  const track = async (activityKind: PresenceActivityKind = "heartbeat"): Promise<void> => {
    if (!channel || document.hidden || !navigator.onLine) return;
    try {
      await channel.track(currentPayload());
      if (identity && options.onActivity) await options.onActivity(activityKind);
    } catch {
      // Subscription callbacks and the reconnect watchdog handle transport loss.
    }
  };

  const scheduleReconnect = (force = false): void => {
    if (destroyed || !atlasSupabase || reconnectTimer || !navigator.onLine) return;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_DELAY_MS * (2 ** Math.min(reconnectAttempt, 4)));
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      void (async () => {
        if (force) await disconnect();
        await connect();
      })();
    }, delay);
  };

  const currentPresenceKey = (): string => `${viewerKey}:${tabKey}`;

  const disconnect = async (): Promise<void> => {
    const previous = channel;
    channel = null;
    activePresenceKey = null;
    if (!previous || !atlasSupabase) return;
    try { await previous.untrack(); } catch { /* best effort */ }
    try { await atlasSupabase.removeChannel(previous); } catch { /* best effort */ }
  };

  const connect = async (): Promise<void> => {
    if (connectInFlight) {
      await connectInFlight;
      const desiredKey = currentPresenceKey();
      if (!destroyed && atlasSupabase && navigator.onLine && (!channel || activePresenceKey !== desiredKey)) {
        await connect();
      }
      return;
    }

    connectInFlight = (async () => {
      if (destroyed || !atlasSupabase) {
        setState("disabled");
        return;
      }
      if (!navigator.onLine) {
        await disconnect();
        onlineCount = 0;
        setState("offline");
        return;
      }

      const desiredKey = currentPresenceKey();
      // A channel with the same presence key owns its own Supabase rejoin
      // lifecycle. Do not tear down a socket that is still connecting or being
      // automatically recovered by the Realtime client.
      if (channel && activePresenceKey === desiredKey) return;

      const epoch = ++joinEpoch;
      setState("connecting");
      await disconnect();
      if (destroyed || epoch !== joinEpoch || desiredKey !== currentPresenceKey()) return;

      const nextChannel = atlasSupabase.channel(CHANNEL_TOPIC, {
        config: { presence: { key: desiredKey } }
      });
      channel = nextChannel;
      activePresenceKey = desiredKey;
      nextChannel
        .on("presence", { event: "sync" }, syncCount)
        .on("presence", { event: "join" }, syncCount)
        .on("presence", { event: "leave" }, syncCount)
        .subscribe((status) => {
          if (destroyed || epoch !== joinEpoch || channel !== nextChannel) return;
          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
            window.clearTimeout(reconnectTimer);
            reconnectTimer = 0;
            setState("live");
            void track("heartbeat");
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // A Realtime channel timeout is not proof that the device is offline.
            // Preserve the last truthful count, show recovery, and perform one
            // bounded hard rejoin. Red is reserved for navigator.onLine=false.
            setState(navigator.onLine ? "connecting" : "offline");
            scheduleReconnect(true);
            return;
          }
          if (status === "CLOSED") {
            channel = null;
            activePresenceKey = null;
            if (!navigator.onLine) onlineCount = 0;
            setState(navigator.onLine ? "connecting" : "offline");
            scheduleReconnect();
          }
        });
    })().finally(() => {
      connectInFlight = null;
    });

    await connectInFlight;
  };

  const refreshIdentity = (): Promise<void> => {
    if (identityRefreshInFlight) return identityRefreshInFlight;
    identityRefreshInFlight = (async () => {
      try {
        const previousUserId = identity?.userId ?? null;
        identity = await getAtlasAuthIdentity();
        viewerKey = identity ? `user:${await shortHash(identity.userId)}` : `guest:${deviceKey}`;
        if (!identity) setState("signed-out");
        await connect();
        if (identity && identity.userId !== previousUserId && options.onActivity) await options.onActivity("sign_in");
      } catch {
        // Identity lookup can fail while the network is still online. Keep the
        // current identity/count and recover instead of publishing a false red state.
        setState(navigator.onLine ? "connecting" : "offline");
        scheduleReconnect(true);
      }
    })().finally(() => {
      identityRefreshInFlight = null;
    });
    return identityRefreshInFlight;
  };

  const noteActivity = (): void => {
    const now = Date.now();
    if (now - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityAt = now;
    if (state === "live") void track("active");
  };

  const handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (channel) void channel.untrack();
      return;
    }
    noteActivity();
    if (state !== "live") void connect();
    else void track("resume");
  };
  const handleOnline = (): void => { void connect(); };
  const handleOffline = (): void => {
    onlineCount = 0;
    setState("offline");
    void disconnect();
  };
  const handlePageHide = (): void => { if (channel) void channel.untrack(); };

  const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "focus"];
  for (const eventName of activityEvents) window.addEventListener(eventName, noteActivity, { passive: true });
  window.addEventListener("nav-kurd:user-activity", noteActivity as EventListener, { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
  window.addEventListener("online", handleOnline, { passive: true });
  window.addEventListener("offline", handleOffline, { passive: true });
  window.addEventListener("pagehide", handlePageHide, { passive: true });

  const unsubscribeAuth = subscribeToAtlasAuth(() => { void refreshIdentity(); });
  heartbeatTimer = window.setInterval(() => {
    if (state === "live") void track("heartbeat");
    else if (navigator.onLine) scheduleReconnect();
  }, HEARTBEAT_MS);
  void refreshIdentity();

  return {
    getSnapshot(): RealtimePresenceSnapshot { return { state, onlineCount, signedIn: Boolean(identity), identity }; },
    noteActivity,
    refreshIdentity,
    destroy(): void {
      destroyed = true;
      joinEpoch += 1;
      clearTimers();
      unsubscribeAuth?.();
      for (const eventName of activityEvents) window.removeEventListener(eventName, noteActivity);
      window.removeEventListener("nav-kurd:user-activity", noteActivity as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pagehide", handlePageHide);
      void disconnect();
    }
  };
}
