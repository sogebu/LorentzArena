import { useI18n } from "../../i18n/I18nContext";
import { useGameStore } from "../../stores/game-store";

/**
 * WebGL context が失われたときに「再読込」 を促す overlay。
 *
 * **背景**: ブラウザ / OS が GPU resource を reclaim する条件 (= macOS の background tab
 * GPU 解放、 Chrome の WebGL context 数上限到達、 GPU driver reset 等) で `webglcontextlost`
 * event が発火すると、 Three.js の描画が完全に停止する (= 背景の星屑も含めて全 useFrame の
 * 結果が画面に出ない)。 内部の physics tick / setInterval / React state は走り続けるが
 * **画面だけが固まって見える**。
 *
 * **復元の難しさ**: `webglcontextrestored` event 後に Three.js の geometry / texture /
 * shader を全 reinit する必要があり、 R3F の scene tree を再構築する大がかりな処理。
 * 現実装ではユーザーに「再読込」 (= page reload) を促す方が確実 + シンプル。
 *
 * **設計選択**:
 * - state ソース: `useGameStore.webglContextLost` (= `RelativisticGame.tsx` の Canvas
 *   `onCreated` で `webglcontextlost` listener が `setWebglContextLost(true)` を呼ぶ)
 * - 復元: 現状なし、 ユーザー操作で `location.reload()` のみ
 * - 一度 lost 検知したら overlay は出っ放し (= context restore でも自動 hide しない、
 *   reinit が確実に成功するか保証できないため)
 *
 * 詳細: `plans/2026-05-02-causality-symmetric-jump.md` 後の WebGL Context Lost 調査。
 * 構造的問題として `<Canvas key="...">` を mode 切替で 3 instance churn しているのも
 * 寄与因 (= 段階 2 で unify 検討)。 本 overlay は段階 1 の最低限 recovery path。
 */
export const WebGLLostOverlay = () => {
  const { t } = useI18n();
  const lost = useGameStore((s) => s.webglContextLost);

  if (!lost) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        background: "rgba(0, 0, 0, 0.82)",
        color: "#fff",
        textAlign: "center",
        fontSize: 16,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
        {t("webglLost.title")}
      </div>
      <div style={{ maxWidth: 480, lineHeight: 1.5, opacity: 0.92 }}>
        {t("webglLost.body")}
      </div>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        style={{
          marginTop: 12,
          padding: "10px 24px",
          fontSize: 16,
          fontWeight: 600,
          color: "#fff",
          background: "#3a86ff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {t("webglLost.reloadButton")}
      </button>
    </div>
  );
};
