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
  EXHAUST_BASE_LENGTH,
  EXHAUST_INNER_COLOR,
  EXHAUST_MAX_OPACITY,
  EXHAUST_OUTER_COLOR,
  EXHAUST_RELEASE_TIME,
  EXHAUST_VISIBILITY_THRESHOLD,
  PLAYER_ACCELERATION,
  SHIP_BRACKET_COLOR,
  SHIP_BRACKET_EMISSIVE_COLOR,
  SHIP_BRACKET_EMISSIVE_INTENSITY,
  SHIP_CANNON_REAR_EXTENSION,
  SHIP_GUN_BARREL_LENGTH,
  SHIP_GUN_BARREL_RADIUS,
  SHIP_GUN_BRACKET_BASE_RADIUS,
  SHIP_GUN_BRACKET_HEIGHT,
  SHIP_GUN_BRACKET_RADIUS,
  SHIP_GUN_BREECH_LENGTH,
  SHIP_GUN_BREECH_RADIUS,
  SHIP_GUN_COLOR,
  SHIP_GUN_EMISSIVE_COLOR,
  SHIP_GUN_EMISSIVE_INTENSITY,
  SHIP_GUN_MUZZLE_BRAKE_LENGTH,
  SHIP_GUN_MUZZLE_BRAKE_RADIUS,
  SHIP_GUN_PITCH_DOWN_RAD,
  SHIP_GUN_RING_COUNT,
  SHIP_GUN_RING_LENGTH,
  SHIP_GUN_RING_RADIUS,
  SHIP_GUN_TIP_LENGTH,
  SHIP_GUN_TIP_RADIUS,
  SHIP_HULL_SEGMENTS,
  SHIP_HULL_X_SCALE,
  SHIP_LIFT_Z,
  SHIP_HULL_COLOR,
  SHIP_HULL_EMISSIVE_COLOR,
  SHIP_HULL_EMISSIVE_INTENSITY,
  SHIP_HULL_HEIGHT,
  SHIP_MODEL_SCALE,
  SHIP_HULL_RADIUS,
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
import { transformEventForDisplay } from "./displayTransform";
import { AntennaBeaconRenderer } from "./AntennaBeaconRenderer";
import { DorsalPodRenderer } from "./DorsalPodRenderer";
import { LaserCannonRenderer } from "./LaserCannonRenderer";
import { getThreeColor, sharedGeometries } from "./threeCache";
import type { lorentzBoost } from "../../physics";

const INNER_CORE_SCALE = 0.45; // 旧 ExhaustCone と同値

/**
 * 自機専用レンダラ (deadpan SF、2026-04-19)。
 *
 * 構成:
 *   1. 八角プリズム hull (固定 dark navy 色、xy 水平、z 軸 = camera yaw 回転)
 *   2. 上面 +x 側に三角形「前方マーク」(警告黄)
 *   3. 周囲 8 角に **常時可視 hardware nozzle** (gunmetal solid cone)
 *   4. 機首 (+x、camera yaw) から下 45° に伸びる太い大砲 (gunmetal gray)
 *   5. **アクティブ時、anti-thrust 方向の hull edge から 1 本の big exhaust** (旧 ExhaustCone
 *      と同寸法・同色・同 smoothing)。8 nozzle に分散させず単一炎で迫力維持。
 *
 * 設計理由:
 *   - ゲーム仕様 (8 方向 thrust + past-cone marker は下 45° 前方) に literal 整合。
 *   - Newton 第 3 法則: thrust が +x なら anti = -x、その方向の hull 端から噴射。
 *     8 ノズル hardware は **decoration** だが thrust は離散 8 方向 (WASD 組合せ) なので
 *     local frame で噴射方向と nozzle 位置が結果的に一致 (= 「ノズルから噴射してる」見え方)。
 *   - C pattern (display 並進 + camera yaw 回転のみ、γ 楕円化を避ける、M14 hybrid policy)。
 *
 * 既存装飾の置き換え:
 *   - sphere + glow halo: 廃止 (この hull が代替)
 *   - ExhaustCone (反推力 1 本): **本 component 内で再構築** (関数を移動した形)
 *   - AccelerationArrow (前方 amber): 廃止 (8 nozzle hardware が方向を示す)
 *   - AimArrow (射撃中 1-3 本): 別経路で存続
 */
