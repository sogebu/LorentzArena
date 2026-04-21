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
 * 2026-04-21 統一: sphere + ring を **両方 past-cone surface anchor** に配置。
 * (旧: sphere は world event t で fixed → 観測者進行で sink し「実際の過去光円錐上の
 *      死亡位置より過去側に見える」違和感があった)。
 * 現: sphere も ring も spatial = death event、t = `observer.t - ρ` (= past-cone 交点)。
 * 物理解釈: 「死亡の光子が届く球面」が観測者に入る瞬間の点で、sphere (solid core) +
 * ring (外周) の bullseye 的マーカーとして観測者時刻と共に動く (display.t = -ρ 固定)。
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

  // Past-cone anchor: spatial = death event、t = observer.t - ρ (= 観測者過去光円錐が
  // death event の spatial 位置と交わる瞬間の時刻)。観測者進行で anchor.t も同等に進み、
  // display.t は常に -ρ (静止観測者なら「沈まない」)。
  let pastConeAnchor = deathEventPos;
  if (observerPos) {
    const dx = deathEventPos.x - observerPos.x;
    const dy = deathEventPos.y - observerPos.y;
    const rho = Math.sqrt(dx * dx + dy * dy);
    pastConeAnchor = { ...deathEventPos, t: observerPos.t - rho };
  }
  const dp = transformEventForDisplay(pastConeAnchor, observerPos, observerBoost);

  return (
    <>
      <mesh
        geometry={sharedGeometries.killSphere}
        position={[dp.x, dp.y, dp.t]}
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
        position={[dp.x, dp.y, dp.t]}
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
