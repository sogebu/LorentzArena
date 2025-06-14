import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  base: "/LorentzArena/",
  plugins: [
    react(),
    visualizer({
      filename: "./dist/stats.html",
      open: false, // 自動で開かないように変更
      gzipSize: true,
      brotliSize: true,
    }),
  ],
});
