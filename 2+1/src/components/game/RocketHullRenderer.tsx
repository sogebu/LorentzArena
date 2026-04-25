import { useMemo } from "react";
import * as THREE from "three";
import {
  SHIP_HULL_COLOR,
  SHIP_HULL_EMISSIVE_COLOR,
  SHIP_HULL_EMISSIVE_INTENSITY,
} from "./constants";
import { getThreeColor } from "./threeCache";

/**
 * Shooter mode 用機体: 滑らかな teardrop body (LatheGeometry 単一 mesh、繋ぎ目なし)。
 *
 * - 前方 +x は尖り、中央〜後方寄りで max radius を持たせて「ちょっとお尻が大きい」 silhouette
 * - 後端は engine bell の throat に近い細さに narrowing (de Laval bell とほぼ連続)
 *
 * 後部 de Laval bell engine + 動的炎は RocketShipRenderer 側で別途実装。Player 色の
 * 識別表示は当面なし (旧 stripe は除去、将来 glow 等で追加検討)。
 */
export const RocketHullRenderer = () => {
  const hullColor = getThreeColor(SHIP_HULL_COLOR);
  const hullEmissive = getThreeColor(SHIP_HULL_EMISSIVE_COLOR);

  // Profile (radius, axial_y)。LatheGeometry default は y 軸まわり revolve、
  // mesh rotation [0, 0, -π/2] で y 軸 → x 軸へ転換 → +y = 機体 forward (+x in world)。
  // Profile point ordering は前方 (+y) → 後方 (-y)。
  // 寸法: max radius 0.40 (太め)、全長 1.30 (大きめ)。お尻が丸くて全体ぽってり。
  const profile = useMemo<THREE.Vector2[]>(
    () => [
      new THREE.Vector2(0.0, 0.65), // 前端 tip (radius 0)
      new THREE.Vector2(0.07, 0.6),
      new THREE.Vector2(0.18, 0.5),
      new THREE.Vector2(0.28, 0.35),
      new THREE.Vector2(0.36, 0.15),
      new THREE.Vector2(0.4, -0.05), // max radius (中央やや後方 = cute round butt)
      new THREE.Vector2(0.38, -0.25),
      new THREE.Vector2(0.31, -0.42),
      new THREE.Vector2(0.2, -0.55),
      new THREE.Vector2(0.08, -0.65), // 後端 (engine bell throat に接続、threshold 0.05)
      new THREE.Vector2(0.0, -0.65),
    ],
    [],
  );

  return (
    <>
      {/* Body: LatheGeometry で revolve、単一 mesh で繋ぎ目なし。32 segments で滑らか。 */}
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <latheGeometry args={[profile, 32]} />
        <meshStandardMaterial
          color={hullColor}
          emissive={hullEmissive}
          emissiveIntensity={SHIP_HULL_EMISSIVE_INTENSITY}
          roughness={0.4}
          metalness={0.55}
        />
      </mesh>

    </>
  );
};
