import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv, type Plugin } from "vite";

function navKurdPreviewHeaders(): Plugin {
  return {
    name: "nav-kurd-preview-headers",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? "").split("?", 1)[0];
        if (/^\/downloads\/NAV-KURD-\d+\.\d+\.\d+\.apk$/.test(pathname)) {
          // Match the exact Vercel production contract during the real-browser
          // CI run. Vite's MIME table has no .apk entry and otherwise emits an
          // empty Content-Type, causing the intentionally strict client probe
          // to hide a valid signed download only in preview.
          response.setHeader("Content-Type", "application/vnd.android.package-archive");
          response.setHeader("Content-Disposition", `attachment; filename="${pathname.split("/").at(-1)}"`);
          response.setHeader("X-Content-Type-Options", "nosniff");
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const nativeBundle = process.env.NAV_KURD_ANDROID_PRESENTATION === "1";
  const declarations = readFileSync(fileURLToPath(new URL("src/vite-env.d.ts", import.meta.url)), "utf8");
  const keys = [...declarations.matchAll(/readonly (VITE_\w+)\?/g)].map(match => match[1]);
  const settings: Record<string,string> = Object.fromEntries(keys.filter(key => env[key]).map(key => [key, env[key]]));
  const supabaseKey = settings.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (supabaseKey && !supabaseKey.startsWith("sb_publishable_") && JSON.parse(Buffer.from(supabaseKey.split(".")[1] || "", "base64url").toString()).role !== "anon") {
    throw new Error("Supabase browser configuration must use a publishable or anon key.");
  }
  if (settings.VITE_KRI_MAPBOX_ACCESS_TOKEN && !settings.VITE_KRI_MAPBOX_ACCESS_TOKEN.startsWith("pk.")) throw new Error("Mapbox browser configuration requires a public token.");
  const defines: Record<string,string> = {__ANDROID_PRESENTATION__: JSON.stringify(nativeBundle)};
  if (nativeBundle) for (const key of keys) defines["import.meta.env."+key] = "globalThis.__NAV_KURD_PUBLIC_CONFIG__."+key;
  return {
    define: defines,
    plugins: [navKurdPreviewHeaders(), {name:"nav-kurd-public-settings", generateBundle() {
      if (!nativeBundle) this.emitFile({type:"asset",fileName:"client-config.json",source:JSON.stringify(settings)});
    }}],
    base: env.VITE_BASE_PATH || "/",
    clearScreen: false,
    server: { host: "0.0.0.0", port: 4173, strictPort: true },
    build: {
      emptyOutDir: true,
      target: "es2022", sourcemap: false, cssCodeSplit: true, reportCompressedSize: true,
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        input: {index:fileURLToPath(new URL("index.html",import.meta.url)), cities:fileURLToPath(new URL("weather-cities.html",import.meta.url))},
        output: {
          manualChunks: (moduleId) => (moduleId.includes("/node_modules/maplibre-gl/") || moduleId.includes("/vendor/maplibre-gl/")) ? "maplibre" : undefined
        }
      }
    }
  };
});
