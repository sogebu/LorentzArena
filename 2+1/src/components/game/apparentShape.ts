import * as THREE from "three";
import { inverseLorentzBoost, type Vector3, type Vector4 } from "../../physics";

/**
 * v3 apparent-shape matrix。plan `2026-04-21-ship-apparent-shape-pattern.md` §v3 参照。
 *
 *   display = displayMatrix · T(anchorPos) · L(-u_P) · R_q · (a, b, c)
 *
 * - `R_q`          model を P 静止系内で yaw (2+1 なら z 軸回転、3+1 では quaternion)
 * - `L(-u_P)`      P 静止系 → world の Lorentz boost = `inverseLorentzBoost(u_P)`
 * - `T(anchorPos)` world 原点を P の過去光円錐 ∩ worldline event へ
 * - `displayMatrix`  world → display (rest frame は `Λ(u_O) · T(-observerPos)`、世界系は
 *                    `T(0, 0, -observerPos.t)`)
 *
 * 静止 P (u_P = 0) + heading = 0 では `displayMatrix · T(anchorPos)` に reduce し、既存
 * `buildMeshMatrix(anchorPos, displayMatrix)` と厳密一致する (灯台は u_P = 0 なので視覚変化
 * なし。ship 展開時に M に L(-u_P) が入り始める)。
 */
export const buildApparentShapeMatrix = (
  anchorPos: Vector4,
  uShip: Vector3,
  headingAngle: number,
  displayMatrix: THREE.Matrix4,
): THREE.Matrix4 => {
  const m = new THREE.Matrix4().multiplyMatrices(
    displayMatrix,
    new THREE.Matrix4().makeTranslation(anchorPos.x, anchorPos.y, anchorPos.t),
  );
  m.multiply(inverseBoostThree(uShip));
  if (headingAngle !== 0) {
    m.multiply(new THREE.Matrix4().makeRotationZ(headingAngle));
  }
  return m;
};

/**
 * `inverseLorentzBoost(u)` (P-rest → world、row-major (t, x, y, z)) を THREE.Matrix4
 * (column-major、display axes (x, y, z=t)) に axis 並べ替えて変換。translation なし。
 *
 * physics の spatial z 次元は 2+1 では常に 0 なので drop し、THREE 側の行列も 3×3 部分のみ
 * 埋めて z_THREE 入力は 0 と扱う (4 列目 identity)。
 */
const inverseBoostThree = (uShip: Vector3): THREE.Matrix4 => {
  const L = inverseLorentzBoost(uShip);
  const g = (r: number, c: number) => L.data[r * 4 + c];
  const m = new THREE.Matrix4();
  // physics row: 0=t, 1=x, 2=y, 3=z (unused in 2+1)
  // physics col: 0=t, 1=x, 2=y, 3=z (unused in 2+1)
  // THREE display axis: row/col 0=x, 1=y, 2=z(=world t), 3=homogeneous
  m.set(
    g(1, 1), g(1, 2), g(1, 0), 0,
    g(2, 1), g(2, 2), g(2, 0), 0,
    g(0, 1), g(0, 2), g(0, 0), 0,
    0, 0, 0, 1,
  );
  return m;
};