export const SelfShipRenderer = ({
  player,
  thrustAccelRef,
  observerPos,
  observerBoost,
  cannonStyle = "gun",
  dorsalStyle = "pod",
  cameraYawRef,
  alpha4,
  controlScheme = "modern",
}: {
  player: {
    id: string;
    phaseSpace: { pos: Vector4; heading: Quaternion };
    color: string;
  };
  thrustAccelRef: React.RefObject<Vector3>;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  /** 懸架砲のデザイン。'gun': 古典機械式大砲 (SHIP_GUN_*)、'laser': エネルギー兵器
   *  (SHIP_LASER_*、LaserCannonRenderer)。default 'gun' で既存挙動保持。 */
  cannonStyle?: "gun" | "laser";
  /** 上面構造物。'pod': 扁平楕円体 + player 色 stripe (案 B)、'antenna': アンテナ + player 色
   *  beacon 球 (案 A)、'none': 何も描かない。default 'pod'。 */
  dorsalStyle?: "pod" | "antenna" | "none";
  /** 時空加速度矢印用の 4-加速度 (world frame)。内部で observerBoost により観測者静止系に
   *  変換されて表示される。未指定 or 零ベクトルなら矢印非表示。自機は phaseSpace.alpha
   *  (前 tick の stored value、1 tick 遅延)、他機は OtherShipRenderer が intersection.alpha を pass。 */
  alpha4?: Vector4;
  /** 自機専用: heading の source として phaseSpace.heading (store 経由、re-render 遅延あり)
   *  の代わりに cameraYawRef を直読して useFrame 内で最新値を使う。未指定なら
   *  phaseSpace.heading を使う (他機流用時)。Phase A の re-render 遅延起因のカクカク対策。 */
  cameraYawRef?: React.RefObject<number>;
  /** 操作系。'legacy_classic' / 'legacy_shooter' では本体 group 全体が heading 方向に回り
   *  (本体ごと向きが変わる)、nozzle outward は heading basis なので thrust (world) を local
   *  frame に変換してから dot。'modern' では本体 world basis 固定 + 砲塔のみ heading で、
   *  nozzle outward は world cardinal なので yaw 変換不要。default 'modern' (他機流用時)。 */
  controlScheme?: "legacy_classic" | "legacy_shooter" | "modern";
}) => {
  const groupRef = useRef<THREE.Group>(null);
  // 砲塔 (cannon = laser or gun) のみを heading に追従させるための独立 group。
  // 本体 (hull) は固定で、cannon assembly だけがこの ref を介して回転。
  const cannonYawGroupRef = useRef<THREE.Group>(null);
  // 4 cardinal nozzle に対応する exhaust ペア (outer + inner)。各 nozzle は独立に
  // smoothing + 表示制御。斜め thrust (e.g., W+A) は **2 nozzle が同時噴射、各 1/√2 の
  // 強度** で literal に再現 (RCS の真面目な合成)。
  const exhaustOuterRefs = useRef<Array<THREE.Mesh | null>>([null, null, null, null]);
  const exhaustInnerRefs = useRef<Array<THREE.Mesh | null>>([null, null, null, null]);
  const exhaustOuterMatRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([
    null,
    null,
    null,
    null,
  ]);
  const exhaustInnerMatRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([
    null,
    null,
    null,
    null,
  ]);
  const smoothedMagRefs = useRef<number[]>([0, 0, 0, 0]);
  const arrowMeshRef = useRef<THREE.Mesh>(null);
  const arrowMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const arrowSmoothedMagRef = useRef(0);

  const hullColor = getThreeColor(SHIP_HULL_COLOR);
  const hullEmissive = getThreeColor(SHIP_HULL_EMISSIVE_COLOR);
  const nozzleHardwareColor = getThreeColor(SHIP_NOZZLE_HARDWARE_COLOR);
  const nozzleEmissiveColor = getThreeColor(SHIP_NOZZLE_EMISSIVE_COLOR);
  const nozzleInnerColor = getThreeColor(SHIP_NOZZLE_INNER_COLOR);
  const nozzleInnerEmissiveColor = getThreeColor(SHIP_NOZZLE_INNER_EMISSIVE_COLOR);
  const gunColor = getThreeColor(SHIP_GUN_COLOR);
  const gunEmissiveColor = getThreeColor(SHIP_GUN_EMISSIVE_COLOR);
  const bracketColor = getThreeColor(SHIP_BRACKET_COLOR);
  const bracketEmissiveColor = getThreeColor(SHIP_BRACKET_EMISSIVE_COLOR);
  const exhaustOuterColor = getThreeColor(EXHAUST_OUTER_COLOR);
  const exhaustInnerColor = getThreeColor(EXHAUST_INNER_COLOR);
  const arrowColor = getThreeColor(ARROW_COLOR);

  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const vecY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const vecDir = useMemo(() => new THREE.Vector3(), []);

  // 4 diagonal nozzle の local 角度 (π/4, 3π/4, 5π/4, 7π/4 = 前右上 / 前左上 /
  // 後左 / 後右の 4 隅)。WASD 単押し (cardinal thrust) → 隣接 2 ノズルが各 1/√2 で噴射、
  // WASD 2 つ同時押し (diagonal thrust) → 単一ノズルが 1.0 で噴射、という分解になる。
  // 数式 `max(0, -thrust · outward)` は angle 集合 general、π/4 offset するだけで成立。
  const NOZZLE_COUNT = 4;
  const nozzleAngles = useMemo(
    () =>
      Array.from(
        { length: NOZZLE_COUNT },
        (_, i) => (i / NOZZLE_COUNT) * Math.PI * 2 + Math.PI / 4,
      ),
    [],
  );

  // 補強リング位置 (主砲身上に SHIP_GUN_RING_COUNT 本、等間隔)。
  // 主砲身は cannon group 内で x ∈ [-REAR_EXT, BARREL_LENGTH - REAR_EXT] にある。
  // ring を等間隔に配置するため frac で割る。
  const ringPositions = useMemo(() => {
    const arr: number[] = [];
    for (let i = 1; i <= SHIP_GUN_RING_COUNT; i++) {
      const frac = i / (SHIP_GUN_RING_COUNT + 1); // 1/4, 2/4, 3/4
      arr.push(SHIP_GUN_BARREL_LENGTH * frac - SHIP_CANNON_REAR_EXTENSION);
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // Position: player world pos → display 座標
    const dp = transformEventForDisplay(
      player.phaseSpace.pos,
      observerPos,
      observerBoost,
    );
    group.position.set(dp.x, dp.y, dp.t);

    // Rotation: 自機 (cameraYawRef 渡し) は ref 直読で rAF 毎に最新値取得、
    // store subscribe 経由の re-render 遅延を避ける。他機流用時 (OtherShipRenderer /
    // DeadShipRenderer) は phaseSpace.heading (past-cone 交点補間済) を読む。
    const yaw = cameraYawRef
      ? cameraYawRef.current
      : quatToYaw(player.phaseSpace.heading);

    // controlScheme で本体 / 砲塔 / 噴射方向の basis が変わる:
    //   modern  → 本体 group は world basis 固定 (rotation 0)、砲塔 (cannonYawGroup) のみ
    //             heading で回る。nozzle outward は world cardinal なので thrust (world)
    //             を直接 dot。
    //   legacy_classic / legacy_shooter
    //           → 本体 group ごと heading で回る (本体に固定の砲塔も一緒に向く)。
    //             cannonYawGroup の自身 rotation は 0 にしておけば二重回転にならない。
    //             nozzle outward は heading basis なので thrust (world) を local frame に
    //             inverse rotate してから dot。
    const isLegacyHull =
      controlScheme === "legacy_classic" || controlScheme === "legacy_shooter";
    if (isLegacyHull) {
      group.rotation.set(0, 0, yaw);
      cannonYawGroupRef.current?.rotation.set(0, 0, 0);
    } else {
      group.rotation.set(0, 0, 0);
      cannonYawGroupRef.current?.rotation.set(0, 0, yaw);
    }

    // 4 cardinal nozzle 各々の独立噴射 (RCS の真面目な合成)。
    // 各 nozzle outward に対し intensity = max(0, -thrust · outward) で分解。
    // WASD 単独 → 1 ノズル intensity 1.0、WA 等斜め → 2 ノズル各 intensity 1/√2。
    const accel = thrustAccelRef.current;
    const ax = accel.x;
    const ay = accel.y;
    const norm = Math.hypot(ax, ay);
    const thrustFrac = Math.min(1, norm / PLAYER_ACCELERATION);
    let localUx = 0;
    let localUy = 0;
    if (norm > 1e-6) {
      if (isLegacyHull) {
        // hull が heading で回っているので thrust (world) を inverse rotate して local frame に。
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        localUx = (cosY * ax + sinY * ay) / norm;
        localUy = (-sinY * ax + cosY * ay) / norm;
      } else {
        // hull 固定 → world basis = local basis。
        localUx = ax / norm;
        localUy = ay / norm;
      }
    }

    const startOffset =
      SHIP_HULL_RADIUS + SHIP_NOZZLE_OUTWARD_OFFSET + SHIP_NOZZLE_LENGTH;
    const radius = SHIP_NOZZLE_EXIT_RADIUS; // 全 nozzle 共通

    for (let i = 0; i < NOZZLE_COUNT; i++) {
      const θ = nozzleAngles[i];
      const outX = Math.cos(θ);
      const outY = Math.sin(θ);
      // intensity per nozzle (raw target, EMA で smoothing)
      const dot = -(localUx * outX + localUy * outY);
      const rawTargetI = Math.max(0, dot) * thrustFrac;
      const currentI = smoothedMagRefs.current[i];
      const tauMsI =
        rawTargetI > currentI ? EXHAUST_ATTACK_TIME : EXHAUST_RELEASE_TIME;
      const rateI = 1 - Math.exp(-(delta * 1000) / tauMsI);
      const smoothedI = currentI + (rawTargetI - currentI) * rateI;
      smoothedMagRefs.current[i] = smoothedI;

      const outer = exhaustOuterRefs.current[i];
      const inner = exhaustInnerRefs.current[i];
      const outerMat = exhaustOuterMatRefs.current[i];
      const innerMat = exhaustInnerMatRefs.current[i];

      if (smoothedI < EXHAUST_VISIBILITY_THRESHOLD || !outer || !inner || !outerMat || !innerMat) {
        if (outer) outer.visible = false;
        if (inner) inner.visible = false;
        continue;
      }
      outer.visible = true;
      inner.visible = true;

      const lengthI = EXHAUST_BASE_LENGTH * smoothedI;
      const offsetI = startOffset + lengthI / 2;

      // 外側 cone: 位置 = nozzle outward 方向 × offsetI、向き = outward
      outer.position.set(outX * offsetI, outY * offsetI, 0);
      // 静的: outward は不変なので quaternion は per-nozzle に固定可能。useFrame 毎回
      // setFromUnitVectors するコストは軽微なので簡潔さ優先で毎フレーム計算する。
      vecDir.set(outX, outY, 0);
      tmpQuat.setFromUnitVectors(vecY, vecDir);
      outer.quaternion.copy(tmpQuat);
      outer.scale.set(radius, lengthI, radius);

      const innerLengthI = lengthI * INNER_CORE_SCALE;
      const innerRadius = radius * INNER_CORE_SCALE;
      const innerOffsetI = startOffset + innerLengthI / 2;
      inner.position.set(outX * innerOffsetI, outY * innerOffsetI, 0);
      inner.quaternion.copy(tmpQuat);
      inner.scale.set(innerRadius, innerLengthI, innerRadius);

      outerMat.opacity = smoothedI * EXHAUST_MAX_OPACITY;
      innerMat.opacity = smoothedI * EXHAUST_MAX_OPACITY;
    }

    // Spacetime acceleration arrow: 4-加速度 α_world を **観測者静止系** に boost し、
    // display frame (three.js: x=x, y=y, z=t_obs_rest) 内で任意方向を向く 3D 矢印として描画。
    // 時間成分が非ゼロになると矢印が time 軸方向に傾く → 相対論的に意味のある spacetime 矢印。
    //   α_obs = observerBoost ? lorentzBoost(u_obs) · α_world : α_world
    // 位置は ship 本体 group (= group.position, yaw'd) とは別の sibling arrow group に
    // display 座標直 attach (hull 中心から α_obs 方向に hullOffset だけオフセット)。
    const arrowMesh = arrowMeshRef.current;
    const arrowMat = arrowMatRef.current;
    if (arrowMesh && arrowMat && alpha4) {
      const alphaObs = observerBoost
        ? multiplyVector4Matrix4(observerBoost, alpha4)
        : alpha4;
      const ax4 = alphaObs.x;
      const ay4 = alphaObs.y;
      const at4 = alphaObs.t; // display z 軸 = observer rest frame time
      const mag4 = Math.sqrt(ax4 * ax4 + ay4 * ay4 + at4 * at4);
      // Smoothing (EMA): mag / PLAYER_ACCELERATION を attack/release 時定数で平滑化。
      const rawTarget = mag4 / PLAYER_ACCELERATION;
      const current = arrowSmoothedMagRef.current;
      const tauMs =
        rawTarget > current ? EXHAUST_ATTACK_TIME : EXHAUST_RELEASE_TIME;
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
        // Arrow origin: ship hull 中心 (dp + lifted by SHIP_LIFT_Z·SCALE) から α_obs 方向に
        // offset して**矢印の tail (local y=-0.5 · arrowLen) が hull 外側**に位置するよう配置
        // (機体貫通防止)。元の flat 矢印では `SHIP_HULL_RADIUS + ARROW_BASE_OFFSET + 0.5·arrowLen`
        // を local 距離として使っており、ship group が SHIP_MODEL_SCALE で縮むので世界距離は
        // `(HULL_R + BASE_OFFSET) · SCALE + 0.5 · arrowLen` (後者は外側 frame の長さ)。
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
        // Orient: local +y → (dirX, dirY, dirT) in display frame
        vecDir.set(dirX, dirY, dirT);
        tmpQuat.setFromUnitVectors(vecY, vecDir);
        arrowMesh.quaternion.copy(tmpQuat);
        // Scale: 元の flat 2D 矢印と同じ比率 (x=幅 / y=長さ / z=1)。
        arrowMesh.scale.set(
          ARROW_BASE_WIDTH * smoothed,
          arrowLen,
          1,
        );
        arrowMat.opacity = smoothed * ARROW_MAX_OPACITY;
      }
    } else if (arrowMesh) {
      arrowMesh.visible = false;
    }
  });

  return (
    <>
    <group ref={groupRef} scale={SHIP_MODEL_SCALE}>
      {/* === Lift wrapper: 全体を +SHIP_LIFT_Z 持ち上げて cannon mount を world origin に着地。
            これで cannon 軸が origin (= 過去光円錐の交点 = laser 発射点) を通る。
            exhausts は lift wrapper 内、座標系は lifted frame (z=0 は world z=+SHIP_LIFT_Z)。
            Spacetime acceleration arrow は display frame 直 attach (ship body group の外、下方)。 */}
      <group position={[0, 0, SHIP_LIFT_Z]}>
      {/* Hull: 六角プリズム (CylinderGeometry segments=6) で +x に vertex (尖端)。
          X 方向 scale 1.4 で elongate → 前後に細長い nose 付きシルエット。
          default cylinder 軸 = +y を z 軸に立てるため X 軸 90° 回転、その後 X scale。 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[SHIP_HULL_X_SCALE, 1, 1]}>
        <cylinderGeometry
          args={[SHIP_HULL_RADIUS, SHIP_HULL_RADIUS, SHIP_HULL_HEIGHT, SHIP_HULL_SEGMENTS]}
        />
        <meshStandardMaterial
          color={hullColor}
          emissive={hullEmissive}
          emissiveIntensity={SHIP_HULL_EMISSIVE_INTENSITY}
          roughness={0.55}
          metalness={0.4}
        />
      </mesh>

      {/* 上面構造物 (案 A/B 切替可能、player 色で識別性を付与)。 */}
      {dorsalStyle === "pod" && <DorsalPodRenderer color={player.color} />}
      {dorsalStyle === "antenna" && <AntennaBeaconRenderer color={player.color} />}

      {/* 4 RCS nozzle hardware (常時可視、de Laval ベル型)。同 geometry を 2 pass 描画
          で外面 (FrontSide、明るい hardware 色) と内面 (BackSide、影に沈んだ暗い色) を
          別 material に分離。CylinderGeometry(EXIT_wide, THROAT_narrow, length) を
          θ-π/2 だけ z 軸回転して outward 方向に top=wide を向ける。 */}
      {nozzleAngles.map((θ, i) => {
        const outX = Math.cos(θ);
        const outY = Math.sin(θ);
        const distFromCenter =
          SHIP_HULL_RADIUS + SHIP_NOZZLE_OUTWARD_OFFSET + SHIP_NOZZLE_LENGTH / 2;
        return (
          <group
            // biome-ignore lint/suspicious/noArrayIndexKey: NOZZLE_COUNT 固定 + 順序不変
            key={`nozzle-${i}`}
            position={[outX * distFromCenter, outY * distFromCenter, 0]}
            rotation={[0, 0, θ - Math.PI / 2]}
          >
            {/* 外面 (FrontSide) */}
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
            {/* 内面 (BackSide、奥に沈んだ影色) */}
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
            {/* Throat disk: nozzle 最奥 (inward 側) を塞ぐ発光円盤。radius = THROAT、
                color = EXHAUST_INNER_COLOR (噴射炎 inner core と同色)。「ノズル奥が
                燃えてる」見え方を作る。meshBasicMaterial なのでライト非依存で常に全輝度。
                rotation.x = -π/2 で disk normal を local +y (= nozzle exit 方向、外側から
                覗き込む camera 向き) に合わせる。 */}
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
            {/* Mount pylon: hull edge → nozzle throat を繋ぐ tapered cylinder。
                +y (top, outward 側) = nozzle throat 接続 (細い)、-y (bottom, hull 側) = base (太い)。
                group 原点は nozzle 中心、mount 中心は hull edge と throat の中点 →
                y = -(OFFSET/2 + LENGTH/2) に placement。hull facet が内側を occlude して
                「hull から emerge する mount」に見える。色は bracket と同じ (steel-blue) で
                「取り付けパーツ」ファミリーに統一。 */}
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
        );
      })}

      {/* === 砲: belly mount で hull 底面から bracket 経由でぶら下げ ===
          1. Bracket: hull 底面 (z=-HULL_H/2) から垂直に -z 方向に伸びる短い cylinder。
          2. その bracket 末端を mount point として cannon group を配置。
          3. cannon group は +π/4 回転で +x → forward+down 方向に向ける。
          4. cannon 各 segment は group 内で x=0 から始まる (HULL_R offset なし)。
          結果: 砲は hull 真下にぶら下がり、そこから forward+down 45° に伸びる
          → 後方視点でも常に hull 下に砲身が見える。
          cannonStyle='laser' では LaserCannonRenderer で差替え (bracket は内部で同 spec 再描画)。
          外側 group (cannonYawGroupRef) で yaw 回転 → 本体固定で砲だけが heading 方向を指す。 */}
      <group ref={cannonYawGroupRef}>
      {cannonStyle === "laser" && <LaserCannonRenderer color={player.color} />}
      {cannonStyle === "gun" && (
        <>

      {/* Bracket (hull 底面 → cannon mount point の垂直支柱)。色は SHIP_BRACKET_* 系列
          (steel-blue、nozzle 外面と同色) で hull/cannon (dark navy) と分離。 */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[
          0,
          0,
          -SHIP_HULL_HEIGHT / 2 - SHIP_GUN_BRACKET_HEIGHT / 2,
        ]}
      >
        {/* Tapered cone (円錐台): radiusTop = BASE_RADIUS (hull 根元側、太い) →
            radiusBottom = BRACKET_RADIUS (cannon mount 側、細い)。rotation=[π/2,0,0] で
            局所 +Y が world +Z (= hull 側) に回転するため、radiusTop = 根元。 */}
        <cylinderGeometry
          args={[
            SHIP_GUN_BRACKET_BASE_RADIUS,
            SHIP_GUN_BRACKET_RADIUS,
            SHIP_GUN_BRACKET_HEIGHT,
            8,
          ]}
        />
        <meshStandardMaterial
          color={bracketColor}
          emissive={bracketEmissiveColor}
          emissiveIntensity={SHIP_BRACKET_EMISSIVE_INTENSITY}
          roughness={0.65}
          metalness={0.6}
        />
      </mesh>

      {/* Cannon assembly group: bracket 末端を mount point として +π/4 down-forward */}
      <group
        position={[0, 0, -SHIP_HULL_HEIGHT / 2 - SHIP_GUN_BRACKET_HEIGHT]}
        rotation={[0, SHIP_GUN_PITCH_DOWN_RAD, 0]}
      >
        {/* Breech (砲尾、cannon 根元のチャンクなハウジング)。REAR_EXTENSION で
            breech 全体が cannon group origin (= bracket 接続点) より後方に shift。 */}
        <mesh
          position={[SHIP_GUN_BREECH_LENGTH / 2 - SHIP_CANNON_REAR_EXTENSION, 0, 0]}
          rotation={[0, 0, -Math.PI / 2]}
        >
          <cylinderGeometry
            args={[
              SHIP_GUN_BREECH_RADIUS,
              SHIP_GUN_BREECH_RADIUS,
              SHIP_GUN_BREECH_LENGTH,
              16,
            ]}
          />
          <meshStandardMaterial
            color={gunColor}
            emissive={gunEmissiveColor}
            emissiveIntensity={SHIP_GUN_EMISSIVE_INTENSITY}
            roughness={0.65}
            metalness={0.65}
          />
        </mesh>
        {/* 主砲身 (同じく REAR_EXT で shift) */}
        <mesh
          position={[SHIP_GUN_BARREL_LENGTH / 2 - SHIP_CANNON_REAR_EXTENSION, 0, 0]}
          rotation={[0, 0, -Math.PI / 2]}
        >
          <cylinderGeometry
            args={[
              SHIP_GUN_BARREL_RADIUS,
              SHIP_GUN_BARREL_RADIUS,
              SHIP_GUN_BARREL_LENGTH,
              16,
            ]}
          />
          <meshStandardMaterial
            color={gunColor}
            emissive={gunEmissiveColor}
            emissiveIntensity={SHIP_GUN_EMISSIVE_INTENSITY}
            roughness={0.6}
            metalness={0.7}
          />
        </mesh>
        {/* 補強リング × N (主砲身に等間隔 wrap)。色は cannon body と同じ (navy) に戻す。 */}
        {ringPositions.map((px, i) => (
          <mesh
            // biome-ignore lint/suspicious/noArrayIndexKey: ring 位置固定 + 順序不変
            key={`gun-ring-${i}`}
            position={[px, 0, 0]}
            rotation={[0, 0, -Math.PI / 2]}
          >
            <cylinderGeometry
              args={[
                SHIP_GUN_RING_RADIUS,
                SHIP_GUN_RING_RADIUS,
                SHIP_GUN_RING_LENGTH,
                16,
              ]}
            />
            <meshStandardMaterial
              color={gunColor}
              emissive={gunEmissiveColor}
              emissiveIntensity={SHIP_GUN_EMISSIVE_INTENSITY * 1.1}
              roughness={0.55}
              metalness={0.7}
            />
          </mesh>
        ))}
        {/* TIP (主砲身 → 細い延長、REAR_EXT shift 適用) */}
        <mesh
          position={[
            SHIP_GUN_BARREL_LENGTH + SHIP_GUN_TIP_LENGTH / 2 - SHIP_CANNON_REAR_EXTENSION,
            0,
            0,
          ]}
          rotation={[0, 0, -Math.PI / 2]}
        >
          <cylinderGeometry
            args={[
              SHIP_GUN_TIP_RADIUS,
              SHIP_GUN_TIP_RADIUS,
              SHIP_GUN_TIP_LENGTH,
              16,
            ]}
          />
          <meshStandardMaterial
            color={gunColor}
            emissive={gunEmissiveColor}
            emissiveIntensity={SHIP_GUN_EMISSIVE_INTENSITY * 1.2}
            roughness={0.55}
            metalness={0.75}
          />
        </mesh>
        {/* Muzzle brake (TIP 末端、砲口デバイス、REAR_EXT shift 適用) */}
        <mesh
          position={[
            SHIP_GUN_BARREL_LENGTH +
              SHIP_GUN_TIP_LENGTH -
              SHIP_GUN_MUZZLE_BRAKE_LENGTH / 2 -
              SHIP_CANNON_REAR_EXTENSION,
            0,
            0,
          ]}
          rotation={[0, 0, -Math.PI / 2]}
        >
          <cylinderGeometry
            args={[
              SHIP_GUN_MUZZLE_BRAKE_RADIUS,
              SHIP_GUN_MUZZLE_BRAKE_RADIUS,
              SHIP_GUN_MUZZLE_BRAKE_LENGTH,
              16,
            ]}
          />
          <meshStandardMaterial
            color={gunColor}
            emissive={gunEmissiveColor}
            emissiveIntensity={SHIP_GUN_EMISSIVE_INTENSITY * 1.3}
            roughness={0.5}
            metalness={0.8}
          />
        </mesh>
      </group>
        </>
      )}
      </group>

      {/* Exhaust (4 nozzle 各々、旧 ExhaustCone と同 spec、2 層 cone + additive blending)。
          位置・向き・scale は useFrame で nozzle 個別に動的設定。
          **`renderOrder={10}` + `depthTest: false`**: 世界線 tube 等の D pattern geometry
          と重なっても煙が必ず上に描画される (transparent + additive なので後勝ち順が
          意味を持つ)。depthTest off で他 object に occlude されず、renderOrder で常に
          後段描画。 */}
      {nozzleAngles.map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: NOZZLE_COUNT 固定 + 順序不変
        <group key={`exhaust-${i}`}>
          <mesh
            ref={(el) => {
              exhaustOuterRefs.current[i] = el;
            }}
            geometry={sharedGeometries.exhaustCone}
            visible={false}
            renderOrder={10}
          >
            <meshBasicMaterial
              ref={(el) => {
                exhaustOuterMatRefs.current[i] = el;
              }}
              color={exhaustOuterColor}
              transparent
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <mesh
            ref={(el) => {
              exhaustInnerRefs.current[i] = el;
            }}
            geometry={sharedGeometries.exhaustCone}
            visible={false}
            renderOrder={10}
          >
            <meshBasicMaterial
              ref={(el) => {
                exhaustInnerMatRefs.current[i] = el;
              }}
              color={exhaustInnerColor}
              transparent
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      </group>{/* end lift wrapper */}
    </group>
    {/* Spacetime acceleration arrow: display frame 直 attach (ship body group の外側、yaw/scale
        非適用)。useFrame が observerBoost · α_world を計算して position + quaternion を直打ち。
        時空 4-vector の可視化なので、位置は display 座標そのもの (機体 lifted frame ではなく)、
        向きも任意 3D 方向 (時間軸に傾くこともあり)。geometry は元の flat 2D 矢印を流用、
        setFromUnitVectors で +y 軸を α_obs 方向に向ける (edge-on 視点になる極限では潰れるが
        通常のゲームカメラ角度では視認可能)。 */}
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
