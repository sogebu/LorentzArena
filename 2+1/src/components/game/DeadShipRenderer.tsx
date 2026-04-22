import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createVector3,
  type Quaternion,
  type Vector3,
  type Vector4,
} from "../../physics";
import { DEATH_TAU_MAX } from "./constants";
import { pastLightConeIntersectionDeathWorldLine } from "./deathWorldLine";
import { useDisplayFrame } from "./DisplayFrameContext";
import { SelfShipRenderer } from "./SelfShipRenderer";

/**
 * **死亡プレイヤー用** の ship モデル描画 (plans/死亡イベント.md §5 準拠)。
 *
 * 自己 gate: (x_D, u_D) から τ_0 = past-cone ∩ W_D(τ) を内部計算、
 * `τ_0 ∈ [0, DEATH_TAU_MAX]` のときだけ render、それ以外は null。
 * caller (SceneContent) は死者に対して無条件に本 component を配置すればよい
 * (τ_0 routing 不要)。
 *
 * - position: x_D に固定 (死亡時空点)。past-cone sweep で浮き沈みしない。
 * - heading: 死亡時姿勢で凍結 (self: myDeathEvent.heading、other: player.phaseSpace.heading)。
 * - thrust: 0 (死者は thrust 発火しない)。exhaust は無視される。
 * - opacity: `(τ_max − τ_0) / τ_max` (0..1)。group 内の全 Mesh material を traverse して一括上書き
 *   (transparent=true, depthWrite=false)。
 *
 * SelfShipRenderer を再利用するため virtualPlayer を synthesize して渡す。SelfShipRenderer
 * は position/heading 以外にも内部 useFrame で exhaust material opacity を毎 tick 上書き
 * するため、exhaust 粒は traverse override の後に再度 0 にされる。thrust=0 なので結果的に
 * exhaust 不可視で問題なし。
 */
export const DeadShipRenderer = ({
  xD,
  uD,
  headingD,
  color,
  playerId,
}: {
  xD: Vector4;
  uD: Vector4;
  headingD: Quaternion;
  color: string;
  playerId: string;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();
  const zeroThrustRef = useRef<Vector3>(createVector3(0, 0, 0));
  const wrapperRef = useRef<THREE.Group>(null);

  // 自己 gate: τ_0 ∈ [0, DEATH_TAU_MAX] のみ render。
  const tau0 = observerPos
    ? pastLightConeIntersectionDeathWorldLine(xD, uD, observerPos)
    : null;
  const fadeAlpha =
    tau0 != null && tau0 >= 0 && tau0 <= DEATH_TAU_MAX
      ? (DEATH_TAU_MAX - tau0) / DEATH_TAU_MAX
      : null;

  const virtualPlayer = useMemo(
    () => ({
      id: playerId,
      phaseSpace: { pos: xD, heading: headingD },
      color,
    }),
    [playerId, xD, headingD, color],
  );

  useFrame(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || fadeAlpha == null) return;
    wrapper.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      if (Array.isArray(mat)) return; // multi-material は scope 外
      // 初回 traverse で original opacity を保存、transparent=true + depthWrite=false に設定。
      if (mat.userData._deadOrigOpacity === undefined) {
        mat.userData._deadOrigOpacity = mat.opacity ?? 1;
        mat.transparent = true;
        mat.depthWrite = false;
      }
      mat.opacity = (mat.userData._deadOrigOpacity as number) * fadeAlpha;
    });
  });

  if (fadeAlpha == null) return null;

  return (
    <group ref={wrapperRef}>
      <SelfShipRenderer
        player={virtualPlayer}
        thrustAccelRef={zeroThrustRef}
        observerPos={observerPos}
        observerBoost={observerBoost}
        cannonStyle="laser"
      />
    </group>
  );
};
