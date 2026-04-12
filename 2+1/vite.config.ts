import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  base: "/LorentzArena/",
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    ),
  },
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
