import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  displayPos,
  evolvePhaseSpace,
  inverseLorentzBoost,
  lorentzDotVector4,
  minImageDelta1D,
  multiplyVector4Matrix4,
  pastLightConeIntersectionWorldLine,
  subVector4,
  subVector4Torus,
  vector3Zero,
  type Vector3,
  type Vector4,
} from "../../physics";
import { getLaserColor } from "./colors";
import {
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  CAMERA_PITCH_SPEED,
  CAMERA_YAW_SPEED,
  CAUSAL_FREEZE_HYSTERESIS,
  ENERGY_PER_SHOT,
  FRICTION_COEFFICIENT,
  HIT_RADIUS,
  LASER_COOLDOWN,
  LASER_RANGE,
  LIGHTHOUSE_AIM_JITTER_SIGMA,
  LIGHTHOUSE_FIRE_INTERVAL,
  LIGHTHOUSE_HIT_RADIUS,
  LIGHTHOUSE_SPAWN_GRACE,
  PLAYER_ACCELERATION,
  THRUST_ENERGY_RATE,
} from "./constants";
import { computeInterceptDirection, isLighthouse, perturbDirection } from "./lighthouse";
import { findLaserHitPosition } from "./laserPhysics";
import type { ControlScheme } from "../../stores/game-store";
import type { Laser, RelativisticPlayer } from "./types";

// --- Camera ---

export interface CameraState {
  yaw: number;
  pitch: number;
}

export function processCamera(
  keys: Set<string>,
  touch: { yawDelta: number; pitchDelta: number },
  dTau: number,
  camera: CameraState,
  isDeadForCamera: boolean,
): CameraState {
  let { yaw, pitch } = camera;

  if (keys.has("ArrowLeft")) yaw += CAMERA_YAW_SPEED * dTau;
  if (keys.has("ArrowRight")) yaw -= CAMERA_YAW_SPEED * dTau;
  if (keys.has("ArrowUp")) pitch = Math.min(CAMERA_PITCH_MAX, pitch + CAMERA_PITCH_SPEED * dTau);
  if (keys.has("ArrowDown")) pitch = Math.max(CAMERA_PITCH_MIN, pitch - CAMERA_PITCH_SPEED * dTau);

  if (touch.yawDelta !== 0) {
    yaw += touch.yawDelta;
  }

  // pitch は touch で制御しない (縦スワイプは thrust に固定、死亡中も ghost 物理で
  // 動けるので pitch 回転との衝突を避ける)。PC の矢印キーのみ。
  // isDeadForCamera は旧仕様 (ghost は等速直線移動のみで touch で pitch できる) の
  // 名残で現在未使用だが signature 維持のため引数は残す。
  void isDeadForCamera;

  return { yaw, pitch };
}

// --- Player Physics ---

export interface PhysicsResult {
  newPhaseSpace: ReturnType<typeof createPhaseSpace>;
  updatedWorldLine: ReturnType<typeof appendWorldLine>;
  /** この tick で thrust が消費したエネルギー量（0 以上） */
  thrustEnergyConsumed: number;
  /** この tick で thrust が要求された (キー/タッチが入っていた) か。
   *  エネルギー不足で実効加速が 0 だった場合も true。recovery 判定に使う。 */
  thrustRequested: boolean;
  /** friction を除外した、この tick の thrust 由来 3-acceleration (world coords)。
   *  視覚 (exhaust) 用。energy 枯渇や非入力時はゼロベクトル。
   *  ゆくゆく phaseSpace に共変 α^μ を乗せる段階で boost(u_own) して 4-vector 化予定。 */
  thrustAcceleration: Vector3;
  /**
   * この tick で適用された effective heading yaw。
   * - body-relative (現行): 引数 `yaw` をそのまま返す (yaw 不変)
   * - screen-relative: WASD/touch の入力ベクトルから atan2 で導いた target yaw
   *   (入力なしの場合は引数 `yaw` を維持)
   * 呼び出し側は cameraYawRef.current にこの値を反映する (= heading 同期)。
   */
  newYaw: number;
}

