import type { RelativisticPlayer } from "./types";

// 32bit FNV-1a hash（IDカラー生成用）
const hashString32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

// HSL文字列から色相を抽出
const extractHue = (hsl: string): number | null => {
  const match = hsl.match(/hsl\((\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
};

// 既存プレイヤーの色と最も区別しやすい色を選ぶ
export const pickDistinctColor = (
  id: string,
  existingPlayers: Map<string, RelativisticPlayer>,
): string => {
  const existingHues: number[] = [];
  for (const [pid, player] of existingPlayers) {
    if (pid === id) continue;
    const h = extractHue(player.color);
    if (h !== null) existingHues.push(h);
  }

  const hash = hashString32(id);
  const saturation = 80 + ((hash >> 8) % 17); // 80-96%
  const lightness = 50 + ((hash >> 16) % 14); // 50-63%

  if (existingHues.length === 0) {
    // 最初のプレイヤーはIDから決定
    const hue = Math.floor(((hash * 137.50776405) % 360 + 360) % 360);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  // 色相環上で既存色から最も遠い色相を探す
  // 候補を36点（10°刻み）でサンプルし、最小距離が最大のものを選ぶ
  let bestHue = 0;
  let bestMinDist = -1;
  for (let candidate = 0; candidate < 360; candidate += 10) {
    let minDist = 360;
    for (const h of existingHues) {
      const d = Math.min(Math.abs(candidate - h), 360 - Math.abs(candidate - h));
      if (d < minDist) minDist = d;
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestHue = candidate;
    }
  }

  return `hsl(${bestHue}, ${saturation}%, ${lightness}%)`;
};

// プレイヤーの色からレーザーの色を生成（より明るく、彩度を上げる）
export const getLaserColor = (playerColor: string): string => {
  // HSL形式をパース: hsl(hue, saturation%, lightness%)
  const match = playerColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return playerColor;

  const hue = Number.parseInt(match[1], 10);
  const saturation = Math.min(100, Number.parseInt(match[2], 10) + 10); // 彩度を上げる
  const lightness = Math.min(90, Number.parseInt(match[3], 10) + 25); // 明度を上げて明るく

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};
