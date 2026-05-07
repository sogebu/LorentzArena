import { createContext, type ReactNode, useContext, useMemo } from "react";
import * as THREE from "three";
import type { lorentzBoost, Vector4 } from "../../physics";

/**
 * D pattern: 全 mesh を「world frame の geometry + per-mesh display matrix」で表現する。
 * mesh matrix = `displayMatrix` × T(worldEventPos) × [optional worldRotation]
 *
 * - `displayMatrix`: world → display の Lorentz boost + 観測者位置の並進 (`buildDisplayMatrix`
 *   の出力)。観測者変化時に 1 回だけ計算し全 mesh で共有。
 * - `T(worldPos)`: 事象の world 座標への並進。mesh ごとに異なる。`buildMeshMatrix` helper で合成。
 *
 * 世界系表示 (observerBoost = null) では `buildDisplayMatrix` は **時間並進のみ** の行列を返す
 * (空間 xy は world のまま、display z = world t − observer.t)。これにより `timeFadeShader`
 * が読む vertex z が rest frame と同じく Δt となり、fade 挙動が観測フレーム非依存になる。
 * β=0 rest frame でも同等。
 */

/** Compose `displayMatrix × T(worldPos)`. mesh の `matrix` prop に渡す共通の組み立て。 */
export const buildMeshMatrix = (
  worldPos: { x: number; y: number; t: number },
  displayMatrix: THREE.Matrix4,
): THREE.Matrix4 => {
  const m = new THREE.Matrix4().makeTranslation(worldPos.x, worldPos.y, worldPos.t);
  return new THREE.Matrix4().multiplyMatrices(displayMatrix, m);
};

export interface DisplayFrameValue {
  observerU: { x: number; y: number } | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  observerPos: Vector4 | null;
  /** world → display 変換 matrix (boost + 観測者位置並進、世界系では時間並進のみ) */
  displayMatrix: THREE.Matrix4;
  /** torus PBC mode の正方形半幅 (open_cylinder mode では undefined)。 transformEventForDisplay
   *  / buildMeshMatrix でこれを渡すと event の (x, y) を観測者中心 primary cell `[obs±L]²` に
   *  最短画像で折り畳む。 詳細: plans/2026-04-27-pbc-torus.md。 */
  torusHalfWidth?: number;
  /** PLC スライス mode の anchor 平坦化フラグ。 true のとき Pattern P renderer
   *  (= group.position に dp を入れるタイプ、Self/Rocket/Jellyfish/DeadShip/DeathMarker
   *   /Debris marker/HeadingMarker 等) は anchor の z (= display t) を 0 に置換し、
   *  全 mesh の anchor を z=0 平面に揃える。 local geometry (= ship hull の 3D 構造) は
   *  そのまま保持される (Pattern P は anchor 並進と local geometry が分離されているため、
   *  anchor だけを潰せば 3D 形状は 3D のまま z=0 平面上に立つ)。
   *
   *  Pattern M renderer (= mesh.matrix = displayMatrix × T(worldPos) の matrix 流し込み) は
   *  local vertex z = world t と spacetime mix が前提なので flattenT は適用不可。 PLC mode
   *  では Pattern M 系 (LightCone / Arena / Spawn / 接平面三角形 / LaserBatch / WorldLine) を
   *  そもそも描画しないことで両立する。 */
  flattenT?: boolean;
}

const DisplayFrameCtx = createContext<DisplayFrameValue | null>(null);

export const DisplayFrameProvider = ({
  observerU,
  observerBoost,
  observerPos,
  displayMatrix,
  torusHalfWidth,
  flattenT,
  children,
}: DisplayFrameValue & { children: ReactNode }) => {
  const value = useMemo<DisplayFrameValue>(
    () => ({ observerU, observerBoost, observerPos, displayMatrix, torusHalfWidth, flattenT }),
    [observerU, observerBoost, observerPos, displayMatrix, torusHalfWidth, flattenT],
  );
  return <DisplayFrameCtx.Provider value={value}>{children}</DisplayFrameCtx.Provider>;
};

export const useDisplayFrame = (): DisplayFrameValue => {
  const v = useContext(DisplayFrameCtx);
  if (!v) {
    throw new Error(
      "useDisplayFrame must be used within a DisplayFrameProvider",
    );
  }
  return v;
};

/** PLC スライス mode の flattenT flag を「Provider が無くても安全に false で返す」 lookup。
 *  ShipPreview / Lobby など DisplayFrameProvider 外で SelfShipRenderer / RocketShipRenderer
 *  / JellyfishShipRenderer を呼ぶケースで使う (それらは ship 形状 preview のみで PLC mode
 *  に入らないため flattenT は常に false でよい)。 通常 game scene では provider が必ず居るので
 *  context 値の flattenT が読まれる。 */
export const useFlattenT = (): boolean => {
  return useContext(DisplayFrameCtx)?.flattenT ?? false;
};
