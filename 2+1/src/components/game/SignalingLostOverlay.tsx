import { useI18n } from "../../i18n/I18nContext";
import { useGameStore } from "../../stores/game-store";

/**
 * PeerJS signaling (WebSocket to PeerServer) が **N 秒以上死亡持続** したとき、
 * user に「再読込」 を促す escape hatch overlay。
 *
 * **背景**: sleep-wake / network split / OS suspend resume で WebSocket 切断後の同
 * Peer instance 再接続が PeerJS 既知挙動で困難 (= `Cannot connect to new Peer after
 * disconnecting from server` で stuck)。 この状態に陥ると tab は「シグナリング: エラー」
 * 表示のまま peers が見つからず、 user は HUD の小さな表示を凝視するしかない。 本 overlay
 * は modal で「再読込」 を明示する全 mode 対称 escape hatch。
 *
 * **設計**:
 * - state ソース: `useGameStore.signalingDead` (= `PeerProvider.tsx` の useEffect が
 *   `peerStatus.status === 'disconnected' | 'error'` を 10 sec watch して立てる、 但し
 *   `unavailable-id` は room discovery auto-connect flow の expected error なので除外)
 * - 復元: 現状なし、 ユーザー操作で `location.reload()` のみ。 (d) PeerJS instance reset
 *   実装後は signaling 自動復帰経路が増えるので modal 出現頻度は下がる見込み
 * - 一度 `signalingDead = true` になったら overlay は出っ放し (= 自動復帰でも user
 *   confirm を経由する方が運用しやすい、 stuck 状態と区別しにくいため)
 *
 * **思想 doc**: [`design/network-recovery.md`](../../../design/network-recovery.md)
 *   軸 2 (escape hatch 軸) + 軸 3 H3 (PeerJS WebSocket 切断後の再接続困難)。
 * **実装 plan**: [`plans/2026-05-05-network-split-rule-b-runaway.md`](../../../plans/2026-05-05-network-split-rule-b-runaway.md)
 *   §3 (e)。 (a)/(d) deploy までの安全網 + permanent な全 mode 対称 escape hatch。
 */
export const SignalingLostOverlay = () => {
  const { t } = useI18n();
  const lost = useGameStore((s) => s.signalingDead);

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
        {t("signalingLost.title")}
      </div>
      <div style={{ maxWidth: 480, lineHeight: 1.5, opacity: 0.92 }}>
        {t("signalingLost.body")}
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
        {t("signalingLost.reloadButton")}
      </button>
    </div>
  );
};
