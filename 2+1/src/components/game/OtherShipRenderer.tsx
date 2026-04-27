import { useRef } from "react";
import {
  createVector3,
  lorentzBoost,
  multiplyVector4Matrix4,
  pastLightConeIntersectionWorldLine,
  type Vector3,
} from "../../physics";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import { useDisplayFrame } from "./DisplayFrameContext";
import { SelfShipRenderer } from "./SelfShipRenderer";
import type { RelativisticPlayer } from "./types";

/**
 * 他機の 3D ship 描画。SelfShipRenderer (自機と同じ 3D モデル) を流用し、
 * **past-cone 交点** の phaseSpace を "合成 player" としてフィードする:
 *
 * - pos: 観測者の過去光円錐と他機世界線の交点 (= 光が届いた瞬間の event 位置)
 * - heading: 同交点での姿勢 quaternion (slerp 補間済、Phase A-4)
 * - thrust ref: **被観測者 (ship) 静止系** での 4-加速度の空間成分 (proper acceleration)。
 *   `α_rest = lorentzBoost(u_subject) · α_world` の spatial part を毎 render で synthetic ref に
 *   commit。exhaust nozzle は ship 自身の rest frame での噴射指令として駆動される。
 *   (u·α=0 が満たされるため α_rest.t ≈ 0、空間成分 = 固有加速度。摩擦寄与は含むが、
 *   現状は摩擦分離せずそのまま exhaust 駆動信号として使用 — thrust 単独信号化は将来 TODO。)
 * - alpha4 (world 4-vec): spacetime arrow 用に SelfShipRenderer に渡す。内部で observerBoost
 *   により観測者静止系に変換されて 4-vector の時空矢印として描画される。
 *
 * 交点 null (新 peer で worldline 履歴が薄い、past-cone が届いていない等) の時は
 * 非描画 (gnomon marker 等も同条件)。死亡中は SceneContent の τ_0 routing で
 * DeadShipRenderer + DeathMarker にフォールバック (8c019e3 統一アルゴリズム)。
 * 本 component は生存中 + τ_0 < 0 の「past-cone 未到達で pre-death worldLine 上に見える」
 * 期間に使う想定。
 *
 * 光源 / lighting は SceneContent の GameLights で共通処理、自機と同じマテリアルを
 * 流用するため一旦適当 (自機ごとのオーバーライドは今後の課題)。
 */
export const OtherShipRenderer = ({
  player,
}: {
  player: RelativisticPlayer;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();

  // Synthetic thrust ref: lifetime = component mount〜unmount、毎 render で値更新。
  // SelfShipRenderer の useFrame は `.current` を読むので sync で OK。
  const thrustRef = useRef<Vector3>(createVector3(0, 0, 0));

  const torusHalfWidth = useTorusHalfWidth();
  const intersection = observerPos
    ? pastLightConeIntersectionWorldLine(player.worldLine, observerPos, torusHalfWidth)
    : null;

  if (!intersection) return null;

  // Subject rest frame proper acceleration: α_rest = lorentzBoost(u) · α_world
  // (lorentzBoost は world → rest 変換。α は u·α=0 の timelike-orthogonal なので
  // α_rest.t ≈ 0、空間成分が固有加速度 3-vec。)
  const alphaRest = multiplyVector4Matrix4(
    lorentzBoost(intersection.u),
    intersection.alpha,
  );
  thrustRef.current = {
    x: alphaRest.x,
    y: alphaRest.y,
    z: 0,
  };

  // 合成 player: SelfShipRenderer の期待形 `{ id, phaseSpace: { pos, heading }, color }`。
  const virtualPlayer = {
    id: player.id,
    phaseSpace: {
      pos: intersection.pos,
      heading: intersection.heading,
    },
    color: player.color,
  };

  return (
    <SelfShipRenderer
      player={virtualPlayer}
      thrustAccelRef={thrustRef}
      observerPos={observerPos}
      observerBoost={observerBoost}
      cannonStyle="laser"
      alpha4={intersection.alpha}
    />
  );
};
