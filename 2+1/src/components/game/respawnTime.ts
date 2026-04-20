import { SPAWN_RANGE } from "./constants";
import type { RelativisticPlayer, RespawnEventRecord } from "./types";

/**
 * 初回スポーン / リスポーン / 新 joiner スポーンで共通に使う座標時刻を算出。
 *
 * ルール: **excludeId を除く全プレイヤー (生存/死亡/LH 問わず) の
 * phaseSpace.pos.t の最大値**。
 *
 * 2 つの原則 (詳細: DESIGN.md §物理「スポーン座標時刻」):
 *
 *  1. **自機除外** (`excludeId`): 呼び出し元が自機 ID を渡すと除外される。
 *     自機が ghost 中の自己 respawn 計算で自分の ghost.pos.t を参照するのを防ぐ。
 *     ghost は生存時と同じ物理 (thrust 自由) で進むが pos.t が γ で先走るため、
 *     自己参照すると自機 respawn が遠未来へ暴走する。他人の timeline で決めれば
 *     自機 ghost の挙動は respawn に影響しない。
 *
 *  2. **死亡プレイヤー (LH 含む) は死亡時刻を持ち時刻とする** (純粋な placeholder):
 *     他人間・LH 問わず死亡中の entity は tick されず、`phaseSpace.pos.t` は
 *     死亡時刻で固定された placeholder として `players` Map に残り、max 計算に
 *     参加する。対称的な設計:
 *      - 他人間 ghost: 死亡中の phaseSpace はネットワーク送信されないため、他 peer
 *        側で自然に死亡時刻で固定 (ネットワーク同期の副作用として明示的ロジック不要)
 *      - LH ghost: `useGameLoop` の LH loop が `if (lh.isDead) continue;` で tick を
 *        skip、phaseSpace は死亡時刻のまま変化しない
 *     通常は alive な entity (自機以外の他人間 + alive LH) の進行中 pos.t が max
 *     に勝つので、死亡時刻は背景に沈む。全員死亡の稀なケースでは「最後に死んだ
 *     event の時刻」が respawn 時刻になる (coord time 上は巻き戻りだが、wall clock
 *     RESPAWN_DELAY は回っているので許容範囲)。
 *
 * **fallback 0 は形式保険のみ**: players map が完全に空 (ゲーム初期化直前の
 * 一瞬) のときだけ maxT = -∞ で 0 fallback。LH は常に `players` に登録されて
 * いるため、通常プレイ中は必ず maxT 有限。
 *
 * **将来の保守注意**: 原則 2 の「他人間 ghost 死亡時刻固定」は「死亡中 phaseSpace
 * 非送信」という既存ネットワーク仕様に依存。「死亡中も phaseSpace を送信する」
 * 設計変更が将来入ると、他 peer 側でも他人間 ghost 進行が反映されて原則 2 が
 * 崩れる。その時はこの関数に明示的な「人間 isDead は skip」フィルタを加える必要が
 * ある (LH は useGameLoop 側の tick skip が担保、ただし LH の phaseSpace を死亡中
 * に触る変更を入れないことが前提)。
 *
 * **呼び出し元の責務**:
 *  - 自機 respawn 計算: `excludeId = myId` を渡す
 *  - 初回スポーン / 新 joiner (snapshot.hostTime): 自機がまだ players に未登録
 *    (or 登録時でも excludeId を渡しても結果同じ) なので引数省略可。意味論統一の
 *    ため自機がある経路では `excludeId = myId` を渡すのが望ましい。
 */
export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
  excludeId?: string | null,
): number => {
  let maxT = Number.NEGATIVE_INFINITY;
  for (const [id, p] of players) {
    if (excludeId != null && id === excludeId) continue;
    const t = p.phaseSpace.pos.t;
    if (Number.isFinite(t) && t > maxT) maxT = t;
  }
  return Number.isFinite(maxT) ? maxT : 0;
};

/**
 * リスポーン/スポーン位置を生成（座標時間 + ランダム空間位置）。
 * `excludeId` の扱いは `computeSpawnCoordTime` に準拠。
 */
export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
  excludeId?: string | null,
): { t: number; x: number; y: number; z: number } => ({
  t: computeSpawnCoordTime(players, excludeId),
  x: Math.random() * SPAWN_RANGE,
  y: Math.random() * SPAWN_RANGE,
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