export function processPlayerPhysics(
  me: RelativisticPlayer,
  keys: Set<string>,
  touch: { thrust: number },
  yaw: number,
  dTau: number,
  otherPositions: Vector4[],
  availableEnergy: number,
  controlScheme: ControlScheme = "legacy_classic",
  cameraYaw = 0,
): PhysicsResult {
  let forwardAccel = 0;
  let lateralAccel = 0;
  let effectiveYaw = yaw;
  // newYaw は controlScheme 別に決まる:
  //   legacy_classic / modern → 入力 yaw 不変 (heading は矢印キー = processCamera で別経路)
  //   legacy_shooter        → WASD 入力ベクトルから atan2 + cameraYaw で即時スナップ
  let newYaw = yaw;

  if (controlScheme === "legacy_classic") {
    // 機体相対 thrust。yaw を基底として forward (W/S) + lateral (A/D)。本体ごと
    // heading に向いて回るので nozzle は heading basis、本体描画側で yaw 変換。
    if (keys.has("w")) forwardAccel += PLAYER_ACCELERATION;
    if (keys.has("s")) forwardAccel -= PLAYER_ACCELERATION;
    if (keys.has("a")) lateralAccel += PLAYER_ACCELERATION;
    if (keys.has("d")) lateralAccel -= PLAYER_ACCELERATION;
    if (touch.thrust !== 0) {
      forwardAccel += PLAYER_ACCELERATION * touch.thrust;
    }
    // effectiveYaw = yaw のまま (入力 yaw 基底に投影)。
  } else if (controlScheme === "legacy_shooter") {
    // Twin-stick: WASD = camera basis での進みたい方向 → heading 即時スナップ。
    let sx = 0; // camera basis +x (画面前方)
    let sy = 0; // camera basis +y (画面左)
    if (keys.has("w")) sx += 1;
    if (keys.has("s")) sx -= 1;
    if (keys.has("a")) sy += 1;
    if (keys.has("d")) sy -= 1;
    if (touch.thrust !== 0) {
      sx += touch.thrust;
    }
    const mag = Math.sqrt(sx * sx + sy * sy);
    if (mag > 1e-6) {
      const norm = Math.min(1, mag);
      effectiveYaw = Math.atan2(sy, sx) + cameraYaw;
      newYaw = effectiveYaw;
      forwardAccel = norm * PLAYER_ACCELERATION;
      lateralAccel = 0;
    }
  } else {
    // modern: WASD = camera basis (cameraYaw=0 前提) thrust。heading は別軸 (矢印 ←/→)。
    let sx = 0;
    let sy = 0;
    if (keys.has("w")) sx += 1;
    if (keys.has("s")) sx -= 1;
    if (keys.has("a")) sy += 1;
    if (keys.has("d")) sy -= 1;
    if (touch.thrust !== 0) {
      sx += touch.thrust;
    }
    const mag = Math.sqrt(sx * sx + sy * sy);
    if (mag > 1e-6) {
      const norm = Math.min(1, mag);
      effectiveYaw = cameraYaw; // 投影 basis = camera basis
      forwardAccel = (sx / mag) * norm * PLAYER_ACCELERATION;
      lateralAccel = (sy / mag) * norm * PLAYER_ACCELERATION;
    }
  }

  const rawLen = Math.sqrt(forwardAccel * forwardAccel + lateralAccel * lateralAccel);
  if (rawLen > PLAYER_ACCELERATION) {
    forwardAccel *= PLAYER_ACCELERATION / rawLen;
    lateralAccel *= PLAYER_ACCELERATION / rawLen;
  }

  // Thrust energy: 使用率 (|a| / PLAYER_ACCELERATION) に比例して消費。
  // エネルギー不足時は賄える分だけスケールして適用、残りはカット。
  const thrustRequested = rawLen > 0;
  const thrustFrac = Math.min(1, rawLen / PLAYER_ACCELERATION);
  const requiredEnergy = THRUST_ENERGY_RATE * thrustFrac * dTau;
  let scale = 1;
  let thrustEnergyConsumed = 0;
  if (thrustRequested) {
    if (availableEnergy <= 0) {
      scale = 0;
    } else if (requiredEnergy > availableEnergy) {
      scale = availableEnergy / requiredEnergy;
      thrustEnergyConsumed = availableEnergy;
    } else {
      thrustEnergyConsumed = requiredEnergy;
    }
    forwardAccel *= scale;
    lateralAccel *= scale;
  }

  const ax = Math.cos(effectiveYaw) * forwardAccel + Math.cos(effectiveYaw + Math.PI / 2) * lateralAccel;
  const ay = Math.sin(effectiveYaw) * forwardAccel + Math.sin(effectiveYaw + Math.PI / 2) * lateralAccel;

  const thrustAcceleration = createVector3(ax, ay, 0);

  const frictionX = -me.phaseSpace.u.x * FRICTION_COEFFICIENT;
  const frictionY = -me.phaseSpace.u.y * FRICTION_COEFFICIENT;

  const acceleration = createVector3(ax + frictionX, ay + frictionY, 0);
  const evolved = evolvePhaseSpace(me.phaseSpace, acceleration, dTau);

  // phaseSpace.alpha は **表示専用** (噴射炎強度 / 加速度矢印 / 他 peer への broadcast)。
  // 物理進行 (位置 / 4-velocity 更新) には evolvePhaseSpace 内部の `acceleration` 引数のみ
  // 使われ、戻り値の alpha は overwrite しても物理に影響しない。
  //
  // evolvePhaseSpace は (thrust + friction) を rest-frame proper acceleration とみなして
  // boost し world-frame 4-加速度 (alpha) を格納するが、friction を含めると静止漂流時に
  // 矢印が反転して見えるのが不自然 → **同じ boost 操作を thrust のみで通した値**で上書き。
  // 新たな計算は無く、(0, ax, ay, 0) を inverseLorentzBoost(u) で world-frame に持って
  // いくだけ ((ax, ay) は thrust 由来の rest-frame proper accel として既に gameLoop 前段
  // で算出済)。
  const thrustAccel4Rest = createVector4(0, ax, ay, 0);
  const boost = inverseLorentzBoost(me.phaseSpace.u);
  const thrustAlpha4 = multiplyVector4Matrix4(boost, thrustAccel4Rest);
  const newPhaseSpace = { ...evolved, alpha: thrustAlpha4 };

  const updatedWorldLine = appendWorldLine(me.worldLine, newPhaseSpace, otherPositions);

  return {
    newPhaseSpace,
    updatedWorldLine,
    thrustEnergyConsumed,
    thrustRequested,
    thrustAcceleration,
    newYaw,
  };
}

