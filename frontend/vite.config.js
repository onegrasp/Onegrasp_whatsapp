import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Production bundles drop debug logging and debugger statements. Errors and
  // warnings stay, so problems can still be investigated in the browser.
  esbuild: command === "build" ? { pure: ["console.log", "console.info", "console.debug"], drop: ["debugger"] } : {},
  build: {
    sourcemap: false, // Prevents raw source code leakage in browser Inspect / DevTools
    minify: "esbuild",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
}));
