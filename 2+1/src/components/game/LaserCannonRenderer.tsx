import { useMemo } from "react";
import {
  SHIP_GUN_PITCH_DOWN_RAD,
  SHIP_HULL_HEIGHT,
  SHIP_LASER_BARREL_COLOR,
  SHIP_LASER_BARREL_EMISSIVE_COLOR,
  SHIP_LASER_BARREL_EMISSIVE_INTENSITY,
  SHIP_LASER_BARREL_LENGTH,
  SHIP_LASER_BARREL_RADIUS,
  SHIP_LASER_BARREL_REAR_EXTENSION,
  SHIP_LASER_CRYSTAL_LENGTH,
  SHIP_LASER_CRYSTAL_POS_FRAC,
  SHIP_LASER_CRYSTAL_RADIUS,
  SHIP_LASER_EMITTER_RADIUS,
  SHIP_LASER_EMITTER_THICKNESS,
  SHIP_LASER_GLOW_COLOR,
  SHIP_LASER_GLOW_EMISSIVE_COLOR,
  SHIP_LASER_GLOW_EMISSIVE_INTENSITY,
  SHIP_LASER_LENS_COLOR,
  SHIP_LASER_LENS_COUNT,
  SHIP_LASER_LENS_EMISSIVE_COLOR,
  SHIP_LASER_LENS_EMISSIVE_INTENSITY_BASE,
  SHIP_LASER_LENS_EMISSIVE_INTENSITY_FRONT,
  SHIP_LASER_LENS_OUTER_R_BACK,
  SHIP_LASER_LENS_OUTER_R_FRONT,
  SHIP_LASER_LENS_SPACING,
  SHIP_LASER_LENS_TUBE,
  SHIP_LASER_MOUNT_X_OFFSET,
  SHIP_LASER_POD_COLOR,
  SHIP_LASER_POD_EMISSIVE_COLOR,
  SHIP_LASER_POD_EMISSIVE_INTENSITY,
  SHIP_LASER_POD_FORE_AFT,
  SHIP_LASER_POD_LATERAL,
  SHIP_LASER_POD_VERTICAL,
  SHIP_LASER_POD_X_OFFSET,
} from "./constants";
import { getThreeColor } from "./threeCache";

/**
 * 自機用レーザー砲 v2 (2026-04-22 redesign)。
 *
 * Theme: Y-wing chin turret 風の整流 pod 一体型。砲は「ぶら下げた外付け」ではなく、
 *        hull 底面の chin pod から **生える** 形で構造的一体感を出す。
 *
 * 構成 (hull 底 → 前):
 *   1. Chin pod        hull 底面にビルトインされた elongated 半潜没 ellipsoid。電源 pack /
 *                      基盤を視覚的に吸収。pod 下極が cannon mount point (world origin)。
 *   2. Barrel          pod 下極から 45° 下前方に slender cylinder で伸びる主砲身。
 *   3. Crystal bulge   barrel 中途 (55%) の cyan emissive 膨らみ。prismatic focus crystal 風。
 *   4. Lens stack      barrel 前端から前方へ 3 段 narrowing torus rings。焦点絞り。
 *   5. Emitter disc    lens stack 最奥の bright cyan plate。発射孔。
 *
 * 制約: SHIP_GUN_PITCH_DOWN_RAD (π/4) と SHIP_LIFT_Z (= HULL_HEIGHT/2 + 0.55) は
 *       gun と共用。cannon mount (cannon group origin) が world origin に着地、cannon 軸が
 *       origin を通る。pod 高 0.55 で mount まで届くよう pod 垂直寸法を設定。
 */
