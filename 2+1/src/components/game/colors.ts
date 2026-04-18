// 32bit FNV-1a hash（ID カラー生成用）
const hashString32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * 接続順 index から色を生成する純関数（黄金角方式）。
 *
 * 連続整数 × 黄金角 (137.508°) で hue を割り当てるため、
 * 2 人で 137.5°、3 人で全員 >90° の色相差が保証される。
 *
 * index 0 = ホスト、1 = 最初のクライアント、2 = 次、...
 * 切断しても index は再利用しない（append-only joinRegistry）。
 */
export const colorForJoinOrder = (index: number): string => {
  const hue = Math.floor(((index * 137.50776405) % 360 + 360) % 360);
  return `hsl(${hue}, 85%, 55%)`;
};

/**
 * プレイヤー ID から決定的に色を生成する純関数（フォールバック用）。
 *
 * joinOrder が判明する前（peerList 未受信時）に使用。
 * 黄金角 (137.50776°) で hash を色相に写す。
 */
export const colorForPlayerId = (id: string): string => {
  const hash = hashString32(id);
  const hue = Math.floor((((hash * 137.50776405) % 360) + 360) % 360);
  const saturation = 80 + ((hash >>> 8) % 17); // 80-96%
  const lightness = 50 + ((hash >>> 16) % 14); // 50-63%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

import {
  LASER_LIGHTNESS_BOOST,
  LASER_LIGHTNESS_MAX,
  LASER_SATURATION_BOOST,
} from "./constants";

// プレイヤー色からレーザー色を生成。彩度嵩上げ + 明度ちょい上げで「発光体」
// らしくするが、明度を上げすぎると teal や紫が淡色に潰れて「どの色のレーザー
// だか分からない」ので、LASER_*_BOOST 定数で鮮やかさと明度のバランスを調整可能。
export const getLaserColor = (playerColor: string): string => {
  // HSL形式をパース: hsl(hue, saturation%, lightness%)
  const match = playerColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return playerColor;

  const hue = Number.parseInt(match[1], 10);
  const saturation = Math.min(
    100,
    Number.parseInt(match[2], 10) + LASER_SATURATION_BOOST,
  );
  const lightness = Math.min(
    LASER_LIGHTNESS_MAX,
    Number.parseInt(match[3], 10) + LASER_LIGHTNESS_BOOST,
  );

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};
