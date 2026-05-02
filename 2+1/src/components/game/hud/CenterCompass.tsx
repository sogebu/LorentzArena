import { useI18n } from "../../../i18n";
import { useGameStore } from "../../../stores/game-store";
import type { RelativisticPlayer } from "../types";

/**
 * 画面上中央の「arena 中心方向」 矢印 + 距離表示。 自機が arena 遠方に飛んだとき
 * 「どっちに戻れば中心」 が一目で分かるようにする onboarding UX (= EXPLORING.md
 * §「遠くに行って戻れない」 問題 1a、 2026-05-02 odakin 自律実装)。
 *
 * - **回転 angle**: 自機 cameraYaw を画面上方向 (heading-up) と仮定、 world 原点
 *   方向 `θ_w = atan2(-obs.y, -obs.x)` を heading-up screen に変換 → CSS clockwise
 *   rotation `cameraYaw - θ_w`。 modern controlScheme (cameraYaw=0) では world basis
 *   (= 上 = +y world) 基準、 legacy では heading 基準で全 mode 自然。
 * - **距離**: `√(obs.x² + obs.y²)` を `m` 単位で。 1m 未満は「中心」 表記、 矢印 hide。
 *   torus mode は最短画像ではなく **raw 連続値距離** で出す (= 「自分が原点から
 *   どれだけ離れたか」 という cumulative 距離。 PBC は描画上の話なので onboarding
 *   guide としては raw が直感的)。
 * - **位置**: 画面上端中央 (top-center)、 fixed。 ControlPanel (top-left) /
 *   Connect (top-right) / Speedometer (bottom-right) / Radar (bottom-left) と
 *   conflict しない zone を採用。
 */
export const CenterCompass = ({
  myId,
  cameraYawRef,
}: {
  myId: string | null;
  cameraYawRef: React.RefObject<number>;
}) => {
  const { t } = useI18n();
  const players = useGameStore((s) => s.players);
  const myDeathEvent = useGameStore((s) => s.myDeathEvent);
  const rawMyPlayer = myId ? players.get(myId) : undefined;
  // 死亡中は ghost phaseSpace で観測者位置を取る (Radar / HUD / SceneContent と
  // 同じ swap pattern)。 ghost も中心方向を知りたい (= 復活 spawn は中心近くなので)。
  const myPlayer: RelativisticPlayer | undefined =
    rawMyPlayer?.isDead && myDeathEvent
      ? { ...rawMyPlayer, phaseSpace: myDeathEvent.ghostPhaseSpace }
      : rawMyPlayer;

  if (!myPlayer) return null;
  const obs = myPlayer.phaseSpace.pos;
  const dist = Math.hypot(obs.x, obs.y);
  const yaw = cameraYawRef.current ?? 0;
  // 中心方向 (= world 原点) の screen-space rotation。 上方向 (= heading-up screen +y)
  // から CSS clockwise positive で測る。 詳細は file docstring。
  const dirAngle = Math.atan2(-obs.y, -obs.x);
  const screenRotationRad = yaw - dirAngle;

  // 中心近傍は矢印 hide、 「中心」 だけ表示 (= ノイズ抑制)。
  // 単位は内部 c=1 自然単位の光秒 (= ls)。 1 光秒 ≈ 30 万 km なので「中心」 圏は十分狭い。
  const NEAR_CENTER_THRESHOLD = 1.0; // ls

  return (
    <div
      style={{
        position: "absolute",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        color: "rgba(255, 255, 255, 0.85)",
        fontFamily: "monospace",
        fontSize: "13px",
        textAlign: "center",
        pointerEvents: "none",
        textShadow: "0 0 4px rgba(0, 0, 0, 0.9)",
        zIndex: 10000,
      }}
    >
      {dist < NEAR_CENTER_THRESHOLD ? (
        <div style={{ opacity: 0.6 }}>● {t("hud.center")}</div>
      ) : (
        <>
          <svg
            width="22"
            height="22"
            viewBox="-10 -10 20 20"
            style={{
              transform: `rotate(${screenRotationRad}rad)`,
              display: "block",
              margin: "0 auto",
              filter: "drop-shadow(0 0 2px rgba(0, 0, 0, 0.85))",
            }}
            aria-hidden="true"
          >
            {/* 上向き三角形 (= 元の orientation で screen +y = up を指す)。
                rotate で実際の direction を決める。 chevron 風 ストローク + 塗り。 */}
            <polygon
              points="0,-7 5,5 0,2 -5,5"
              fill="rgba(255, 255, 255, 0.85)"
              stroke="rgba(0, 0, 0, 0.6)"
              strokeWidth="0.6"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ marginTop: "2px" }}>
            {dist.toFixed(0)} {t("hud.distanceUnit")}
          </div>
        </>
      )}
    </div>
  );
};
