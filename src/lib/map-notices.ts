/** One shared stack keeps GPS and weather notices out of each other's way. */
export function mapNoticeStack(shell: HTMLElement): HTMLElement {
  let stack = shell.querySelector<HTMLElement>(":scope > .map-notice-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "map-notice-stack";
    shell.append(stack);
  }
  return stack;
}

/** Count visible reading time only; hovering, focus and a modal pause dismissal. */
export class NoticeAutoHide {
  private timer = 0;
  private remaining = 0;
  private started = 0;
  private hovered = false;
  private blocked = false;
  private active = false;
  constructor(private readonly element: HTMLElement, private readonly onDismiss: () => void) {
    element.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") { this.hovered = true; this.sync(); } });
    element.addEventListener("pointerleave", () => { this.hovered = false; this.sync(); });
    element.addEventListener("focusin", () => this.sync());
    element.addEventListener("focusout", () => queueMicrotask(() => this.sync()));
    document.addEventListener("visibilitychange", () => this.sync());
    window.addEventListener("nav-kurd:notices-blocked", event => {
      this.blocked = (event as CustomEvent<boolean>).detail; this.sync();
    });
  }
  start(milliseconds: number): void {
    this.clear(); this.remaining = milliseconds; this.active = true;
    this.blocked = this.element.closest<HTMLElement>(".map-notice-stack")?.dataset.blocked === "true";
    this.sync();
  }
  clear(): void { window.clearTimeout(this.timer); this.timer = 0; this.remaining = 0; this.active = false; }
  private sync(): void {
    if (this.timer) {
      window.clearTimeout(this.timer); this.timer = 0;
      this.remaining = Math.max(0, this.remaining - (performance.now() - this.started));
    }
    if (this.element.hidden || document.hidden || this.blocked || this.hovered || this.element.matches(":focus-within")) return;
    if (!this.active) return;
    if (this.remaining <= 0) { this.active = false; this.onDismiss(); return; }
    this.started = performance.now();
    this.timer = window.setTimeout(() => {
      this.timer = 0; this.remaining = 0; this.active = false; this.onDismiss();
    }, this.remaining);
  }
}