/**
 * タブ hidden 復帰時の ballistic catchup。thrust 入力なしで friction のみ適用し、
 * phaseSpace を sub-step で前進させる。
 *
 * 目的: hidden 中は game loop が tick しないため、単純に `lastTimeRef` を fresh に
 * 保つ従来実装だと自 pos.t が他 peer と drift する (= 症状 5 と同系の副作用)。
 * hidden も「プレイヤーは coast (操縦入力なし) していた」として pos.t・u・x を
 * 連続に進めることで universal wall-clock と自 proper time が乖離しない。
 *
 * sub-step 幅 `STEP = 0.1s` は通常 tick の skip 閾値 (0.2s) より小さく、friction の
 * 数値安定性 (FRICTION_COEFFICIENT = 0.5 → 時間定数 2s、STEP*FRICTION < 0.05 で線形
 * 近似誤差 < 0.1%) を確保。worldLine は呼び出し側が freeze + 1 点 reset で clean に
 * 連続化させる (渡さない、返さない)。
 *
 * 非常に長い hidden (例えば > 数時間) でも while ループは O(N) で完結する
 * (N=1 時間 ≈ 36000 iterations、JS 実行時間 < 50ms 想定)。上限指定は現状なし。
 */
export function ballisticCatchupPhaseSpace(
  ps: ReturnType<typeof createPhaseSpace>,
  totalDTau: number,
): ReturnType<typeof createPhaseSpace> {
  const STEP = 0.1;
  let current = ps;
  let remaining = totalDTau;
  while (remaining > 1e-6) {
    const step = Math.min(STEP, remaining);
    const friction = createVector3(
      -current.u.x * FRICTION_COEFFICIENT,
      -current.u.y * FRICTION_COEFFICIENT,
      0,
    );
    current = evolvePhaseSpace(current, friction, step);
    remaining -= step;
  }
  return current;
}

// --- Lighthouse AI ---

export interface LighthouseResult {
  newPs: ReturnType<typeof createPhaseSpace>;
  newWl: ReturnType<typeof appendWorldLine>;
  laser: Laser | null;
}

