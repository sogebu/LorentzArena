import * as THREE from "three";
import type { Vector3, Vector4 } from "../../physics";
import { buildMeshMatrix } from "./DisplayFrameContext";

/**
 * Base-ring 楕円 stretch factor (x_∥^O 方向、display xy plane で)。
 *
 * **物理的導出**: 観測者 O の rest frame (display frame) で anchor 起点の
 * 過去光円錐頂点方向ベクトル (x_∥^O, 1) は Euclidean 長 √2。これを display xy
 * plane (O の simultaneity plane、time 軸に垂直) に寝かせて長さ保存すると、
 * x_∥^O 軸成分 √2·r、x_⊥^O 軸成分 r の楕円になる → k = √2。
 *
 * 詳細: `plans/2026-04-21-ship-apparent-shape-pattern.md` §底面 xy 楕円化。
 */
const ELLIPSE_K = Math.SQRT2;

/**
 * Apparent-shape matrix (2+1 M pattern、LH / ship 共通 generic 版)。
 *
 * ## 物理 spec
 *
 * Model vertex (m.x, m.y, m.z) を以下で世界系へ写す:
 *
 * 1. **底面 (m.xy)**: 観測者 O の rest frame (= display frame) の xy plane
 *    (simultaneity slice) 上で x_∥^O 方向に k=√2 stretch:
 *      (X_disp, Y_disp) = S · (m.x, m.y),   S = I + (k−1) · x_∥^O ⊗ x_∥^O^T
 *    x_∥^O = display spatial で anchor から観測者への単位ベクトル。
 *    `displayMatrix^{-1}` で world 系へ back-solve (translation は direction vec
 *    に効かない)。
 * 2. **塔軸 (m.z)**: A の world 4-velocity 方向に m.z 倍 = L(−uA)·(0,0,1) in
 *    three.js = (uA.x, uA.y, γ(uA))。LH (uA=0) は world t 軸、ship (uA≠0) は
 *    worldline tangent 方向に γ 倍で倒れる。
 * 3. 世界系 anchor 位置への並進 tAnchor、次いで displayMatrix。
 *
 * ## 振る舞い
 *
 * - **底面**: 観測者静止系時間軸 (display z) に常に垂直 (= display 上で水平な
 *   ellipse)。観測者が動いていても display では水平を維持、world 系で見ると
 *   observer simultaneity plane に沿った tilt。
 * - **塔軸**: A の world worldline tangent 方向。静止 O では display でも同方向、
 *   動く O では display で L(uO) によって傾く (観測者視点での A's proper time axis)。
 *
 * ## Degenerate
 *
 * - `observerPos = null` → `buildMeshMatrix` fallback。
 * - display spatial で anchor と観測者の xy が一致 (x_∥^O 不定) → 同上 fallback。
 *
 * @param anchorPos   worldline ∩ 観測者 past-cone の world 4-vec。
 * @param anchorU     A の world 系 spatial 4-velocity (Vector3、2+1 では z=0)。
 *                    LH は `vector3Zero()`、ship は `player.phaseSpace.u`。
 * @param observerPos 観測者の world 4-vec (null で fallback)。
 * @param displayMatrix world → display の THREE.Matrix4 (= `buildDisplayMatrix`)。
 */
export const buildApparentShapeMatrix = (
  anchorPos: Vector4,
  anchorU: Vector3,
  observerPos: Vector4 | null,
  displayMatrix: THREE.Matrix4,
): THREE.Matrix4 => {
  if (!observerPos) return buildMeshMatrix(anchorPos, displayMatrix);

  // x_∥^O を display spatial で取る。観測者の display 位置は observerBoost 有り
  // (静止系) で (0,0,0)、無し (世界系) で (observer.x, observer.y, 0) だが、
  // 一般に displayMatrix(observerPos) として計算する。
  const anchorDisp = new THREE.Vector3(anchorPos.x, anchorPos.y, anchorPos.t)
    .applyMatrix4(displayMatrix);
  const observerDisp = new THREE.Vector3(observerPos.x, observerPos.y, observerPos.t)
    .applyMatrix4(displayMatrix);
  const dispDx = observerDisp.x - anchorDisp.x;
  const dispDy = observerDisp.y - anchorDisp.y;
  const rho2O = dispDx * dispDx + dispDy * dispDy;
  if (rho2O < 1e-12) return buildMeshMatrix(anchorPos, displayMatrix);

  const invRho = 1 / Math.sqrt(rho2O);
  const xParX = dispDx * invRho;
  const xParY = dispDy * invRho;

  // 底面 display 楕円 stretch: S = I + (k−1) · x_∥^O ⊗ x_∥^O^T
  const dk = ELLIPSE_K - 1;
  const Sxx = 1 + dk * xParX * xParX;
  const Sxy = dk * xParX * xParY;
  const Syy = 1 + dk * xParY * xParY;

  // M[:, 0] と M[:, 1] を back-solve: display での base 変位が (S·m.xy, 0_display_t)
  // になるように world 系の direction vector を取る。tAnchor は translation で
  // direction vec に効かない → displayMatrix^{-1} を direction に掛けて得る。
  const invDisplay = new THREE.Matrix4().copy(displayMatrix).invert();
  const mCol0 = new THREE.Vector4(Sxx, Sxy, 0, 0).applyMatrix4(invDisplay);
  const mCol1 = new THREE.Vector4(Sxy, Syy, 0, 0).applyMatrix4(invDisplay);

  // 塔軸 (m.z 列): A の world 4-velocity 方向 = L(−uA)·(0,0,1) in three.js
  // = (uA.x, uA.y, γ(uA))。LH uA=0 で (0, 0, 1) = world t 軸。
  const uAx = anchorU.x;
  const uAy = anchorU.y;
  const ut = Math.sqrt(1 + uAx * uAx + uAy * uAy);

  const M = new THREE.Matrix4().set(
    mCol0.x, mCol1.x, uAx, 0,
    mCol0.y, mCol1.y, uAy, 0,
    mCol0.z, mCol1.z, ut,  0,
    0,       0,       0,   1,
  );
  const tAnchor = new THREE.Matrix4().makeTranslation(
    anchorPos.x,
    anchorPos.y,
    anchorPos.t,
  );
  const result = new THREE.Matrix4().multiplyMatrices(displayMatrix, tAnchor);
  result.multiply(M);
  return result;
};
