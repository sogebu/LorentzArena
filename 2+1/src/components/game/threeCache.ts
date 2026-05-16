import * as THREE from "three";
import { DEBRIS_MARKER_OPACITY, HIT_DEBRIS_MARKER_OPACITY } from "./constants";

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

/**
 * 2 つの CSS color (HSL / RGB / hex 等、 THREE.Color が parse できる形式) を `t` で線形補間
 * して "rgb(r, g, b)" string で返す。 t=0 で base、 t=1 で tint、 t=0.5 で半々。
 *
 * 用途: hit debris / laser past-cone marker 等で「base 色 (= universal silver 等) に
 * 個別色 (= 発射者 / victim 色) を混ぜる」 ための utility。 `getThreeColor` は引数を
 * cache する pure converter なので `.clone()` で base を mutate しないようにし、
 * `.getStyle()` で CSS 形式 string に戻す (= `DebrisRecord.color: string` 等の slot に
 * 直接入る)。 結果 string は base + tint + ratio の組み合わせごとに unique で、 同じ組み
 * 合わせなら `getThreeColor` cache が hit する (= cache 肥大化は killer/victim 色種別の
 * 数程度に bounded)。
 *
 * 2026-05-16 odakin 指示「レーザーが当たったときの煙にも、 撃った人の色を混ぜよう」 で
 * 新設。 過去の universal silver design (= 2026-04-21、 「killer 識別は HUD で行う、
 * debris に二重情報を入れない」) を撤回、 hit debris 色軸 + HUD 軸の 2 経路で識別性
 * 強化する設計に移行。
 */
export const mixColors = (
  baseColor: string,
  tintColor: string,
  t: number,
): string => {
  const mixed = getThreeColor(baseColor).clone().lerp(getThreeColor(tintColor), t);
  return mixed.getStyle();
};

// 共有ジオメトリ（シングルトン）
export const sharedGeometries = {
  playerSphere: new THREE.SphereGeometry(0.5, 8, 8),
  intersectionSphere: new THREE.SphereGeometry(0.225, 16, 16),
  intersectionRing: new THREE.TorusGeometry(0.35, 0.035, 12, 24),
  laserIntersectionDot: new THREE.SphereGeometry(0.125, 12, 12),
  // レーザー × 光円錐 交差: 同時刻面 (local xy) 上の細長い三角形、tip が +x（回転で進行方向へ向ける）
  laserIntersectionTriangle: (() => {
    const shape = new THREE.Shape();
    // Acute golden gnomon: 頂角 36°、脚:底辺 = φ:1。
    // 底辺 = 0.12, 脚 = 0.12·φ ≈ 0.194, 高さ ≈ 0.1844。
    // 重心 (x) = 0 になるよう tip=2h/3, back=-h/3 で配置。
    shape.moveTo(0.1229, 0);
    shape.lineTo(-0.0615, 0.06);
    shape.lineTo(-0.0615, -0.06);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  })(),
  explosionParticle: new THREE.SphereGeometry(0.5, 6, 6), // スケールで size 調整
  // Spawn effect
  spawnRing: new THREE.TorusGeometry(0.5, 0.03, 8, 24), // スケールで ringRadius 調整
  spawnPillar: new THREE.CylinderGeometry(0.5, 0.5, 1, 12), // スケールで pillarHeight 調整
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
  // Exhaust cone: local +y 方向を軸に、底面が y=-0.5、頂点が y=+0.5 にある単位 cone。
  // scale(r, length, r) で実寸調整、rotation で反推力方向へ向ける。
  exhaustCone: new THREE.ConeGeometry(1, 1, 12, 1, true),
  // Acceleration arrow: xy 平面上の flat 2D 矢印 (頭 + 軸)。unit 長 1・最大幅 0.5。
  // 方向は +y 方向で生成、rotation で加速度方向へ向ける。flat で描画するため
  // 任意視点から「矢印」として常に認識できる (cone 頭だけだと視線方向で潰れる)。
  accelerationArrowFlat: (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1);          // tip (+y)
    shape.lineTo(0.35, 0.55);    // 頭右下
    shape.lineTo(0.14, 0.55);    // 軸右上
    shape.lineTo(0.14, -0.5);    // 軸右下 (tail)
    shape.lineTo(-0.14, -0.5);   // 軸左下
    shape.lineTo(-0.14, 0.55);   // 軸左上
    shape.lineTo(-0.35, 0.55);   // 頭左下
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  })(),
  // Arena 用の固定 cylinder geometry は不要 (ArenaRenderer が observer 因果コーンで
  // 動的に triangle strip を生成する)。
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
      opacity: DEBRIS_MARKER_OPACITY,
      depthWrite: false,
    });
    debrisMaterialCache.set(key, mat);
  }
  return mat;
};

// Phase C1: hit デブリ用 marker material (opacity 半分)。
const hitDebrisMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
export const getHitDebrisMaterial = (
  color: THREE.Color,
): THREE.MeshBasicMaterial => {
  const key = color.getHexString();
  let mat = hitDebrisMaterialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: HIT_DEBRIS_MARKER_OPACITY,
      depthWrite: false,
    });
    hitDebrisMaterialCache.set(key, mat);
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
