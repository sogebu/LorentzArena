import * as THREE from "three";
import { LIGHT_CONE_HEIGHT } from "./constants";

// Color キャッシュ
const colorCache = new Map<string, THREE.Color>();
export const getThreeColor = (hslString: string): THREE.Color => {
  let color = colorCache.get(hslString);
  if (!color) {
    color = new THREE.Color(hslString);
    colorCache.set(hslString, color);
  }
  return color;
};

// 共有ジオメトリ（シングルトン）
export const sharedGeometries = {
  playerSphere: new THREE.SphereGeometry(0.5, 8, 8),
  intersectionSphere: new THREE.SphereGeometry(0.225, 16, 16),
  intersectionCore: new THREE.SphereGeometry(0.075, 12, 12),
  intersectionRing: new THREE.TorusGeometry(0.35, 0.035, 12, 24),
  laserIntersectionDot: new THREE.SphereGeometry(0.125, 12, 12),
  // レーザー × 光円錐 交差: 同時刻面 (local xy) 上の細長い三角形、tip が +x（回転で進行方向へ向ける）
  laserIntersectionTriangle: (() => {
    const shape = new THREE.Shape();
    // Acute golden gnomon: 頂角 36°、脚:底辺 = φ:1。
    // 底辺 = 0.12, 脚 = 0.12·φ ≈ 0.194, 高さ = √(脚² − (底辺/2)²) ≈ 0.1844。
    shape.moveTo(0.0344, 0);
    shape.lineTo(-0.15, 0.06);
    shape.lineTo(-0.15, -0.06);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  })(),
  lightCone: new THREE.ConeGeometry(LIGHT_CONE_HEIGHT, LIGHT_CONE_HEIGHT, 32, 1, true),
  explosionParticle: new THREE.SphereGeometry(0.5, 6, 6), // スケールで size 調整
  // Spawn effect
  spawnRing: new THREE.TorusGeometry(0.5, 0.03, 8, 24), // スケールで ringRadius 調整
  spawnPillar: new THREE.CylinderGeometry(0.04, 0.04, 1, 6), // スケールで pillarHeight 調整
  // Kill notification
  // Laser direction arrow (past light cone direction)
  laserArrow: (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.75);    // 先端（下向き）
    shape.lineTo(0.45, 0.45);  // 右上
    shape.lineTo(-0.45, 0.45); // 左上
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  })(),
  killSphere: new THREE.SphereGeometry(0.55, 16, 16),
  killRing: new THREE.RingGeometry(0.65, 0.8, 24),
};

// デブリマーカー用 material キャッシュ（色ごとに1つ）
const debrisMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
export const getDebrisMaterial = (
  color: THREE.Color,
): THREE.MeshBasicMaterial => {
  const key = color.getHexString();
  let mat = debrisMaterialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
    });
    debrisMaterialCache.set(key, mat);
  }
  return mat;
};

// デバッグ用: キャッシュサイズの監視（ブラウザコンソールで window.debugCaches を参照）
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).debugCaches = {
    colorCache,
    sharedGeometries,
  };
}
