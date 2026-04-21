import { useRef } from "react";
import {
  createVector3,
  pastLightConeIntersectionWorldLine,
  type Vector3,
} from "../../physics";
import { FRICTION_COEFFICIENT } from "./constants";
import { useDisplayFrame } from "./DisplayFrameContext";
import { SelfShipRenderer } from "./SelfShipRenderer";
import type { RelativisticPlayer } from "./types";

/**
 * 他機の 3D ship 描画。SelfShipRenderer (自機と同じ 3D モデル) を流用し、
 * **past-cone 交点** の phaseSpace を "合成 player" としてフィードする:
 *
 * - pos: 観測者の過去光円錐と他機世界線の交点 (= 光が届いた瞬間の event 位置)
 * - heading: 同交点での姿勢 quaternion (slerp 補間済、Phase A-4)
 * - thrust ref: 同交点での alpha (world 4-acc) から friction 寄与を差し引いた
 *   thrust 近似値 `alpha + FRICTION_COEFFICIENT · u` を毎 render で synthetic ref に
 *   commit (ship の exhaust / arrow が thrust 単独信号で発火するよう補正)。
 *
 * 交点 null (新 peer で worldline 履歴が薄い、past-cone が届いていない等) の時は
 * 非描画 (gnomon marker 等も同条件)。死亡中は SceneContent 側で OtherPlayerRenderer
 * (死亡 fade) にフォールバックするので本 component は生存中のみに使う想定。
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

  const intersection = observerPos
    ? pastLightConeIntersectionWorldLine(player.worldLine, observerPos)
    : null;

  if (!intersection) return null;

  // Thrust proxy = alpha + FRICTION · u
  //   alpha ≈ thrust − FRICTION · u (低速近似、processPlayerPhysics 内で
  //     acceleration = thrust + friction, friction = −FRICTION·u)
  //   thrust ≈ alpha + FRICTION · u
  // これにより coasting (thrust=0) では thrust_proxy=0 で exhaust 不発、実 thrust
  // 入力時のみ発火。
  thrustRef.current = {
    x: intersection.alpha.x + FRICTION_COEFFICIENT * intersection.u.x,
    y: intersection.alpha.y + FRICTION_COEFFICIENT * intersection.u.y,
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
    />
  );
};
