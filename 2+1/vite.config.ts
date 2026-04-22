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
    // vendor 分離: app コード変更時の deploy で巨大 three.js chunk を再 DL させない。
    // - three: ~600 KB minified / ~150 KB gzip。version bump 以外で変化しない
    // - react: react + react-dom + react-reconciler + scheduler。R3F の base で必須
    // - peer: peerjs + webrtc-adapter + sdp + binarypack。network layer
    // - fiber: @react-three/fiber。R3F 層
    // chunkSizeWarningLimit: three chunk (~600 KB) が警告閾値 500 KB を越えるため緩和
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("/three/")) return "three";
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-reconciler/") ||
              id.includes("/scheduler/")
            )
              return "react";
            if (
              id.includes("/peerjs") ||
              id.includes("/webrtc-adapter/") ||
              id.includes("/sdp/")
            )
              return "peer";
            if (id.includes("/@react-three/fiber/")) return "fiber";
          }
          return undefined;
        },
      },
    },
    // three chunk は minified で ~740 KB (tree-shake 後の下限)。named import 化しない限り
    // これ以上縮まないので警告閾値を 800 に緩和 (vendor なので通常 deploy で変化しない)。
    chunkSizeWarningLimit: 800,
  },
});
