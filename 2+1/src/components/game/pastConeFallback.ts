import {
  pastLightConeIntersectionWorldLine,
  type PhaseSpace,
  type Vector4,
  type WorldLine,
} from "../../physics";
import type { FrozenWorldLine } from "./types";

/**
 * 観測者の過去光円錐 ∩ player 世界線 を求める resilient helper。
 * `pastLightConeIntersectionWorldLine` を current worldLine + 同 playerId の
 * frozenWorldLines の順で試し、 最初に non-null を返した intersection を採用。
 *
 * **設計動機** (2026-05-04 plan: virtualpos-lastsync-rca §3 Fix C 副作用 fix):
 * Fix C で alive 自機 / LH の Rule B 大ジャンプ時、 旧 worldLine を frozenWorldLines
 * に push + 新 worldLine を **1 点 (= adjustedPs)** から開始する。 worldLine が 1 点
 * しかない瞬間、 線分が形成されず `pastLightConeIntersectionWorldLine` が **null
 * 返却** → renderer (= LighthouseRenderer / OtherShipRenderer) で描画消失 → 次 tick
 * の append で 2 点目できると交差成功 → 描画復活、 という flicker が起こる
 * (= 2026-05-04 user 観察「灯台がちらちらフリッカー」)。
 *
 * 物理的解釈: 観測者の過去光円錐 ∩ (旧 worldLine ∪ 新 worldLine) = 「観測者が今
 * 見えている event」。 過去光円錐がまだ新 event (= jump 直後) の光速到達前なら、
 * 旧 worldLine 上の event を観測している = 光速遅延で「観測者は jump 前の旧軌跡
 * をしばらく見続け、 やがて jump 後の新軌跡が visible になる」 = visible
 * discontinuity の物理的 natural な表現。 fallback は単に「凍結 + 新分割」 を
 * union として扱い直すための表示用 resilience であって物理 model 変更ではない。
 *
 * **Policy**: frozenWorldLines は push 順 (= 時系列順)、 通常は最新 frozen で
 * intersection 取れるが、 観測者高速移動 / 大 spatial gap で稀に旧 frozen の方が
 * hit する可能性 → 全 frozen を **逆順走査 + 最初の non-null** で最新優先 + fallback
 * 古い方も試す (= LH の frozen は通常少数で計算量小)。
 *
 * 計算量: O(K_log + sum_i log N_i)、 K_log = current worldLine 二分探索、 N_i = i 番目
 * frozen worldLine の history 長。 通常 K=1 (= primary success) で短絡。
 */
export const pastConeIntersectionWithFrozenFallback = (
  currentWorldLine: WorldLine,
  frozenWorldLines: readonly FrozenWorldLine[],
  playerId: string,
  observerPosition: Vector4,
  torusHalfWidth?: number,
): PhaseSpace | null => {
  const primary = pastLightConeIntersectionWorldLine(
    currentWorldLine,
    observerPosition,
    torusHalfWidth,
  );
  if (primary) return primary;
  for (let i = frozenWorldLines.length - 1; i >= 0; i--) {
    const fw = frozenWorldLines[i];
    if (fw.playerId !== playerId) continue;
    const fallback = pastLightConeIntersectionWorldLine(
      fw.worldLine,
      observerPosition,
      torusHalfWidth,
    );
    if (fallback) return fallback;
  }
  return null;
};
