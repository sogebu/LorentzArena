import type { Vector4 } from "./vector";

/**
 * Toroidal (PBC) topology helpers for the 2+1 arena.
 *
 * State (phaseSpace.pos / worldLine 各点) は **unwrapped 連続値** を source of truth として
 * 保ち、wrap は描画 (`displayPos`) と距離計算 (`minImageDelta1D` / `minImageDelta4`) に閉じ
 * 込める。これで snapshot serialization / worldLine ring buffer / phaseSpace 構造を変えずに
 * PBC topology を実現する。設計詳細は `plans/2026-04-27-pbc-torus.md`。
 *
 * 全 helper は `boundaryMode === "torus"` のときのみ呼ばれることを想定。`open_cylinder` mode
 * では呼び出し側で gate して通常の連続値計算にフォールバックする。
 */

/**
 * 1 軸の最短画像 delta。`d` を `[-L, L)` に折り畳む。
 *
 * 例: L=20、d=22 → -18 (= 22 - 40、 wrap 1 周分)、 d=-22 → 18、 d=5 → 5 (folding 不要)。
 *
 * `d / (2L)` を nearest integer に round して 2L の倍数を引く方式。 浮動小数点誤差は
 * 隣接 image との中点で flicker 可能性あるが、この helper は距離計算 (連続的な値) で
 * 使うので無問題。 cell 番号比較 (`imageCell`) は floor 基準で別実装。
 */
export const minImageDelta1D = (d: number, L: number): number => {
  return d - 2 * L * Math.round(d / (2 * L));
};

/**
 * Vector4 の (x, y) のみ最短画像化、 t/z は不変。
 *
 * 物理進行 (= 4-velocity / proper time) は連続値、 PBC が効くのは空間軸のみ。
 */
export const minImageDelta4 = (a: Vector4, b: Vector4, L: number): Vector4 => {
  return {
    t: a.t - b.t,
    x: minImageDelta1D(a.x - b.x, L),
    y: minImageDelta1D(a.y - b.y, L),
    z: a.z - b.z,
  };
};

/**
 * `a - b` を返す。 `torusHalfWidth` が渡されたら (x, y) を最短画像化、 渡されなければ
 * 通常の連続値 delta。
 *
 * 距離計算 callsite で `subVector4` をこれに置き換える形で torus 対応。 引数 undefined なら
 * open_cylinder mode と等価。
 */
