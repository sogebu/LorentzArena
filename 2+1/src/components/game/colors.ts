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
 * プレイヤー ID から決定的に色を生成する純関数。
 *
 * 黄金角 (137.50776°) で hash を色相に写すことで、ID の小さな差を
 * 色環上の大きな差に広げる。saturation/lightness も hash の別ビット
 * から決めるので、2〜4 人程度のプレイヤーなら統計的に十分分離する。
 *
 * すべてのピア（ホスト/クライアント）が同じ関数を呼ぶので、ネットワーク
 * で色を同期する必要がない。過去の `playerColor` メッセージ / `pendingColorsRef` /
 * ホストのブロードキャストはすべてこの純関数に置き換えられた。
 */
export const colorForPlayerId = (id: string): string => {
  const hash = hashString32(id);
  const hue = Math.floor((((hash * 137.50776405) % 360) + 360) % 360);
  const saturation = 80 + ((hash >>> 8) % 17); // 80-96%
  const lightness = 50 + ((hash >>> 16) % 14); // 50-63%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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
