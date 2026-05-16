import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type * as THREE from "three";
import {
  createVector3,
  type Quaternion,
  type Vector3,
  type Vector4,
} from "../../physics";
import { DEATH_TAU_MAX } from "./constants";
import { pastLightConeIntersectionDeathWorldLine } from "./deathWorldLine";
import { useDisplayFrame } from "./DisplayFrameContext";
import { JellyfishShipRenderer } from "./JellyfishShipRenderer";
import { RocketShipRenderer } from "./RocketShipRenderer";
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
 * - heading: 死亡時姿勢で凍結 (self / other 共通で `player.phaseSpace.heading`、 self は
 *   applyKill で死亡時刻凍結保持されるため別途 myDeathEvent.heading 不要、 2026-05-04
 *   plan: mydeathevent-decomposition で複合型解体)。
 * - thrust: 0 (死者は thrust 発火しない)。exhaust は無視される。
 * - opacity: `(τ_max − τ_0) / τ_max` (0..1)。group 内の全 Mesh material を traverse して一括上書き
 *   (transparent=true, depthWrite=false)。
 * - **viewMode dispatch** (= 2026-05-16): caller (SceneContent) から player.viewMode を渡し、
 *   classic = SelfShipRenderer / shooter = RocketShipRenderer / jellyfish = JellyfishShipRenderer
 *   を選択。 旧 client や undefined は "classic" fallback。 OtherShipRenderer の dispatch と
 *   対称構造 (= 自機死亡時 / 他機死亡時いずれも生時 hull と一致した沈下映像)。
 *
 * traverse override は全 ship hull 共通で動作 (= group 内 Mesh を全部 walk して material.opacity
 * 上書き)、 dispatch 先 renderer の internal exhaust / arrow useFrame も traverse 後再上書き
 * される (= 旧 SelfShipRenderer 固定時と同等)、 thrust=0 + alpha4 未渡しなので exhaust /
 * arrow は表示されず traverse 結果が visible。
 */
export const DeadShipRenderer = ({
  xD,
  uD,
  headingD,
  color,
  playerId,
  viewMode,
}: {
  xD: Vector4;
  uD: Vector4;
  headingD: Quaternion;
  color: string;
  playerId: string;
  viewMode?: "classic" | "shooter" | "jellyfish";
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

  const effectiveViewMode = viewMode ?? "classic";
  return (
    <group ref={wrapperRef}>
      {effectiveViewMode === "shooter" ? (
        <RocketShipRenderer
          player={virtualPlayer}
          thrustAccelRef={zeroThrustRef}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ) : effectiveViewMode === "jellyfish" ? (
        <JellyfishShipRenderer
          player={virtualPlayer}
          thrustAccelRef={zeroThrustRef}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ) : (
        <SelfShipRenderer
          player={virtualPlayer}
          thrustAccelRef={zeroThrustRef}
          observerPos={observerPos}
          observerBoost={observerBoost}
          cannonStyle="laser"
        />
      )}
    </group>
  );
};