export function processLighthouseAI(
  players: Map<string, RelativisticPlayer>,
  lhId: string,
  lh: RelativisticPlayer,
  dTau: number,
  currentTime: number,
  lastFireMap: Map<string, number>,
  spawnTimeMap: Map<string, number>,
  torusHalfWidth?: number,
): LighthouseResult {
  // 死亡中 LH は呼び出し側 (useGameLoop) で既に continue されているため、ここには
  // alive な LH しか来ない。死亡中 LH の phaseSpace.pos.t は死亡時刻で固定されており、
  // 他の死亡プレイヤーと対称的に扱われる (DESIGN.md §物理「スポーン座標時刻」原則 2)。
  let lhNewPs = evolvePhaseSpace(lh.phaseSpace, vector3Zero(), dTau);

  // 因果律ジャンプ: 灯台が誰かの過去光円錐内に落ちたら、
  // 一番過去にいる生存プレイヤーの座標時間までジャンプして因果律を保つ
  let needsJump = false;
  let minPlayerT = Number.POSITIVE_INFINITY;
  for (const [pId, player] of players) {
    if (isLighthouse(pId)) continue;
    if (player.isDead) continue;
    minPlayerT = Math.min(minPlayerT, player.phaseSpace.pos.t);
    if (player.phaseSpace.pos.t <= lhNewPs.pos.t) continue;
    const diff = subVector4Torus(lhNewPs.pos, player.phaseSpace.pos, torusHalfWidth);
    const l = lorentzDotVector4(diff, diff);
    if (l < 0) {
      needsJump = true;
    }
  }
  if (needsJump && minPlayerT > lhNewPs.pos.t) {
    lhNewPs = createPhaseSpace(
      createVector4(minPlayerT, lhNewPs.pos.x, lhNewPs.pos.y, 0),
      vector3Zero(),
    );
  }

  const lhNewWl = appendWorldLine(lh.worldLine, lhNewPs);

  // Grace period after spawn
  const spawnTime = spawnTimeMap.get(lhId) ?? 0;
  if (currentTime - spawnTime < LIGHTHOUSE_SPAWN_GRACE) {
    return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
  }

  // Fire interval check
  const lastFire = lastFireMap.get(lhId) ?? 0;
  if (currentTime - lastFire < LIGHTHOUSE_FIRE_INTERVAL) {
    return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
  }

  // Find best target
  let bestDir: { x: number; y: number; z: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const [pId, player] of players) {
    if (isLighthouse(pId)) continue;
    if (player.isDead) continue;

    const observed = pastLightConeIntersectionWorldLine(
      player.worldLine,
      lhNewPs.pos,
      torusHalfWidth,
    );
    if (!observed) continue;

    const dir = computeInterceptDirection(
      lhNewPs.pos,
      observed.pos,
      observed.u,
      torusHalfWidth,
    );
    if (!dir) continue;

    // 最短画像距離で「最近い enemy」を選ぶ (torus mode で境界跨ぎ相手を最短画像として扱う)
    const dx =
      torusHalfWidth !== undefined
        ? minImageDelta1D(observed.pos.x - lhNewPs.pos.x, torusHalfWidth)
        : observed.pos.x - lhNewPs.pos.x;
    const dy =
      torusHalfWidth !== undefined
        ? minImageDelta1D(observed.pos.y - lhNewPs.pos.y, torusHalfWidth)
        : observed.pos.y - lhNewPs.pos.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }

  if (!bestDir) {
    return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
  }

  const aimDir = perturbDirection(bestDir, LIGHTHOUSE_AIM_JITTER_SIGMA);

  const laser: Laser = {
    id: `${lhId}-${currentTime}`,
    playerId: lhId,
    emissionPos: {
      t: lhNewPs.pos.t,
      x: lhNewPs.pos.x,
      y: lhNewPs.pos.y,
      z: 0,
    },
    direction: aimDir,
    range: LASER_RANGE,
    color: getLaserColor(lh.color),
  };

  return { newPs: lhNewPs, newWl: lhNewWl, laser };
}

// --- Hit Detection ---

export interface HitDetectionResult {
  hits: Array<{
    victimId: string;
    killerId: string;
    hitPos: { t: number; x: number; y: number; z: number };
    /** Laser 3-direction (unit, c=1)。hit debris 散らし方向の計算用。 */
    laserDir: { x: number; y: number; z: number };
  }>;
  hitLaserIds: string[];
}

