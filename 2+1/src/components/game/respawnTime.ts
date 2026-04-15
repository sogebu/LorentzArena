import { SPAWN_RANGE } from "./constants";
import type { RelativisticPlayer } from "./types";

/**
 * 初回スポーン / リスポーン / 新 joiner スポーンで共通に使う座標時刻を算出。
 *
 * ルール: **全プレイヤー (生存/死亡/LH 問わず) の phaseSpace.pos.t の最大値**。
 *
 * 意図:
 * - 生存者がいれば彼らの最新時刻に追随 (過去スポーンによる「時差」解消)
 * - 人間が全員死んでいても LH は常に alive なので LH.t が拾われ、
 *   ゲームの「現在」が保たれる
 * - 死亡中プレイヤーの .pos.t はゴースト世界線で単調増加しており、
 *   「宇宙の最新イベント時刻」として妥当
 * - peer ごとの OFFSET (Date.now()/1000 - OFFSET) に依存しないため、
 *   beacon holder 以外の peer でも正しく機能する
 *
 * 空 Map はゲーム初期化直前の一瞬のみで、その経路 (RelativisticGame 初期化) は
 * 別途 `Date.now()/1000 - OFFSET = 0` を使うのでここには来ない。保険として 0。
 */
export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
): number => {
  let maxT = Number.NEGATIVE_INFINITY;
  for (const [, p] of players) {
    const t = p.phaseSpace.pos.t;
    if (Number.isFinite(t) && t > maxT) maxT = t;
  }
  return Number.isFinite(maxT) ? maxT : 0;
};

/**
 * リスポーン/スポーン位置を生成（座標時間 + ランダム空間位置）。
 */
export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
): { t: number; x: number; y: number; z: number } => ({
  t: computeSpawnCoordTime(players),
  x: Math.random() * SPAWN_RANGE,
  y: Math.random() * SPAWN_RANGE,
  z: 0,
});
