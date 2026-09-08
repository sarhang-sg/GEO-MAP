import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, type Plugin } from "vite";

function navKurdPreviewHeaders(): Plugin {
  return {
    name: "nav-kurd-preview-headers",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? "").split("?", 1)[0];
        if (pathname === "/downloads/NAV-KURD-9.1.0.apk") {
          // Match the exact Vercel production contract during the real-browser
          // CI run. Vite's MIME table has no .apk entry and otherwise emits an
          // empty Content-Type, causing the intentionally strict client probe
          // to hide a valid signed download only in preview.
          response.setHeader("Content-Type", "application/vnd.android.package-archive");
          response.setHeader("Content-Disposition", "attachment; filename=\"NAV-KURD-9.1.0.apk\"");
          response.setHeader("X-Content-Type-Options", "nosniff");
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  return {
    plugins: [navKurdPreviewHeaders()],
    base: env.VITE_BASE_PATH || "/",
    clearScreen: false,
    server: { host: "0.0.0.0", port: 4173, strictPort: true },
    build: {
      target: "es2022", sourcemap: false, cssCodeSplit: true, reportCompressedSize: true,
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        output: {
          manualChunks: (moduleId) => moduleId.includes("/node_modules/maplibre-gl/") ? "maplibre" : undefined
        }
      }
    }
  };
});
