import { appUrl } from "./app-url";

export function renderAppShell(app: HTMLElement, brandLogoSrc: string, releaseVersion: string, mapEdition: string): void {
  app.innerHTML = `
  <main class="map-shell" data-atlas="true" data-ui-theme="aurora" data-load-state="loading" data-network-state="online" aria-busy="true">
    <div id="map" role="region" aria-label="Kurdistan geographic map"></div>
    <div class="map-focus-vignette" aria-hidden="true"></div>
    <div class="map-edge-frame" aria-hidden="true"><span></span></div>
    <div id="mapLoading" class="map-loading" data-phase="loading" role="status" aria-live="polite" aria-atomic="true">
      <div class="map-loading__terrain" aria-hidden="true"></div>
      <div class="map-loading__deck">
        <div class="map-loading__brand">
          <div class="map-loading__mark" aria-hidden="true">
            <span class="map-loading__mark-grid"></span>
            <img src="${brandLogoSrc}" width="1024" height="1024" alt="" decoding="async" loading="eager" fetchpriority="high" draggable="false" />
            <span class="map-loading__beacon"></span>
          </div>
          <div class="map-loading__copy">
            <span class="map-loading__kicker">NAV KURD</span>
            <strong>KURDISTAN ATLAS</strong>
            <small>خەریکە ماپەکە ئامادە دەکرێت…</small>
          </div>
        </div>
        <div class="map-loading__route" aria-hidden="true">
          <span class="map-loading__route-line"></span>
          <span class="map-loading__route-node map-loading__route-node--a"></span>
          <span class="map-loading__route-node map-loading__route-node--b"></span>
          <span class="map-loading__route-node map-loading__route-node--c"></span>
          <span class="map-loading__route-runner"></span>
        </div>
        <div class="map-loading__meta" aria-hidden="true">
          <span class="map-loading__state-dot"></span>
          <span class="map-loading__network-label"></span>
          <span class="map-loading__meter"><span></span></span>
        </div>
        <button id="mapLoadingRetry" class="map-loading__retry" type="button" hidden>دووبارە هەوڵدان</button>
      </div>
    </div>
    <div id="appHealth" class="app-health" role="status" aria-live="polite" hidden></div>

    <header class="topbar" aria-label="Map header">
      <div id="mapStatus" class="map-status" aria-live="polite" data-state="loading">
        <span class="map-status__dot" aria-hidden="true"></span>
        <span>خەریکی ئامادەکردن</span>
      </div>
      <div id="mapOnlineIndicator" class="map-online-indicator" aria-live="polite" title="Online now">
        <span class="map-online-indicator__dot" aria-hidden="true"></span>
        <span id="mapOnlineIndicatorLabel" class="visually-hidden">ئۆنلاین</span>
        <strong id="mapOnlineIndicatorCount">0</strong>
      </div>
      <button id="brandAboutButton" class="brand-card" type="button" aria-labelledby="brandTitle brandSubtitle brandActionAssistive" aria-controls="aboutDialog" aria-expanded="false">
        <span class="brand-card__aura" aria-hidden="true"></span>
        <img class="brand-card__logo" src="${brandLogoSrc}" alt="NAV KURD logo" width="1024" height="1024" />
        <span class="brand-card__copy"><strong id="brandTitle">NAV KURD</strong><span id="brandSubtitle">نەخشەیەکی سەربەخۆ بۆ باشووری کوردستان</span></span>
        <span id="brandActionAssistive" class="visually-hidden">About</span>
        <span class="brand-card__hint" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.7v5.1M12 7.7h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></span>
      </button>
    </header>

    <section class="search-card" data-component="aurora-search" aria-labelledby="searchRegionHeading">
      <h2 id="searchRegionHeading" class="visually-hidden">Search Kurdistan map</h2>
      <label class="search-card__icon" for="placeSearch"><span id="searchLabelText" class="visually-hidden">Open search</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.2 4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></label>
      <input id="placeSearch" type="search" autocomplete="off" spellcheck="false" placeholder="گەڕان بۆ گوند، شەقام، بانک یان هەر شوێنێک…" aria-label="Search village, street or place" />
      <button id="clearSearch" class="search-card__clear" type="button" aria-label="Clear search" hidden><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>
      <div id="searchResults" class="search-results" hidden role="listbox" aria-label="Search results"></div>
    </section>

    <aside class="map-actions" aria-label="Map controls">
      <div class="style-picker" role="group" aria-label="Map style">
        <button class="style-choice is-active" type="button" data-map-mode="street" aria-pressed="true">Roads</button>
        <button class="style-choice" type="button" data-map-mode="night" aria-pressed="false">Night</button>
        <button class="style-choice" type="button" data-map-mode="satellite" aria-pressed="false">Satellite</button>
      </div>
      <button id="actionsToggleButton" class="round-button map-actions__toggle" type="button" aria-label="More map controls" aria-expanded="false" title="More map controls"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="12" r="1.65" fill="currentColor"/><circle cx="12" cy="12" r="1.65" fill="currentColor"/><circle cx="19" cy="12" r="1.65" fill="currentColor"/></svg></button>
      <button id="baseMapButton" class="map-button is-active map-button--logo" type="button" aria-pressed="true" title="Roads, water and places"><img class="map-button__logo" src="${brandLogoSrc}" alt="" width="1024" height="1024" draggable="false" /><span id="baseMapText">Map data</span></button>
      <button id="layersButton" class="round-button is-active" type="button" title="Administrative layers" aria-label="Toggle administrative layers" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 4.5L12 12 4 7.5 12 3Zm8 9L12 16.5 4 12m16 4.5L12 21 4 16.5" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg></button>
      <button id="placesButton" class="round-button is-active" type="button" title="Places and checkpoints" aria-label="Toggle places and checkpoints" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="7" cy="8" r="2.2" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="7" r="2.2" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17" r="2.4" stroke="currentColor" stroke-width="1.8"/><path d="m8.8 9.3 2.1 5.2m4.3-5.8-2 5.7M9.1 8.1l5.7-.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <button id="userAccountButton" class="round-button user-account-button" type="button" title="Account and contributions" aria-label="Account and contributions"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20c.65-4.1 3.05-6.1 6.5-6.1s5.85 2 6.5 6.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="user-account-button__dot" hidden></span></button>
      <button id="ownerStudioButton" class="round-button owner-studio-button" type="button" title="Administrator tools" aria-label="Administrator tools" hidden><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 19 6.2v5.3c0 4.5-2.85 7.53-7 9.5-4.15-1.97-7-5-7-9.5V6.2L12 3Z" stroke="currentColor" stroke-width="1.8"/><path d="M9.1 11.8 11 13.7l4.2-4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button id="routePinButton" class="round-button route-pin-button" type="button" title="Set destination pin" aria-label="Set destination pin" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s6-5.03 6-11a6 6 0 1 0-12 0c0 5.97 6 11 6 11Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.15" stroke="currentColor" stroke-width="1.8"/><path d="M8 21h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
      <button id="locateButton" class="round-button" type="button" title="Show my location" aria-label="Show my location"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.05 6.95L21 12l-6.95 2.05L12 21l-2.05-6.95L3 12l6.95-2.05L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg></button>
      <button id="shareLocationButton" class="round-button native-share-location" type="button" title="Share my location" aria-label="Share my location"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="19" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="m8.3 10.9 7.4-4.6M8.3 13.1l7.4 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
      <button id="fitButton" class="round-button" type="button" title="Show Kurdistan Region" aria-label="Show Kurdistan Region"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 8h8v8H8z" stroke="currentColor" stroke-width="1.8"/></svg></button>
    </aside>

    <button id="threeDButton" class="map-3d-button" data-control-kind="camera-3d" type="button" aria-pressed="false" aria-label="3D view" title="3D view"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8 20 7.2v9.6l-8 4.4-8-4.4V7.2l8-4.4Z" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/><path d="m4 7.2 8 4.45 8-4.45M12 11.65v9.55" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/><path d="m8.15 5 7.8 4.35" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" opacity=".72"/></svg></button>
    <button id="controlsVisibilityButton" class="controls-visibility-button" type="button" aria-pressed="false" aria-label="Hide map controls" title="Hide map controls"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.8 12s3.45-6 9.2-6 9.2 6 9.2 6-3.45 6-9.2 6-9.2-6-9.2-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.65" stroke="currentColor" stroke-width="1.7"/><path class="controls-visibility-button__slash" d="M4.2 4.2 19.8 19.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></button>

    <button id="feedbackQuickButton" class="feedback-quick-button" type="button" aria-label="Feedback and issue report" title="Feedback and issue report"><span class="feedback-quick-button__pulse" aria-hidden="true"></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.6 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 10h8M8 13.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span class="visually-hidden">Feedback</span></button>

    <section id="mapSheet" class="map-sheet" aria-labelledby="mapTitle" data-sheet-state="expanded">
      <button id="sheetToggle" class="sheet-handle" type="button" aria-expanded="true" aria-controls="sheetContent">
        <span aria-hidden="true"></span><span id="sheetHandleText" class="sheet-handle__text">وردەکاری ماپ</span>
      </button>
      <div id="mapAttributionSlot" class="map-sheet__attribution-slot" aria-live="polite"></div>
      <div class="sheet-header"><div class="sheet-header__copy"><p id="regionEyebrow" class="eyebrow">KURDISTAN REGION</p><h1 id="mapTitle">نەخشەی کوردستان</h1></div><div class="sheet-icon"><img src="${brandLogoSrc}" alt="NAV KURD logo" width="1024" height="1024" /></div></div>
      <div id="sheetContent" class="sheet-content">
      <p id="mapMessage" class="map-message" role="status">خەریکە داتای ڕاستەقینەی ماپەکە بار دەکرێت.</p>
      <div class="map-stats" role="group" aria-label="Map dataset details"><div><strong id="localityCount">—</strong><span id="localityStatLabel">شوێن</span></div><div><strong id="baseSearchCount">—</strong><span id="baseSearchStatLabel">داتای گەڕان</span></div><div><strong id="ownerPlaceCount">—</strong><span id="ownerPlaceStatLabel">شوێنی زیادکراو</span></div></div>
      <div class="action-grid"><button id="sheetLocateButton" class="action-card" type="button"><span class="action-card__icon action-card__icon--tracking" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.05 6.95L21 12l-6.95 2.05L12 21l-2.05-6.95L3 12l6.95-2.05L12 3Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg></span><span><strong id="locateTitle">شوێنی من</strong><small id="locateSub">شوێنی ئێستا و جوڵە</small></span></button><button id="sheetFitButton" class="action-card" type="button"><span class="action-card__icon action-card__icon--logo" aria-hidden="true"><img src="${brandLogoSrc}" alt="" width="1024" height="1024" draggable="false" /></span><span><strong id="fitTitle">تەواوی هەرێم</strong><small id="fitSub">گەڕانەوە بۆ سنوور</small></span></button><button id="sheetShareLocationButton" class="action-card action-card--native-share" type="button"><span class="action-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="18" cy="5" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="19" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="m8.3 10.9 7.4-4.6M8.3 13.1l7.4 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span><strong id="shareLocationTitle">هاوبەشکردنی شوێن</strong><small id="shareLocationSub">لینکی شوێنی ئێستا</small></span></button></div>
      <div class="utility-row"><div class="segmented" role="group" aria-label="Language"><button data-language="ku" class="is-active" type="button">کوردی</button><button data-language="ar" type="button">عربي</button><button data-language="en" type="button">EN</button></div><span id="backendState" class="backend-state">داتای ناوخۆیی</span></div>
      <p id="mapNote" class="map-note">ماپەکە ڕێگا، شەقام، گوند، شار، سنوور و شوێنە گرنگەکانی هەرێمی کوردستان پیشان دەدات.</p>
      </div>
    </section>

    <div id="aboutDialog" class="about-dialog" hidden>
      <section class="about-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="aboutTitle" aria-describedby="aboutDescription">
        <span class="about-dialog__aurora" aria-hidden="true"></span>
        <button id="aboutCloseButton" class="dialog-close-button about-dialog__close" type="button" aria-label="Close about panel">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <div class="about-dialog__scroll">
        <div class="about-dialog__brand">
          <span class="about-dialog__logo"><img src="${brandLogoSrc}" alt="NAV KURD logo" width="1024" height="1024" /></span>
          <div><p id="aboutEyebrow">NAV KURD</p><h2 id="aboutTitle">Kurdistan Atlas</h2></div>
        </div>
        <p id="aboutDescription" class="about-dialog__description">A modern geographic atlas for roads, places, navigation, GPS and satellite context across the Kurdistan Region.</p>
        <dl class="about-dialog__meta">
          <div><dt id="aboutVersionLabel">Version</dt><dd>${releaseVersion}</dd></div>
          <div><dt id="aboutMapEditionLabel">Map edition</dt><dd id="aboutMapEditionValue">${mapEdition}</dd></div>
          <div><dt id="aboutDeveloperLabel">Developer</dt><dd class="about-dialog__developer"><span>SARHANG IO</span><a href="https://www.instagram.com/sarhang.io/" target="_blank" rel="noopener noreferrer" aria-label="Instagram — SARHANG IO"><img src="${import.meta.env.BASE_URL}assets/icons/social/instagram.svg" alt="" aria-hidden="true" /></a></dd></div>
          <div><dt id="aboutCvLabel">MY CV</dt><dd><a id="aboutCvLink" class="about-dialog__meta-link about-dialog__meta-link--cv" href="https://sarhang-cs.github.io/Sarhang-Cv/" target="_blank" rel="noopener noreferrer" aria-label="MY CV"><img class="about-dialog__meta-icon" src="${import.meta.env.BASE_URL}assets/support/my-cv-preview.jpg" alt="" width="1120" height="1680" loading="lazy" decoding="async" draggable="false" /></a></dd></div>
          <div><dt id="aboutCoverageLabel">Coverage</dt><dd id="aboutCoverageValue">Kurdistan Region + disputed areas</dd></div>
        </dl>
        <section id="offlineMapPack" class="offline-map-pack" data-status="idle" data-progress-phase="start" aria-live="polite" aria-labelledby="offlineMapPackHeading">
          <h3 id="offlineMapPackHeading" class="visually-hidden">Offline map pack</h3>
          <div class="offline-map-pack__header">
            <div><strong id="offlinePackTitle">Offline map</strong><small id="offlinePackStatus">Not downloaded</small></div>
            <span id="offlinePackSize">0 MB</span>
          </div>
          <div class="offline-map-pack__track" role="progressbar" aria-label="Offline map download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="offlinePackProgress"></span></div>
          <div class="offline-map-pack__meta" aria-live="polite">
            <span id="offlinePackPersistence">—</span>
            <span id="offlinePackStorage">—</span>
          </div>
          <p id="offlinePackNote" class="offline-map-pack__note">Download this section once so the app runs better and faster on your device.</p>
          <div class="offline-map-pack__actions">
            <button id="offlinePackDownload" type="button">Download</button>
            <button id="offlinePackPause" type="button" hidden>Pause</button>
            <button id="offlinePackResume" type="button" hidden>Resume</button>
            <button id="offlinePackDelete" type="button" hidden>Delete</button>
          </div>
        </section>
        <section id="androidDownloadSection" class="android-download" aria-labelledby="androidDownloadTitle">
          <span class="android-download__sky" aria-hidden="true"><i></i><i></i><i></i></span>
          <div class="android-download__heading">
            <span class="android-download__mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none"><path d="M14 17.5h20a5 5 0 0 1 5 5V36a4 4 0 0 1-4 4h-2v4a2 2 0 0 1-4 0v-4H19v4a2 2 0 0 1-4 0v-4h-2a4 4 0 0 1-4-4V22.5a5 5 0 0 1 5-5Z" fill="currentColor"/><path d="m15 15-3.5-5M33 15l3.5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="18" cy="25" r="1.8" fill="#071321"/><circle cx="30" cy="25" r="1.8" fill="#071321"/></svg>
            </span>
            <div><p>NAV KURD 8.0.4</p><h3 id="androidDownloadTitle">ئەپی Android دابگرە</h3><small id="androidDownloadSummary">وەشانی واژۆکراو و پشتڕاستکراو بۆ Android 7 و نوێتر</small></div>
          </div>
          <div class="android-download__actions">
            <a id="androidDirectDownload" class="android-download__primary" href="${appUrl("downloads/NAV-KURD-8.0.4.apk")}" download>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span><strong>APK دابگرە</strong><small>ڕاستەوخۆ · v8.0.4</small></span>
            </a>
            <a id="androidApkPureDownload" class="android-download__store" href="https://apkpure.com/nav-kurd/com.navkurd.app/download" target="_blank" rel="noopener noreferrer">
              <span class="android-download__apkpure" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M18 3 3 30h7l8-15 8 15h7L18 3Z" fill="currentColor"/><path d="M14 24h8l-4-7-4 7Z" fill="#071321"/></svg></span>
              <span><strong>APKPure</strong><small id="androidApkPureLabel">لە کۆگای APKPure</small></span>
            </a>
          </div>
        </section>
        <div id="offlinePackDeleteConfirm" class="offline-pack-confirm" hidden>
          <div class="offline-pack-confirm__backdrop" data-offline-pack-confirm="cancel"></div>
          <section class="offline-pack-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="offlinePackDeleteConfirmTitle" aria-describedby="offlinePackDeleteConfirmMessage">
            <span class="offline-pack-confirm__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <p class="offline-pack-confirm__eyebrow">NAV KURD</p>
            <h3 id="offlinePackDeleteConfirmTitle">Delete the offline map?</h3>
            <p id="offlinePackDeleteConfirmMessage">The downloaded offline map data will be removed from this device.</p>
            <div class="offline-pack-confirm__actions">
              <button id="offlinePackDeleteConfirmCancel" class="offline-pack-confirm__cancel" type="button" data-offline-pack-confirm="cancel">Cancel</button>
              <button id="offlinePackDeleteConfirmProceed" class="offline-pack-confirm__delete" type="button">Yes, delete</button>
            </div>
          </section>
        </div>
        <section id="nativeIosPanel" class="native-ios-panel" aria-labelledby="nativeIosHeading" hidden>
          <div class="native-ios-panel__header"><div><p id="nativePlatformEyebrow">NATIVE APP</p><h3 id="nativeIosHeading">ڕێکخستنەکانی ئەپی NAV KURD</h3></div><span id="nativePlatformIcon">◆</span></div>
          <dl class="native-ios-panel__status"><div><dt id="nativeConnectionTerm">تۆڕ</dt><dd id="nativeConnectionValue">—</dd></div><div><dt id="nativeStorageTerm">خەزن</dt><dd id="nativeCacheValue">—</dd></div></dl>
          <div class="native-ios-panel__actions"><button id="nativeClearCacheButton" type="button">پاککردنەوەی cache ـی کاتی</button><button id="nativeOpenSettingsButton" type="button">کردنەوەی Settings</button></div>
          <p id="nativeIosNote">GPS permission، offline data، safe-area و deep links لە ڕێگەی سیستەمی ئامێرەکەت بەڕێوە دەبرێن.</p>
        </section>
        <div class="about-dialog__utility-actions">
          <button id="tutorialRestartButton" type="button">فێرکاری</button>
          <button id="feedbackButton" type="button">Feedback</button>
          <button id="supportButton" type="button">Support</button>
          <a id="aboutPrivacyLink" href="${appUrl("legal/privacy.html")}" target="_blank" rel="noopener">سیاسەتی تایبەتمەندی</a>
          <a id="aboutTermsLink" href="${appUrl("legal/terms.html")}" target="_blank" rel="noopener">مەرجەکانی بەکارهێنان</a>
        </div>
        <section id="supportSection" class="support-section support-section--neon" aria-labelledby="supportSectionHeading">
          <span class="support-neon-frame" aria-hidden="true">
            <i class="support-neon-segment support-neon-segment--top" data-essential-animation="true"></i>
            <i class="support-neon-segment support-neon-segment--right" data-essential-animation="true"></i>
            <i class="support-neon-segment support-neon-segment--bottom" data-essential-animation="true"></i>
            <i class="support-neon-segment support-neon-segment--left" data-essential-animation="true"></i>
          </span>
          <div class="support-section__header">
            <p id="supportSectionEyebrow">SUPPORT NAV KURD</p>
            <h3 id="supportSectionHeading">یارمەتیم بدە</h3>
          </div>
          <p id="supportSectionIntro" class="support-section__intro">ئەگەر NAV KURD بۆت بەسوود بووە، دەتوانیت بە هاوکاریی داریی، پشتگیریی پڕۆژەکە بکەیت. ئەم یارمەتیدانە یارمەتیم دەدات بۆ باشترکردنی داتای ماپ، زیادکردنی شوێنەکان، GPS، ئۆفلاین و گەشەپێدانی وەشانەکانی داهاتوو.</p>
          <div class="support-section__groups">
            <details class="support-fold" open>
              <summary class="support-fold__summary"><span id="supportPaymentHeading">پارەدان و یارمەتی</span><small id="supportPaymentSub">فاست‌پەی · بانکی یەکەمی عێراق · سوپەرکیو</small></summary>
              <div class="support-methods" role="list" aria-label="Support payment methods">
                <article class="support-method" role="listitem">
                  <button class="support-method__copy-button" type="button" data-copy-value="7501504608" data-copy-target="fastpay" aria-live="polite">کۆپی</button>
                  <div class="support-method__copy"><strong id="supportFastPayLabel">FastPay</strong><small>7501504608</small></div>
                  <span class="support-method__badge support-method__badge--fastpay" aria-hidden="true"><img src="${import.meta.env.BASE_URL}assets/support/fastpay.webp" alt="" width="384" height="384" loading="lazy" decoding="async" draggable="false" /></span>
                </article>
                <article class="support-method" role="listitem">
                  <button class="support-method__copy-button" type="button" data-copy-value="7501504608" data-copy-target="fib" aria-live="polite">کۆپی</button>
                  <div class="support-method__copy"><strong id="supportFibLabel">First Iraqi Bank</strong><small>7501504608</small></div>
                  <span class="support-method__badge support-method__badge--fib" aria-hidden="true"><img src="${import.meta.env.BASE_URL}assets/support/fib.webp" alt="" width="384" height="384" loading="lazy" decoding="async" draggable="false" /></span>
                </article>
                <article class="support-method" role="listitem">
                  <button class="support-method__copy-button" type="button" data-copy-value="6035410775" data-copy-target="superqi" aria-live="polite">کۆپی</button>
                  <div class="support-method__copy"><strong id="supportSuperQiLabel">SuperQi</strong><small>6035410775</small></div>
                  <span class="support-method__badge support-method__badge--superqi" aria-hidden="true"><img src="${import.meta.env.BASE_URL}assets/support/superqi.webp" alt="" width="384" height="384" loading="lazy" decoding="async" draggable="false" /></span>
                </article>
              </div>
            </details>
            <details id="supportVisitorsFold" class="support-fold">
              <summary class="support-fold__summary"><span id="supportRecentVisitorsHeading">سەردانکەرانی تۆمارکراو</span><small id="supportRecentVisitorsSub">بەکارهێنەرانی چوونەژوورەوە بە نوێترین چالاکی ڕیز دەکرێن</small></summary>
              <div id="supportVisitorPrivacyControl" class="support-visitors-privacy" aria-live="polite"></div><div id="supportRecentVisitorsList" class="support-people-list" role="list"></div>
            </details>
            <details class="support-fold">
              <summary class="support-fold__summary"><span id="supportersHeading">هاوکاران و پشتیوانان</span><small id="supportersSub">کەسانێک کە هاوکاریان کردووە</small></summary>
              <div id="supportersList" class="support-people-list" role="list"></div>
            </details>
          </div>
          <p id="supportSectionNote" class="support-section__note">هەر پشتیوانییەک، تەنانەت بچووکیش، بۆ من و بۆ پڕۆژەکە زۆر گرنگە. ئەگەر دەتەوێت هاوکاریی تر بکەیت یان پرسیارت هەیە، دەتوانیت پەیوەندیم پێوە بکەیت.</p>
          <a id="supportSectionContact" class="support-section__contact" href="mailto:sarhang.salah9@gmail.com">sarhang.salah9@gmail.com</a>
        </section>
        <footer class="about-dialog__footer"><button id="aboutDoneButton" class="about-dialog__primary" type="button">Done</button></footer>
        </div>
      </section>
    </div>
  </main>`;
}