export const subVector4Torus = (
  a: Vector4,
  b: Vector4,
  torusHalfWidth?: number,
): Vector4 => {
  if (torusHalfWidth === undefined) {
    return { t: a.t - b.t, x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }
  return minImageDelta4(a, b, torusHalfWidth);
};

/**
 * boundaryMode を取って `pastLightConeIntersectionWorldLine` 等に渡す `torusHalfWidth`
 * 引数を返す薄い helper。 callsite が boundaryMode === "torus" の判定 + ARENA_HALF_WIDTH
 * 取り出しを毎回書かずに済む。
 *
 * `null` (= open_cylinder) なら undefined、 `'torus'` なら半幅を返す。 callsite で boundaryMode
 * を直接渡すパターンを取る場合に使う (= 利用側で生 boolean / 数値を持つときは不要)。
 */
export const torusHalfWidthOrUndef = (
  boundaryMode: "torus" | "open_cylinder" | null,
  arenaHalfWidth: number,
): number | undefined => {
  return boundaryMode === "torus" ? arenaHalfWidth : undefined;
};

/**
 * `observer` を `reference` と同じ image cell に shift する。 worldLine.ts などの「連続値
 * 前提」の探索関数を変更せずに PBC 対応するための主要 helper。
 *
 * 戦略: 観測者位置を「worldLine 基準点 (通常は最新点) と同じ image」に持ってきてから
 * 既存 helper (`pastLightConeIntersectionWorldLine` 等) を呼ぶ。 worldLine 各点は連続値で
 * 保持されており、 observer を最新点近傍に shift しておけば過去光円錐探索が連続値で正しく
 * 動く。 worldLine 履歴 (~16s) は一周 (~40s) しないので「光が一周回って届く」エッジケースは
 * 発生しない (発生するほど履歴が長くないので無視可)。
 *
 * 例: observer=(0,0)、 reference=(50,0)、 L=20 → 結果 (40,0)。 reference との delta が
 * 最短画像になる位置。
 *
 * `torusHalfWidth === undefined` (= open_cylinder mode) は素通し。
 */
export const shiftObserverToReferenceImage = (
  observer: Vector4,
  reference: Vector4,
  torusHalfWidth?: number,
): Vector4 => {
  if (torusHalfWidth === undefined) return observer;
  const L = torusHalfWidth;
  const dx = reference.x - observer.x;
  const dy = reference.y - observer.y;
  return {
    t: observer.t,
    x: observer.x + (dx - minImageDelta1D(dx, L)),
    y: observer.y + (dy - minImageDelta1D(dy, L)),
    z: observer.z,
  };
};

/**
 * Observer 中心の image cell index。worldLine の wrap 跨ぎ判定に使う。
 *
 * floor 基準なので cell 境界 `(obs ± L)` での round 半分振る舞いが安定 (= 境界跨ぎで
 * cell 番号が flicker しない)。primary cell は `(0, 0)`、 隣接が `(±1, 0)` 等。
 */
export const imageCell = (
  p: { x: number; y: number },
  obs: { x: number; y: number },
  L: number,
): { kx: number; ky: number } => ({
  kx: Math.floor((p.x - obs.x + L) / (2 * L)),
  ky: Math.floor((p.y - obs.y + L) / (2 * L)),
});

/**
 * 観測者中心の primary cell `[obs-L, obs+L)²` に折り畳んだ display position。
 *
 *   displayPos(p) = obs + minImageDelta(p - obs, L)
 *
 * t/z は素通し (空間 wrap のみ)。
 */
export const displayPos = (
  p: Vector4,
  obs: { x: number; y: number },
  L: number,
): Vector4 => {
  const dx = minImageDelta1D(p.x - obs.x, L);
  const dy = minImageDelta1D(p.y - obs.y, L);
  return {
    t: p.t,
    x: obs.x + dx,
    y: obs.y + dy,
    z: p.z,
  };
};

/**
 * Universal cover image cell index。 PBC topology では同じ event が無限の image cell に
 * 複製される (= `(kx, ky) ∈ Z²` で `2L * (kx, ky)` 並進した copy が universal cover に存在)。
 *
 * `(kx, ky) = (0, 0)` を primary image と呼ぶ。 観測者から見える image 集合は spatial 距離 ≤
 * LCH の image (= R = ⌈LCH/(2L)⌉ で決まる) で打ち切れる。
 */
export type ImageCell = { kx: number; ky: number };

/**
 * 観測者から観測可能な image cell の集合。 `(kx, ky) ∈ {-R, ..., R}²` の `(2R+1)²` 個。
 *
 * primary cell `(0, 0)` を必ず先頭に置く (= score double-count 防止のため、 「最初の発火」
 * を primary image で固定する規約)。
 */
export const observableImageCells = (R: number): ImageCell[] => {
  const cells: ImageCell[] = [{ kx: 0, ky: 0 }];
  for (let kx = -R; kx <= R; kx++) {
    for (let ky = -R; ky <= R; ky++) {
      if (kx === 0 && ky === 0) continue;
      cells.push({ kx, ky });
    }
  }
  return cells;
};

/**
 * Image cell key (= `"kx,ky"` 文字列、 JSON serializable)。 Set / Map のキーや
 * `firedImageCells: string[]` 配列の要素として使う。
 */
export const imageCellKey = (cell: ImageCell): string =>
  `${cell.kx},${cell.ky}`;

/**
 * Event の image cell における spatial 位置を計算 (= world coords を `2L * (kx, ky)` 並進)。
 * t / z は素通し (空間 wrap のみ)。
 */
export const eventImage = <T extends { x: number; y: number }>(
  event: T,
  cell: ImageCell,
  L: number,
): T => ({
  ...event,
  x: event.x + 2 * L * cell.kx,
  y: event.y + 2 * L * cell.ky,
});

/**
 * 観測者の過去光円錐 (spatial 半径 LCH) が届く image cell の最大半径 R。
 *
 *   R = ⌈LCH / (2L)⌉
 *
 * 例: LCH = L = 20 → R = ⌈0.5⌉ = 1 (= 3x3 cells で十分)。
 * LCH = 2L → R = 1 で隣接 image が ちょうど境界、 R = 2 にすれば余裕。
 */
export const requiredImageCellRadius = (
  L: number,
  lightConeHeight: number,
): number => Math.ceil(lightConeHeight / (2 * L));

/**
 * worldLine の隣接 2 点間で「画面を横切るような線分」になっているかの判定。
 *
 * OR 結合の 2 軸:
 *
 *   1. **生 unwrapped delta が L 超え** = broadcast 欠落 / frame 落ち / 高速移動の defensive 検出
 *      (1 tick の物理進行は L よりずっと小さいはずなので、 |Δ| > L は異常事態)
 *   2. **observer 中心の image cell が変わった瞬間** = primary cell 境界跨ぎ瞬間の正常検出
 *
 * どちらかが true なら描画上の line break (= LineSegments の対応 segment を skip)。
 * 設計議論は `plans/2026-04-27-pbc-torus.md` の Appendix A。
 */
export const isWrapCrossing = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  obs: { x: number; y: number },
  L: number,
): boolean => {
  // 判定 1: raw delta defensive
  if (Math.abs(p1.x - p0.x) > L) return true;
  if (Math.abs(p1.y - p0.y) > L) return true;
  // 判定 2: observer 中心 cell 比較 (primary 検出)
  const c0 = imageCell(p0, obs, L);
  const c1 = imageCell(p1, obs, L);
  return c0.kx !== c1.kx || c0.ky !== c1.ky;
};
