import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createVector3, createVector4, lorentzBoost } from "../../physics";
import { buildApparentShapeMatrix } from "./apparentShape";
import { buildMeshMatrix } from "./DisplayFrameContext";
import { buildDisplayMatrix } from "./displayTransform";

const apply = (m: THREE.Matrix4, x: number, y: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(x, y, z).applyMatrix4(m);

const matrixApproxEqual = (a: THREE.Matrix4, b: THREE.Matrix4, eps = 1e-9): void => {
  for (let i = 0; i < 16; i++) {
    expect(a.elements[i]).toBeCloseTo(b.elements[i], -Math.log10(eps));
  }
};

describe("buildApparentShapeMatrix (v1 接平面)", () => {
  describe("fallback: degenerate ケース", () => {
    it("observerPos = null → buildMeshMatrix と一致", () => {
      const displayMatrix = buildDisplayMatrix(null, null);
      const anchor = createVector4(-3, 2, 1, 0);
      const v1 = buildApparentShapeMatrix(anchor, null, displayMatrix);
      const d = buildMeshMatrix(anchor, displayMatrix);
      matrixApproxEqual(v1, d);
    });

    it("観測者が anchor の真上 (ρ → 0) → buildMeshMatrix と一致 (tilt なし)", () => {
      const observerPos = createVector4(0, 2, 1, 0); // 同 xy、時間だけズラす
      const anchor = createVector4(-5, 2, 1, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const v1 = buildApparentShapeMatrix(anchor, observerPos, displayMatrix);
      const d = buildMeshMatrix(anchor, displayMatrix);
      matrixApproxEqual(v1, d);
    });
  });

  describe("past-cone 接平面 tilt (静止 LH、観測者静止)", () => {
    // observer 原点、anchor 空間 (-5, 0)、光円錐 t = -5 → anchorPos = (-5, 0, 0, -5)
    // x_∥ = (観測者 − anchor).spatial の unit = (5, 0)/5 = (1, 0)
    // v1 期待: t_out = x · 1 + y · 0 + z = x + z
    const observerPos = createVector4(0, 0, 0, 0);
    const displayMatrix = buildDisplayMatrix(
      observerPos,
      lorentzBoost(createVector3(0, 0, 0)),
    );
    const anchor = createVector4(-5, -5, 0, 0);
    const m = buildApparentShapeMatrix(anchor, observerPos, displayMatrix);

    it("前面 (model x=+0.3): 時刻 +0.3 (観測者に近い = 後で発光)", () => {
      const out = apply(m, 0.3, 0, 0);
      expect(out.x).toBeCloseTo(-5 + 0.3, 9); // world xy = anchor.xy + model xy
      expect(out.y).toBeCloseTo(0, 9);
      expect(out.z).toBeCloseTo(-5 + 0.3, 9); // world t = anchor.t + 0.3 (x_∥.x=1)
    });

    it("背面 (model x=-0.3): 時刻 -0.3 (観測者に遠い = 前に発光)", () => {
      const out = apply(m, -0.3, 0, 0);
      expect(out.x).toBeCloseTo(-5 - 0.3, 9);
      expect(out.y).toBeCloseTo(0, 9);
      expect(out.z).toBeCloseTo(-5 - 0.3, 9);
    });

    it("横 (model y=+0.3): 時刻シフトなし (x_∥.y = 0)", () => {
      const out = apply(m, 0, 0.3, 0);
      expect(out.x).toBeCloseTo(-5, 9);
      expect(out.y).toBeCloseTo(0.3, 9);
      expect(out.z).toBeCloseTo(-5, 9); // tilt 無、接平面上
    });

    it("塔の上 (model z=+1): 時刻 +1 (z は線形に世界 t に載る)", () => {
      const out = apply(m, 0, 0, 1);
      expect(out.x).toBeCloseTo(-5, 9);
      expect(out.y).toBeCloseTo(0, 9);
      expect(out.z).toBeCloseTo(-5 + 1, 9);
    });

    it("合成 (x=0.3, z=1): 前面が塔上で時刻 -5 + 0.3 + 1 = -3.7", () => {
      const out = apply(m, 0.3, 0, 1);
      expect(out.z).toBeCloseTo(-3.7, 9);
    });
  });

  describe("past-cone 方向が斜めのケース", () => {
    it("x_∥ = (1, 1)/√2 で model (x=1, y=1, z=0) は t = (1+1)/√2 = √2", () => {
      const observerPos = createVector4(0, 0, 0, 0);
      const rho = Math.SQRT2 * 5;
      const anchor = createVector4(-rho, -5, -5, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(anchor, observerPos, displayMatrix);
      const out = apply(m, 1, 1, 0);
      expect(out.x).toBeCloseTo(-5 + 1, 9);
      expect(out.y).toBeCloseTo(-5 + 1, 9);
      expect(out.z).toBeCloseTo(-rho + Math.SQRT2, 9);
    });
  });

  describe("v4 厳密との差 (接平面近似の誤差上限)", () => {
    it("r=0.3, ρ=5 で誤差 ~0.009 (視覚無視可能範囲) を数値確認", () => {
      const observerPos = createVector4(0, 0, 0, 0);
      const rho = 5;
      const anchor = createVector4(-rho, -rho, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(anchor, observerPos, displayMatrix);
      // v1 の塔前面 (model x=+0.3): world t = -rho + 0.3
      const v1Out = apply(m, 0.3, 0, 0);
      const v1T = v1Out.z;
      // v4 厳密: world t = xO.t - |world_xy - xO.spatial| = 0 - |(-5+0.3, 0)| = -4.7
      // で同じ、なぜならこの vertex は純 x_∥ 方向 → 2 次誤差なし
      const v4T = -Math.hypot(-rho + 0.3, 0);
      expect(Math.abs(v1T - v4T)).toBeLessThan(1e-12); // 純 ∥ 方向は厳密一致

      // model (y=0.3) 横方向は誤差 O(r²/ρ) が出る
      const v1OutY = apply(m, 0, 0.3, 0);
      const v4TY = -Math.hypot(-rho, 0.3); // = -sqrt(25 + 0.09) ≈ -5.00899
      expect(v1OutY.z).toBeCloseTo(-rho, 9); // v1: tilt 無 (y 方向)
      const err = Math.abs(v1OutY.z - v4TY);
      expect(err).toBeGreaterThan(0.008);
      expect(err).toBeLessThan(0.01); // r²/(2ρ) = 0.09/10 = 0.009
    });
  });
});
