/** One loading composition for the early module download and the map startup. */
export function loadingMarkup(): string {
  return `<div id="mapLoading" class="map-loading" data-phase="loading" role="status" aria-live="polite" aria-atomic="true">
    <div class="map-loading__content">
      <div class="map-loading__word" aria-hidden="true">
        ${Array.from({ length: 9 }, () => '<span class="map-loading__slice"><b>Loading</b></span>').join("")}
        <span class="map-loading__line"></span>
      </div>
      <p class="map-loading__equation" dir="ltr" aria-label="2 plus 2 equals 1">2 + 2 = 1</p>
      <p class="map-loading__message" hidden></p>
      <button id="mapLoadingRetry" class="map-loading__retry" type="button" hidden>دووبارە هەوڵدان</button>
    </div>
  </div>`;
}
