import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  evolvePhaseSpace,
  lorentzDotVector4,
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
}

export function processPlayerPhysics(
  me: RelativisticPlayer,
  keys: Set<string>,
  touch: { thrust: number },
  yaw: number,
  dTau: number,
  otherPositions: Vector4[],
  availableEnergy: number,
): PhysicsResult {
  let forwardAccel = 0;
  let lateralAccel = 0;

  if (keys.has("w")) forwardAccel += PLAYER_ACCELERATION;
  if (keys.has("s")) forwardAccel -= PLAYER_ACCELERATION;
  if (keys.has("a")) lateralAccel += PLAYER_ACCELERATION;
  if (keys.has("d")) lateralAccel -= PLAYER_ACCELERATION;

  if (touch.thrust !== 0) {
    forwardAccel += PLAYER_ACCELERATION * touch.thrust;
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

  const ax = Math.cos(yaw) * forwardAccel + Math.cos(yaw + Math.PI / 2) * lateralAccel;
  const ay = Math.sin(yaw) * forwardAccel + Math.sin(yaw + Math.PI / 2) * lateralAccel;

  const thrustAcceleration = createVector3(ax, ay, 0);

  const frictionX = -me.phaseSpace.u.x * FRICTION_COEFFICIENT;
  const frictionY = -me.phaseSpace.u.y * FRICTION_COEFFICIENT;

  const acceleration = createVector3(ax + frictionX, ay + frictionY, 0);
  const newPhaseSpace = evolvePhaseSpace(me.phaseSpace, acceleration, dTau);
  const updatedWorldLine = appendWorldLine(me.worldLine, newPhaseSpace, otherPositions);

  return {
    newPhaseSpace,
    updatedWorldLine,
    thrustEnergyConsumed,
    thrustRequested,
    thrustAcceleration,
  };
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
  kills: Array<{
    victimId: string;
    killerId: string;
    hitPos: { t: number; x: number; y: number; z: number };
  }>;
  hitLaserIds: string[];
}

/**
 * Target-authoritative hit detection (Stage B).
 *
 * 各 peer は「自分が owner の player 達」についてのみ hit を判定する。
 * - 人間ピア: 自分自身（ownerId === myId === id）
 * - beacon holder (= 現 host): 自分 + Lighthouse（LH.ownerId = host myId）
 *
 * プラン `plans/2026-04-14-authority-dissolution.md` Stage B 手順 1,4。
 */
export function processHitDetection(
  players: Map<string, RelativisticPlayer>,
  lasers: Laser[],
  myId: string,
  processedIds: Set<string>,
  deadIds: Set<string>,
  invincibleIds: Set<string>,
): HitDetectionResult {
  const kills: HitDetectionResult["kills"] = [];
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
  if (ownedPlayers.length === 0) return { kills, hitLaserIds };

  const killedThisFrame = new Set<string>();
  for (const laser of lasers) {
    if (processedIds.has(laser.id)) continue;

    const laserEndT = laser.emissionPos.t + laser.range;
    if (minOwnedT > laserEndT) {
      processedIds.add(laser.id);
      continue;
    }

    for (const [playerId, player] of ownedPlayers) {
      if (playerId === laser.playerId) continue;
      if (killedThisFrame.has(playerId)) continue;
      if (deadIds.has(playerId)) continue;
      if (invincibleIds.has(playerId)) continue;
      const hitPos = findLaserHitPosition(laser, player.worldLine, HIT_RADIUS);
      if (hitPos) {
        kills.push({ victimId: playerId, killerId: laser.playerId, hitPos });
        hitLaserIds.push(laser.id);
        killedThisFrame.add(playerId);
        break;
      }
    }
  }

  return { kills, hitLaserIds };
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

