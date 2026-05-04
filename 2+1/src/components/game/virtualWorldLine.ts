import { gamma, type Vector4 } from "../../physics";
import type { KillEventRecord, RelativisticPlayer } from "./types";

/**
 * inertial 延長の上限 (秒)。 `lastSyncWall` が `nowWall` から本値以上離れたら、
 * `tau = nowWall - lastSyncWall` を本値で cap する safety net。
 *
 * 設計動機 (2026-05-04 plan: virtualpos-lastsync-rca §3 Fix B):
 * `lastSyncWall` の意味は「peer state が最後に確定した時刻」 だが、 host migration や
 * lastUpdateTimeRef.set 漏れ等で「古いまま update されない」 path が万一残ると、
 * tau が wall_clock 比例で線形増加 → virtualPos.pos.t が線形発散 → Rule B が huge
 * λ で fire 連発 → self.pos.t 暴走 (= 5/4 user 観察 Bug 10 の真因と同 class)。
 * 本値による cap で、 万一 lastSync が壊れても virtualPos の advance は最大 N 秒に
 * bounded、 self の Rule B も最大 N 秒分しか追従しない (= 1 度の jump で N 秒先に
 * fixed point、 暴走しない)。
 *
 * **N=2 sec の理論的根拠**:
 * - 下限: hidden tab 復帰 (= 5/2 Stage 6 で「lastTimeRef を hidden 中も毎 throttle
 *   tick で update」 fix 済) の延長要件は wall_dt 単位 (= 16ms)、 N=1 sec も safe
 * - 上限: stale peer remove 前の最大期待 broadcast 間隔 ≈ heartbeat 5 sec の半分 ≈ 2.5 sec
 * - → N=2 sec が良いバランス (= 通常 plays では tau < 100ms なので cap 効くシナリオは
 *   bug / extreme 切断のみ、 副作用最小)
 *
 * 主因 fix (= host-side LH lastSync 毎 tick update、 useGameLoop 内) と併用、
 * 本値は一般 safety net。
 */
export const MAX_VIRTUAL_TAU_SEC = 2;

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
  // tau に upper bound MAX_VIRTUAL_TAU_SEC を適用 (= safety net、 詳細は定数 docstring)。
  // 通常 plays では realTau < 100ms なので cap 効くシナリオは bug / extreme 切断のみ。
  const realTau = (nowWall - lastSyncWall) / 1000;
  const tau = Math.min(realTau, MAX_VIRTUAL_TAU_SEC);
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
