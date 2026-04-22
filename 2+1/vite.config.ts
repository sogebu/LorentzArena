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
  build: {
    // vendor を単一 chunk に束ねる。app コード変更時の deploy で vendor を再 DL
    // させない cache 分離効果は維持しつつ、vendor 内細分割による循環 import を回避。
    //
    // **循環 import 事故 (2026-04-22、`4928c98` で導入 → `16b7f55` 後に発覚)**:
    // react / @react-three/fiber / react-reconciler を別 chunk に分けたら
    // react chunk と fiber chunk が相互に `import` し合い、ESM 循環で TDZ error
    // → 本番真っ白。原因は react-reconciler が fiber の内部 helper を、fiber が
    // react-reconciler を相互参照するため。vendor 細分割するなら循環の実在を
    // 事前に確認する必要があり、確認コストより単一 chunk のシンプルさを優先。
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes("node_modules") ? "vendor" : undefined,
      },
    },
    // vendor chunk は minified で ~1.2 MB (three.js 738 KB 支配)。warning 緩和。
    chunkSizeWarningLimit: 1400,
  },
});
