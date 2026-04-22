import { useMemo } from "react";
import {
  SHIP_DORSAL_ANTENNA_LENGTH,
  SHIP_DORSAL_ANTENNA_RADIUS,
  SHIP_DORSAL_BEACON_EMISSIVE_INTENSITY_DEFAULT,
  SHIP_DORSAL_BEACON_EMISSIVE_INTENSITY_PLAYER,
  SHIP_DORSAL_BEACON_RADIUS,
  SHIP_DORSAL_STRIPE_DEFAULT_COLOR,
  SHIP_HULL_HEIGHT,
  SHIP_LASER_BARREL_COLOR,
  SHIP_LASER_BARREL_EMISSIVE_COLOR,
  SHIP_LASER_BARREL_EMISSIVE_INTENSITY,
} from "./constants";
import { getThreeColor } from "./threeCache";

/**
 * 案 A: 機体上面に細いアンテナ棒 + 先端の player 色 ビーコン球。
 *
 * 真上からの game camera で球が一番視認性高く、シルエットを崩さない最小構造。
 *
 * - Antenna rod: 細い cylinder、gunmetal (laser barrel と同色)、hull 上面 (z=HULL_H/2)
 *   から +z 方向に SHIP_DORSAL_ANTENNA_LENGTH 伸ばす。
 * - Beacon ball: rod 先端に sphere、player 色 emissive (識別用)。R+G 両 ch 強い hue
 *   (orange/yellow) のクリップ回避のため intensity を 1.0 に抑える (default cyan は 2.0)。
 *
 * 配置は SelfShipRenderer の lift wrapper 内 (座標系: lifted frame、hull 中心 z=0)。
 */
export const AntennaBeaconRenderer = ({ color }: { color?: string } = {}) => {
  const playerBeaconColor = useMemo(
    () => (color?.startsWith("hsl(") ? color : null),
    [color],
  );

  const rodColor = useMemo(() => getThreeColor(SHIP_LASER_BARREL_COLOR), []);
  const rodEmissive = useMemo(
    () => getThreeColor(SHIP_LASER_BARREL_EMISSIVE_COLOR),
    [],
  );
  const beaconColorObj = useMemo(
    () => getThreeColor(playerBeaconColor ?? SHIP_DORSAL_STRIPE_DEFAULT_COLOR),
    [playerBeaconColor],
  );
  const beaconIntensity = playerBeaconColor
    ? SHIP_DORSAL_BEACON_EMISSIVE_INTENSITY_PLAYER
    : SHIP_DORSAL_BEACON_EMISSIVE_INTENSITY_DEFAULT;

  // Rod: hull 上面 (z=HULL_H/2) から +z に LENGTH 伸びる cylinder。
  // CylinderGeometry は default で +y 軸沿いなので X 軸 90° 回転して +z に立てる。
  const rodCenterZ = SHIP_HULL_HEIGHT / 2 + SHIP_DORSAL_ANTENNA_LENGTH / 2;
  // Beacon ball: rod 先端 = hull 上面 + LENGTH。
  const beaconZ =
    SHIP_HULL_HEIGHT / 2 + SHIP_DORSAL_ANTENNA_LENGTH + SHIP_DORSAL_BEACON_RADIUS * 0.6;

  return (
    <>
      <mesh position={[0, 0, rodCenterZ]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry
          args={[
            SHIP_DORSAL_ANTENNA_RADIUS,
            SHIP_DORSAL_ANTENNA_RADIUS,
            SHIP_DORSAL_ANTENNA_LENGTH,
            8,
          ]}
        />
        <meshStandardMaterial
          color={rodColor}
          emissive={rodEmissive}
          emissiveIntensity={SHIP_LASER_BARREL_EMISSIVE_INTENSITY}
          roughness={0.5}
          metalness={0.72}
        />
      </mesh>
      <mesh position={[0, 0, beaconZ]}>
        <sphereGeometry args={[SHIP_DORSAL_BEACON_RADIUS, 18, 14]} />
        <meshStandardMaterial
          color={beaconColorObj}
          emissive={beaconColorObj}
          emissiveIntensity={beaconIntensity}
          roughness={0.3}
          metalness={0.2}
          toneMapped={false}
        />
      </mesh>
    </>
  );
};