export const LaserCannonRenderer = () => {
  const podColor = useMemo(() => getThreeColor(SHIP_LASER_POD_COLOR), []);
  const podEmissive = useMemo(
    () => getThreeColor(SHIP_LASER_POD_EMISSIVE_COLOR),
    [],
  );
  const barrelColor = useMemo(() => getThreeColor(SHIP_LASER_BARREL_COLOR), []);
  const barrelEmissive = useMemo(
    () => getThreeColor(SHIP_LASER_BARREL_EMISSIVE_COLOR),
    [],
  );
  const glowColor = useMemo(() => getThreeColor(SHIP_LASER_GLOW_COLOR), []);
  const glowEmissive = useMemo(
    () => getThreeColor(SHIP_LASER_GLOW_EMISSIVE_COLOR),
    [],
  );
  const lensColor = useMemo(() => getThreeColor(SHIP_LASER_LENS_COLOR), []);
  const lensEmissive = useMemo(
    () => getThreeColor(SHIP_LASER_LENS_EMISSIVE_COLOR),
    [],
  );

  // Chin pod 寸法 (sphere base R=1 を scale して ellipsoid 化)。
  // pod 中心 z = -HULL_H/2 - POD_VERTICAL/2 で pod 下極が -HULL_H/2 - POD_VERTICAL に到達、
  // これが cannon mount (世界座標 0) に一致する。
  const podCenterZ = -SHIP_HULL_HEIGHT / 2 - SHIP_LASER_POD_VERTICAL / 2;
  const podScaleX = SHIP_LASER_POD_FORE_AFT / 2;
  const podScaleY = SHIP_LASER_POD_LATERAL / 2;
  const podScaleZ = SHIP_LASER_POD_VERTICAL / 2;

  // Lens stack: N 段、rear → front で outer R が narrowing、x 等間隔、emissive 強化。
  const lensRings = useMemo(() => {
    const arr: { x: number; outerR: number; emissive: number }[] = [];
    const denom = Math.max(1, SHIP_LASER_LENS_COUNT - 1);
    for (let i = 0; i < SHIP_LASER_LENS_COUNT; i++) {
      const frac = i / denom;
      const x =
        SHIP_LASER_BARREL_LENGTH +
        SHIP_LASER_LENS_SPACING / 2 +
        i * SHIP_LASER_LENS_SPACING;
      const outerR =
        SHIP_LASER_LENS_OUTER_R_BACK +
        (SHIP_LASER_LENS_OUTER_R_FRONT - SHIP_LASER_LENS_OUTER_R_BACK) * frac;
      const emissive =
        SHIP_LASER_LENS_EMISSIVE_INTENSITY_BASE +
        (SHIP_LASER_LENS_EMISSIVE_INTENSITY_FRONT -
          SHIP_LASER_LENS_EMISSIVE_INTENSITY_BASE) *
          frac;
      arr.push({ x, outerR, emissive });
    }
    return arr;
  }, []);

  const emitterX =
    SHIP_LASER_BARREL_LENGTH +
    SHIP_LASER_LENS_SPACING / 2 -
    SHIP_LASER_EMITTER_THICKNESS / 2;

  return (
    <>
      {/* === (1) Chin pod: hull 底面にビルトイン、elongated ellipsoid。
             upper 半は hull 内部に埋没 (z > -HULL_H/2)、lower 半が可視。
             pod 下極 (z = -HULL_H/2 - POD_VERTICAL) が cannon mount 一致点。 === */}
      <mesh
        position={[SHIP_LASER_POD_X_OFFSET, 0, podCenterZ]}
        scale={[podScaleX, podScaleY, podScaleZ]}
      >
        <sphereGeometry args={[1, 24, 18]} />
        <meshStandardMaterial
          color={podColor}
          emissive={podEmissive}
          emissiveIntensity={SHIP_LASER_POD_EMISSIVE_INTENSITY}
          roughness={0.5}
          metalness={0.65}
        />
      </mesh>

      {/* === Cannon assembly group (+π/4 down-forward) ===
          Pod 下極を mount point に一致させるため cannon group 位置は
          [0, 0, -HULL_H/2 - POD_VERTICAL] とする (= gun と同じ -HULL_H/2 - BRACKET_HEIGHT)。 */}
      <group
        position={[0, 0, -SHIP_HULL_HEIGHT / 2 - SHIP_LASER_POD_VERTICAL]}
        rotation={[0, SHIP_GUN_PITCH_DOWN_RAD, 0]}
      >
        <group position={[-SHIP_LASER_MOUNT_X_OFFSET, 0, 0]}>
          {/* (2) Barrel: slender cylinder、rear を REAR_EXTENSION 分 pod 内に埋没させる。
                 mesh range: local x ∈ [-REAR_EXT, BARREL_LENGTH]、mesh center x = (BARREL_LENGTH - REAR_EXT)/2。
                 rotZ=-π/2 で cylinderGeometry (default +Y 軸) を +x 軸に寝かせる。 */}
          <mesh
            position={[
              (SHIP_LASER_BARREL_LENGTH - SHIP_LASER_BARREL_REAR_EXTENSION) / 2,
              0,
              0,
            ]}
            rotation={[0, 0, -Math.PI / 2]}
          >
            <cylinderGeometry
              args={[
                SHIP_LASER_BARREL_RADIUS,
                SHIP_LASER_BARREL_RADIUS,
                SHIP_LASER_BARREL_LENGTH + SHIP_LASER_BARREL_REAR_EXTENSION,
                18,
              ]}
            />
            <meshStandardMaterial
              color={barrelColor}
              emissive={barrelEmissive}
              emissiveIntensity={SHIP_LASER_BARREL_EMISSIVE_INTENSITY}
              roughness={0.5}
              metalness={0.72}
            />
          </mesh>

          {/* (3) Crystal bulge: barrel 中途の cyan glow bulge (barrel radius より僅か proud) */}
          <mesh
            position={[
              SHIP_LASER_BARREL_LENGTH * SHIP_LASER_CRYSTAL_POS_FRAC,
              0,
              0,
            ]}
            rotation={[0, 0, -Math.PI / 2]}
          >
            <cylinderGeometry
              args={[
                SHIP_LASER_CRYSTAL_RADIUS,
                SHIP_LASER_CRYSTAL_RADIUS,
                SHIP_LASER_CRYSTAL_LENGTH,
                22,
              ]}
            />
            <meshStandardMaterial
              color={glowColor}
              emissive={glowEmissive}
              emissiveIntensity={SHIP_LASER_GLOW_EMISSIVE_INTENSITY * 1.0}
              roughness={0.3}
              metalness={0.2}
              toneMapped={false}
            />
          </mesh>

          {/* (4) Lens stack: 3 段 nested torus rings、rotY=π/2 で torus 軸を +x に向ける */}
          {lensRings.map((ring, i) => (
            <mesh
              // biome-ignore lint/suspicious/noArrayIndexKey: lens ring 固定
              key={`laser-lens-${i}`}
              position={[ring.x, 0, 0]}
              rotation={[0, Math.PI / 2, 0]}
            >
              <torusGeometry
                args={[
                  ring.outerR - SHIP_LASER_LENS_TUBE / 2,
                  SHIP_LASER_LENS_TUBE,
                  10,
                  28,
                ]}
              />
              <meshStandardMaterial
                color={lensColor}
                emissive={lensEmissive}
                emissiveIntensity={ring.emissive}
                roughness={0.4}
                metalness={0.7}
              />
            </mesh>
          ))}

          {/* (5) Recessed emitter disc: lens 最奥の bright cyan plate */}
          <mesh position={[emitterX, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <cylinderGeometry
              args={[
                SHIP_LASER_EMITTER_RADIUS,
                SHIP_LASER_EMITTER_RADIUS,
                SHIP_LASER_EMITTER_THICKNESS,
                24,
              ]}
            />
            <meshStandardMaterial
              color={glowColor}
              emissive={glowEmissive}
              emissiveIntensity={SHIP_LASER_GLOW_EMISSIVE_INTENSITY * 1.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      </group>
    </>
  );
};
