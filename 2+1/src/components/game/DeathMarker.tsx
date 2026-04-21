import * as THREE from "three";
import type { Vector4 } from "../../physics";
import {
  KILL_NOTIFICATION_RING_OPACITY,
  KILL_NOTIFICATION_SPHERE_OPACITY,
} from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { sharedGeometries } from "./threeCache";

/**
 * 死亡 marker (sphere + ring): 観測者の過去光円錐が death event に到達してから出現、
 * DEBRIS_MAX_LAMBDA かけて fade 1→0 で消失する「死亡光子到達」エフェクト。
 *
 * LH / 自機 / 他機 共通。`computePastConeDisplayState` が返す `deathMarkerAlpha` を
 * そのまま `alpha` に渡す (null なら描画スキップ)。
 *
 * 2 つの marker は **anchor 方針が異なる**:
 *   - **Sphere**: world event 位置 (= 時空点 deathT で fixed) → 観測者進行で sink する。
 *     「死亡 event がどこ・いつ起きたか」を時空内に literal に示す不動の点。
 *   - **Ring**: 過去光円錐 surface 上 (= death event の spatial 位置 × `observer.t - ρ`)。
 *     観測者進行で anchorT も `+Δt` 足されて動く → display.t = -ρ で推移。静止観測者なら
 *     display.t 一定で「沈まない」。physics 的には「死亡の光子が届く球面が時間と共に広がる、
 *     その球面が死亡 event の spatial 位置と交わる点」。
 */
export const DeathMarker = ({
  deathEventPos,
  alpha,
  color,
}: {
  deathEventPos: Vector4;
  /** null なら描画しない (past-cone 未到達 / fade 完了)。0..1 = sphere+ring の opacity 乗数。 */
  alpha: number | null;
  color: THREE.Color;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();
  if (alpha == null || alpha <= 0) return null;

  // Sphere: world event 位置に C pattern で並進 (沈む = 観測者進行で display.t < 0)。
  const sphereDp = transformEventForDisplay(deathEventPos, observerPos, observerBoost);

  // Ring: 過去光円錐 surface anchor。spatial 位置は death event、時刻は観測者の
  // 過去光円錐と交差する時刻 (= observer.t - ρ) に更新。観測者時刻が進むと anchor の
  // 世界時刻も足され、display.t = -ρ で推移 (静止観測者なら沈まない)。
  let ringAnchor = deathEventPos;
  if (observerPos) {
    const dx = deathEventPos.x - observerPos.x;
    const dy = deathEventPos.y - observerPos.y;
    const rho = Math.sqrt(dx * dx + dy * dy);
    ringAnchor = { ...deathEventPos, t: observerPos.t - rho };
  }
  const ringDp = transformEventForDisplay(ringAnchor, observerPos, observerBoost);

  return (
    <>
      <mesh
        geometry={sharedGeometries.killSphere}
        position={[sphereDp.x, sphereDp.y, sphereDp.t]}
      >
        <meshBasicMaterial
          color={color}
          transparent
          depthWrite={false}
          opacity={KILL_NOTIFICATION_SPHERE_OPACITY * alpha}
        />
      </mesh>
      <mesh
        geometry={sharedGeometries.killRing}
        position={[ringDp.x, ringDp.y, ringDp.t]}
      >
        <meshBasicMaterial
          color={color}
          transparent
          depthWrite={false}
          opacity={KILL_NOTIFICATION_RING_OPACITY * alpha}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
};
