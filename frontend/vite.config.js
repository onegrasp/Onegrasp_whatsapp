import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false, // Prevents raw source code leakage in browser Inspect / DevTools
    minify: "esbuild",
    terserOptions: {
      compress: {
        drop_console: true, // Strips console.log outputs in production bundle
        drop_debugger: true,
      },
    },
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
});
