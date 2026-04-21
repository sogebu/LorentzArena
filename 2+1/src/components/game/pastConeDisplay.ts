import type { Vector4 } from "../../physics";

export interface PastConeDisplayState {
  /** Body の表示位置。観測者の過去光円錐が player spawn event を通過するまで未来から引っ張られて
   *  追従する (リスポーン遅延の視覚表現)。 */
  anchorPos: Vector4;
  /** Body を描画するか。past-cone がまだ spawn event に届いていない場合 false。 */
  visible: boolean;
}

/**
 * **生存中**プレイヤー (主に LH tower) の past-cone anchor を返す utility。
 *
 * 2026-04-22 refactor: 死亡 event の past-cone 表示は `deathWorldLine.ts` +
 * 各 renderer の τ_0 path に移動。本 utility は「spawn 後の光未到達期」視覚表現のみ。
 *
 *   - `pastConeT = observer.t − ρ`
 *   - `pastConeT < spawnT`: 観測者過去光円錐がまだ spawn event に届いていない → visible=false
 *   - `pastConeT ≥ spawnT`: anchorT = pastConeT (観測者にちょうど見える時刻で body を anchor)
 *
 * `observerPos == null` (世界系表示): pastCone を使わず常に current world pos。
 */
export function computePastConeDisplayState(
  playerPos: Vector4,
  spawnT: number,
  observerPos: Vector4 | null,
): PastConeDisplayState {
  if (!observerPos) {
    return { anchorPos: playerPos, visible: true };
  }

  const dx = playerPos.x - observerPos.x;
  const dy = playerPos.y - observerPos.y;
  const rho = Math.sqrt(dx * dx + dy * dy);
  const pastConeT = observerPos.t - rho;

  if (pastConeT < spawnT) {
    return { anchorPos: playerPos, visible: false };
  }

  return {
    anchorPos: { ...playerPos, t: pastConeT },
    visible: true,
  };
}
