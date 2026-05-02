import { gamma, type Vector4 } from "../../physics";
import type { KillEventRecord, RelativisticPlayer } from "./types";

/**
 * 「最後に信じた phaseSpace」 から `pos + u·τ` の inertial 直線で延長して算出する仮想 4-position。
 *
 * alive / stale / dead を統一インターフェースで扱うのが目的:
 * - **alive other**: `lastSyncWall` = 最後に phaseSpace を broadcast 受信した wall_clock。
 * - **alive self** : `lastSyncWall` = `nowWall` (= τ=0、 自機は live なので `phaseSpace.pos` そのまま)。
 * - **stale other**: 同 alive other (= broadcast 停止前の最後値から延長)。
 * - **dead any**   : `lastSyncWall` = `lastSyncForDead(id, killLog)` (= killLog の最新 wallTime)。
 *   `applyKill` が `phaseSpace.pos` / `phaseSpace.u` を死亡時値で残しているため (`killRespawn.ts`)、
 *   そこから inertial 延長すれば全 peer が決定論的に同じ値を計算できる (= broadcast 不要)。
 *
 * 式は通常の 4-velocity 統合 `dx^μ/dτ = u^μ` を `τ ≡ wall_dt` に対して代数積分しただけ
 * (= no-acceleration の純 inertial)。 thrust 中断や ghost 物理の補正は本関数の責務外。
 *
 * 設計背景: `plans/2026-05-02-causality-symmetric-jump.md` §4 「死者の二本世界線モデル」 の
 * (1) 仮想世界線。 (2) ghost worldline (= self camera 用) は `myDeathEvent.ghostPhaseSpace`
 * 側で別管理、 本関数とは無関係。
 */
export const virtualPos = (
  player: RelativisticPlayer,
  lastSyncWall: number,
  nowWall: number,
): Vector4 => {
  const tau = (nowWall - lastSyncWall) / 1000;
  const ps = player.phaseSpace;
  const g = gamma(ps.u);
  return {
    t: ps.pos.t + g * tau,
    x: ps.pos.x + ps.u.x * tau,
    y: ps.pos.y + ps.u.y * tau,
    z: 0,
  };
};

/**
 * dead player の lastSync wall_time を killLog から取得 (= 最新 kill の wallTime)。
 * 同 victim の複数 kill (= 複数回 respawn 後再度 kill) があれば最大値を返す。
 *
 * caller は `virtualPos(deadPlayer, lastSyncForDead(id, killLog) ?? nowWall, nowWall)` で
 * 「killLog 未登録の defensive fallback」 を nowWall (= τ=0、 死亡時値そのまま) にする。
 */
export const lastSyncForDead = (
  playerId: string,
  killLog: readonly KillEventRecord[],
): number | undefined => {
  let latest: number | undefined;
  for (const e of killLog) {
    if (e.victimId !== playerId) continue;
    if (latest === undefined || e.wallTime > latest) latest = e.wallTime;
  }
  return latest;
};
