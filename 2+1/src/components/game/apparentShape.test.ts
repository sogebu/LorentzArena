import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createVector3, createVector4, gamma, lorentzBoost } from "../../physics";
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

const ZERO_U = createVector3(0, 0, 0);

describe("buildApparentShapeMatrix (底面 display xy 楕円 + 塔軸 L(−uA)·(0,0,1))", () => {
  describe("fallback: degenerate ケース", () => {
    it("observerPos = null → buildMeshMatrix", () => {
      const displayMatrix = buildDisplayMatrix(null, null);
      const anchor = createVector4(0, -3, 2, 1);
      const v = buildApparentShapeMatrix(anchor, ZERO_U, null, displayMatrix);
      const d = buildMeshMatrix(anchor, displayMatrix);
      matrixApproxEqual(v, d);
    });

    it("display spatial で ρ_O → 0 → buildMeshMatrix", () => {
      const observerPos = createVector4(0, 0, 0, 0);
      const anchor = createVector4(0, 0, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const v = buildApparentShapeMatrix(anchor, ZERO_U, observerPos, displayMatrix);
      const d = buildMeshMatrix(anchor, displayMatrix);
      matrixApproxEqual(v, d);
    });
  });

  describe("静止 A (uA=0) + 静止 O: 底面楕円 + 塔世界 t 軸", () => {
    // observer (0,0,0,0)、anchor (t=-5, x=-5, y=0)、displayMatrix = identity
    // x_∥^O = (観測者 − anchor) / ρ = (5, 0) / 5 = (1, 0)
    const observerPos = createVector4(0, 0, 0, 0);
    const displayMatrix = buildDisplayMatrix(
      observerPos,
      lorentzBoost(createVector3(0, 0, 0)),
    );
    const anchor = createVector4(-5, -5, 0, 0);
    const m = buildApparentShapeMatrix(anchor, ZERO_U, observerPos, displayMatrix);

    it("前面 (model x=+0.3): √2·0.3 stretch、display t 一定", () => {
      const out = apply(m, 0.3, 0, 0);
      expect(out.x).toBeCloseTo(-5 + Math.SQRT2 * 0.3, 9);
      expect(out.y).toBeCloseTo(0, 9);
      expect(out.z).toBeCloseTo(-5, 9);
    });

    it("背面 (model x=-0.3): −√2·0.3 stretch", () => {
      const out = apply(m, -0.3, 0, 0);
      expect(out.x).toBeCloseTo(-5 - Math.SQRT2 * 0.3, 9);
      expect(out.z).toBeCloseTo(-5, 9);
    });

    it("x_⊥ (model y=+0.3): stretch なし", () => {
      const out = apply(m, 0, 0.3, 0);
      expect(out.x).toBeCloseTo(-5, 9);
      expect(out.y).toBeCloseTo(0.3, 9);
      expect(out.z).toBeCloseTo(-5, 9);
    });

    it("塔軸 (model z=1): world t 軸に +1 (uA=0 で L(−uA)=I)", () => {
      const out = apply(m, 0, 0, 1);
      expect(out.x).toBeCloseTo(-5, 9);
      expect(out.y).toBeCloseTo(0, 9);
      expect(out.z).toBeCloseTo(-4, 9);
    });

    it("合成 (x=0.3, z=1): 底面 stretch + 塔 1 段", () => {
      const out = apply(m, 0.3, 0, 1);
      expect(out.x).toBeCloseTo(-5 + Math.SQRT2 * 0.3, 9);
      expect(out.z).toBeCloseTo(-4, 9);
    });
  });

  describe("静止 A + 静止 O、斜め x_∥^O = (1, 1)/√2", () => {
    it("model (1, 1, 0): display spatial で x_∥ 方向に √2·√2 stretch", () => {
      const observerPos = createVector4(0, 0, 0, 0);
      const rho = Math.SQRT2 * 5;
      const anchor = createVector4(-rho, -5, -5, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(anchor, ZERO_U, observerPos, displayMatrix);
      const out = apply(m, 1, 1, 0);
      // (1,1) の x_∥ 成分 = √2、S·(1,1) の x_∥ 成分 = √2·√2 = 2、x_⊥ 成分 = 0
      //   → display spatial ずれ = 2·x_∥ = (√2, √2)、display t 不変
      expect(out.x).toBeCloseTo(-5 + Math.SQRT2, 9);
      expect(out.y).toBeCloseTo(-5 + Math.SQRT2, 9);
      expect(out.z).toBeCloseTo(-rho, 9);
    });
  });

  describe("移動 A (ship case、uA ≠ 0) + 静止 O", () => {
    it("塔軸 (model z=1): world 4-vel 方向 = (uA.x, uA.y, γ)", () => {
      const uA = createVector3(0.6, 0, 0);
      const gA = gamma(uA); // = √(1+0.36) = √1.36 ≈ 1.166
      const observerPos = createVector4(0, 0, 0, 0);
      const anchor = createVector4(-5, -5, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(anchor, uA, observerPos, displayMatrix);
      const out = apply(m, 0, 0, 1);
      expect(out.x).toBeCloseTo(-5 + uA.x, 9);
      expect(out.y).toBeCloseTo(0 + uA.y, 9);
      expect(out.z).toBeCloseTo(-5 + gA, 9);
    });

    it("底面 (model x=0.3): 静止 O で display = world、uA に無関係に √2 stretch flat", () => {
      const uA = createVector3(0.6, 0, 0);
      const observerPos = createVector4(0, 0, 0, 0);
      const anchor = createVector4(-5, -5, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(anchor, uA, observerPos, displayMatrix);
      const out = apply(m, 0.3, 0, 0);
      expect(out.x).toBeCloseTo(-5 + Math.SQRT2 * 0.3, 9);
      expect(out.y).toBeCloseTo(0, 9);
      expect(out.z).toBeCloseTo(-5, 9);
    });
  });

  describe("移動 O (静止系表示): 底面が display 水平に", () => {
    it("静止 A + 移動 O、底面の display t は anchor と同じ (水平)", () => {
      const uO = createVector3(0.5, 0, 0);
      const observerPos = createVector4(5, 0, 0, 0);
      // world past-cone: |observer.spatial - anchor.spatial| = observer.t - anchor.t
      //   (5 - 0 - 0)² = 5² → anchor.t = 0, anchor.spatial = (-5, 0)
      const anchor = createVector4(0, -5, 0, 0);
      const displayMatrix = buildDisplayMatrix(observerPos, lorentzBoost(uO));
      const m = buildApparentShapeMatrix(anchor, ZERO_U, observerPos, displayMatrix);

      // display での anchor 位置を取得し、base 頂点の display t が一致することを確認
      const anchorDisp = new THREE.Vector3(anchor.x, anchor.y, anchor.t).applyMatrix4(
        displayMatrix,
      );
      const baseOut = apply(m, 0.3, 0, 0);
      expect(baseOut.z).toBeCloseTo(anchorDisp.z, 9); // base flat in display t
    });

    it("静止 A + 移動 O、塔軸は world (0,0,1)、display で L(uO) により傾く", () => {
      const uO = createVector3(0.5, 0, 0);
      const observerPos = createVector4(5, 0, 0, 0);
      const anchor = createVector4(0, -5, 0, 0);
      const displayMatrix = buildDisplayMatrix(observerPos, lorentzBoost(uO));
      const m = buildApparentShapeMatrix(anchor, ZERO_U, observerPos, displayMatrix);

      const top = apply(m, 0, 0, 1);
      const bottom = apply(m, 0, 0, 0);
      // direction = top - bottom = displayMatrix · (0, 0, 1, 0)_world
      // L(uO=(0.5,0)) の spatial rows: display x <- physics row 1 col (1,0) = -uO.x
      //   display x = -0.5, display y = 0, display t = γ(uO) = √(1+0.25) = √1.25
      const gO = gamma(uO);
      expect(top.x - bottom.x).toBeCloseTo(-uO.x, 9);
      expect(top.y - bottom.y).toBeCloseTo(-uO.y, 9);
      expect(top.z - bottom.z).toBeCloseTo(gO, 9);
    });
  });
});
