import { LARGE_JUMP_THRESHOLD_LS, MAX_FROZEN_WORLDLINES } from "./constants";
import type { FrozenWorldLine, RelativisticPlayer } from "./types";

/**
 * Rule B (= 因果律対称ジャンプ) の λ_exit が「視覚的に gap を作るレベル」 か判定。
 *
 * `lambda >= LARGE_JUMP_THRESHOLD_LS` のとき true (= 旧 worldLine を frozenWorldLines に
 * 凍結し、 新セグメントを 1 点から始めるべき)。 false なら通常の `appendWorldLine` で連続
 * worldLine を維持する。
 *
 * 設計背景: `plans/2026-05-02-causality-symmetric-jump.md` §6 Stage 3 + Stage 5 で、
 * Rule B が hidden 復帰 / 新 join 等の異常 scenario で大 λ jump を出すとき、 旧 WL から
 * 新位置までを直線補間すると tube renderer (CatmullRomCurve3) が「滑らかな嘘」 で 描画して
 * しまう。 概念上は messageHandler の `WORLDLINE_GAP_THRESHOLD_MS` と同種だが、 あちらは
 * 受信側 wall_time gap、 こちらは自機側 coord time jump 量で別 layer。
 */
export const isLargeJump = (lambda: number): boolean =>
  lambda >= LARGE_JUMP_THRESHOLD_LS;

/**
 * 旧 worldLine を frozenWorldLines に push (= 容量上限 `MAX_FROZEN_WORLDLINES` で tail
 * truncate する純関数)。 alive 自機の Rule B 大ジャンプで「過去の観測 worldLine を
 * 保存しつつ新セグメントを開始」 する場面で使う。
 *
 * 既存 messageHandler の inline 実装と同じパターン (= 受信側の gap reset 時)、 こちらは
 * 自機側 Rule B 用に extract した版。 caller (= Stage 5 の useGameLoop alive 自機分岐) は
 * 本関数の戻り値を `setFrozenWorldLines` に流し、 player の worldLine.history を
 * `[newPhaseSpace]` にリセットする (= 後続の append が新セグメント基点になる)。
 *
 * 注意 (= edge case):
 * - `player.worldLine.history.length === 0`: 新規 player で history 未蓄積 → 凍結対象なし
 *   (= no-op、 prev そのまま)。 dead は本関数の対象外 (= caller が isDead 判定で除外)、
 *   ガード重複で防御。
 */
export const pushFrozenWorldLine = (
  prev: readonly FrozenWorldLine[],
  player: RelativisticPlayer,
): readonly FrozenWorldLine[] => {
  if (player.isDead) return prev;
  if (player.worldLine.history.length === 0) return prev;
  const entry: FrozenWorldLine = {
    playerId: player.id,
    worldLine: player.worldLine,
    color: player.color,
  };
  return [...prev, entry].slice(-MAX_FROZEN_WORLDLINES);
};
