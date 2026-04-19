import { DEBRIS_MAX_LAMBDA } from "./constants";
import type { Vector4 } from "../../physics";

export interface PastConeDisplayState {
  /** Body (sphere / tower) の表示位置。observer の past-cone anchor に従って t がシフトする。 */
  anchorPos: Vector4;
  /** Body を描画するか。past-cone がまだ spawn 前、または死亡後 fade 完了で false。 */
  visible: boolean;
  /** Body の 0..1 opacity 乗数。死亡後 past-cone が death event を通過してから DEBRIS_MAX_LAMBDA
   *  かけて 1→0 linearly に減衰。生存中は常に 1。 */
  alpha: number;
  /**
   * 死亡 marker (sphere + ring、"死亡光子が届いた" 一時エフェクト) の alpha。
   *   - null: 描画しない (生存中 / past-cone がまだ death event に届いていない / fade 完了後)
   *   - 0..1: 死亡 event 位置に marker を描画、この alpha を乗算
   * `alpha` との違い: body は past-cone 到達前も「まだ生きて見える」ので alpha=1 で表示される
   * が、marker は past-cone が到達して初めて出現する (= "観測者が死を見た瞬間" のエフェクト)。
   */
  deathMarkerAlpha: number | null;
}

/**
 * 観測者の過去光円錐に anchor されたオブジェクト (= LH / 死亡 player など **world 時空で
 * 静止している event**) の表示状態を返す。解析式:
 *
 *   pastConeT = observer.t - |Δxy|
 *
 * 動いているプレイヤーの past-cone 交差には使えない (worldLine に対する intersection 計算が
 * 必要、SceneContent の `worldLineIntersections` を使う)。死亡 player は wp.pos が death event
 * で freeze するので static event として扱える → この utility が使える。
 *
 * 生存中:
 *   - pastConeT < spawnT: 観測者の過去光円錐がまだ spawn event に届いていない → visible=false
 *     (respawn 直後、距離が遠くて光がまだ届いていない段階)
 *   - pastConeT ≥ spawnT: anchorT = pastConeT (観測者にちょうど見える時刻)、alpha=1
 * 死亡中:
 *   - pastConeT < deathT: まだ死亡光子が届いていない → anchor 追従、alpha=1 (= 観測者に
 *     「まだ生きて見える」相対論的遅延期間)
 *   - pastConeT ∈ [deathT, deathT + DEBRIS_MAX_LAMBDA]: anchor=deathT で freeze、
 *     alpha = 1 - (pastConeT - deathT) / DEBRIS_MAX_LAMBDA で linear fade
 *   - pastConeT > deathT + DEBRIS_MAX_LAMBDA: visible=false (完全消失)
 *
 * observerPos == null (世界系表示): pastCone を使わず常に current world pos で visible、alpha=1。
 */
export function computePastConeDisplayState(
  playerPos: Vector4,
  spawnT: number,
  isDead: boolean,
  observerPos: Vector4 | null,
): PastConeDisplayState {
  if (!observerPos) {
    return {
      anchorPos: playerPos,
      visible: true,
      alpha: 1,
      deathMarkerAlpha: isDead ? 1 : null,
    };
  }

  const dx = playerPos.x - observerPos.x;
  const dy = playerPos.y - observerPos.y;
  const rho = Math.sqrt(dx * dx + dy * dy);
  const pastConeT = observerPos.t - rho;

  let anchorT = playerPos.t;
  let visible = true;
  let alpha = 1;
  let deathMarkerAlpha: number | null = null;

  if (isDead) {
    const elapsedPastDeath = pastConeT - playerPos.t;
    if (elapsedPastDeath > DEBRIS_MAX_LAMBDA) {
      visible = false;
      // past-cone が deathT + DEBRIS_MAX_LAMBDA を超えたら marker も消失
    } else {
      anchorT = Math.min(pastConeT, playerPos.t);
      const elapsed = Math.max(0, elapsedPastDeath);
      alpha = 1 - elapsed / DEBRIS_MAX_LAMBDA;
      // marker は past-cone が death event に到達してから出現 (= 死亡光子到達の瞬間)
      if (elapsedPastDeath >= 0) {
        deathMarkerAlpha = alpha; // body と同じ fade 速度 (共に deathT + DEBRIS_MAX_LAMBDA で消失)
      }
    }
  } else if (pastConeT < spawnT) {
    visible = false;
  } else {
    anchorT = pastConeT;
  }

  return {
    anchorPos: { ...playerPos, t: anchorT },
    visible,
    alpha,
    deathMarkerAlpha,
  };
}
