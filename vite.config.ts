import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { resolveBuildNumber } from "./scripts/build-number.mjs";

const buildNumber = resolveBuildNumber();

export default defineConfig({
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/gateway": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
