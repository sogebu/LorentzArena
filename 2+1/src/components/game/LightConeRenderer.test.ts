import { describe, expect, it } from "vitest";
import { cylinderHitDistance } from "./LightConeRenderer";

// Float64 同一演算なので厳密一致に近いが、sin/cos の order-of-operation で 1e-12 程度の
// ズレは許容。
const EPS = 1e-9;

describe("cylinderHitDistance", () => {
  // Canonical cylinder (arena geometry): center (5, 5), radius 20.
  const CX = 5;
  const CY = 5;
  const R = 20;

  it("observer at cylinder center → ρ = R for all θ", () => {
    for (let i = 0; i < 16; i++) {
      const theta = (i / 16) * Math.PI * 2;
      const rho = cylinderHitDistance(CX, CY, theta, CX, CY, R);
      expect(rho).not.toBeNull();
      expect(Math.abs((rho as number) - R)).toBeLessThan(EPS);
    }
  });

  it("observer inside cylinder, ray along +x → hit at dx = R − offset_x", () => {
    // Observer at (10, 5) (offset +5 from center, still inside). θ = 0 → +x.
    // Reaches cylinder at (cx + R, cy) = (25, 5), so ρ = 25 − 10 = 15.
    const rho = cylinderHitDistance(10, 5, 0, CX, CY, R);
    expect(rho).not.toBeNull();
    expect(Math.abs((rho as number) - 15)).toBeLessThan(EPS);
  });

  it("observer inside cylinder, ray along −x → hit at far side", () => {
    // Observer at (10, 5). θ = π → −x. Reaches (cx − R, cy) = (−15, 5), ρ = 25.
    const rho = cylinderHitDistance(10, 5, Math.PI, CX, CY, R);
    expect(rho).not.toBeNull();
    expect(Math.abs((rho as number) - 25)).toBeLessThan(EPS);
  });

  it("observer on cylinder, ray inward → ρ = 2R", () => {
    // Observer at (cx + R, cy) = (25, 5). θ = π → −x. Ray traverses cylinder,
    // exits opposite side at (cx − R, cy), ρ = 2R = 40.
    const rho = cylinderHitDistance(25, 5, Math.PI, CX, CY, R);
    expect(rho).not.toBeNull();
    expect(Math.abs((rho as number) - 2 * R)).toBeLessThan(EPS);
  });

  it("observer outside cylinder, ray pointing at cylinder → near-side hit", () => {
    // Observer at (30, 5), 5 units outside the near wall (at x = 25).
    // θ = π → ray goes toward −x. Near hit at x = 25, ρ = 5. Far at x = −15 (ρ = 45).
    const rho = cylinderHitDistance(30, 5, Math.PI, CX, CY, R);
    expect(rho).not.toBeNull();
    expect(Math.abs((rho as number) - 5)).toBeLessThan(EPS);
  });

  it("observer outside cylinder, ray pointing away → null", () => {
    // Observer at (30, 5), θ = 0 → +x. Ray moves away from cylinder; no positive root.
    const rho = cylinderHitDistance(30, 5, 0, CX, CY, R);
    expect(rho).toBeNull();
  });

  it("observer outside cylinder, ray misses (perpendicular offset > R) → null", () => {
    // Observer at (cx, cy + 40) = (5, 45), far above cylinder. θ = 0 → +x.
    // Ray at y = 45 never crosses cylinder (max y on cylinder = cy + R = 25).
    const rho = cylinderHitDistance(5, 45, 0, CX, CY, R);
    expect(rho).toBeNull();
  });

  it("symmetry: ρ(θ) from offset observer is reflective across offset axis", () => {
    // Observer at (10, 5) = center + 5*x_hat. Ray at θ and −θ should give same ρ
    // because geometry is symmetric about the x-axis through observer.
    for (let i = 1; i < 8; i++) {
      const theta = (i / 8) * Math.PI; // avoid 0 and π which are on the axis
      const rhoA = cylinderHitDistance(10, 5, theta, CX, CY, R);
      const rhoB = cylinderHitDistance(10, 5, -theta, CX, CY, R);
      expect(rhoA).not.toBeNull();
      expect(rhoB).not.toBeNull();
      expect(Math.abs((rhoA as number) - (rhoB as number))).toBeLessThan(EPS);
    }
  });

  it("rim points on cylinder (observer inside) all lie on cylinder boundary", () => {
    // Exhaustive check: for any interior observer, (ox + ρ cosθ, oy + ρ sinθ) must
    // satisfy (x − cx)² + (y − cy)² = R².
    const observers: Array<[number, number]> = [
      [5, 5], // center
      [10, 5], // offset +x
      [5, 15], // offset +y
      [12, 12], // diagonal offset
    ];
    for (const [ox, oy] of observers) {
      for (let i = 0; i < 32; i++) {
        const theta = (i / 32) * Math.PI * 2;
        const rho = cylinderHitDistance(ox, oy, theta, CX, CY, R);
        expect(rho).not.toBeNull();
        const rx = ox + (rho as number) * Math.cos(theta);
        const ry = oy + (rho as number) * Math.sin(theta);
        const d2 = (rx - CX) ** 2 + (ry - CY) ** 2;
        expect(Math.abs(d2 - R * R)).toBeLessThan(1e-6);
      }
    }
  });
});
