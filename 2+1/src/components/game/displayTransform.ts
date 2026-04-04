import * as THREE from "three";
import {
  type lorentzBoost,
  multiplyVector4Matrix4,
  subVector4,
  type Vector4,
} from "../../physics";

/**
 * Convert a world-frame event into display coordinates.
 *
 * English:
 *   - When `observerBoost` is present, we display in the observer's instantaneous rest frame.
 *   - Otherwise, we keep world-frame coordinates.
 *
 * 日本語:
 *   - `observerBoost` がある場合は観測者の瞬間静止系で表示します。
 *   - ない場合は世界系のまま表示します。
 */
export const transformEventForDisplay = (
  worldEvent: Vector4,
  observerPos: Vector4 | null,
  observerBoost: ReturnType<typeof lorentzBoost> | null,
): Vector4 => {
  if (!observerPos || !observerBoost) return worldEvent;
  return multiplyVector4Matrix4(
    observerBoost,
    subVector4(worldEvent, observerPos),
  );
};

/**
 * Build a THREE.js Matrix4 that maps world-frame vertices (x, y, z=t)
 * to display-frame vertices via Lorentz boost + translation.
 *
 * Since the Lorentz transform is linear, it can be applied as a mesh
 * matrix instead of regenerating geometry every frame.
 *
 * THREE.js vertex: (x, y, z) = spacetime (x, y, t)
 * Lorentz matrix Λ operates on (t, x, y, z) → column reorder needed.
 *
 * display_x = Λ[1,1]*x + Λ[1,2]*y + Λ[1,0]*t + tx
 * display_y = Λ[2,1]*x + Λ[2,2]*y + Λ[2,0]*t + ty
 * display_z = Λ[0,1]*x + Λ[0,2]*y + Λ[0,0]*t + tz
 */
export const buildDisplayMatrix = (
  observerPos: Vector4 | null,
  observerBoost: ReturnType<typeof lorentzBoost> | null,
): THREE.Matrix4 => {
  const m = new THREE.Matrix4();
  if (!observerPos || !observerBoost) {
    return m; // identity
  }

  const L = observerBoost;
  const get = (r: number, c: number) => L.data[r * 4 + c];

  // Translation: -M * observerPos (in THREE.js coords)
  const ox = observerPos.x;
  const oy = observerPos.y;
  const ot = observerPos.t;
  const tx = -(get(1, 1) * ox + get(1, 2) * oy + get(1, 0) * ot);
  const ty = -(get(2, 1) * ox + get(2, 2) * oy + get(2, 0) * ot);
  const tz = -(get(0, 1) * ox + get(0, 2) * oy + get(0, 0) * ot);

  // THREE.js Matrix4 is column-major: set(row, col, value) → elements[col*4+row]
  m.set(
    get(1, 1),
    get(1, 2),
    get(1, 0),
    tx, // row 0: display x
    get(2, 1),
    get(2, 2),
    get(2, 0),
    ty, // row 1: display y
    get(0, 1),
    get(0, 2),
    get(0, 0),
    tz, // row 2: display z (=t')
    0,
    0,
    0,
    1, // row 3: homogeneous
  );
  return m;
};
