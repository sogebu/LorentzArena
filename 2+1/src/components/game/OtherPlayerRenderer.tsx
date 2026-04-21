import { useMemo } from "react";
import { getVelocity4, type Vector4 } from "../../physics/vector";
import {
  DEATH_TAU_MAX,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_SIZE_OTHER,
} from "./constants";
import { DeathMarker } from "./DeathMarker";
import {
  pastLightConeIntersectionDeathWorldLine,
} from "./deathWorldLine";
import { useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { RelativisticPlayer } from "./types";

/**
 * **死亡プレイヤー用** の body sphere + DeathMarker。
 * 2026-04-22 統一アルゴリズム:
 *   - body は死亡時空点 x_D に固定 (沈む = 観測者進行で display.t < 0)
 *   - opacity は `a_0 · (DEATH_TAU_MAX − τ_0) / DEATH_TAU_MAX` (linear fade、τ_0 = W_D 交点 proper time)
 *   - τ_0 < 0 (光未到達) / τ_0 > DEATH_TAU_MAX (fade 完了) は null
 *   - DeathMarker へは (x_D, u_D) をそのまま渡す
 *
 * x_D / u_D の出所:
 *   - self-dead: `deathEventOverride = myDeathEvent.pos` / `uD = myDeathEvent.u` (SceneContent から注入)
 *   - other-dead: `player.phaseSpace.pos` (死亡時刻で凍結) と `getVelocity4(player.phaseSpace.u)`
 */
export const OtherPlayerRenderer = ({
  player,
  deathEventOverride,
  uDOverride,
}: {
  player: RelativisticPlayer;
  /** self-dead で `myDeathEvent.pos` を渡す (他者は phaseSpace.pos が freeze 済なので不要)。 */
  deathEventOverride?: Vector4;
  /** self-dead で `myDeathEvent.u` (= 4-velocity) を渡す。他者は phaseSpace.u から getVelocity4。 */
  uDOverride?: Vector4;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();
  const color = useMemo(() => getThreeColor(player.color), [player.color]);
  const size = PLAYER_MARKER_SIZE_OTHER;

  if (!player.isDead || !observerPos) return null;

  const xD = deathEventOverride ?? player.phaseSpace.pos;
  const uD = uDOverride ?? getVelocity4(player.phaseSpace.u);

  const tau0 = pastLightConeIntersectionDeathWorldLine(xD, uD, observerPos);
  if (tau0 == null || tau0 < 0 || tau0 > DEATH_TAU_MAX) return null;

  const bodyAlpha = (DEATH_TAU_MAX - tau0) / DEATH_TAU_MAX;
  const dp = transformEventForDisplay(xD, observerPos, observerBoost);
  const mainOpacity = PLAYER_MARKER_MAIN_OPACITY_OTHER * bodyAlpha;
  const glowOpacity = PLAYER_MARKER_GLOW_OPACITY_OTHER * bodyAlpha;

  return (
    <group>
      <group position={[dp.x, dp.y, dp.t]}>
        <mesh
          scale={[size, size, size]}
          geometry={sharedGeometries.playerSphere}
        >
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.4}
            roughness={0.3}
            metalness={0.1}
            transparent
            depthWrite={false}
            opacity={mainOpacity}
          />
        </mesh>
        <mesh
          scale={[size * 1.8, size * 1.8, size * 1.8]}
          geometry={sharedGeometries.playerSphere}
        >
          <meshBasicMaterial
            color={color}
            transparent
            depthWrite={false}
            opacity={glowOpacity}
          />
        </mesh>
      </group>
      <DeathMarker xD={xD} uD={uD} color={color} />
    </group>
  );
};
