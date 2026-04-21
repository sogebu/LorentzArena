import * as THREE from "three";
import type { Vector4 } from "../../physics";
import { buildMeshMatrix } from "./DisplayFrameContext";

/**
 * Apparent shape matrix (v1 接平面版)。plan `2026-04-21-ship-apparent-shape-pattern.md` 参照。
 *
 * 各 model vertex (x, y, z) を以下に render:
 *
 *   world_pos.xy = anchorPos.spatial + (x, y)
 *   world_pos.t  = anchorPos.t + (x·x_∥.x + y·x_∥.y) + z
 *
 * x_∥ = (観測者 − anchor).spatial の単位ベクトル = anchor から観測者へ向かう方向。
 * xy 断面は O の過去光円錐の **接平面** に載る。厳密な光円錐 (v4) からの誤差は
 * O(r²/ρ) (r = 物体半径、ρ = 観測者-anchor 距離) で、典型 LorentzArena スケール
 * (r ≲ 0.5, ρ ≳ 2) では視覚的に無視可能 (< 1% の時間次元シフト)。
 *
 * 現 LH (u_A = 0 静止、回転対称) のみを想定。ship (u_A ≠ 0) に広げる際は
 * x_∥ を A-rest frame で取る (aberration 補正) + z 列に L(-u_A) を掛ける
 * 拡張が必要。
 *
 * Degenerate (観測者が anchor の真上・真下): x_∥ 未定義 → `buildMeshMatrix` に fallback。
 */
export const buildApparentShapeMatrix = (
  anchorPos: Vector4,
  observerPos: Vector4 | null,
  displayMatrix: THREE.Matrix4,
): THREE.Matrix4 => {
  if (!observerPos) return buildMeshMatrix(anchorPos, displayMatrix);

  const dx = observerPos.x - anchorPos.x;
  const dy = observerPos.y - anchorPos.y;
  const rho2 = dx * dx + dy * dy;
  if (rho2 < 1e-12) return buildMeshMatrix(anchorPos, displayMatrix);

  const invRho = 1 / Math.sqrt(rho2);
  const xParX = dx * invRho;
  const xParY = dy * invRho;

  // M (3×3 linear in (x, y, z) model coords、出力も (x, y, z=t)):
  //   x_out = x
  //   y_out = y
  //   t_out = x_∥.x · x + x_∥.y · y + z
  //
  // THREE.set() は row-major 受け取り、rows = output axes (x, y, z=t)。
  const M = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 1, 0, 0,
    xParX, xParY, 1, 0,
    0, 0, 0, 1,
  );
  const tAnchor = new THREE.Matrix4().makeTranslation(
    anchorPos.x,
    anchorPos.y,
    anchorPos.t,
  );
  const result = new THREE.Matrix4().multiplyMatrices(displayMatrix, tAnchor);
  result.multiply(M);
  return result;
};
