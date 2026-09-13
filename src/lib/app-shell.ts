import { appUrl } from "./app-url";
import { dialogCloseIcon } from "./dialog-close-icon";

function navIcon(name: string, className = "nav-ui-icon"): string {
  return `<img class="${className}" src="${appUrl(`assets/icons/nav-kurd/${name}.svg`)}" alt="" aria-hidden="true" draggable="false" />`;
}

export function renderAppShell(app: HTMLElement, brandLogoSrc: string, releaseVersion: string, mapEdition: string): void {
  app.innerHTML = `
  <main class="map-shell" data-atlas="true" data-ui-theme="luxe-ocean" data-load-state="loading" data-network-state="online" aria-busy="true">
    <div id="map" role="region" aria-label="Kurdistan geographic map"></div>
    <div class="map-focus-vignette" aria-hidden="true"></div>
    <div class="map-edge-frame" aria-hidden="true"><span></span></div>
    <div id="mapLoading" class="map-loading" data-phase="loading" role="status" aria-live="polite" aria-atomic="true">
      <div class="map-loading__content">
        <div class="map-loading__word" aria-hidden="true">
          ${Array.from({ length: 9 }, () => '<span class="map-loading__slice"><b data-essential-animation="true">Loading</b></span>').join("")}
          <span class="map-loading__line" data-essential-animation="true"></span>
        </div>
        <p class="map-loading__equation" dir="ltr" aria-label="2 plus 2 equals 1">2 + 2 = 1</p>
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
        <span class="map-online-indicator__dot" aria-hidden="true">${navIcon("07")}</span>
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
        <button id="mapModeCycleButton" class="style-choice is-active" type="button" data-map-mode="night" data-map-mode-cycle="true" aria-pressed="true">
          <span class="style-choice__icons" aria-hidden="true">
            <svg data-map-mode-icon="street" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2m0 14.6v2.2M2.5 12h2.2m14.6 0h2.2M5.3 5.3l1.6 1.6m10.2 10.2 1.6 1.6m0-13.4-1.6 1.6M6.9 17.1l-1.6 1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <svg data-map-mode-icon="night" viewBox="0 0 24 24" fill="none"><path d="M19.6 15.1A8 8 0 0 1 8.9 4.4 8.1 8.1 0 1 0 19.6 15.1Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            <img data-map-mode-icon="satellite" src="${appUrl("assets/icons/nav-kurd/a2.svg")}" alt="" draggable="false" />
          </span>
          <span class="style-choice__label visually-hidden" data-map-mode-label>Night</span>
        </button>
      </div>
      <button id="actionsToggleButton" class="round-button map-actions__toggle" type="button" aria-label="More map controls" aria-expanded="false" title="More map controls"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="5" cy="12" r="1.65" fill="currentColor"/><circle cx="12" cy="12" r="1.65" fill="currentColor"/><circle cx="19" cy="12" r="1.65" fill="currentColor"/></svg></button>
      <button id="baseMapButton" class="map-button is-active map-button--logo" type="button" aria-pressed="true" title="Roads, water and places"><img class="map-button__logo" src="${brandLogoSrc}" alt="" width="1024" height="1024" draggable="false" /><span id="baseMapText">Map data</span></button>
      <button id="layersButton" class="round-button is-active" type="button" title="Administrative layers" aria-label="Toggle administrative layers" aria-pressed="true">${navIcon("03")}</button>
      <button id="placesButton" class="round-button is-active" type="button" title="Places and checkpoints" aria-label="Toggle places and checkpoints" aria-pressed="true">${navIcon("04")}</button>
      <button id="userAccountButton" class="round-button user-account-button" type="button" title="Account and contributions" aria-label="Account and contributions">${navIcon("profile")}<span class="user-account-button__dot" hidden></span></button>
      <button id="ownerStudioButton" class="round-button owner-studio-button" type="button" title="Administrator tools" aria-label="Administrator tools" hidden>${navIcon("a1")}</button>
      <button id="routePinButton" class="round-button route-pin-button" type="button" title="Set destination pin" aria-label="Set destination pin" aria-pressed="false">${navIcon("05")}</button>
      <button id="locateButton" class="round-button" type="button" title="Show my location" aria-label="Show my location">${navIcon("06")}</button>
      <button id="shareLocationButton" class="round-button native-share-location" type="button" title="Share my location" aria-label="Share my location"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="19" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="m8.3 10.9 7.4-4.6M8.3 13.1l7.4 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
      <button id="fitButton" class="round-button" type="button" title="Show Kurdistan Region" aria-label="Show Kurdistan Region">${navIcon("09")}</button>
    </aside>

    <button id="threeDButton" class="map-3d-button" data-control-kind="camera-3d" type="button" aria-pressed="false" aria-label="3D view" title="3D view">${navIcon("01")}</button>
    <button id="controlsVisibilityButton" class="controls-visibility-button" type="button" aria-pressed="false" aria-label="Hide map controls" title="Hide map controls">${navIcon("02")}</button>

    <button id="feedbackQuickButton" class="feedback-quick-button" type="button" aria-label="Feedback and issue report" title="Feedback and issue report"><span class="feedback-quick-button__pulse" aria-hidden="true"></span>${navIcon("08")}<span class="visually-hidden">Feedback</span></button>

    <section id="mapSheet" class="map-sheet" aria-labelledby="mapTitle" data-sheet-state="expanded">
      <button id="sheetToggle" class="sheet-handle" type="button" aria-expanded="true" aria-controls="sheetContent">
        <span aria-hidden="true"></span><span id="sheetHandleText" class="sheet-handle__text">وردەکاری ماپ</span>
      </button>
      <div id="mapAttributionSlot" class="map-sheet__attribution-slot" aria-live="polite"></div>
      <div class="sheet-header"><div class="sheet-header__copy"><p id="regionEyebrow" class="eyebrow">KURDISTAN REGION</p><h1 id="mapTitle">نەخشەی کوردستان</h1></div><div class="sheet-icon"><img src="${brandLogoSrc}" alt="NAV KURD logo" width="1024" height="1024" /></div></div>
      <div id="sheetContent" class="sheet-content">
      <p id="mapMessage" class="map-message" role="status">خەریکە داتای ڕاستەقینەی ماپەکە بار دەکرێت.</p>
      <div class="map-stats" role="group" aria-label="Map dataset details"><div><strong id="localityCount">—</strong><span id="localityStatLabel">شوێن</span></div><div><strong id="baseSearchCount">—</strong><span id="baseSearchStatLabel">داتای گەڕان</span></div><div><strong id="ownerPlaceCount">—</strong><span id="ownerPlaceStatLabel">شوێنی زیادکراو</span></div></div>
      <div class="action-grid"><button id="sheetLocateButton" class="action-card" type="button"><span class="action-card__icon action-card__icon--tracking" aria-hidden="true">${navIcon("06")}</span><span><strong id="locateTitle">شوێنی من</strong><small id="locateSub">شوێنی ئێستا و جوڵە</small></span></button><button id="sheetFitButton" class="action-card" type="button"><span class="action-card__icon" aria-hidden="true">${navIcon("09")}</span><span><strong id="fitTitle">تەواوی هەرێم</strong><small id="fitSub">گەڕانەوە بۆ سنوور</small></span></button><button id="sheetShareLocationButton" class="action-card action-card--native-share" type="button"><span class="action-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="18" cy="5" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="19" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="m8.3 10.9 7.4-4.6M8.3 13.1l7.4 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span><strong id="shareLocationTitle">هاوبەشکردنی شوێن</strong><small id="shareLocationSub">لینکی شوێنی ئێستا</small></span></button></div>
      <div class="utility-row"><div class="segmented" role="group" aria-label="Language"><button data-language="ku" class="is-active" type="button">کوردی</button><button data-language="ar" type="button">عربي</button><button data-language="en" type="button">EN</button></div><span id="backendState" class="backend-state">داتای ناوخۆیی</span></div>
      <p id="mapNote" class="map-note">ماپەکە ڕێگا، شەقام، گوند، شار، سنوور و شوێنە گرنگەکانی هەرێمی کوردستان پیشان دەدات.</p>
      </div>
    </section>

    <div id="aboutDialog" class="about-dialog" hidden>
      <section class="about-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="aboutTitle" aria-describedby="aboutDescription">
        <span class="about-dialog__aurora" aria-hidden="true"></span>
        <div class="about-dialog__scroll">
        <div class="about-dialog__close-row">
          <button id="aboutCloseButton" class="dialog-close-button about-dialog__close" type="button" aria-label="Close about panel">
            ${dialogCloseIcon()}
          </button>
        </div>
        <div class="about-dialog__brand">
          <span class="about-dialog__logo"><img src="${brandLogoSrc}" alt="NAV KURD logo" width="1024" height="1024" /></span>
          <div><p id="aboutEyebrow">NAV KURD</p><h2 id="aboutTitle">Kurdistan Atlas</h2></div>
        </div>
        <figure class="about-dialog__cover">
          <img src="${appUrl("assets/promo/nav-kurd-v9-cover.jpg")}" alt="NAV KURD ${releaseVersion} application showcase" width="1536" height="910" loading="lazy" decoding="async" draggable="false" />
          <figcaption><span>NAV KURD ${releaseVersion}</span><strong>Built for Kurdistan. Native on Android. Fast on the web.</strong></figcaption>
        </figure>
        <p id="aboutDescription" class="about-dialog__description">A modern geographic atlas for roads, places, navigation, GPS and satellite context across the Kurdistan Region.</p>
        <dl class="about-dialog__meta">
          <div><dt id="aboutVersionLabel">Version</dt><dd>${releaseVersion}</dd></div>
          <div><dt id="aboutMapEditionLabel">Map edition</dt><dd id="aboutMapEditionValue">${mapEdition}</dd></div>
          <div><dt id="aboutDeveloperLabel">Developer</dt><dd class="about-dialog__developer"><span>SARHANG IO</span><a href="https://www.instagram.com/sarhang.io/" target="_blank" rel="noopener noreferrer" aria-label="Instagram — SARHANG IO"><img src="${import.meta.env.BASE_URL}assets/icons/social/instagram.svg" alt="" aria-hidden="true" /></a></dd></div>
          <div><dt id="aboutCvLabel">MY CV</dt><dd><a id="aboutCvLink" class="about-dialog__meta-link about-dialog__meta-link--cv" href="https://sarhang-cs.github.io/Sarhang-Cv/" target="_blank" rel="noopener noreferrer" aria-label="MY CV"><img class="about-dialog__meta-icon" src="${import.meta.env.BASE_URL}assets/support/my-cv-preview.jpg" alt="" width="1120" height="1680" loading="lazy" decoding="async" draggable="false" /></a></dd></div>
          <div><dt id="aboutCoverageLabel">Coverage</dt><dd id="aboutCoverageValue">Kurdistan Region + disputed areas</dd></div>
        </dl>
        <section id="offlineMapPack" class="offline-map-pack" data-status="idle" aria-labelledby="offlineMapPackHeading">
          <h3 id="offlineMapPackHeading" class="visually-hidden">Offline map pack</h3>
          <div class="offline-map-pack__header">
            <div><strong id="offlinePackTitle">Offline map</strong><small id="offlinePackStatus" role="status">Not downloaded</small></div>
            <span id="offlinePackSize">0 MB</span>
          </div>
          <div class="offline-map-pack__track" role="progressbar" aria-label="Offline map download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="offlinePackProgress"></span></div>
          <div class="offline-map-pack__meta">
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
          <span class="android-download__sky" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <div class="android-download__heading">
            <span class="android-download__mark" aria-hidden="true">
              <img src="${appUrl("assets/android-app-icon.png")}" alt="" width="1080" height="1080" loading="lazy" decoding="async" draggable="false" />
            </span>
            <div><p>NAV KURD ${releaseVersion}</p><h3 id="androidDownloadTitle">ئەپی Android دابگرە</h3><small id="androidDownloadSummary">وەشانی واژۆکراو و پشتڕاستکراو بۆ Android 7 و نوێتر</small></div>
          </div>
          <div class="android-download__actions">
            <a id="androidDirectDownload" class="android-download__primary Download-button" href="${appUrl(`downloads/NAV-KURD-${releaseVersion}.apk`)}" download="NAV-KURD-${releaseVersion}.apk">
              <svg viewBox="0 0 640 512" aria-hidden="true"><path fill="currentColor" d="M144 480C64.5 480 0 415.5 0 336c0-62.8 40.2-116.2 96.2-135.9-.1-2.7-.2-5.4-.2-8.1 0-88.4 71.6-160 160-160 59.3 0 111 32.2 138.7 80.2C409.9 102 428.3 96 448 96c53 0 96 43 96 96 0 12.2-2.3 23.8-6.4 34.6C596 238.4 640 290.1 640 352c0 70.7-57.3 128-128 128H144Zm79-167 80 80c9.4 9.4 24.6 9.4 33.9 0l80-80c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-39 39V184c0-13.3-10.7-24-24-24s-24 10.7-24 24v134.1l-39-39c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9Z"/></svg>
              <span><strong>APK دابگرە</strong><small>ڕاستەوخۆ · v${releaseVersion}</small></span>
            </a>
          </div>
        </section>
        <div id="offlinePackDeleteConfirm" class="offline-pack-confirm" hidden>
          <div class="offline-pack-confirm__backdrop" data-offline-pack-confirm="cancel"></div>
          <section class="offline-pack-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="offlinePackDeleteConfirmTitle" aria-describedby="offlinePackDeleteConfirmMessage">
            <span class="offline-pack-confirm__icon" aria-hidden="true">${navIcon("delete")}</span>
            <p class="offline-pack-confirm__eyebrow">NAV KURD</p>
            <h3 id="offlinePackDeleteConfirmTitle">Delete the offline map?</h3>
            <p id="offlinePackDeleteConfirmMessage">The downloaded offline map data will be removed from this device.</p>
            <div class="offline-pack-confirm__actions">
              <button id="offlinePackDeleteConfirmCancel" class="offline-pack-confirm__cancel" type="button" data-offline-pack-confirm="cancel">Cancel</button>
              <button id="offlinePackDeleteConfirmProceed" class="offline-pack-confirm__delete" type="button">Yes, delete</button>
            </div>
          </section>
        </div>
        <section id="nativeAppPanel" class="native-app-panel" aria-labelledby="nativeAppHeading" hidden>
          <div class="native-app-panel__header"><div><p id="nativePlatformEyebrow">NATIVE APP</p><h3 id="nativeAppHeading">ڕێکخستنەکانی ئەپی NAV KURD</h3></div><span id="nativePlatformIcon" aria-hidden="true"><img class="native-app-panel__icon" src="${appUrl("assets/native/info.svg")}" alt="" draggable="false"></span></div>
          <dl class="native-app-panel__status"><div><dt id="nativeConnectionTerm">تۆڕ</dt><dd id="nativeConnectionValue">—</dd></div><div><dt id="nativeStorageTerm">خەزن</dt><dd id="nativeCacheValue">—</dd></div></dl>
          <div class="native-app-panel__actions"><button id="nativeClearCacheButton" type="button" aria-label="پاککردنەوەی cache ـی کاتی" title="پاککردنەوەی cache ـی کاتی"><img class="native-app-panel__icon" src="${appUrl("assets/native/clear.svg")}" alt="" aria-hidden="true" draggable="false"><span id="nativeClearCacheLabel" class="native-app-panel__action-label">پاککردنەوەی cache ـی کاتی</span></button><button id="nativeOpenSettingsButton" type="button" aria-label="کردنەوەی Settings" title="کردنەوەی Settings"><img class="native-app-panel__icon" src="${appUrl("assets/native/settings.svg")}" alt="" aria-hidden="true" draggable="false"><span id="nativeOpenSettingsLabel" class="native-app-panel__action-label">کردنەوەی Settings</span></button></div>
          <p id="nativeAppNote">GPS permission، offline data، safe-area و deep links لە ڕێگەی سیستەمی ئامێرەکەت بەڕێوە دەبرێن.</p>
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
