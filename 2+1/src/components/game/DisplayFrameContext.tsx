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
 * 世界系表示 (observerBoost = null) では `buildDisplayMatrix` が identity を返すので自動的に
 * world = display。β=0 でも同じ。
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
  /** world → display 変換 matrix (boost + 観測者位置並進)。identity if 世界系表示 */
  displayMatrix: THREE.Matrix4;
}

const DisplayFrameCtx = createContext<DisplayFrameValue | null>(null);

export const DisplayFrameProvider = ({
  observerU,
  observerBoost,
  observerPos,
  displayMatrix,
  children,
}: DisplayFrameValue & { children: ReactNode }) => {
  const value = useMemo<DisplayFrameValue>(
    () => ({ observerU, observerBoost, observerPos, displayMatrix }),
    [observerU, observerBoost, observerPos, displayMatrix],
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
