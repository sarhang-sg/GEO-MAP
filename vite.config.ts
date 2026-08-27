import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  return {
    base: env.VITE_BASE_PATH || "/",
    clearScreen: false,
    server: { host: "0.0.0.0", port: 4173, strictPort: true },
    build: {
      target: "es2022", sourcemap: false, cssCodeSplit: true, reportCompressedSize: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } }
    },
    watch: { ignored: ["**/src-tauri/**", "**/android/**", "**/ios/**"] }
  };
});
