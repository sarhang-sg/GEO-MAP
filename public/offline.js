(() => {
  "use strict";

  const readyMetadata = () => {
    try {
      const metadata = JSON.parse(localStorage.getItem("nav-kurd:offline-map-pack") ?? "null");
      if (!metadata || metadata.schema !== 1 || metadata.runtime?.complete !== true) return false;
      const files = metadata.files && typeof metadata.files === "object" ? Object.values(metadata.files) : [];
      return files.length > 0 && files.every((file) => file && file.complete === true && file.headerVerified === true);
    } catch {
      return false;
    }
  };

  const openApp = (reason) => {
    const target = new URL("./", location.href);
    target.searchParams.set("source", "pwa");
    target.searchParams.set(reason, "1");
    location.replace(target.href);
  };

  document.querySelectorAll("[data-offline-action]").forEach((button) => {
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("dragstart", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (button.getAttribute("data-offline-action") === "back") {
        if (history.length > 1) history.back();
        else openApp("back");
        return;
      }
      openApp("retry");
    });
  });

  if (readyMetadata() && !new URL(location.href).searchParams.has("offline_recovery")) {
    const target = new URL("./", location.href);
    target.searchParams.set("source", "pwa");
    target.searchParams.set("offline_recovery", "1");
    location.replace(target.href);
  }
})();
