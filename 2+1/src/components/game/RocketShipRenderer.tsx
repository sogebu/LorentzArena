import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  multiplyVector4Matrix4,
  quatToYaw,
  type Quaternion,
  type Vector3,
  type Vector4,
} from "../../physics";
import {
  ARROW_BASE_LENGTH,
  ARROW_BASE_OFFSET,
  ARROW_BASE_WIDTH,
  ARROW_COLOR,
  ARROW_MAX_OPACITY,
  EXHAUST_ATTACK_TIME,
  EXHAUST_INNER_COLOR,
  EXHAUST_MAX_OPACITY,
  EXHAUST_OUTER_COLOR,
  EXHAUST_RELEASE_TIME,
  EXHAUST_VISIBILITY_THRESHOLD,
  PLAYER_ACCELERATION,
  SHIP_BRACKET_COLOR,
  SHIP_BRACKET_EMISSIVE_COLOR,
  SHIP_BRACKET_EMISSIVE_INTENSITY,
  SHIP_HULL_RADIUS,
  SHIP_LIFT_Z,
  SHIP_MODEL_SCALE,
  SHIP_NOZZLE_EMISSIVE_COLOR,
  SHIP_NOZZLE_EMISSIVE_INTENSITY,
  SHIP_NOZZLE_EXIT_RADIUS,
  SHIP_NOZZLE_HARDWARE_COLOR,
  SHIP_NOZZLE_INNER_COLOR,
  SHIP_NOZZLE_INNER_EMISSIVE_COLOR,
  SHIP_NOZZLE_INNER_EMISSIVE_INTENSITY,
  SHIP_NOZZLE_LENGTH,
  SHIP_NOZZLE_MOUNT_HULL_RADIUS,
  SHIP_NOZZLE_MOUNT_THROAT_RADIUS,
  SHIP_NOZZLE_OUTWARD_OFFSET,
  SHIP_NOZZLE_THROAT_RADIUS,
} from "./constants";
import { useTorusHalfWidth } from "../../hooks/useTorusHalfWidth";
import { transformEventForDisplay } from "./displayTransform";
import { RocketHullRenderer } from "./RocketHullRenderer";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { lorentzBoost } from "../../physics";

const INNER_CORE_SCALE = 0.45;

/**
 * Shooter mode 専用の自機レンダラ (twin-stick、ぽっちゃりロケット)。
 *
 * 構成:
 *   1. Hull = RocketHullRenderer (LatheGeometry teardrop body)、heading 方向に lerp 追従回転
 *      → 機体 nose が入力方向を指す (砲がない代わりに本体姿勢で direction を伝える)
 *   2. 後部 de Laval bell engine (SelfShipRenderer の RCS と同 spec、bracket + bell + 内側 disk)
 *      + 動的炎 (|thrust| のみで強度駆動、物理方向ではなく rocket aesthetic 優先)
 *   3. Spacetime acceleration arrow (sibling、observer rest frame で時空 4-vector 表示)
 *
 * Classic mode (SelfShipRenderer) との切替は SceneContent / ShipPreview が dispatch。
 * 両者は構造的に独立。
 */
