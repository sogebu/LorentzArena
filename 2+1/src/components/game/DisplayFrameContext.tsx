import { createContext, type ReactNode, useContext, useMemo } from "react";
import * as THREE from "three";
import type { lorentzBoost } from "../../physics";

/**
 * 観測者の瞬間静止系 display における Lorentz boost のみ (並進なし) を
 * three.js Matrix4 で返す。three.js の (x, y, z) ↔ Minkowski の (x, y, t) マッピング付き。
 *
 * この matrix を ring mesh の `matrix` として設定し `matrixAutoUpdate = false` にすると、
 * mesh の local 頂点 v に対して group 位置 (display) へ置かれたうえで **頂点単位 Lorentz**
 * が掛かる (parent · Boost · v)。クォータニオン方式と違い:
 *   - β=0 / 世界系表示: identity、同じ見た目
 *   - 運動中 rest frame: 運動方向に γ 倍伸びた楕円として tilted plane 上に乗る
 *
 * これは「世界系で固定の円」を観測者 rest frame で素直に描画した結果。3+1 への自然な拡張
 * (boost matrix を増やすだけ、geometry/code 無改造) が利く。`buildDisplayMatrix` と同じ基底
 * 変換を使うが、観測者位置の減算 (translation) は含めない: 並進は group position が担う。
 */
export const computeRingMatrix = (
  observerBoost: ReturnType<typeof lorentzBoost> | null,
): THREE.Matrix4 => {
  const m = new THREE.Matrix4();
  if (!observerBoost) return m; // identity
  const L = observerBoost;
  const get = (r: number, c: number) => L.data[r * 4 + c];
  // Minkowski (t=row/col 0, x=1, y=2) → three.js (x=row 0, y=row 1, z=t=row 2)
  m.set(
    get(1, 1), get(1, 2), get(1, 0), 0,
    get(2, 1), get(2, 2), get(2, 0), 0,
    get(0, 1), get(0, 2), get(0, 0), 0,
    0, 0, 0, 1,
  );
  return m;
};

export interface DisplayFrameValue {
  /** 観測者の 4-velocity 空間成分。静止系表示中のみ意味あり (世界系表示では null) */
  observerU: { x: number; y: number } | null;
  /** 観測者の Lorentz boost (display frame の性質を決める)。null = 世界系表示 */
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  /** Ring mesh の頂点単位 Lorentz 用 Matrix4 (boost のみ、並進なし、three.js 座標) */
  ringMatrix: THREE.Matrix4;
}

const DisplayFrameCtx = createContext<DisplayFrameValue | null>(null);

export const DisplayFrameProvider = ({
  observerU,
  observerBoost,
  ringMatrix,
  children,
}: DisplayFrameValue & { children: ReactNode }) => {
  const value = useMemo<DisplayFrameValue>(
    () => ({ observerU, observerBoost, ringMatrix }),
    [observerU, observerBoost, ringMatrix],
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
