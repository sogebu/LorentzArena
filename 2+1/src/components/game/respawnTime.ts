import { SPAWN_RANGE } from "./constants";
import type {
  KillEventRecord,
  RelativisticPlayer,
  RespawnEventRecord,
} from "./types";
import { lastSyncForDead, virtualPos } from "./virtualWorldLine";

/**
 * 初回スポーン / リスポーン / 新 joiner スポーンで共通に使う座標時刻を算出。
 *
 * **Stage 7 (`plans/2026-05-02-causality-symmetric-jump.md`)**: alive / stale / dead を
 * `virtualPos` で統一処理。 旧仕様の `staleFrozenIds` 除外 + `isDead` 除外を撤廃し、
 * 全 peer を「最後に信じた phaseSpace から `pos + u·τ` で inertial 延長した virtualPos」
 * の coord time で扱う:
 *
 * - alive (= broadcast 受信中): `lastSyncWall = lastUpdateTimes.get(id)`、 提供されない
 *   場合は `nowWall` (= τ=0、 `phaseSpace.pos` そのまま) で fallback
 * - stale (= 5s+ broadcast 停止): 同 alive (= 最後の broadcast 値から forward 延長)
 * - dead: `lastSyncWall = lastSyncForDead(id, killLog)` (= killLog の最新 wallTime)、
 *   未登録なら `nowWall` で fallback
 *
 * 算出値は `(min + max) / 2` で「両側 lag を半減」 する 4/28 的中間値仕様 (= `3ba639a`
 * 由来)。 Stage 8 で「self の wall_clock 自分基準 (α 案)」 等への変更を検討中、 現時点で
 * は中間値を維持。
 *
 * 旧仕様 (~ Stage 7) との挙動差:
 * - dead 含めて min/max 算定 → 死後しばらくは死亡 player の virtualPos.t も寄与
 * - stale 別扱いなし → broadcast 停止中の peer も予測値で寄与
 * - 結果として min/max の spread が「各 peer の純 inertial 予測」 に基づき、 broadcast
 *   gap や death event で discrete jump しなくなる
 *
 * **呼び出し元の責務**:
 *  - 自機 respawn 計算: `excludeId = myId` を渡す (= 自分の現状 pos を反映しない)
 *  - 初回スポーン / 新 joiner: 自機未登録なので `excludeId` 省略可
 *  - `lastUpdateTimes` は `useStaleDetection` の `lastUpdateTimeRef.current` を渡す。
 *    取得困難な caller (= snapshot から呼ぶ場合等) は `undefined` → τ=0 fallback で OK
 *  - `nowWall` は `Date.now()`
 *
 * **fallback**: 全 peer が excludeId に該当 / 空 → 0 を返す。
 */
export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: ReadonlyMap<string, number> | undefined,
  nowWall: number,
  excludeId?: string | null,
): number => {
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const [id, p] of players) {
    if (excludeId != null && id === excludeId) continue;
    const lastSync = p.isDead
      ? (lastSyncForDead(id, killLog) ?? nowWall)
      : (lastUpdateTimes?.get(id) ?? nowWall);
    const vp = virtualPos(p, lastSync, nowWall);
    if (!Number.isFinite(vp.t)) continue;
    if (vp.t < minT) minT = vp.t;
    if (vp.t > maxT) maxT = vp.t;
  }
  if (Number.isFinite(minT) && Number.isFinite(maxT)) {
    return (minT + maxT) / 2;
  }
  return 0;
};

/**
 * リスポーン/スポーン位置を生成（座標時間 + ランダム空間位置）。
 * `excludeId` の扱いは `computeSpawnCoordTime` に準拠。
 */
export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: ReadonlyMap<string, number> | undefined,
  nowWall: number,
  excludeId?: string | null,
): { t: number; x: number; y: number; z: number } => ({
  t: computeSpawnCoordTime(players, killLog, lastUpdateTimes, nowWall, excludeId),
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
