import { getAtlasAuthIdentity, loadAtlasNotifications, subscribeToAtlasAccount, subscribeToAtlasAuth } from "./atlas-places";
import type { Language } from "./types";

let activeCleanup: (() => void) | undefined;

/** Uses the existing authenticated realtime client; native code never stores tokens. */
export function installNativeAccountNotifications(getLanguage: () => Language): () => void {
  activeCleanup?.();
  let disposed = false;
  let generation = 0;
  let running = false;
  let queued = false;
  let timer: number | undefined;
  const publish = async (): Promise<void> => {
    if (disposed) return;
    if (running) { queued = true; return; }
    running = true;
    const epoch = generation;
    try {
      const bridge = window.flutter_inappwebview;
      if (!bridge) return;
      const identity = await getAtlasAuthIdentity();
      if (epoch !== generation) return;
      // Clear notifications from the previous account before any server read.
      await bridge.callHandler("nativeAccountNotifications", { userId: identity?.userId ?? "", items: [] });
      if (!identity || !navigator.onLine || epoch !== generation) return;
      const rows = await loadAtlasNotifications();
      if (epoch !== generation) return;
      const lang = getLanguage();
      await bridge.callHandler("nativeAccountNotifications", {
        userId: identity.userId,
        items: rows.filter((row) => row.user_id === identity.userId).map((row) => ({
          id: row.id, read: row.is_read, at: Date.parse(row.created_at),
          title: row[`title_${lang}`] || row.title_ku,
          body: row[`body_${lang}`] || row.body_ku || row.body_ar || row.body_en || ""
        }))
      });
    } catch { /* The in-app inbox stays authoritative while offline or unsupported. */ }
    finally {
      running = false;
      if (queued) { queued = false; schedule(); }
    }
  };
  const schedule = (): void => {
    if (disposed || timer !== undefined) return;
    timer = window.setTimeout(() => { timer = undefined; void publish(); }, 250);
  };
  const unsubscribeAuth = subscribeToAtlasAuth((change) => {
    if (change?.event === "TOKEN_REFRESHED") return;
    generation++;
    schedule();
  });
  const unsubscribeAccount = subscribeToAtlasAccount(schedule);
  window.addEventListener("online", schedule);
  window.addEventListener("nav-kurd:native-resume", schedule);
  window.addEventListener("nav-kurd:language-change", schedule);
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    generation++;
    queued = false;
    if (timer !== undefined) window.clearTimeout(timer);
    unsubscribeAuth?.();
    unsubscribeAccount?.();
    window.removeEventListener("online", schedule);
    window.removeEventListener("nav-kurd:native-resume", schedule);
    window.removeEventListener("nav-kurd:language-change", schedule);
    if (activeCleanup === cleanup) activeCleanup = undefined;
  };
  activeCleanup = cleanup;
  schedule();
  return cleanup;
}
