import { SPAWN_RANGE } from "./constants";
import type { RelativisticPlayer, RespawnEventRecord } from "./types";

/**
 * 初回スポーン / リスポーン / 新 joiner スポーンで共通に使う座標時刻を算出。
 *
 * ルール: **alive で broadcast している player (= dead 除外 + stale 除外 + excludeId 除外)
 * の `phaseSpace.pos.t` の min と max の中間値**。
 *
 * 2026-04-28 に旧「全 player の max」 から変更。 旧仕様では 高 γ 累積 player に
 * hostTime が引っ張られ、 静止気味 alive player が新 joiner の過去光円錐内に入って
 * 永遠凍結する bug が起きていた (= `evolvePhaseSpace` で `pos.t += γ * dτ` (dτ = wall_dt)
 * のため、 動いた player の pos.t は wall_clock より速く進み、 player 間 lag が累積する)。
 *
 * 中間値にすることで:
 *  - max の動いた player は新 joiner の **未来側** (= 新 joiner.t < other.t、 freeze check
 *    の line 593 で skip)
 *  - min の静止気味 player は新 joiner の **過去側** だが lag は ±(max-min)/2 に半減 →
 *    typical な spatial 距離より dt が小さくなり 過去光円錐内に入りにくい
 *
 * 原則:
 *
 *  1. **自機除外** (`excludeId`): 呼び出し元が自機 ID を渡すと除外される。
 *     自機が ghost 中の自己 respawn 計算で自分の ghost.pos.t を参照するのを防ぐ。
 *     ghost は生存時と同じ物理で進むが pos.t が γ で先走るため、 自己参照すると
 *     自機 respawn が遠未来へ暴走する。
 *
 *  2. **dead player は除外**: 死亡 placeholder の pos.t (= 死亡時刻で固定) は alive な
 *     「現在 broadcasting している player」 を代表しないため min/max 算定から外す。
 *     全員死亡の稀ケースでは fallback として全 player の max を使う (= 旧仕様の挙動)。
 *
 *  3. **stale player は除外**: `staleFrozenIds` で渡された ID は除外。 broadcast 停止後
 *     5s 経過の player を含めると min が異常に過去側に振れる。
 *
 * **fallback**: alive non-stale が居ない場合、 全 player (dead 含む) の max にフォールバック
 * (= ゲーム初期化前 / 全員死亡の瞬間 等)。 通常 LH が常時 alive のため実害稀。
 *
 * **呼び出し元の責務**:
 *  - 自機 respawn 計算: `excludeId = myId` を渡す
 *  - 初回スポーン / 新 joiner (snapshot.hostTime): 自機がまだ players に未登録なので
 *    excludeId 省略可
 *  - stale 集合は基本的に `useGameStore.getState().staleFrozenIds` を渡す
 */
export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
  excludeId?: string | null,
  staleFrozenIds?: ReadonlySet<string>,
): number => {
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const [id, p] of players) {
    if (excludeId != null && id === excludeId) continue;
    if (p.isDead) continue;
    if (staleFrozenIds?.has(id)) continue;
    const t = p.phaseSpace.pos.t;
    if (!Number.isFinite(t)) continue;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  if (Number.isFinite(minT) && Number.isFinite(maxT)) {
    return (minT + maxT) / 2;
  }
  // Fallback: alive non-stale が居ない (= ゲーム初期化前 / 全員死亡の瞬間 等)。
  // 全 player (dead 含む) の max を使う = 旧仕様の挙動。
  let fallbackMaxT = Number.NEGATIVE_INFINITY;
  for (const [id, p] of players) {
    if (excludeId != null && id === excludeId) continue;
    const t = p.phaseSpace.pos.t;
    if (Number.isFinite(t) && t > fallbackMaxT) fallbackMaxT = t;
  }
  return Number.isFinite(fallbackMaxT) ? fallbackMaxT : 0;
};

/**
 * リスポーン/スポーン位置を生成（座標時間 + ランダム空間位置）。
 * `excludeId` / `staleFrozenIds` の扱いは `computeSpawnCoordTime` に準拠。
 */
export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
  excludeId?: string | null,
  staleFrozenIds?: ReadonlySet<string>,
): { t: number; x: number; y: number; z: number } => ({
  t: computeSpawnCoordTime(players, excludeId, staleFrozenIds),
  x: (Math.random() - 0.5) * SPAWN_RANGE,
  y: (Math.random() - 0.5) * SPAWN_RANGE,
  z: 0,
});

/**
 * プレイヤーの最新 spawn coord time を respawnLog から取得。
 *
 * 「spawnT」は past-cone visibility 判定の境界 (= この event が観測者の過去光円錐に
 * まだ届いていない間は renderer 側で invisible にする)。以前は
 * `player.worldLine.history[0]?.pos.t` を使っていたが、phaseSpace gap-reset
 * (`WORLDLINE_GAP_THRESHOLD_MS`) が発火すると `history[0]` が「現在の phaseSpace」で
 * 上書きされ spawnT が jump up → `pastConeT < spawnT` が成立し LH tower 等が
 * 一時的に消える bug があった (host migration 時に LH が消える症状の一因)。
 *
 * respawnLog は handleSpawn 時のみ append され gap-reset では触らないので、
 * 「spawn event の coord time」という semantics に忠実。
 *
 * Fallback: respawnLog に entry が無い例外ケース (players map に居るのに
 * respawnLog 側で未登録 = bug) のみ worldLine origin を採用。
 */
export const getLatestSpawnT = (
  respawnLog: readonly RespawnEventRecord[],
  player: RelativisticPlayer,
): number => {
  for (let i = respawnLog.length - 1; i >= 0; i--) {
    if (respawnLog[i].playerId === player.id) return respawnLog[i].position.t;
  }
  return player.worldLine.history[0]?.pos.t ?? player.phaseSpace.pos.t;
};
