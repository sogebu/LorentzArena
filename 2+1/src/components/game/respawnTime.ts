import { SPAWN_RANGE } from "./constants";
import { isNpc } from "./lighthouse";
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
 *   場合は `nowWall` (= τ=0、 `phaseSpace.pos` そのもの) で fallback
 * - stale (= 5s+ broadcast 停止): 同 alive (= 最後の broadcast 値から forward 延長)
 * - dead: `lastSyncWall = lastSyncForDead(id, killLog)` (= killLog の最新 wallTime)、
 *   未登録なら `nowWall` で fallback
 *
 * **NPC 非対称 (= 2026-05-06、 `plans/2026-05-06-npc-asymmetric-causality.md` §3.2)**:
 * NPC (= LH 等) は spawn anchor 計算から **除外** する (`isNpc(p)` で判定)。 これにより:
 * - LH が runaway 状態でも新 joiner / respawn の anchor に流出しない (= Bug 14
 *   propagation race の LH 経路を構造的に遮断)
 * - 既存 checkCausalFreeze の片肺 LH skip + 走行中 Rule B の NPC skip と整合、 全
 *   causality calc 経路で「NPC = subordinate、 human を causally 制約しない」 を統一
 *
 * **集約 formula = mean (= sum / N、 plan §1.3)**:
 * 旧 (γ) `(min + max) / 2` (midpoint) → 新 (γ') `sum / N` (mean) に移行。 利点:
 * 1. **outlier robustness**: midpoint は extremum 2 点に full sensitivity、 mean は
 *    1/N 重みで cluster 平均化、 runaway peer 1 つで anchor が引きずられにくい
 * 2. **excludeId 撤去で fallback 構造消滅**: self も virtualPos で寄与する設計に変更、
 *    solo respawn corner case (= self が dead で他 alive human 不在 + LH のみ) でも
 *    peers 配列が常に non-empty (= self_dead が必ず居る)、 fallback 経路 trigger なし
 * 3. **signature 簡素化**: `excludeId?: string | null` 引数を撤去、 caller 側も整理
 *
 * 通常 plays (= 同 cluster 内 N peer) では mean ≈ midpoint で挙動差なし、 outlier
 * scenario (= runaway peer 等) で mean が robust。 plan §5.3 に数値検証あり。
 *
 * **dead を含めて寄与させる根拠 (= 5/2 plan §4 「死者の二本世界線モデル」 を維持)**:
 * dead を spawn 計算から除外すると alive 群が wall_dt で advance を続ける一方 dead は
 * 寄与しない → 多数死亡 / 復活サイクルで時刻 split が systemic に広がる。 dead を
 * virtualPos で寄与させれば、 死者の virtual continuation が cluster と一緒に drift し
 * cluster 同期維持される。 dead.virtualPos drift は γ_death × elapsed_dead_wall で
 * bounded (= γ_death ≤ 1.89 × RESPAWN_DELAY = 5 sec で最大 ≈ 9.45 sec、 2026-05-16 odakin 指示で 10 sec → 5 sec 短縮)、 大幅な発散
 * しない。
 *
 * 走行中 Rule A/B (= dead 完全除外) と spawn 計算 (= dead virtualPos 包含) の dead 扱い
 * asymmetric は **dead の役割の違い** から導出される必然 (= plan §4.2):
 * - 走行中 = active causality reaction、 dead 含むと「dead-me virtualPos が alive-other の
 *   future cone を作って Rule A trigger」 という regression
 * - spawn 計算 = anchor 計算、 同 regression が triggering せず cluster 同期 benefit が大きい
 *
 * **(α) `now wall_clock` 自分基準 案の永続却下** (= plan §11.13): 5/2 plan §6 Stage 8 で
 * 「plan 推奨」 とされた (α) は P1 設計柱 (= `pos.t = γ × wall_clock`、 動いた人ほど未来
 * に進む) と本質矛盾するため永続不採用 (= wall_clock = 固有時、 coord time とは別軸)。
 *
 * **呼び出し元の責務**:
 *  - 自機 / LH / 他 peer respawn: 全 caller で signature 同一、 `excludeId` 廃止
 *  - 初回スポーン / 新 joiner: 同上
 *  - `lastUpdateTimes` は `useStaleDetection` の `lastUpdateTimeRef.current` を渡す
 *  - 取得困難な caller (= snapshot から呼ぶ場合等) は `undefined` → τ=0 fallback で OK
 *  - `nowWall` は `Date.now()`
 *
 * **fallback** (= peers 真に空、 想定外 defensive): caller A (`buildSnapshot`) / B (LH
 * respawn) / C (self respawn) の文脈では host/runner/self が peers に必ず残るため理論上
 * 発火しない。 hit したら bug 報告対象、 silent に変な値を返さず原点 `0` を defensive
 * に返す。
 */
export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: ReadonlyMap<string, number> | undefined,
  nowWall: number,
  /**
   * 現在死亡中の player ID 集合 (= `selectDeadPlayerIds(state)`)。 caller (= snapshot
   * buildSnapshot / useGameLoop respawn handlers) が tick 開始時 1 回 derive して渡す
   * (= 2026-05-04 isDead 二重管理解消で `RelativisticPlayer.isDead` field 撤廃、
   * derive 唯一化の caller-pass pattern)。
   */
  deadIds: ReadonlySet<string>,
): number => {
  let sumT = 0;
  let count = 0;
  for (const [id, p] of players) {
    if (isNpc(p)) continue;
    const lastSync = deadIds.has(id)
      ? (lastSyncForDead(id, killLog) ?? nowWall)
      : (lastUpdateTimes?.get(id) ?? nowWall);
    const vp = virtualPos(p, lastSync, nowWall);
    if (!Number.isFinite(vp.t)) continue;
    sumT += vp.t;
    count++;
  }
  return count > 0 ? sumT / count : 0;
};

/**
 * リスポーン/スポーン位置を生成（座標時間 + ランダム空間位置）。
 *
 * `excludeId` は (γ') 移行 (= plans/2026-05-06-npc-asymmetric-causality.md §3.2) で
 * 撤去 — self も virtualPos で寄与する設計に統一。 詳細は `computeSpawnCoordTime`
 * docstring 参照。
 */
export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: ReadonlyMap<string, number> | undefined,
  nowWall: number,
  deadIds: ReadonlySet<string>,
): { t: number; x: number; y: number; z: number } => ({
  t: computeSpawnCoordTime(players, killLog, lastUpdateTimes, nowWall, deadIds),
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
