import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The Redaktion (editor UI). Built into dist/editor and served by the editor container.
export default defineConfig({
  root: fileURLToPath(new URL("./src/editor", import.meta.url)),
  base: "/",
  // Milkdown's Vue parts: no Options API, no prod devtools (smaller bundle, no console warning).
  define: {
    __VUE_OPTIONS_API__: "false",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/editor", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "assets",
    chunkSizeWarningLimit: 2000,
  },
});
