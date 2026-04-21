import { useMemo } from "react";
import * as THREE from "three";
import {
  pastLightConeIntersectionWorldLine,
  quatToYaw,
  type Vector4,
} from "../../physics";
import {
  ARROW_BASE_LENGTH,
  ARROW_BASE_OFFSET,
  ARROW_BASE_WIDTH,
  ARROW_MAX_OPACITY,
  EXHAUST_VISIBILITY_THRESHOLD,
  PLAYER_ACCELERATION,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_SIZE_OTHER,
} from "./constants";
import { DeathMarker } from "./DeathMarker";
import { useDisplayFrame } from "./DisplayFrameContext";
import { transformEventForDisplay } from "./displayTransform";
import { computePastConeDisplayState } from "./pastConeDisplay";
import { getLatestSpawnT } from "./respawnTime";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { RelativisticPlayer } from "./types";
import { selectInvincibleUntil, useGameStore } from "../../stores/game-store";

/**
 * プレイヤー (non-LH) の sphere marker。生存/死亡両対応、self/other 両用:
 *
 * 生存中:
 *   - 現在 world 位置に sphere + glow halo (gameplay 視認性優先)。過去光円錐の到達を
 *     待たず即座に表示 (LH の live sphere と同じ pattern)。動いているプレイヤーの past-cone
 *     交差は `worldLineIntersections` の gnomon marker で別途表示されるため、ここでは
 *     あえて current world pos を使って「相対論的に非整合だが gameplay 的に分かる位置」を示す。
 *   - 無敵 (respawn 直後 INVINCIBILITY_DURATION 内): 2Hz pulse で opacity oscillate。
 * 死亡中:
 *   - `deathEventOverride` (self 用、myDeathEvent.pos) があればそれを death event として使用、
 *     なければ player.phaseSpace.pos を死亡 event とする (other player は phaseSpace.pos が
 *     死亡時で freeze するため、self は ghost 追従で動くため override が必要)。
 *   - `computePastConeDisplayState` で past-cone fade を適用 (観測者の過去光円錐が死亡 event
 *     を通過したら alpha 1→0 を DEBRIS_MAX_LAMBDA で linear に。完了で完全消失)。
 *     **LH tower と同じ relativistic death logic** の共通化。
 *
 * 世界系表示 (observerPos null): pastCone 無視、現在 pos で常時表示。
 */
