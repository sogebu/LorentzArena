import { createContext, type ReactNode, useContext, useMemo } from "react";
import * as THREE from "three";
import type { lorentzBoost } from "../../physics";

/**
 * 観測者の瞬間静止系 display における「世界系同時面」の Euclidean 法線を、
 * 観測者の 4-velocity u = (u_x, u_y) (spatial, γ は導出) から一本の式で返す。
 *
 * 物理的導出:
 *   - 観測者 rest frame で、世界系観測者の 4-velocity は (t: γ, x: -u_x, y: -u_y)
 *   - 世界系同時面 = これに Minkowski-perp な 2D 超平面
 *   - 超平面の Euclidean 法線 = (u_x, u_y, γ)  (signature (+,+,+,-) の変換で時間成分が反転)
 *
 * 言い換えれば **観測者自身の 4-velocity を (x, y, t) 順に並べて正規化したもの** が
 * そのまま ring の軸方向。observerBoost が null (= 世界系表示) なら identity。
 */
export const computeRingQuat = (
  observerU: { x: number; y: number } | null,
  observerBoost: ReturnType<typeof lorentzBoost> | null,
): THREE.Quaternion => {
  const u = observerBoost ? observerU : null;
  if (!u) return new THREE.Quaternion();
  const gamma = Math.sqrt(1 + u.x * u.x + u.y * u.y);
  const n = new THREE.Vector3(u.x, u.y, gamma).normalize();
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
};

export interface DisplayFrameValue {
  /** 観測者の 4-velocity 空間成分。静止系表示中のみ意味あり (世界系表示では null) */
  observerU: { x: number; y: number } | null;
  /** 観測者の Lorentz boost (display frame の性質を決める)。null = 世界系表示 */
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  /** 世界系同時面に ring を寝かせる quaternion。local +z (= display t) を法線に回す */
  ringQuat: THREE.Quaternion;
}

const DisplayFrameCtx = createContext<DisplayFrameValue | null>(null);

export const DisplayFrameProvider = ({
  observerU,
  observerBoost,
  ringQuat,
  children,
}: DisplayFrameValue & { children: ReactNode }) => {
  const value = useMemo<DisplayFrameValue>(
    () => ({ observerU, observerBoost, ringQuat }),
    [observerU, observerBoost, ringQuat],
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
