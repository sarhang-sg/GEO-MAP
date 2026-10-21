/** Keeps desktop, touch, keyboard and visual-viewport behavior explicit. */
export function installInputModeController(): () => void {
  const root = document.documentElement;
  const coarse = window.matchMedia("(pointer: coarse)");
  const hover = window.matchMedia("(hover: hover)");
  let lastMode = coarse.matches ? "touch" : "keyboard";
  let viewportFrame = 0;

  const applyCapabilities = (): void => {
    root.dataset.pointer = coarse.matches ? "coarse" : "fine";
    root.dataset.hover = hover.matches ? "available" : "none";
  };
  const applyMode = (mode: string): void => {
    if (lastMode === mode) return;
    lastMode = mode;
    root.dataset.inputMode = mode;
  };
  const setViewportProperty = (key: string, value: string): void => {
    if (root.style.getPropertyValue(key) !== value) root.style.setProperty(key, value);
  };
  const updateViewport = (): void => {
    if (!viewportFrame) viewportFrame = requestAnimationFrame(writeViewport);
  };
  const writeViewport = (): void => {
    viewportFrame = 0;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    setViewportProperty("--visual-viewport-width", `${Math.round(width)}px`);
    setViewportProperty("--visual-viewport-height", `${Math.round(height)}px`);
    setViewportProperty("--visual-viewport-top", `${Math.round(offsetTop)}px`);
    setViewportProperty("--visual-viewport-left", `${Math.round(offsetLeft)}px`);
  };

  const onPointer = (event: PointerEvent): void => applyMode(event.pointerType === "mouse" ? "mouse" : "touch");
  const onKey = (event: KeyboardEvent): void => {
    if (["Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Escape", "Home", "End"].includes(event.key)) applyMode("keyboard");
  };
  const onMouse = (): void => applyMode("mouse");
  const onTouch = (): void => applyMode("touch");

  applyCapabilities();
  updateViewport();
  root.dataset.inputMode = lastMode;
  coarse.addEventListener("change", applyCapabilities);
  hover.addEventListener("change", applyCapabilities);
  window.addEventListener("pointerdown", onPointer, { passive: true, capture: true });
  window.addEventListener("keydown", onKey, { capture: true });
  if (typeof window.PointerEvent === "undefined") {
    window.addEventListener("mousemove", onMouse, { passive: true, capture: true });
    window.addEventListener("touchstart", onTouch, { passive: true, capture: true });
  }
  window.addEventListener("resize", updateViewport, { passive: true });
  window.visualViewport?.addEventListener("resize", updateViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateViewport, { passive: true });

  return () => {
    cancelAnimationFrame(viewportFrame);
    coarse.removeEventListener("change", applyCapabilities);
    hover.removeEventListener("change", applyCapabilities);
    window.removeEventListener("pointerdown", onPointer, { capture: true });
    window.removeEventListener("keydown", onKey, { capture: true });
    window.removeEventListener("mousemove", onMouse, { capture: true });
    window.removeEventListener("touchstart", onTouch, { capture: true });
    window.removeEventListener("resize", updateViewport);
    window.visualViewport?.removeEventListener("resize", updateViewport);
    window.visualViewport?.removeEventListener("scroll", updateViewport);
  };
}
