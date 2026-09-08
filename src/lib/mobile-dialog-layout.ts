type ScrollPosition = {
  selector: string;
  value: number;
};

/** Restore modal scroll without allowing a stale mobile offset past content. */
export function restoreClampedScroll(root: ParentNode, positions: readonly ScrollPosition[]): void {
  const apply = (): void => {
    for (const position of positions) {
      const element = root.querySelector<HTMLElement>(position.selector);
      if (!element) continue;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = Math.min(Math.max(0, position.value), maximum);
    }
  };

  requestAnimationFrame(() => requestAnimationFrame(apply));
  // A delayed clamp covers the final Android visualViewport resize after the
  // native gallery animation has completed.
  window.setTimeout(apply, 140);
}
