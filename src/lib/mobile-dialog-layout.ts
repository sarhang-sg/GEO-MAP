type ScrollPosition = {
  selector: string;
  value: number;
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Android browsers briefly expose a near-zero visual viewport when returning
 * from a system picker. Wait for two stable, usable samples before replacing
 * dialog content so the restored layout cannot collapse into a blank panel.
 */
export async function waitForUsableVisualViewport(): Promise<void> {
  const viewport = window.visualViewport;
  if (!viewport) {
    await nextFrame();
    await nextFrame();
    return;
  }

  const documentHeight = Math.max(
    document.documentElement.clientHeight,
    window.innerHeight,
    1
  );
  const minimumUsableHeight = Math.min(280, Math.max(160, documentHeight * 0.4));
  let previousHeight = -1;
  let stableSamples = 0;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 24));
    const height = viewport.height;
    const stable = height >= minimumUsableHeight && Math.abs(height - previousHeight) < 1;
    stableSamples = stable ? stableSamples + 1 : 0;
    previousHeight = height;
    if (stableSamples >= 2) break;
  }

  await nextFrame();
  await nextFrame();
}

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
