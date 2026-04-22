import { useMemo } from "react";
import {
  SHIP_DORSAL_POD_FORE_AFT,
  SHIP_DORSAL_POD_LATERAL,
  SHIP_DORSAL_POD_SUBMERGE_RATIO,
  SHIP_DORSAL_POD_VERTICAL,
  SHIP_DORSAL_POD_X_OFFSET,
  SHIP_DORSAL_STRIPE_DEFAULT_COLOR,
  SHIP_DORSAL_STRIPE_EMISSIVE_INTENSITY_DEFAULT,
  SHIP_DORSAL_STRIPE_EMISSIVE_INTENSITY_PLAYER,
  SHIP_DORSAL_STRIPE_TUBE_RADIUS,
  SHIP_HULL_HEIGHT,
  SHIP_LASER_POD_COLOR,
  SHIP_LASER_POD_EMISSIVE_COLOR,
  SHIP_LASER_POD_EMISSIVE_INTENSITY,
} from "./constants";
import { getThreeColor } from "./threeCache";

/**
 * Dorsal pod (機体上面の sensor/comms pod、chin laser pod の鏡像)。
 *
 * - Pod 本体: 扁平楕円体、下 30% を hull に埋没。構造色は chin pod と同じ dark navy
 *   (SHIP_LASER_POD_*)。
 * - 赤道 stripe: pod 中心 z に torus を一周、scale で pod 断面楕円に合わせる。
 *   `color?` 指定時はその hsl 色で emissive 点灯 (識別用 player 色)、未指定時は
 *   default cyan (laser glow と揃え)。
 * - player 色の emissive intensity は 1.0 に抑える (orange/yellow のように R+G 両 ch
 *   強い hue が HDR intensity でクリップ → 白飛びするのを回避、LaserCannonRenderer と同方針)。
 *
 * 配置は SelfShipRenderer の lift wrapper 内 (座標系: lifted frame、hull 中心 z=0)。
 */
export const DorsalPodRenderer = ({ color }: { color?: string } = {}) => {
  // hsl() 以外 (ShipPreview の "#ffffff" stub 等) は default cyan に fall back。
  const playerStripeColor = useMemo(
    () => (color?.startsWith("hsl(") ? color : null),
    [color],
  );

  const podColor = useMemo(() => getThreeColor(SHIP_LASER_POD_COLOR), []);
  const podEmissive = useMemo(
    () => getThreeColor(SHIP_LASER_POD_EMISSIVE_COLOR),
    [],
  );
  const stripeColorObj = useMemo(
    () => getThreeColor(playerStripeColor ?? SHIP_DORSAL_STRIPE_DEFAULT_COLOR),
    [playerStripeColor],
  );
  const stripeIntensity = playerStripeColor
    ? SHIP_DORSAL_STRIPE_EMISSIVE_INTENSITY_PLAYER
    : SHIP_DORSAL_STRIPE_EMISSIVE_INTENSITY_DEFAULT;

  // Pod 寸法 (sphere base R=1 を scale して ellipsoid 化)。
  const scaleX = SHIP_DORSAL_POD_FORE_AFT / 2;
  const scaleY = SHIP_DORSAL_POD_LATERAL / 2;
  const scaleZ = SHIP_DORSAL_POD_VERTICAL / 2;
  // pod 下面を hull 上面から SUBMERGE_RATIO · VERTICAL だけ下に置く:
  //   pod bottom = HULL_HEIGHT/2 - SUBMERGE_RATIO · VERTICAL
  //   pod center = pod bottom + VERTICAL/2 = HULL_HEIGHT/2 + (0.5 - SUBMERGE_RATIO) · VERTICAL
  const podCenterZ =
    SHIP_HULL_HEIGHT / 2 +
    (0.5 - SHIP_DORSAL_POD_SUBMERGE_RATIO) * SHIP_DORSAL_POD_VERTICAL;

  return (
    <>
      {/* Pod 本体 (扁平楕円体、構造色は chin pod と同じ dark navy) */}
      <mesh position={[SHIP_DORSAL_POD_X_OFFSET, 0, podCenterZ]} scale={[scaleX, scaleY, scaleZ]}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshStandardMaterial
          color={podColor}
          emissive={podEmissive}
          emissiveIntensity={SHIP_LASER_POD_EMISSIVE_INTENSITY}
          roughness={0.5}
          metalness={0.72}
        />
      </mesh>

      {/* 赤道 stripe: pod center z の xy 平面 (z 軸 = torus 軸) に torus を配置、
          scale (scaleX, scaleY, 1) で pod 楕円断面に追従。tube radius は細め
          (0.014) で「細い帯」に見せ、player 色 emissive で識別性を与える。 */}
      <mesh
        position={[SHIP_DORSAL_POD_X_OFFSET, 0, podCenterZ]}
        scale={[scaleX, scaleY, 1]}
      >
        <torusGeometry args={[1, SHIP_DORSAL_STRIPE_TUBE_RADIUS, 8, 32]} />
        <meshStandardMaterial
          color={stripeColorObj}
          emissive={stripeColorObj}
          emissiveIntensity={stripeIntensity}
          roughness={0.3}
          metalness={0.2}
          toneMapped={false}
        />
      </mesh>
    </>
  );
};
