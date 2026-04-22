import { describe, expect, it } from "vitest";
import { lorentzBoost, multiplyVector4Matrix4 } from "./matrix";
import { createPhaseSpace, evolvePhaseSpace } from "./mechanics";
import {
  createVector3,
  createVector4,
  quatIdentity,
  yawToQuat,
} from "./vector";

describe("PhaseSpace (heading / alpha 拡張)", () => {
  describe("createPhaseSpace default 引数", () => {
    it("heading / alpha 省略で identity / zero にフォールバック", () => {
      const ps = createPhaseSpace(
        createVector4(0, 0, 0, 0),
        createVector3(0, 0, 0),
      );
      expect(ps.heading).toEqual(quatIdentity());
      expect(ps.alpha).toEqual({ t: 0, x: 0, y: 0, z: 0 });
    });

    it("明示的に渡した heading / alpha を保持", () => {
      const heading = yawToQuat(0.5);
      const alpha = createVector4(0.1, 0.2, 0.3, 0);
      const ps = createPhaseSpace(
        createVector4(0, 0, 0, 0),
        createVector3(0, 0, 0),
        heading,
        alpha,
      );
      expect(ps.heading).toEqual(heading);
      expect(ps.alpha).toEqual(alpha);
    });
  });

  describe("evolvePhaseSpace の heading / alpha 挙動", () => {
    it("heading は dτ 中 identity transport (現仕様: 角速度統合なし)", () => {
      const heading = yawToQuat(1.2);
      const ps = createPhaseSpace(
        createVector4(0, 0, 0, 0),
        createVector3(0.3, 0, 0),
        heading,
      );
      const next = evolvePhaseSpace(ps, createVector3(0, 0, 0), 0.1);
      expect(next.heading).toEqual(heading);
    });

    it("thrust 0 + u=0 → alpha = zero", () => {
      const ps = createPhaseSpace(
        createVector4(0, 0, 0, 0),
        createVector3(0, 0, 0),
      );
      const next = evolvePhaseSpace(ps, createVector3(0, 0, 0), 0.1);
      expect(next.alpha.t).toBeCloseTo(0, 12);
      expect(next.alpha.x).toBeCloseTo(0, 12);
      expect(next.alpha.y).toBeCloseTo(0, 12);
      expect(next.alpha.z).toBeCloseTo(0, 12);
    });

    it("静止 (u=0) + rest 系 thrust → alpha = (0, ax, ay, 0)", () => {
      const ps = createPhaseSpace(
        createVector4(0, 0, 0, 0),
        createVector3(0, 0, 0),
      );
      const next = evolvePhaseSpace(ps, createVector3(0.5, 0.2, 0), 0.01);
      expect(next.alpha.t).toBeCloseTo(0, 9);
      expect(next.alpha.x).toBeCloseTo(0.5, 9);
      expect(next.alpha.y).toBeCloseTo(0.2, 9);
      expect(next.alpha.z).toBeCloseTo(0, 9);
    });

    it("移動中 (u ≠ 0) で u·α = 0 の Minkowski 制約を満たす", () => {
      const u = createVector3(0.6, 0, 0); // 4-velocity (γ ≈ 1.166)
      const ps = createPhaseSpace(createVector4(0, 0, 0, 0), u);
      const next = evolvePhaseSpace(ps, createVector3(1, 0.5, 0), 0.01);
      // Minkowski (+,+,+,−): u·α = u.x·α.x + u.y·α.y + u.z·α.z − γ·α.t
      const gamma = Math.sqrt(1 + u.x * u.x + u.y * u.y + u.z * u.z);
      const inner =
        u.x * next.alpha.x +
        u.y * next.alpha.y +
        u.z * next.alpha.z -
        gamma * next.alpha.t;
      expect(inner).toBeCloseTo(0, 9);
    });

    it("lorentzBoost(u) · α_world で proper acceleration を復元 (OtherShipRenderer が exhaust 駆動に使う逆変換)", () => {
      // evolvePhaseSpace は rest-frame proper accel を inverseLorentzBoost(u) で world frame に
      // 持ち上げて alpha に格納。観測者側 (OtherShipRenderer) では逆変換 lorentzBoost(u) で
      // rest frame に戻して proper accel 空間成分を取り出す。round-trip が恒等になることを確認。
      const u = createVector3(0.6, 0.3, 0);
      const properAcc = createVector3(0.5, -0.2, 0);
      const ps = createPhaseSpace(createVector4(0, 0, 0, 0), u);
      const next = evolvePhaseSpace(ps, properAcc, 0.0); // dτ=0 で u, alpha 計算のみ取り出し
      const alphaRest = multiplyVector4Matrix4(lorentzBoost(u), next.alpha);
      expect(alphaRest.t).toBeCloseTo(0, 9);
      expect(alphaRest.x).toBeCloseTo(properAcc.x, 9);
      expect(alphaRest.y).toBeCloseTo(properAcc.y, 9);
      expect(alphaRest.z).toBeCloseTo(properAcc.z, 9);
    });
  });
});
