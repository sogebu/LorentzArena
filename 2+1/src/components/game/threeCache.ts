import * as THREE from "three";

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
  playerSphere: new THREE.SphereGeometry(1, 8, 8),
  intersectionSphere: new THREE.SphereGeometry(0.45, 16, 16),
  intersectionCore: new THREE.SphereGeometry(0.15, 12, 12),
  intersectionRing: new THREE.TorusGeometry(0.7, 0.07, 12, 24),
  laserIntersectionDot: new THREE.SphereGeometry(0.25, 12, 12),
  lightCone: new THREE.ConeGeometry(40, 40, 32, 1, true),
  explosionParticle: new THREE.SphereGeometry(1, 6, 6), // スケールで size 調整
  // Spawn effect
  spawnRing: new THREE.TorusGeometry(1, 0.06, 8, 24), // スケールで ringRadius 調整
  spawnPillar: new THREE.CylinderGeometry(0.08, 0.08, 1, 6), // スケールで pillarHeight 調整
  // Kill notification
  killSphere: new THREE.SphereGeometry(1.5, 16, 16),
  killRing: new THREE.RingGeometry(1.8, 2.2, 24),
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
