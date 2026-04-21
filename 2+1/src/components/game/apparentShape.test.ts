import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createVector3, createVector4, lorentzBoost } from "../../physics";
import { buildApparentShapeMatrix } from "./apparentShape";
import { buildMeshMatrix } from "./DisplayFrameContext";
import { buildDisplayMatrix } from "./displayTransform";

const matrixApproxEqual = (a: THREE.Matrix4, b: THREE.Matrix4, eps = 1e-9): void => {
  for (let i = 0; i < 16; i++) {
    expect(a.elements[i]).toBeCloseTo(b.elements[i], -Math.log10(eps));
  }
};

const apply = (m: THREE.Matrix4, x: number, y: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(x, y, z).applyMatrix4(m);

describe("buildApparentShapeMatrix", () => {
  describe("静止 ship (u_P = 0, heading = 0)", () => {
    it("observer 静止時は buildMeshMatrix と完全一致 (LH の現状挙動)", () => {
      const observerPos = createVector4(5, 1, -2, 0);
      const observerBoost = lorentzBoost(createVector3(0, 0, 0));
      const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
      const anchorPos = createVector4(-3, 2, 1, 0);

      const v3 = buildApparentShapeMatrix(
        anchorPos,
        createVector3(0, 0, 0),
        0,
        displayMatrix,
      );
      const d = buildMeshMatrix(anchorPos, displayMatrix);
      matrixApproxEqual(v3, d);
    });

    it("observer 運動時も buildMeshMatrix と完全一致", () => {
      const observerPos = createVector4(0, 0, 0, 0);
      // u = γv で v = 0.6、γ = 1.25 → u_x = 0.75
      const observerBoost = lorentzBoost(createVector3(0.75, 0, 0));
      const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
      const anchorPos = createVector4(-4, 2, 0, 0);

      const v3 = buildApparentShapeMatrix(
        anchorPos,
        createVector3(0, 0, 0),
        0,
        displayMatrix,
      );
      const d = buildMeshMatrix(anchorPos, displayMatrix);
      matrixApproxEqual(v3, d);
    });

    it("世界系 display (observerBoost = null) でも一致", () => {
      const observerPos = createVector4(3, 0, 0, 0);
      const displayMatrix = buildDisplayMatrix(observerPos, null);
      const anchorPos = createVector4(-1, 5, 2, 0);

      const v3 = buildApparentShapeMatrix(
        anchorPos,
        createVector3(0, 0, 0),
        0,
        displayMatrix,
      );
      const d = buildMeshMatrix(anchorPos, displayMatrix);
      matrixApproxEqual(v3, d);
    });
  });

  describe("heading (yaw in P 静止系)", () => {
    it("heading = π/2 で model +x → display +y (静止 ship, observer 静止)", () => {
      const observerPos = createVector4(0, 0, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      // anchor を原点にして translation を除去、boost も identity で見れば M = R_q のみ
      const m = buildApparentShapeMatrix(
        createVector4(0, 0, 0, 0),
        createVector3(0, 0, 0),
        Math.PI / 2,
        displayMatrix,
      );
      const out = apply(m, 1, 0, 0);
      expect(out.x).toBeCloseTo(0, 6);
      expect(out.y).toBeCloseTo(1, 6);
      expect(out.z).toBeCloseTo(0, 6);
    });
  });

  describe("運動する ship (u_P ≠ 0): L(-u_P) の効果", () => {
    it("model z 軸 (0,0,1) = P の proper time 方向 → display で u_P (4-velocity)", () => {
      // ship が +x 方向に 3-velocity v=0.5 で運動: γ = 2/√3 ≈ 1.1547
      // u_P^spatial = γ·v = (0.5774, 0, 0)、u_P^t = γ = 1.1547
      const v = 0.5;
      const gammaV = 1 / Math.sqrt(1 - v * v);
      const uSpatialX = gammaV * v;

      const observerPos = createVector4(0, 0, 0, 0);
      const observerBoost = lorentzBoost(createVector3(0, 0, 0));
      const displayMatrix = buildDisplayMatrix(observerPos, observerBoost);
      // anchor 原点 + 観測者 rest で M を純粋に見る
      const m = buildApparentShapeMatrix(
        createVector4(0, 0, 0, 0),
        createVector3(uSpatialX, 0, 0),
        0,
        displayMatrix,
      );

      // (0, 0, 1) model → u_P の display 成分 (x, y, t) = (γv, 0, γ)
      const out = apply(m, 0, 0, 1);
      expect(out.x).toBeCloseTo(uSpatialX, 5);
      expect(out.y).toBeCloseTo(0, 5);
      expect(out.z).toBeCloseTo(gammaV, 5);
    });

    it("model x 軸 (1,0,0) = P 静止系 spatial x → display で (γ, 0, γv) (同方向に boost)", () => {
      const v = 0.5;
      const gammaV = 1 / Math.sqrt(1 - v * v);
      const uSpatialX = gammaV * v;

      const observerPos = createVector4(0, 0, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(
        createVector4(0, 0, 0, 0),
        createVector3(uSpatialX, 0, 0),
        0,
        displayMatrix,
      );

      // P 静止系の spatial x 方向 (1,0,0) を P→world に boost すると (γ, 0, γv)
      const out = apply(m, 1, 0, 0);
      expect(out.x).toBeCloseTo(gammaV, 5);
      expect(out.y).toBeCloseTo(0, 5);
      expect(out.z).toBeCloseTo(uSpatialX, 5); // = γv
    });

    it("model y 軸 (0,1,0) = 運動に垂直方向は boost 不変", () => {
      const v = 0.5;
      const gammaV = 1 / Math.sqrt(1 - v * v);
      const uSpatialX = gammaV * v;

      const observerPos = createVector4(0, 0, 0, 0);
      const displayMatrix = buildDisplayMatrix(
        observerPos,
        lorentzBoost(createVector3(0, 0, 0)),
      );
      const m = buildApparentShapeMatrix(
        createVector4(0, 0, 0, 0),
        createVector3(uSpatialX, 0, 0),
        0,
        displayMatrix,
      );

      const out = apply(m, 0, 1, 0);
      expect(out.x).toBeCloseTo(0, 5);
      expect(out.y).toBeCloseTo(1, 5);
      expect(out.z).toBeCloseTo(0, 5);
    });
  });
});