export const OtherPlayerRenderer = ({
  player,
  deathEventOverride,
}: {
  player: RelativisticPlayer;
  /**
   * 死亡 event の world 位置。Self-dead の場合は myDeathEvent.pos を渡す
   * (player.phaseSpace.pos は ghost 追従で動いているため death event 位置ではない)。
   * 省略時は player.phaseSpace.pos を使う (= other player 向け default)。
   */
  deathEventOverride?: Vector4;
}) => {
  const { observerPos, observerBoost, displayMatrix } = useDisplayFrame();
  const color = useMemo(() => getThreeColor(player.color), [player.color]);
  const size = PLAYER_MARKER_SIZE_OTHER;

  const invUntil = selectInvincibleUntil(useGameStore.getState(), player.id);
  const isInvincible = Date.now() < invUntil;
  // Pulse: opacity oscillates 0.3–1.0 at 2Hz during invincibility (生存時のみ意味あり)
  const pulse = isInvincible ? 0.65 + 0.35 * Math.sin(Date.now() * 0.012) : 1.0;

  const respawnLog = useGameStore((s) => s.respawnLog);
  const wp = player.phaseSpace.pos;

  // 描画位置と alpha を生存/死亡で切り分け。死亡中は死亡 event 位置の past-cone fade に加え、
  // "死亡光子到達" を示す sphere + ring marker も同時に描画 (LH / killNotification から統合移植)。
  let renderPos = wp;
  let deathAlpha = 1;
  let deathEventPosForMarker: Vector4 | null = null;
  let deathMarkerAlpha: number | null = null;
  if (player.isDead) {
    const deathEventPos = deathEventOverride ?? wp;
    // 死亡 branch は spawnT を使わないが、API 整合のため respawnLog 経由で取得。
    // gap-reset で worldLine.history[0] が書き換わっても影響を受けない。
    const spawnT = getLatestSpawnT(respawnLog, player);
    const state = computePastConeDisplayState(deathEventPos, spawnT, true, observerPos);
    if (!state.visible) return null;
    renderPos = state.anchorPos;
    deathAlpha = state.alpha;
    deathEventPosForMarker = deathEventPos;
    deathMarkerAlpha = state.deathMarkerAlpha;
  }

  const dp = transformEventForDisplay(renderPos, observerPos, observerBoost);
  const mainOpacity = PLAYER_MARKER_MAIN_OPACITY_OTHER * pulse * deathAlpha;
  const glowOpacity = PLAYER_MARKER_GLOW_OPACITY_OTHER * pulse * deathAlpha;

  // Past-cone 交点で nose / 加速度矢印を描く (=「観測者に光が届いた時点の他機状態」)。
  // sphere は gameplay 視認性のため current world pos のまま (二重表示的だが、"NOW の
  // 位置" と "SEE している状態" を分離する意図: 空間オフセットが相対論的遅延の educational
  // な指標にもなる)。死亡中は nose / 矢印 非表示 (sphere は past-cone fade で別途処理済)。
  //
  // worldLine history の各 sample には heading / alpha が Phase A-1/A-3 で同梱されており、
  // pastLightConeIntersectionWorldLine は A-4 の `interpolateSegmentPhaseSpace` で
  // heading を slerp、alpha を linear 補間した PhaseSpace を返す。
  const pcIntersection =
    !player.isDead && observerPos
      ? pastLightConeIntersectionWorldLine(player.worldLine, observerPos)
      : null;
  const dpAnchor = pcIntersection
    ? transformEventForDisplay(pcIntersection.pos, observerPos, observerBoost)
    : null;

  // Heading indicator (nose bar): past-cone 交点の heading から yaw 抽出。
  // display frame での z 軸 yaw rotation は aberration 近似 (static 観測者で正確)。
  const yaw = pcIntersection ? quatToYaw(pcIntersection.heading) : 0;
  const noseLength = size * 1.6;
  const showNose = pcIntersection !== null && dpAnchor !== null;

  // Acceleration arrow: past-cone 交点の alpha (world 4-vec) を displayMatrix で
  // display frame に boost し、display spatial 方向 (x, y) を矢印で可視化。
  const alphaWorldT = pcIntersection?.alpha ?? null;
  const alphaDispDir = alphaWorldT
    ? new THREE.Vector4(
        alphaWorldT.x,
        alphaWorldT.y,
        alphaWorldT.t,
        0, // direction vector (translation 不作用)
      ).applyMatrix4(displayMatrix)
    : null;
  const dispAx = alphaDispDir?.x ?? 0;
  const dispAy = alphaDispDir?.y ?? 0;
  const alphaMag = Math.hypot(dispAx, dispAy);
  const alphaFrac = Math.min(1, alphaMag / PLAYER_ACCELERATION);
  const showArrow =
    pcIntersection !== null &&
    dpAnchor !== null &&
    alphaFrac > EXHAUST_VISIBILITY_THRESHOLD &&
    alphaMag > 1e-6;
  const arrowYaw = showArrow ? Math.atan2(dispAy, dispAx) - Math.PI / 2 : 0;
  const arrowLen = ARROW_BASE_LENGTH * alphaFrac;
  const arrowCenterOffset = size + ARROW_BASE_OFFSET + 0.5 * arrowLen;
  const arrowX = showArrow ? (dispAx / alphaMag) * arrowCenterOffset : 0;
  const arrowY = showArrow ? (dispAy / alphaMag) * arrowCenterOffset : 0;

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
            depthWrite={!player.isDead}
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
      {/* Past-cone 交点位置の nose / 加速度矢印。sphere とは空間的にオフセットし得る
          (他機が光速に近い相対速度で動いてる時、我々が "見ている" 位置は現在位置より遅れ、
          sphere との差が相対論的遅延そのもの)。 */}
      {(showNose || showArrow) && dpAnchor && (
        <group position={[dpAnchor.x, dpAnchor.y, dpAnchor.t]}>
          {showNose && (
            <group rotation={[0, 0, yaw]}>
              <mesh
                position={[size * 0.9, 0, 0]}
                scale={[noseLength, size * 0.25, size * 0.25]}
                geometry={sharedGeometries.playerSphere}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  depthWrite={false}
                  opacity={PLAYER_MARKER_MAIN_OPACITY_OTHER * pulse * 0.9}
                />
              </mesh>
            </group>
          )}
          {showArrow && (
            <mesh
              position={[arrowX, arrowY, 0]}
              rotation={[0, 0, arrowYaw]}
              scale={[ARROW_BASE_WIDTH * alphaFrac, arrowLen, 1]}
              geometry={sharedGeometries.accelerationArrowFlat}
            >
              <meshBasicMaterial
                color={color}
                transparent
                depthWrite={false}
                opacity={ARROW_MAX_OPACITY * alphaFrac}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
        </group>
      )}
      {deathEventPosForMarker && (
        <DeathMarker
          deathEventPos={deathEventPosForMarker}
          alpha={deathMarkerAlpha}
          color={color}
        />
      )}
    </group>
  );
};
