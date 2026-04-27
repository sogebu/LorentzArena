import { describe, expect, it } from "vitest";
import {
  conjugateQuat,
  createVector4,
  isInPastLightCone,
  multiplyQuat,
  normalizeQuat,
  quatIdentity,
  quatToYaw,
  slerpQuat,
  yawToQuat,
} from "./vector";

const quatApproxEqual = (
  a: { w: number; x: number; y: number; z: number },
  b: { w: number; x: number; y: number; z: number },
  eps = 1e-9,
) => {
  expect(a.w).toBeCloseTo(b.w, -Math.log10(eps));
  expect(a.x).toBeCloseTo(b.x, -Math.log10(eps));
  expect(a.y).toBeCloseTo(b.y, -Math.log10(eps));
  expect(a.z).toBeCloseTo(b.z, -Math.log10(eps));
};

describe("Quaternion helpers", () => {
  describe("quatIdentity / yawToQuat", () => {
    it("identity は (1, 0, 0, 0)", () => {
      expect(quatIdentity()).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    });

    it("yawToQuat(0) = identity", () => {
      quatApproxEqual(yawToQuat(0), quatIdentity());
    });

    it("yawToQuat(π/2) は (√2/2, 0, 0, √2/2)", () => {
      const q = yawToQuat(Math.PI / 2);
      const s = Math.SQRT1_2;
      quatApproxEqual(q, { w: s, x: 0, y: 0, z: s });
    });

    it("yawToQuat(π) は (0, 0, 0, ±1) (sign は符号慣例、magnitude 1)", () => {
      const q = yawToQuat(Math.PI);
      expect(q.w).toBeCloseTo(0, 9);
      expect(q.x).toBeCloseTo(0, 9);
      expect(q.y).toBeCloseTo(0, 9);
      expect(Math.abs(q.z)).toBeCloseTo(1, 9);
    });
  });

  describe("quatToYaw round-trip", () => {
    it.each([-Math.PI + 0.01, -1, -0.1, 0, 0.1, 1, Math.PI - 0.01])(
      "yaw=%f round-trip",
      (yaw) => {
        const recovered = quatToYaw(yawToQuat(yaw));
        expect(recovered).toBeCloseTo(yaw, 9);
      },
    );
  });

  describe("multiplyQuat", () => {
    it("identity * q = q", () => {
      const q = yawToQuat(0.7);
      quatApproxEqual(multiplyQuat(quatIdentity(), q), q);
    });

    it("q * identity = q", () => {
      const q = yawToQuat(0.7);
      quatApproxEqual(multiplyQuat(q, quatIdentity()), q);
    });

    it("yaw 合成: Q(a) · Q(b) = Q(a + b)", () => {
      const a = 0.3;
      const b = 0.9;
      const product = multiplyQuat(yawToQuat(a), yawToQuat(b));
      quatApproxEqual(product, yawToQuat(a + b));
    });
  });

  describe("conjugateQuat", () => {
    it("q * conj(q) = identity (単位 quat)", () => {
      const q = yawToQuat(1.1);
      quatApproxEqual(multiplyQuat(q, conjugateQuat(q)), quatIdentity());
    });

    it("conj(identity) = identity", () => {
      // toEqual は +0/-0 を区別するので quatApproxEqual で比較 (conjugate 内の単項 `-0` は -0 になる)
      quatApproxEqual(conjugateQuat(quatIdentity()), quatIdentity());
    });
  });

  describe("normalizeQuat", () => {
    it("zero quat は identity に fallback", () => {
      expect(normalizeQuat({ w: 0, x: 0, y: 0, z: 0 })).toEqual(quatIdentity());
    });

    it("スケールされた quat を単位化", () => {
      const q = { w: 2, x: 0, y: 0, z: 2 };
      const n = normalizeQuat(q);
      expect(n.w * n.w + n.x * n.x + n.y * n.y + n.z * n.z).toBeCloseTo(1, 9);
      expect(n.w).toBeCloseTo(Math.SQRT1_2, 9);
      expect(n.z).toBeCloseTo(Math.SQRT1_2, 9);
    });
  });

  describe("slerpQuat", () => {
    it("t=0 → a", () => {
      const a = yawToQuat(0.3);
      const b = yawToQuat(1.5);
      quatApproxEqual(slerpQuat(a, b, 0), a);
    });

    it("t=1 → b", () => {
      const a = yawToQuat(0.3);
      const b = yawToQuat(1.5);
      quatApproxEqual(slerpQuat(a, b, 1), b);
    });

    it("yaw(0) ↔ yaw(π/2)、t=0.5 で yaw(π/4)", () => {
      const a = yawToQuat(0);
      const b = yawToQuat(Math.PI / 2);
      const mid = slerpQuat(a, b, 0.5);
      quatApproxEqual(mid, yawToQuat(Math.PI / 4));
    });

    it("近接 quat (dot > 0.9995) で lerp fallback、結果は正規化されている", () => {
      const a = yawToQuat(0.001);
      const b = yawToQuat(0.002);
      const mid = slerpQuat(a, b, 0.5);
      const norm2 =
        mid.w * mid.w + mid.x * mid.x + mid.y * mid.y + mid.z * mid.z;
      expect(norm2).toBeCloseTo(1, 6);
    });

    it("二重被覆: a と −b の slerp は短経路 (dot < 0 の補正)", () => {
      const a = yawToQuat(0);
      const b = yawToQuat(Math.PI / 2);
      const negB = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
      const mid1 = slerpQuat(a, b, 0.5);
      const mid2 = slerpQuat(a, negB, 0.5);
      // どちらも yaw(π/4) 回転を表す (符号二重被覆で同一回転)
      const y1 = quatToYaw(normalizeQuat(mid1));
      const y2 = quatToYaw(normalizeQuat(mid2));
      // y1 と y2 は同じ絶対値 (符号は slerp 内部選択による) で、yaw(π/4) と整合
      expect(Math.abs(y1)).toBeCloseTo(Math.PI / 4, 6);
      expect(Math.abs(y2)).toBeCloseTo(Math.PI / 4, 6);
    });
  });
});

