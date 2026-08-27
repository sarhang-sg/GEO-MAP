(() => {
  "use strict";
  const supported = new Set(["ku", "ar", "en"]);
  const query = new URLSearchParams(location.search).get("lang")?.toLowerCase();
  let stored = null;
  try { stored = localStorage.getItem("nav-kurd:legal-language"); } catch { /* Optional storage. */ }
  const browser = navigator.language.toLowerCase().startsWith("ar")
    ? "ar"
    : navigator.language.toLowerCase().startsWith("en") ? "en" : "ku";
  const initial = supported.has(query) ? query : supported.has(stored) ? stored : browser;

  const apply = (language) => {
    if (!supported.has(language)) return;
    document.documentElement.lang = language === "ku" ? "ckb" : language;
    document.documentElement.dir = language === "en" ? "ltr" : "rtl";
    document.querySelectorAll("[data-legal-lang]").forEach((article) => {
      article.hidden = article.dataset.legalLang !== language;
    });
    document.querySelectorAll("[data-language]").forEach((button) => {
      const active = button.dataset.language === language;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    try { localStorage.setItem("nav-kurd:legal-language", language); } catch { /* Optional storage. */ }
  };

  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => apply(button.dataset.language));
  });
  apply(initial);
})();
