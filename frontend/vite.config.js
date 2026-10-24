import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Production builds are minified with Vite's default minifier, which also
// removes `debugger` statements. Debug logging is silenced at runtime in
// production (see src/main.jsx); errors and warnings stay visible.
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false, // Prevents raw source code leakage in browser Inspect / DevTools
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
