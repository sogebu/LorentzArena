import type { PhaseSpace } from "../physics/mechanics";

/**
 * A minimal player shape used in some experiments.
 *
 * English: This is mostly legacy / debug use.
 * 日本語: 主に互換・デバッグ用の簡易型です。
 */
export type Player = {
  id: string;
  x: number;
  y: number;
};

/**
 * Player state used by the relativistic renderer.
 *
 * English:
 *   - `phaseSpace` is the authoritative state (4-position + 3-velocity).
 *   - `apparentX/Y` is what the current observer sees (past-light-cone intersection).
 *
 * 日本語:
 *   - `phaseSpace` が本体（4元位置 + 3元速度）。
 *   - `apparentX/Y` は観測者から見えた位置（過去光円錐との交点）。
 */
export type RelativisticPlayer = {
  id: string;
  phaseSpace: PhaseSpace;
  // apparent position seen by the observer / 観測者から見た見かけの位置
  apparentX: number;
  apparentY: number;
  // last updated time in world coordinates / 最後に更新された時刻（世界時）
  lastUpdateTime: number;
};