describe("isInPastLightCone", () => {
  const L = 20;
  // observer at origin, t=100 (= future), event の t は past 側
  const observer = createVector4(100, 0, 0, 0);

  it("通常の event (近距離 + 過去) は past cone 内", () => {
    // event at (t=80, x=10, y=0)、 spatial 距離 10、 dt=20、 lightlike 内
    const event = createVector4(80, 10, 0, 0);
    expect(isInPastLightCone(event, observer)).toBe(true);
  });

  it("future event は past cone 外 (t 順序判定)", () => {
    const event = createVector4(120, 0, 0, 0);
    expect(isInPastLightCone(event, observer)).toBe(false);
  });

  it("spacelike event (= 距離大、 dt 小) は past cone 外", () => {
    // dt=5、 spatial=20 → spacelike
    const event = createVector4(95, 20, 0, 0);
    expect(isInPastLightCone(event, observer)).toBe(false);
  });

  it("torus 化: 1 周回って戻ってきた event は最短画像で判定", () => {
    // 観測者 (0, 0)、 event (x=35, y=0): unwrapped 距離 35、 minImage で -5
    // dt = 100 - 80 = 20、 lightlike check: dx²+dy²+dz² ≤ dt² (minImage 適用)
    const event = createVector4(80, 35, 0, 0);
    // unwrapped: 35² > 20² → spacelike → past cone 外
    expect(isInPastLightCone(event, observer)).toBe(false);
    // torus L=20: minImage(35) = -5、 5² ≤ 20² → past cone 内
    expect(isInPastLightCone(event, observer, L)).toBe(true);
  });

  it("torus 化: y 軸でも同様に最短画像で判定", () => {
    const event = createVector4(80, 0, -35, 0);
    expect(isInPastLightCone(event, observer)).toBe(false);
    // minImage(-35) = 5、 5² ≤ 20² → past cone 内
    expect(isInPastLightCone(event, observer, L)).toBe(true);
  });

  it("torus 化: 離れたままの event (= 最短画像でも past cone 外) は false 維持", () => {
    // observer (0, 0)、 event (x=15, y=0)、 spatial 15、 dt=5 → spacelike (15² > 5²)
    const event = createVector4(95, 15, 0, 0);
    expect(isInPastLightCone(event, observer, L)).toBe(false);
  });

  it("torusHalfWidth undefined は従来挙動と等価", () => {
    const event = createVector4(80, 35, 0, 0);
    expect(isInPastLightCone(event, observer, undefined)).toBe(
      isInPastLightCone(event, observer),
    );
  });
});