export const RocketShipRenderer = ({
  player,
  thrustAccelRef,
  observerPos,
  observerBoost,
  cameraYawRef,
  alpha4,
}: {
  player: {
    id: string;
    phaseSpace: { pos: Vector4; heading: Quaternion };
    color: string;
  };
  thrustAccelRef: React.RefObject<Vector3>;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  /** heading の source。SelfShipRenderer 同様に ref 直読で re-render 遅延回避。
   *  未指定時は phaseSpace.heading から quatToYaw で取得 (ShipPreview など stub 用途)。 */
  cameraYawRef?: React.RefObject<number>;
  alpha4?: Vector4;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  // 単一後部エンジン噴射: de Laval bell exit の直後から -x 方向へ smoothing。
  const rearExhaustOuterRef = useRef<THREE.Mesh | null>(null);
  const rearExhaustInnerRef = useRef<THREE.Mesh | null>(null);
  const rearExhaustOuterMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const rearExhaustInnerMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const rearSmoothedMagRef = useRef(0);
  // Spacetime acceleration arrow (display frame 直 attach)。
  const arrowMeshRef = useRef<THREE.Mesh>(null);
  const arrowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const arrowSmoothedMagRef = useRef(0);

  const exhaustOuterColor = getThreeColor(EXHAUST_OUTER_COLOR);
  const exhaustInnerColor = getThreeColor(EXHAUST_INNER_COLOR);
  const arrowColor = getThreeColor(ARROW_COLOR);
  const nozzleHardwareColor = getThreeColor(SHIP_NOZZLE_HARDWARE_COLOR);
  const nozzleEmissiveColor = getThreeColor(SHIP_NOZZLE_EMISSIVE_COLOR);
  const nozzleInnerColor = getThreeColor(SHIP_NOZZLE_INNER_COLOR);
  const nozzleInnerEmissiveColor = getThreeColor(SHIP_NOZZLE_INNER_EMISSIVE_COLOR);
  const bracketColor = getThreeColor(SHIP_BRACKET_COLOR);
  const bracketEmissiveColor = getThreeColor(SHIP_BRACKET_EMISSIVE_COLOR);

  // Rocket dimensions: RocketHullRenderer の LatheGeometry profile axial 範囲 [-0.65, +0.65]、
  // max radius 0.40 (太め)、後端 radius 0.08 で narrowing。
  const ROCKET_BODY_HALF_X = 0.65;
  // Nozzle 寸法は SHIP_NOZZLE_* (classic 4 RCS と同じ) を直接使う。
  // 中心位置: body 後端 + OUTWARD_OFFSET + LENGTH/2 を -x 方向に。
  const REAR_NOZZLE_DIST =
    ROCKET_BODY_HALF_X + SHIP_NOZZLE_OUTWARD_OFFSET + SHIP_NOZZLE_LENGTH / 2;
  // 動的炎の起点 (bell exit、= BODY_HALF_X + OFFSET + LENGTH)。
  const REAR_EXHAUST_START_OFFSET =
    ROCKET_BODY_HALF_X + SHIP_NOZZLE_OUTWARD_OFFSET + SHIP_NOZZLE_LENGTH;

  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const vecY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const vecDir = useMemo(() => new THREE.Vector3(), []);
  const torusHalfWidth = useTorusHalfWidth();

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Position: player world pos → display 座標
    const dp = transformEventForDisplay(
      player.phaseSpace.pos,
      observerPos,
      observerBoost,
      torusHalfWidth,
    );
    group.position.set(dp.x, dp.y, dp.t);

    // Hull (group) を heading 方向に lerp 追従回転。機体 nose が入力方向を指すことで
    // 「向きが変わる」visual feedback を提供 (砲がない代わりに本体姿勢で direction を伝える)。
    // tau=80ms で滑らかに追従、急な heading 変化 (screen-relative の 8 方向 stick 入力) でも
    // 視覚的にスナップせず慣性感を残す。
    const targetYaw = cameraYawRef
      ? cameraYawRef.current
      : quatToYaw(player.phaseSpace.heading);
    {
      const cur = group.rotation.z;
      let diff = targetYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const tau = 0.08;
      const alpha = 1 - Math.exp(-Math.min(0.1, delta) / tau);
      group.rotation.z = cur + diff * alpha;
    }

    // 単一後部エンジン噴射: |thrust| のみで強度 smoothing。物理方向は無視 (rocket は
    // body 固定で「お尻 1 個」のシンプル化、physics-correct な反推力ではなく
    // 「噴射してる」感の表現、de Laval bell が固定 hardware として後部に存在)。
    const accel = thrustAccelRef.current;
    const ax = accel.x;
    const ay = accel.y;
    const norm = Math.hypot(ax, ay);
    const thrustFrac = Math.min(1, norm / PLAYER_ACCELERATION);

    const rawTargetR = thrustFrac;
    const curR = rearSmoothedMagRef.current;
    const tauMsR = rawTargetR > curR ? EXHAUST_ATTACK_TIME : EXHAUST_RELEASE_TIME;
    const rateR = 1 - Math.exp(-(delta * 1000) / tauMsR);
    const smR = curR + (rawTargetR - curR) * rateR;
    rearSmoothedMagRef.current = smR;

    const rOuter = rearExhaustOuterRef.current;
    const rInner = rearExhaustInnerRef.current;
    const rOuterMat = rearExhaustOuterMatRef.current;
    const rInnerMat = rearExhaustInnerMatRef.current;

    if (smR < EXHAUST_VISIBILITY_THRESHOLD || !rOuter || !rInner || !rOuterMat || !rInnerMat) {
      if (rOuter) rOuter.visible = false;
      if (rInner) rInner.visible = false;
    } else {
      rOuter.visible = true;
      rInner.visible = true;
      // 動的炎は de Laval bell exit (REAR_EXHAUST_START_OFFSET) 後ろから -x 方向へ伸びる。
      // 半径は SHIP_NOZZLE_EXIT_RADIUS で bell の出口にぴったり合わせる。
      const radius = SHIP_NOZZLE_EXIT_RADIUS;
      // 長さスケールは |thrust| 比例 (smR)。EXHAUST_BASE_LENGTH の RCS と同等。
      const lengthR = 1.2 * smR;
      const offsetR = REAR_EXHAUST_START_OFFSET + lengthR / 2;
      rOuter.position.set(-offsetR, 0, 0);
      vecDir.set(-1, 0, 0);
      tmpQuat.setFromUnitVectors(vecY, vecDir);
      rOuter.quaternion.copy(tmpQuat);
      rOuter.scale.set(radius, lengthR, radius);

      const innerLengthR = lengthR * INNER_CORE_SCALE;
      const innerRadiusR = radius * INNER_CORE_SCALE;
      const innerOffsetR = REAR_EXHAUST_START_OFFSET + innerLengthR / 2;
      rInner.position.set(-innerOffsetR, 0, 0);
      rInner.quaternion.copy(tmpQuat);
      rInner.scale.set(innerRadiusR, innerLengthR, innerRadiusR);

      rOuterMat.opacity = smR * EXHAUST_MAX_OPACITY;
      rInnerMat.opacity = smR * EXHAUST_MAX_OPACITY;
    }

    // Spacetime acceleration arrow: SelfShipRenderer 同等仕様 (4-加速度 α_world を
    // observerBoost で rest frame に戻し、display 矢印として描画)。
    const arrowMesh = arrowMeshRef.current;
    const arrowMat = arrowMatRef.current;
    if (arrowMesh && arrowMat && alpha4) {
      const alphaObs = observerBoost
        ? multiplyVector4Matrix4(observerBoost, alpha4)
        : alpha4;
      const ax4 = alphaObs.x;
      const ay4 = alphaObs.y;
      const at4 = alphaObs.t;
      const mag4 = Math.sqrt(ax4 * ax4 + ay4 * ay4 + at4 * at4);
      const rawTarget = mag4 / PLAYER_ACCELERATION;
      const current = arrowSmoothedMagRef.current;
      const tauMs = rawTarget > current ? EXHAUST_ATTACK_TIME : EXHAUST_RELEASE_TIME;
      const rate = 1 - Math.exp(-(delta * 1000) / tauMs);
      const smoothed = current + (rawTarget - current) * rate;
      arrowSmoothedMagRef.current = smoothed;

      if (smoothed < EXHAUST_VISIBILITY_THRESHOLD || mag4 < 1e-6) {
        arrowMesh.visible = false;
      } else {
        arrowMesh.visible = true;
        const invMag = 1 / mag4;
        const dirX = ax4 * invMag;
        const dirY = ay4 * invMag;
        const dirT = at4 * invMag;
        const arrowLen = ARROW_BASE_LENGTH * smoothed;
        const originOffset =
          (SHIP_HULL_RADIUS + ARROW_BASE_OFFSET) * SHIP_MODEL_SCALE +
          0.5 * arrowLen;
        const hullCenterT = dp.t + SHIP_LIFT_Z * SHIP_MODEL_SCALE;
        arrowMesh.position.set(
          dp.x + dirX * originOffset,
          dp.y + dirY * originOffset,
          hullCenterT + dirT * originOffset,
        );
        vecDir.set(dirX, dirY, dirT);
        tmpQuat.setFromUnitVectors(vecY, vecDir);
        arrowMesh.quaternion.copy(tmpQuat);
        arrowMesh.scale.set(ARROW_BASE_WIDTH * smoothed, arrowLen, 1);
        arrowMat.opacity = smoothed * ARROW_MAX_OPACITY;
      }
    } else if (arrowMesh) {
      arrowMesh.visible = false;
    }
  });

  return (
    <>
      <group ref={groupRef} scale={SHIP_MODEL_SCALE}>
        <group position={[0, 0, SHIP_LIFT_Z]}>
          {/* Hull: 滑らかな teardrop (LatheGeometry 単一 mesh、繋ぎ目なし)。 */}
          <RocketHullRenderer />

          {/* 後部 de Laval bell engine (SelfShipRenderer の RCS 4 nozzle と同 spec、単一)。
              位置: body 後端 -x 方向に OUTWARD_OFFSET + LENGTH/2 だけ離して配置。
              rotation z = π/2 で cylinder default +y 軸を outward (-x) に向ける。 */}
          <group
            position={[-REAR_NOZZLE_DIST, 0, 0]}
            rotation={[0, 0, Math.PI / 2]}
          >
            {/* 外面 (FrontSide、明るい hardware 色) */}
            <mesh>
              <cylinderGeometry
                args={[
                  SHIP_NOZZLE_EXIT_RADIUS,
                  SHIP_NOZZLE_THROAT_RADIUS,
                  SHIP_NOZZLE_LENGTH,
                  12,
                  1,
                  true,
                ]}
              />
              <meshStandardMaterial
                color={nozzleHardwareColor}
                emissive={nozzleEmissiveColor}
                emissiveIntensity={SHIP_NOZZLE_EMISSIVE_INTENSITY}
                roughness={0.6}
                metalness={0.5}
                side={THREE.FrontSide}
              />
            </mesh>
            {/* 内面 (BackSide、暗い影色) */}
            <mesh>
              <cylinderGeometry
                args={[
                  SHIP_NOZZLE_EXIT_RADIUS,
                  SHIP_NOZZLE_THROAT_RADIUS,
                  SHIP_NOZZLE_LENGTH,
                  12,
                  1,
                  true,
                ]}
              />
              <meshStandardMaterial
                color={nozzleInnerColor}
                emissive={nozzleInnerEmissiveColor}
                emissiveIntensity={SHIP_NOZZLE_INNER_EMISSIVE_INTENSITY}
                roughness={0.85}
                metalness={0.2}
                side={THREE.BackSide}
              />
            </mesh>
            {/* Throat disk: nozzle 最奥 (inward 側 = body 側) を塞ぐ発光円盤。 */}
            <mesh
              position={[0, -SHIP_NOZZLE_LENGTH / 2, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[SHIP_NOZZLE_THROAT_RADIUS, 16]} />
              <meshBasicMaterial
                color={exhaustInnerColor}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Mount pylon: body 表面 → nozzle throat の取り付け cone (steel-blue)。 */}
            <mesh
              position={[
                0,
                -(SHIP_NOZZLE_OUTWARD_OFFSET / 2 + SHIP_NOZZLE_LENGTH / 2),
                0,
              ]}
            >
              <cylinderGeometry
                args={[
                  SHIP_NOZZLE_MOUNT_THROAT_RADIUS,
                  SHIP_NOZZLE_MOUNT_HULL_RADIUS,
                  SHIP_NOZZLE_OUTWARD_OFFSET,
                  12,
                ]}
              />
              <meshStandardMaterial
                color={bracketColor}
                emissive={bracketEmissiveColor}
                emissiveIntensity={SHIP_BRACKET_EMISSIVE_INTENSITY}
                roughness={0.6}
                metalness={0.55}
              />
            </mesh>
          </group>

          {/* 動的炎 (bell exit から -x 方向、|thrust| 駆動)。 */}
          <group>
            <mesh
              ref={rearExhaustOuterRef}
              geometry={sharedGeometries.exhaustCone}
              visible={false}
              renderOrder={10}
            >
              <meshBasicMaterial
                ref={rearExhaustOuterMatRef}
                color={exhaustOuterColor}
                transparent
                depthTest={false}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            <mesh
              ref={rearExhaustInnerRef}
              geometry={sharedGeometries.exhaustCone}
              visible={false}
              renderOrder={10}
            >
              <meshBasicMaterial
                ref={rearExhaustInnerMatRef}
                color={exhaustInnerColor}
                transparent
                depthTest={false}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
        </group>{/* end lift wrapper */}
      </group>

      {/* Spacetime acceleration arrow (sibling、ship body group の外側、yaw/scale 非適用)。 */}
      <mesh
        ref={arrowMeshRef}
        geometry={sharedGeometries.accelerationArrowFlat}
        visible={false}
      >
        <meshBasicMaterial
          ref={arrowMatRef}
          color={arrowColor}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
};
