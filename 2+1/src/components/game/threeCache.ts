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
};

// デバッグ用: キャッシュサイズの監視（ブラウザコンソールで window.debugCaches を参照）
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).debugCaches = {
    colorCache,
    sharedGeometries,
  };
}
