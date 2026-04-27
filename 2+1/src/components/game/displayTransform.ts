import * as THREE from "three";
import {
  type lorentzBoost,
  minImageDelta1D,
  multiplyVector4Matrix4,
  subVector4,
  type Vector4,
} from "../../physics";

/**
 * Convert a world-frame event into display coordinates.
 *
 *   - Rest frame (`observerBoost` 有り): `L · (event − observer)` で観測者を display 原点に。
 *   - World frame (`observerBoost = null`): 時間成分のみ `event.t − observer.t` に並進。
 *     空間 (x, y) は world 座標のまま保持 → カメラが観測者を追随。時間並進によって
 *     `timeFadeShader` が読む display z が `Δt` となり、rest frame と fade 挙動が一致する。
 *   - 観測者が未設定 (`observerPos = null`): 素通し。
 *
 * **torus PBC mode** (`torusHalfWidth` 指定時): event の (x, y) を観測者中心 primary cell
 * `[obs.x±L, obs.y±L]²` に最短画像で折り畳む (= Asteroids 風 visual wrapping)。 これを世界系
 * では結果 event の (x, y) を「shifted observer.xy + minImage(event.xy − observer.xy)」 に、
 * rest frame では observer subtract の前に同じ shift を適用して boost に渡す。 これで観測者が
 * 境界を超えても他オブジェクトが画面内に映り続ける。 詳細: plans/2026-04-27-pbc-torus.md
 */
export const transformEventForDisplay = (
  worldEvent: Vector4,
  observerPos: Vector4 | null,
  observerBoost: ReturnType<typeof lorentzBoost> | null,
  torusHalfWidth?: number,
): Vector4 => {
  if (!observerPos) return worldEvent;
  // torus mode で event を観測者中心 primary cell に折り畳んだ「shifted event」を生成
  const wrappedEvent: Vector4 =
    torusHalfWidth !== undefined
      ? {
          t: worldEvent.t,
          x: observerPos.x + minImageDelta1D(worldEvent.x - observerPos.x, torusHalfWidth),
          y: observerPos.y + minImageDelta1D(worldEvent.y - observerPos.y, torusHalfWidth),
          z: worldEvent.z,
        }
      : worldEvent;
  if (!observerBoost) {
    return {
      t: wrappedEvent.t - observerPos.t,
      x: wrappedEvent.x,
      y: wrappedEvent.y,
      z: wrappedEvent.z,
    };
  }
  return multiplyVector4Matrix4(
    observerBoost,
    subVector4(wrappedEvent, observerPos),
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
  if (!observerPos) {
    return m; // identity (観測者未設定)
  }
  if (!observerBoost) {
    // 世界系: 時間のみ並進。display z = world t − observer.t、xy は world のまま (カメラ側で追随)。
    // `timeFadeShader` の vertex z = Δt として機能 → rest frame と fade 挙動統一。
    m.makeTranslation(0, 0, -observerPos.t);
    return m;
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
