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
}

const DisplayFrameCtx = createContext<DisplayFrameValue | null>(null);

export const DisplayFrameProvider = ({
  observerU,
  observerBoost,
  observerPos,
  displayMatrix,
  torusHalfWidth,
  children,
}: DisplayFrameValue & { children: ReactNode }) => {
  const value = useMemo<DisplayFrameValue>(
    () => ({ observerU, observerBoost, observerPos, displayMatrix, torusHalfWidth }),
    [observerU, observerBoost, observerPos, displayMatrix, torusHalfWidth],
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
