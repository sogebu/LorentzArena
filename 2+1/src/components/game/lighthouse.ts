import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  gamma,
  minImageDelta1D,
  vector3Zero,
  type Vector3,
  type Vector4,
} from "../../physics";
import { ENERGY_MAX, LIGHTHOUSE_COLOR, LIGHTHOUSE_ID_PREFIX, MAX_WORLDLINE_HISTORY, SPAWN_RANGE } from "./constants";
import type { RelativisticPlayer } from "./types";

/**
 * Canonical English display name for a Lighthouse NPC. Used as the locale-
 * independent value persisted to leaderboards and snapshotted into kill
 * events; render layers translate this via i18n (`hud.lighthouse`).
 */
export const LIGHTHOUSE_DISPLAY_NAME = "Lighthouse";

/** Check if a player ID belongs to a Lighthouse NPC. */
export const isLighthouse = (id: string): boolean =>
  id.startsWith(LIGHTHOUSE_ID_PREFIX);

/**
 * このプレイヤーを駆動するのが自分（`myId`）かどうか。
 * Authority 解体で hit detection 等を「owner のみ」に絞る際に使う。
 */
export const isOwnedByMe = (player: RelativisticPlayer, myId: string): boolean =>
  player.ownerId === myId;

/**
 * Create a Lighthouse player at a random position.
 *
 * @param ownerId - peer ID of the current beacon holder (drives Lighthouse AI).
 *                  Authority 解体では Lighthouse も他のプレイヤーと同様 owner 概念で扱う。
 */
export const createLighthouse = (
  id: string,
  time: number,
  ownerId: string,
): RelativisticPlayer => {
  const spawnX = (Math.random() - 0.5) * SPAWN_RANGE;
  const spawnY = (Math.random() - 0.5) * SPAWN_RANGE;
  const ps = createPhaseSpace(
    createVector4(time, spawnX, spawnY, 0),
    vector3Zero(),
  );
  let wl = createWorldLine(MAX_WORLDLINE_HISTORY);
  wl = appendWorldLine(wl, ps);
  return {
    id,
    ownerId,
    phaseSpace: ps,
    worldLine: wl,
    color: LIGHTHOUSE_COLOR,
    energy: ENERGY_MAX,
  };
};

/**
 * Compute the laser direction for a relativistic intercept.
 *
 * Given:
 * - Turret at position P_t (stationary)
 * - Enemy observed on past light cone at (p_e, u_e)
 *
 * Find the direction to fire so the laser hits an inertially-moving enemy.
 *
 * `enemyU` は phaseSpace.u (= 4-velocity 空間成分 = γ·v、 codebase 全体共通の convention)。
 * 4-velocity full は `u^μ = (γ, enemyU.x, enemyU.y, 0)` で、 `γ = sqrt(1 + |enemyU|²)`。
 *
 * The enemy's world line (assuming inertial): p(τ) = p_e + u^μ · τ
 *
 * The laser from P_t travels at c=1 in direction d: L(λ) = P_t + λ·(1, dx, dy, 0)
 * where dx² + dy² = 1.
 *
 * We need to find τ, λ such that p(τ) = L(λ):
 *   p_e + u^μ·τ = P_t + λ·(1, dx, dy, 0)
 *
 * Equivalently, the intercept point is on the turret's future light cone:
 *   (t_i - T)² = (x_i - X_t)² + (y_i - Y_t)²
 * where (t_i, x_i, y_i) = p_e + u^μ·τ.
 *
 * This gives a quadratic in τ. Solve for τ > 0, then direction = normalize(spatial displacement).
 */
export const computeInterceptDirection = (
  turretPos: Vector4,
  enemyPos: Vector4,
  enemyU: Vector3,
  torusHalfWidth?: number,
): Vector3 | null => {
  // Displacement from turret to enemy observation point.
  // torus mode では最短画像 delta で取る (= 境界跨ぎの enemy にも intercept 計算が機能)。
  const rawDx = enemyPos.x - turretPos.x;
  const rawDy = enemyPos.y - turretPos.y;
  const dx =
    torusHalfWidth !== undefined ? minImageDelta1D(rawDx, torusHalfWidth) : rawDx;
  const dy =
    torusHalfWidth !== undefined ? minImageDelta1D(rawDy, torusHalfWidth) : rawDy;
  const dt = enemyPos.t - turretPos.t;

  // Enemy 4-velocity components (= u^μ)。 enemyU は既に 4-velocity 空間成分 (γv) なので
  // ux/uy はそのまま。 ut (= u^0 = γ) のみ計算。 旧実装で `g * enemyU.{x,y}` と書いて
  // γ を二重適用 → 高速 enemy で intercept 軌道係数が破綻していた bug を 2026-04-28 に修正。
  const ut = gamma(enemyU);
  const ux = enemyU.x;
  const uy = enemyU.y;

  // Quadratic: a·τ² + b·τ + c = 0
  // From (dt + ut·τ)² = (dx + ux·τ)² + (dy + uy·τ)²
  // Expanding: (ut² - ux² - uy²)·τ² + 2·(dt·ut - dx·ux - dy·uy)·τ + (dt² - dx² - dy²) = 0
  const a = ut * ut - ux * ux - uy * uy;
  const b = 2 * (dt * ut - dx * ux - dy * uy);
  const c = dt * dt - dx * dx - dy * dy;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);
  let tau: number;

  if (Math.abs(a) < 1e-12) {
    // Linear case (enemy at rest: a ≈ 0)
    if (Math.abs(b) < 1e-12) return null;
    tau = -c / b;
  } else {
    // Two solutions: pick the smallest positive one
    const tau1 = (-b + sqrtD) / (2 * a);
    const tau2 = (-b - sqrtD) / (2 * a);
    if (tau1 > 0 && tau2 > 0) tau = Math.min(tau1, tau2);
    else if (tau1 > 0) tau = tau1;
    else if (tau2 > 0) tau = tau2;
    else return null;
  }

  // Intercept point
  const ix = dx + ux * tau;
  const iy = dy + uy * tau;

  // Normalize to get direction
  const dist = Math.sqrt(ix * ix + iy * iy);
  if (dist < 1e-10) return null;

  return { x: ix / dist, y: iy / dist, z: 0 };
};

/** Box–Muller で N(0, σ²) を 1 サンプル。 */
const sampleGaussian = (sigma: number): number => {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/**
 * 方向ベクトルに xy 平面内の角度誤差を加える (単位長は厳密保持)。
 * θ ~ N(0, σ²) を 3σ で clamp。距離 D での横ズレ RMS ≈ σ·D。
 */
export const perturbDirection = (dir: Vector3, sigma: number): Vector3 => {
  const raw = sampleGaussian(sigma);
  const theta = Math.max(-3 * sigma, Math.min(3 * sigma, raw));
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c, z: 0 };
};