/**
 * Target-authoritative hit detection (Stage B + Phase C1).
 *
 * 各 peer は「自分が owner の player 達」についてのみ hit を判定する。
 * - 人間ピア: 自分自身（ownerId === myId === id）
 * - beacon holder (= 現 host): 自分 + Lighthouse（LH.ownerId = host myId）
 *
 * Phase C1: kill 直行ではなく hit events を返す。致命判定 (energy < 0) は
 * handleDamage で行う。同 laser が 1 player に複数 hit する事故は防ぐ
 * (最初の 1 発で break) が、同 frame に別 laser で同 player を複数 hit
 * する場合は全て emit され、handleDamage 側の i-frame で実 damage が
 * 0 クランプされる。
 */
export function processHitDetection(
  players: Map<string, RelativisticPlayer>,
  lasers: Laser[],
  myId: string,
  processedIds: Set<string>,
  deadIds: Set<string>,
  invincibleIds: Set<string>,
  torusHalfWidth?: number,
): HitDetectionResult {
  const hits: HitDetectionResult["hits"] = [];
  const hitLaserIds: string[] = [];

  // Owner が自分のプレイヤーだけを候補に。
  const ownedPlayers: Array<[string, RelativisticPlayer]> = [];
  let minOwnedT = Number.POSITIVE_INFINITY;
  for (const [id, player] of players) {
    if (player.ownerId !== myId) continue;
    ownedPlayers.push([id, player]);
    if (player.phaseSpace.pos.t < minOwnedT) {
      minOwnedT = player.phaseSpace.pos.t;
    }
  }
  if (ownedPlayers.length === 0) return { hits, hitLaserIds };

  // 同 frame での重複 hit を防ぐ (一人の victim に複数 laser が当たっても 1 発のみ
  // emit)。cross-frame の重複は handleDamage 側の post-hit i-frame で弾く。
  const hitThisFrame = new Set<string>();
  for (const laser of lasers) {
    if (processedIds.has(laser.id)) continue;

    const laserEndT = laser.emissionPos.t + laser.range;
    if (minOwnedT > laserEndT) {
      processedIds.add(laser.id);
      continue;
    }

    for (const [playerId, player] of ownedPlayers) {
      if (playerId === laser.playerId) continue;
      if (hitThisFrame.has(playerId)) continue;
      if (deadIds.has(playerId)) continue;
      if (invincibleIds.has(playerId)) continue;
      const radius = isLighthouse(playerId) ? LIGHTHOUSE_HIT_RADIUS : HIT_RADIUS;
      const hitPos = findLaserHitPosition(laser, player.worldLine, radius, torusHalfWidth);
      if (hitPos) {
        hits.push({
          victimId: playerId,
          killerId: laser.playerId,
          hitPos,
          laserDir: laser.direction,
        });
        hitLaserIds.push(laser.id);
        hitThisFrame.add(playerId);
        break;
      }
    }
  }

  return { hits, hitLaserIds };
}

// --- Causality Guard ---

/**
 * Causality 判定の wrap origin。 PBC torus universe では「実体は (0,0) cell に閉じる、
 * universal cover の他 image cells はその描画コピー」 (= odakin 設計思想) を尊重し、
 * 観測者 / 他機 raw 位置を独立に (0,0) cell の primary domain `[-L, L)²` に折り畳んで
 * から fundamental domain 内の Lorentz interval で因果律判定する。
 *
 * 旧実装 (`subVector4Torus` = 観測者中心 minimum image) は 「universal cover 上の他機の
 * 最も近い image との距離」 で判定するため、 観測者の PBC 境界跨ぎで minimum image cell
 * が切り替わる瞬間に距離が discontinuous jump → freeze 誤発動 → thrust skip → 「跨ぎ後
 * 燃料減らない」 bug の原因だった (2026-04-28)。 (0,0) wrap pattern では universal cover
 * image を判定対象から外し、 fundamental domain の本物 1 個の他機との関係のみで判定。
 *
 * 跨ぎ瞬間の distance jump は (0,0) wrap でも起き得る (= 観測者 raw cell が変わると
 * wrap 後位置が discontinuous) が、 jump 量が常に minimum image より小さく発動頻度減少 +
 * 既存 `CAUSAL_FREEZE_HYSTERESIS` で flicker は実用上抑制。
 */
const FREEZE_ORIGIN = { x: 0, y: 0 } as const;

