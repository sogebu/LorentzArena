import { imageCell, type Vector4 } from "../../physics";

/**
 * レーザー直線 (emission → tip) を「観測者から見て同じ image cell に収まる line segment」
 * の配列に分割する。 emission と tip が異なる image cell にあるとき、 emission cell の境界で
 * 直線をクリップして 2 segment に分割。 各 segment 内では vertex がすべて同じ image cell に
 * 属するので、 image cell instance の mesh.matrix で `displayMatrix × translate(2L*offset)`
 * に並進された後も画面を横切らない。 (= LaserBatchRenderer の universal cover image 化と
 * 連携)
 *
 * `torusHalfWidth === undefined` (= open_cylinder mode) または `observerPos === null` なら
 * 分割せず emission → tip の単一 segment を返す (= 既存挙動)。
 *
 * 同 image cell の場合も単一 segment。
 *
 * 異なる image cell の場合: emission cell `[obs ± L]` の境界 (= 4 平面のうち、 direction で
 * 出る側) との交点を Liang-Barsky 風 sweep で求めて、 segment 1 = emission → 境界手前 ε、
 * segment 2 = 境界奥 ε → tip。 ε は shader fold が反対 cell に飛ぶ境界 ちょうど (= mod の
 * 連続性失う点) を回避する微小量。 LASER_RANGE が ARENA L より十分小さい前提で、 複数 cell
 * 跨ぎ (= 2 cell 以上) は近似で 2 segment に固定 (= 中間 cell は描画されないが影響軽微)。
 *
 * 詳細: plans/2026-04-27-pbc-torus.md §「レーザー軌跡」 (b) 案
 */

export type LaserSegment = {
  sx: number;
  sy: number;
  st: number;
  ex: number;
  ey: number;
  et: number;
};

const EPSILON = 1e-3;

export const buildLaserSegments = (
  emission: { x: number; y: number; t: number },
  tip: { x: number; y: number; t: number },
  observerPos: Vector4 | null,
  torusHalfWidth: number | undefined,
): LaserSegment[] => {
  const single: LaserSegment = {
    sx: emission.x,
    sy: emission.y,
    st: emission.t,
    ex: tip.x,
    ey: tip.y,
    et: tip.t,
  };
  if (torusHalfWidth === undefined || !observerPos) return [single];

  const L = torusHalfWidth;
  const eCell = imageCell({ x: emission.x, y: emission.y }, observerPos, L);
  const tCell = imageCell({ x: tip.x, y: tip.y }, observerPos, L);
  if (eCell.kx === tCell.kx && eCell.ky === tCell.ky) return [single];

  // emission cell の境界出口 s 値を計算 (Liang-Barsky の sweep を 4 平面に対して min 取る)
  const dx = tip.x - emission.x;
  const dy = tip.y - emission.y;
  const dt = tip.t - emission.t;
  const eCenterX = observerPos.x + 2 * L * eCell.kx;
  const eCenterY = observerPos.y + 2 * L * eCell.ky;

  let sExit = 1;
  if (dx > 0) {
    const s = (eCenterX + L - emission.x) / dx;
    if (s > 0 && s < sExit) sExit = s;
  } else if (dx < 0) {
    const s = (eCenterX - L - emission.x) / dx;
    if (s > 0 && s < sExit) sExit = s;
  }
  if (dy > 0) {
    const s = (eCenterY + L - emission.y) / dy;
    if (s > 0 && s < sExit) sExit = s;
  } else if (dy < 0) {
    const s = (eCenterY - L - emission.y) / dy;
    if (s > 0 && s < sExit) sExit = s;
  }

  // EPSILON は spatial 距離なので、 spatial direction magnitude で割って s 値に変換 (=
  // 境界から spatial 距離 EPSILON 手前 / 奥で segment を切る)
  const dirLen = Math.hypot(dx, dy);
  const sEps = dirLen > 0 ? EPSILON / dirLen : 0;
  const sBefore = Math.max(0, sExit - sEps);
  const sAfter = Math.min(1, sExit + sEps);

  return [
    {
      sx: emission.x,
      sy: emission.y,
      st: emission.t,
      ex: emission.x + sBefore * dx,
      ey: emission.y + sBefore * dy,
      et: emission.t + sBefore * dt,
    },
    {
      sx: emission.x + sAfter * dx,
      sy: emission.y + sAfter * dy,
      st: emission.t + sAfter * dt,
      ex: tip.x,
      ey: tip.y,
      et: tip.t,
    },
  ];
};
