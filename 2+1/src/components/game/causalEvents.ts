import {
  createVector4,
  displayPos,
  type ImageCell,
  imageCellKey,
  isInPastLightCone,
  observableImageCells,
  requiredImageCellRadius,
  type Vector4,
} from "../../physics";
import type { KillEventRecord, PendingSpawnEvent, SpawnEffect } from "./types";

export interface KillEventEffects {
  deathFlash: boolean;
  killNotification: {
    victimId: string;
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null;
}

export interface KillEventsResult {
  /** Indices into the input killLog whose firedForUi/firedImageCells should be updated. */
  firedIndices: number[];
  /** For each fired index, the new firedImageCells array (= union of old + newly fired this tick). */
  firedImageCellsByIndex: Map<number, string[]>;
  newScores: Record<string, number>;
  effects: KillEventEffects;
}

/**
 * 観測者から見える image cells。 PBC torus は `(2R+1)²` 個、 open_cylinder は primary 1 個。
 */
const visibleImageCells = (
  torusHalfWidth: number | undefined,
  R: number,
): ImageCell[] =>
  torusHalfWidth === undefined ? [{ kx: 0, ky: 0 }] : observableImageCells(R);

/**
 * 観測者本人 cell (= cell.kx=0, cell.ky=0 相対) の image を primary と定義。 observer 中心
 * wrap で event を folding した後:
 * - 観測者本人 image (= cell.kx=0) は最短画像距離で wrap 後 event 位置と一致
 * - 必ず最短距離 = 過去光円錐入りも最早 = 9 image loop の first iteration で primary fire
 *
 * Score 加算 / death flash / kill notification は primary fire のみ trigger (= 観測者の主観
 * 1 度の体験)。
 */
const PRIMARY_KEY = "0,0";

/**
 * Fire UI effects for kill events that have just entered the observer's past light cone.
 *
 * **PBC observer-centered wrap pattern**: observer は raw 座標のまま、 event のみ observer
 * 中心で minimum image folding (= `displayPos(event, observer, L)`) → event は observer の
 * primary cell `[obs-L, obs+L)²` に折り畳まれる (= 観測者から最短画像距離の image 位置)。
 * その後、 観測者周りの `(2R+1)²` image cells を loop:
 *
 *   wrappedEv = displayPos(event, observer, L)       // event を observer 中心に最短画像化
 *   imageObserver = observer - 2L*(cell.kx, cell.ky) // observer を逆 shift
 *   isInPastLightCone(wrappedEv, imageObserver)      // 観測者から event image までの距離で判定
 *   imagePos = wrappedEv + 2L*(cell.kx, cell.ky)     // 観測者周りの 9 cells に描画
 *
 * **「観測者は常に (0,0) cell に居る」 設計**: observer 中心 wrap = 観測者中心の primary
 * cell が常に観測者位置を含む = 観測者は universal cover 上常に primary cell に居る。 image
 * cells は観測者本人 cell + 隣接 8 cells で意味が固定 → 観測者が PBC 境界を raw 跨ぎしても
 * 9 image loop の semantics は不変 → 跨ぎ越しの fire 漏れが原理的に発生しない。
 *
 * 各 image が past cone に入ると `firedImageCells` に観測者相対 cell key で append +
 * visual effect。 PRIMARY_KEY="0,0" 一致 (= 観測者本人 image = wrappedEv 自身) で score /
 * death flash / kill notification trigger。
 *
 * `torusHalfWidth === undefined` (open_cylinder) は primary cell 1 つのみ + wrap fold なし
 * = 従来挙動。
 */
export function firePendingKillEvents(
  killLog: KillEventRecord[],
  myPos: Vector4,
  myId: string,
  scores: Record<string, number>,
  torusHalfWidth?: number,
  lightConeHeight?: number,
): KillEventsResult {
  const firedIndices: number[] = [];
  const firedImageCellsByIndex = new Map<number, string[]>();
  const newScores = { ...scores };
  let deathFlash = false;
  let killNotification: KillEventEffects["killNotification"] = null;

  const R =
    torusHalfWidth !== undefined && lightConeHeight !== undefined
      ? requiredImageCellRadius(torusHalfWidth, lightConeHeight)
      : 0;
  const cells = visibleImageCells(torusHalfWidth, R);
  const totalCells = cells.length;
  const L = torusHalfWidth ?? 0;

  for (let i = 0; i < killLog.length; i++) {
    const ev = killLog[i];
    if (ev.firedForUi) continue;
    const evV4 = createVector4(ev.hitPos.t, ev.hitPos.x, ev.hitPos.y, ev.hitPos.z);
    // event を observer 中心 minimum image folding (= 最短画像 image 位置)。
    // open_cylinder では wrap せず raw 座標。
    const wrappedEv =
      torusHalfWidth !== undefined ? displayPos(evV4, myPos, L) : evV4;
    const alreadyFired = new Set(ev.firedImageCells);
    const newlyFired: string[] = [];
    let primaryJustFired = false;
    for (const cell of cells) {
      const key = imageCellKey(cell);
      if (alreadyFired.has(key)) continue;
      const dx = 2 * L * cell.kx;
      const dy = 2 * L * cell.ky;
      // imageObserver = observer raw - 2L*cell shift。 distance = wrappedEv - imageObserver
      // = (wrappedEv - observer) + 2L*cell = 観測者から event の cell-image までの距離。
      const imageObserverV4 = createVector4(
        myPos.t,
        myPos.x - dx,
        myPos.y - dy,
        myPos.z,
      );
      if (isInPastLightCone(wrappedEv, imageObserverV4)) {
        newlyFired.push(key);
        if (key === PRIMARY_KEY) {
          primaryJustFired = true;
          if (ev.victimId === myId) deathFlash = true;
          if (ev.killerId === myId && ev.victimId !== myId) {
            killNotification = {
              victimId: ev.victimId,
              victimName: ev.victimName,
              color: ev.victimColor,
              hitPos: ev.hitPos,
            };
          }
        }
      }
    }
    if (newlyFired.length > 0) {
      firedIndices.push(i);
      const merged = [...ev.firedImageCells, ...newlyFired];
      firedImageCellsByIndex.set(i, merged);
      if (primaryJustFired) {
        newScores[ev.killerId] = (newScores[ev.killerId] || 0) + 1;
      }
      // firedForUi は caller (useGameLoop) で `merged.length >= totalCells` 判定して立てる。
      void totalCells;
    }
  }

  return {
    firedIndices,
    firedImageCellsByIndex,
    newScores,
    effects: { deathFlash, killNotification },
  };
}

export interface SpawnEventsResult {
  firedSpawns: SpawnEffect[];
  remaining: PendingSpawnEvent[];
}

/**
 * Spawn ring fire — kill loop と同じ wrap pattern。 自機 / 他機 / 灯台 すべて対称扱い
 * (= 自分の spawn event も他者と同じく観測者周りの 9 cells に echo 描画)。
 *
 * 各 image が past cone 到達 → spawn ring 1 個発生 (= echo)。 全 image 発火で event 消化
 * (= remaining から外す)。 PRIMARY_KEY 一致時の id は ev.id そのまま (suffix なし)、 他 image
 * は `${ev.id}#${key}` で uniqueness 保証 (overlap しても別 entity 扱い)。
 *
 * `torusHalfWidth === undefined` (open_cylinder) は primary cell 1 つのみ = 従来挙動。
 */
export function firePendingSpawnEvents(
  pending: PendingSpawnEvent[],
  myPos: Vector4,
  fireTime: number,
  players: Map<string, { color: string }>,
  torusHalfWidth?: number,
  lightConeHeight?: number,
): SpawnEventsResult {
  const firedSpawns: SpawnEffect[] = [];
  const remaining: PendingSpawnEvent[] = [];

  const R =
    torusHalfWidth !== undefined && lightConeHeight !== undefined
      ? requiredImageCellRadius(torusHalfWidth, lightConeHeight)
      : 0;
  const cells = visibleImageCells(torusHalfWidth, R);
  const totalCells = cells.length;
  const L = torusHalfWidth ?? 0;

  for (const ev of pending) {
    const evV4 = createVector4(ev.pos.t, ev.pos.x, ev.pos.y, ev.pos.z);
    const wrappedEv =
      torusHalfWidth !== undefined ? displayPos(evV4, myPos, L) : evV4;
    const alreadyFired = new Set(ev.firedImageCells);
    const newlyFired: string[] = [];
    for (const cell of cells) {
      const key = imageCellKey(cell);
      if (alreadyFired.has(key)) continue;
      const dx = 2 * L * cell.kx;
      const dy = 2 * L * cell.ky;
      const imageObserverV4 = createVector4(
        myPos.t,
        myPos.x - dx,
        myPos.y - dy,
        myPos.z,
      );
      if (isInPastLightCone(wrappedEv, imageObserverV4)) {
        newlyFired.push(key);
        const resolvedColor = players.get(ev.playerId)?.color ?? ev.color;
        // 描画位置は observer 中心 wrap 後の event を観測者周りの image cell 位置に shift。
        const imagePos = {
          ...ev.pos,
          x: wrappedEv.x + dx,
          y: wrappedEv.y + dy,
        };
        firedSpawns.push({
          id: key === PRIMARY_KEY ? ev.id : `${ev.id}#${key}`,
          pos: imagePos,
          color: resolvedColor,
          startTime: fireTime,
        });
      }
    }
    const merged = [...ev.firedImageCells, ...newlyFired];
    if (merged.length < totalCells) {
      remaining.push({ ...ev, firedImageCells: merged });
    }
  }

  return { firedSpawns, remaining };
}