/**
 * Freeze 判定で「最近 update があった他機のみ対象」 にする閾値 (= ms)。 staleFrozen が立つ
 * 5 秒よりずっと早く skip することで、 「タブ非表示 / network jitter で短期的に phaseSpace
 * が止まった他機」 が freeze cause にならないようにする。
 *
 * 1.5 秒の根拠: 通常 game flow の jitter (= 〜0.5-1 秒沈黙) は許容、 1.5 秒以上沈黙なら
 * 「動いてない player」 として freeze 判定対象外。 staleFrozen (5s) との中間。
 */
const FREEZE_RECENT_UPDATE_MS = 1500;

/**
 * Check if the player is in any other player's future light cone.
 * If so, the player should be frozen to preserve causality.
 * Uses hysteresis: threshold is 2.0 when already frozen, 0 otherwise.
 *
 * **PBC**: 観測者 / 他機 を `displayPos(_, FREEZE_ORIGIN, L)` で (0,0) cell に折り畳んで
 * から `subVector4` (= unwrapped 距離) で判定。 詳細は `FREEZE_ORIGIN` の docstring。
 *
 * **Skip 対象**: 自機 / dead / Lighthouse / staleFrozen 既存に加え、 `lastUpdateTime` と
 * `currentWallTime` が渡されたら「最終 phaseSpace 受信から `FREEZE_RECENT_UPDATE_MS` 以上
 * 経過した他機」 も skip。 これは staleFrozen (5s) より早く skip することで、 落ちた直後 〜
 * stale 認定までの sub-grace で freeze cause になるのを防ぐ。
 */
export function checkCausalFreeze(
  players: Map<string, RelativisticPlayer>,
  myId: string,
  me: RelativisticPlayer,
  staleFrozenIds: Set<string>,
  wasFrozen: boolean,
  torusHalfWidth?: number,
  lastUpdateTime?: Map<string, number>,
  currentWallTime?: number,
): boolean {
  const wrappedMe =
    torusHalfWidth !== undefined
      ? displayPos(me.phaseSpace.pos, FREEZE_ORIGIN, torusHalfWidth)
      : me.phaseSpace.pos;
  for (const [id, player] of players) {
    if (id === myId) continue;
    if (player.isDead) continue;
    if (isLighthouse(id)) continue;
    if (staleFrozenIds.has(id)) continue;
    if (player.phaseSpace.pos.t > me.phaseSpace.pos.t) continue;
    if (lastUpdateTime && currentWallTime !== undefined) {
      const lastUpdate = lastUpdateTime.get(id);
      if (
        lastUpdate !== undefined &&
        currentWallTime - lastUpdate > FREEZE_RECENT_UPDATE_MS
      ) {
        continue;
      }
    }
    const wrappedPlayer =
      torusHalfWidth !== undefined
        ? displayPos(player.phaseSpace.pos, FREEZE_ORIGIN, torusHalfWidth)
        : player.phaseSpace.pos;
    const diff = subVector4(wrappedPlayer, wrappedMe);
    const l = lorentzDotVector4(diff, diff);
    const threshold = wasFrozen ? CAUSAL_FREEZE_HYSTERESIS : 0;
    if (l < -threshold) {
      return true;
    }
  }
  return false;
}

// --- Laser Firing ---

export interface LaserFiringResult {
  laser: Laser | null;
  newEnergy: number;
  fired: boolean;
}

/**
 * Create a laser if conditions are met (energy, cooldown, alive).
 * Returns the laser to add and updated energy. Network send is caller's responsibility.
 */
export function processLaserFiring(
  myPlayer: RelativisticPlayer,
  myId: string,
  cameraYaw: number,
  currentTime: number,
  energy: number,
  lastLaserTime: number,
  wantsFire: boolean,
): LaserFiringResult {
  if (
    !wantsFire ||
    energy < ENERGY_PER_SHOT ||
    currentTime - lastLaserTime <= LASER_COOLDOWN
  ) {
    return { laser: null, newEnergy: energy, fired: false };
  }

  const dx = Math.cos(cameraYaw);
  const dy = Math.sin(cameraYaw);
  const laser: Laser = {
    id: `${myId}-${currentTime}`,
    playerId: myId,
    emissionPos: {
      t: myPlayer.phaseSpace.pos.t,
      x: myPlayer.phaseSpace.pos.x,
      y: myPlayer.phaseSpace.pos.y,
      z: 0,
    },
    direction: { x: dx, y: dy, z: 0 },
    range: LASER_RANGE,
    color: getLaserColor(myPlayer.color),
  };

  return { laser, newEnergy: energy - ENERGY_PER_SHOT, fired: true };
}

