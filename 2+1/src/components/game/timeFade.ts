import { TIME_FADE_SCALE } from "./constants";

/**
 * Lorentzian 型の時間的距離 opacity fade factor。
 *
 *   fade = r² / (r² + Δt²)、r = TIME_FADE_SCALE
 *
 * 観測者の世界系時刻から event 時刻までの時間距離の 2 乗に反比例して暗くなる。
 * 物理の逆 2 乗法則 (重力・光の強度) と同型の smooth な Lorentzian / Cauchy 形。
 *
 * - Δt = 0 で fade = 1 (発散せず smooth)
 * - Δt = r で fade = 0.5
 * - Δt = 2r で fade = 0.2
 * - Δt = 3r で fade = 0.1
 * - Δt → ∞ で 漸近的に r²/Δt² (純粋な 1/Δt² 挙動)
 *
 * 詳細と採用根拠: EXPLORING.md §「時間的距離 opacity fade」。
 */
export const computeTimeFade = (deltaT: number): number => {
  const r = TIME_FADE_SCALE;
  const r2 = r * r;
  return r2 / (r2 + deltaT * deltaT);
};
