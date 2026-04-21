import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createVector3,
  type Quaternion,
  type Vector3,
  type Vector4,
} from "../../physics";
import { useDisplayFrame } from "./DisplayFrameContext";
import { SelfShipRenderer } from "./SelfShipRenderer";

/**
 * **死亡プレイヤー用** の ship モデル描画 (2026-04-22 統一アルゴリズム)。
 *
 * - position: x_D に固定 (死亡時空点)。past-cone sweep で浮き沈みしない。
 * - heading: 死亡時姿勢で凍結 (self: myDeathEvent.heading、other: player.phaseSpace.heading)。
 * - thrust: 0 (死者は thrust 発火しない)。exhaust は無視される。
 * - opacity: `fadeAlpha` (0..1)。group 内の全 Mesh material を traverse して一括上書き
 *   (transparent=true, depthWrite=false)。caller が `(τ_max − τ_0) / τ_max` を渡す想定。
 *
 * SelfShipRenderer を再利用するため virtualPlayer を synthesize して渡す。SelfShipRenderer
 * は position/heading 以外にも内部 useFrame で exhaust material opacity を毎 tick 上書き
 * するため、exhaust 粒は traverse override の後に再度 0 にされる。thrust=0 なので結果的に
 * exhaust 不可視で問題なし。
 */
export const DeadShipRenderer = ({
  xD,
  headingD,
  color,
  playerId,
  fadeAlpha,
}: {
  xD: Vector4;
  headingD: Quaternion;
  color: string;
  playerId: string;
  fadeAlpha: number;
}) => {
  const { observerPos, observerBoost } = useDisplayFrame();
  const zeroThrustRef = useRef<Vector3>(createVector3(0, 0, 0));
  const wrapperRef = useRef<THREE.Group>(null);

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
    if (!wrapper) return;
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

  return (
    <group ref={wrapperRef}>
      <SelfShipRenderer
        player={virtualPlayer}
        thrustAccelRef={zeroThrustRef}
        observerPos={observerPos}
        observerBoost={observerBoost}
      />
    </group>
  );
};
