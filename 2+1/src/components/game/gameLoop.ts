import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  evolvePhaseSpace,
  inverseLorentzBoost,
  lorentzDotVector4,
  multiplyVector4Matrix4,
  pastLightConeIntersectionWorldLine,
  subVector4,
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
  viewMode: "classic" | "shooter" | "jellyfish" = "classic",
  cameraYaw = 0,
): PhysicsResult {
  let forwardAccel = 0;
  let lateralAccel = 0;
  // Thrust 方向は heading に依存しない。WASD は camera basis (画面相対) の純粋な並進。
  // heading は別経路 (矢印キー = processCamera) で旋回し、aim 方向 = 砲身方向として独立。
  // viewMode に関わらず統一の操作系。
  // - 画面 forward (W) = camera basis +x = world (cos cy, sin cy)
  // - 画面 left   (A) = camera basis +y = world (-sin cy, cos cy)
  // 既存の (forwardAccel, lateralAccel, effectiveYaw) 投影機構を流用するために、effectiveYaw
  // を cameraYaw に置き、forward/lateral には camera basis の (sx, sy) をそのまま入れる。
  let sx = 0; // camera basis +x 成分 (画面前方)
  let sy = 0; // camera basis +y 成分 (画面左)
  if (keys.has("w")) sx += 1;
  if (keys.has("s")) sx -= 1;
  if (keys.has("a")) sy += 1;
  if (keys.has("d")) sy -= 1;
  if (touch.thrust !== 0) {
    sx += touch.thrust;
  }
  const mag = Math.sqrt(sx * sx + sy * sy);
  let effectiveYaw = yaw; // default (input direction が無い時) はそのまま (使われない)
  if (mag > 1e-6) {
    const norm = Math.min(1, mag);
    effectiveYaw = cameraYaw; // 投影 basis = camera basis
    forwardAccel = (sx / mag) * norm * PLAYER_ACCELERATION;
    lateralAccel = (sy / mag) * norm * PLAYER_ACCELERATION;
  }
  // viewMode は引数として残すが現在は分岐に使わない (将来分岐したくなった時の hook)。
  void viewMode;

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
    // 新操作系では WASD は heading を変えない (heading は矢印キーで別経路)。
    // ここで入力 yaw をそのまま返すことで useGameLoop の headingYawRef 同期が no-op に。
    newYaw: yaw,
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
    const diff = subVector4(lhNewPs.pos, player.phaseSpace.pos);
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

    const observed = pastLightConeIntersectionWorldLine(player.worldLine, lhNewPs.pos);
    if (!observed) continue;

    const dir = computeInterceptDirection(lhNewPs.pos, observed.pos, observed.u);
    if (!dir) continue;

    const dx = observed.pos.x - lhNewPs.pos.x;
    const dy = observed.pos.y - lhNewPs.pos.y;
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
      const hitPos = findLaserHitPosition(laser, player.worldLine, radius);
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
 * Check if the player is in any other player's future light cone.
 * If so, the player should be frozen to preserve causality.
 * Uses hysteresis: threshold is 2.0 when already frozen, 0 otherwise.
 */
export function checkCausalFreeze(
  players: Map<string, RelativisticPlayer>,
  myId: string,
  me: RelativisticPlayer,
  staleFrozenIds: Set<string>,
  wasFrozen: boolean,
): boolean {
  for (const [id, player] of players) {
    if (id === myId) continue;
    if (player.isDead) continue;
    if (isLighthouse(id)) continue;
    if (staleFrozenIds.has(id)) continue;
    if (player.phaseSpace.pos.t > me.phaseSpace.pos.t) continue;
    const diff = subVector4(player.phaseSpace.pos, me.phaseSpace.pos);
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

