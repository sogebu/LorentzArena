import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createVector4,
  futureLightConeIntersectionWorldLine,
  lorentzBoost,
  pastLightConeIntersectionWorldLine,
  type Vector3,
  type Vector4,
} from "../../physics";
import { selectInvincibleUntil, useGameStore } from "../../stores/game-store";
import { ArenaRenderer } from "./ArenaRenderer";
import { DebrisRenderer } from "./DebrisRenderer";
import { LaserBatchRenderer } from "./LaserBatchRenderer";
import { LightConeRenderer } from "./LightConeRenderer";
import { LighthouseRenderer } from "./LighthouseRenderer";
import { isLighthouse } from "./lighthouse";
import { SpawnRenderer } from "./SpawnRenderer";
import { StardustRenderer } from "./StardustRenderer";
import { WorldLineRenderer } from "./WorldLineRenderer";
import {
  AIM_ARROW_BASE_OPACITY,
  AIM_ARROW_OPACITY_STEP,
  ARROW_BASE_LENGTH,
  ARROW_BASE_OFFSET,
  ARROW_BASE_WIDTH,
  ARROW_COLOR,
  ARROW_MAX_OPACITY,
  CAMERA_DISTANCE_ORTHOGRAPHIC,
  CAMERA_DISTANCE_PERSPECTIVE,
  EXHAUST_ATTACK_TIME,
  EXHAUST_BASE_LENGTH,
  EXHAUST_BASE_RADIUS,
  EXHAUST_INNER_COLOR,
  EXHAUST_MAX_OPACITY,
  EXHAUST_OFFSET,
  EXHAUST_OUTER_COLOR,
  EXHAUST_RADIUS_MIN_SCALE,
  EXHAUST_RELEASE_TIME,
  EXHAUST_VISIBILITY_THRESHOLD,
  FUTURE_CONE_LASER_TRIANGLE_OPACITY,
  FUTURE_CONE_WORLDLINE_RING_OPACITY,
  FUTURE_CONE_WORLDLINE_SPHERE_OPACITY,
  KILL_NOTIFICATION_RING_OPACITY,
  KILL_NOTIFICATION_SPHERE_OPACITY,
  LIGHTHOUSE_WORLDLINE_OPACITY,
  PAST_CONE_WORLDLINE_RING_OPACITY,
  PLAYER_ACCELERATION,
  PLAYER_MARKER_GLOW_OPACITY_OTHER,
  PLAYER_MARKER_GLOW_OPACITY_SELF,
  PLAYER_MARKER_MAIN_OPACITY_OTHER,
  PLAYER_MARKER_MAIN_OPACITY_SELF,
  PLAYER_MARKER_SIZE_OTHER,
  PLAYER_MARKER_SIZE_SELF,
} from "./constants";
import {
  buildDisplayMatrix,
  transformEventForDisplay,
} from "./displayTransform";
import { buildMeshMatrix, DisplayFrameProvider } from "./DisplayFrameContext";
import { futureLightConeIntersectionLaser, pastLightConeIntersectionLaser } from "./laserPhysics";
import {
  getThreeColor,
  sharedGeometries,
} from "./threeCache";
import type { Laser } from "./types";

/**
 * 交点 `eventPos` (world frame) における光円錐接平面の **world frame rotation matrix** を返す。
 * 三角形ジオメトリは local xy 平面、tip=+x、法線=+z。観測者 `obsPos` と event の world 相対位置
 * から接平面を導出するので過去/未来両方、rest frame 表示中でも世界系表示でも同じ式で動く。
 *
 * 数式: Δ = event - observer。ρ = |Δ_xy|、n = (Δx, Δy, -Δt) / √(ρ² + Δt²)。
 * laser direction を接平面に射影して u、v = n × u。
 */
const computeConeTangentWorldRotation = (
  eventPos: { x: number; y: number; t: number },
  obsPos: { x: number; y: number; t: number },
  laserDir: { x: number; y: number; z: number },
): THREE.Matrix4 | null => {
  const dx = eventPos.x - obsPos.x;
  const dy = eventPos.y - obsPos.y;
  const dt = eventPos.t - obsPos.t;
  const rho2 = dx * dx + dy * dy;
  if (rho2 < 1e-12) return null;
  const denom = Math.sqrt(rho2 + dt * dt); // ρ√2 on the cone
  if (denom < 1e-12) return null;
  const nx = dx / denom;
  const ny = dy / denom;
  const nt = -dt / denom;
  // Project laser direction onto the tangent plane (laser has no t-component)
  const ldotN = laserDir.x * nx + laserDir.y * ny;
  let ux = laserDir.x - ldotN * nx;
  let uy = laserDir.y - ldotN * ny;
  let ut = -ldotN * nt;
  const ulen = Math.sqrt(ux * ux + uy * uy + ut * ut);
  if (ulen < 1e-9) return null;
  ux /= ulen; uy /= ulen; ut /= ulen;
  // v = n × u
  const vx = ny * ut - nt * uy;
  const vy = nt * ux - nx * ut;
  const vt = nx * uy - ny * ux;
  // Local (x, y, z) → world (u, v, n). Three.js maps local z ↔ world t.
  return new THREE.Matrix4().set(
    ux, vx, nx, 0,
    uy, vy, ny, 0,
    ut, vt, nt, 0,
    0, 0, 0, 1,
  );
};

/**
 * Exhaust cone: 自機の thrust 加速度の逆方向 (反推力) に cone を 2 層描画。
 *
 * - **v0: C pattern (rest-frame 固定)**。自機球と同じ display 座標系で並進のみ、
 *   displayMatrix の boost 効果は `transformEventForDisplay` で既に自機 position に
 *   適用済み (dp 経由)。自機 rest-frame view では自機が原点に来て、cone も rest-frame
 *   の -accel 方向にまっすぐ真後ろ。world-frame view では Lorentz 収縮なしの
 *   剛体 exhaust になる (視覚簡略化、物理精密版は D pattern + 共変 α へ上位化予定)。
 *   EXPLORING.md §進行方向・向きの認知支援 §「(3) exhaust の visual-only vs 物理放出」。
 * - **2 層 cone**: 外側=プレイヤー色 (広がった炎)、内側=白 (白熱コア、細め・短め)。
 *   MeshBasicMaterial + additive blending で「固体の三角錐」でなく「発光する炎」に。
 * - **magnitude EMA smoothing** (attack 60ms / release 180ms)。PC の binary 入力でも
 *   点滅せず、mobile の連続値でもほぼ即時。方向は smoothing しない (入力との対応保持)。
 * - energy 枯渇時は `thrustAccel` がゼロになるので自動非表示。
 *
 * 詳細は DESIGN.md §描画「exhaust」。
 */
const INNER_CORE_SCALE = 0.45; // 内側 core cone の radius / length 共通倍率

const ExhaustCone = ({
  player,
  thrustAccelRef,
  observerPos,
  observerBoost,
}: {
  player: {
    phaseSpace: { pos: Vector4 };
  };
  thrustAccelRef: React.RefObject<Vector3>;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const outerMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const innerMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const smoothedMagRef = useRef(0);
  const outerColor = getThreeColor(EXHAUST_OUTER_COLOR);
  const innerColor = getThreeColor(EXHAUST_INNER_COLOR);

  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const vecY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const vecDir = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    const outerMat = outerMatRef.current;
    const innerMat = innerMatRef.current;
    if (!outer || !inner || !outerMat || !innerMat) return;

    const accel = thrustAccelRef.current;
    const norm = Math.hypot(accel.x, accel.y);
    const rawTarget = Math.min(1, norm / PLAYER_ACCELERATION);

    const current = smoothedMagRef.current;
    const tauMs = rawTarget > current ? EXHAUST_ATTACK_TIME : EXHAUST_RELEASE_TIME;
    const rate = 1 - Math.exp(-(delta * 1000) / tauMs);
    const smoothed = current + (rawTarget - current) * rate;
    smoothedMagRef.current = smoothed;

    if (smoothed < EXHAUST_VISIBILITY_THRESHOLD || norm < 1e-6) {
      outer.visible = false;
      inner.visible = false;
      return;
    }
    outer.visible = true;
    inner.visible = true;

    // 反推力方向 = rest-frame -accel を正規化 (display 座標と同じ basis で使用)
    const dirX = -accel.x / norm;
    const dirY = -accel.y / norm;
    vecDir.set(dirX, dirY, 0);
    tmpQuat.setFromUnitVectors(vecY, vecDir);

    // 自機の display 座標 (rest-frame view なら原点、world-frame view なら world pos)
    const dp = transformEventForDisplay(
      player.phaseSpace.pos,
      observerPos,
      observerBoost,
    );

    const length = EXHAUST_BASE_LENGTH * smoothed;
    // radius も smoothed に連動。低 thrust で針状にならないよう 0.5× 下限でガード。
    // mobile の連続 thrust で「細い → 太い」の変化が視認できる。
    const radiusScale =
      EXHAUST_RADIUS_MIN_SCALE +
      (1 - EXHAUST_RADIUS_MIN_SCALE) * smoothed;
    const radius = EXHAUST_BASE_RADIUS * radiusScale;
    const offset = EXHAUST_OFFSET + length / 2;

    // 外側 cone: 自機位置 + offset × dir (cone 中心)
    outer.position.set(dp.x + dirX * offset, dp.y + dirY * offset, dp.t);
    outer.quaternion.copy(tmpQuat);
    outer.scale.set(radius, length, radius);

    // 内側 core cone: 同じ向き、短くて細く (白熱コア)。base が外側 cone と同じ位置で
    // 先端も外側に包まれるよう length を短縮、base offset で揃える。
    const innerLength = length * INNER_CORE_SCALE;
    const innerRadius = radius * INNER_CORE_SCALE;
    const innerOffset = EXHAUST_OFFSET + innerLength / 2;
    inner.position.set(dp.x + dirX * innerOffset, dp.y + dirY * innerOffset, dp.t);
    inner.quaternion.copy(tmpQuat);
    inner.scale.set(innerRadius, innerLength, innerRadius);

    outerMat.opacity = smoothed * EXHAUST_MAX_OPACITY;
    innerMat.opacity = smoothed * EXHAUST_MAX_OPACITY;
  });

  return (
    <>
      <mesh ref={outerRef} geometry={sharedGeometries.exhaustCone}>
        <meshBasicMaterial
          ref={outerMatRef}
          color={outerColor}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={innerRef} geometry={sharedGeometries.exhaustCone}>
        <meshBasicMaterial
          ref={innerMatRef}
          color={innerColor}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </>
  );
};

/**
 * 加速度矢印 (自機のみ、C pattern)。xy 平面上の flat 2D 矢印 (ShapeGeometry)。
 * 加速度方向 (exhaust の逆) に sphere 表面から前方へ伸びる。flat で描画するため
 * 任意視点から常に「矢印」として認識できる (cone だけだと視線方向に潰れて blob になる)。
 * smoothed magnitude で length/width/opacity が連動。ユーザー要望 #1, #4。
 */
const AccelerationArrow = ({
  player,
  thrustAccelRef,
  observerPos,
  observerBoost,
}: {
  player: {
    phaseSpace: { pos: Vector4 };
  };
  thrustAccelRef: React.RefObject<Vector3>;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const smoothedMagRef = useRef(0);
  const color = getThreeColor(ARROW_COLOR);

  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const vecY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const vecDir = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    const accel = thrustAccelRef.current;
    const norm = Math.hypot(accel.x, accel.y);
    const rawTarget = Math.min(1, norm / PLAYER_ACCELERATION);

    const current = smoothedMagRef.current;
    const tauMs = rawTarget > current ? EXHAUST_ATTACK_TIME : EXHAUST_RELEASE_TIME;
    const rate = 1 - Math.exp(-(delta * 1000) / tauMs);
    const smoothed = current + (rawTarget - current) * rate;
    smoothedMagRef.current = smoothed;

    if (smoothed < EXHAUST_VISIBILITY_THRESHOLD || norm < 1e-6) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // 加速度方向 = +accel を xy 平面上で正規化 (exhaust の反対側)
    const dirX = accel.x / norm;
    const dirY = accel.y / norm;
    vecDir.set(dirX, dirY, 0);
    // geometry は +y 方向を向いた矢印。setFromUnitVectors で z 軸回りの回転 (xy 平面内)
    tmpQuat.setFromUnitVectors(vecY, vecDir);

    const dp = transformEventForDisplay(
      player.phaseSpace.pos,
      observerPos,
      observerBoost,
    );

    // geometry: y ∈ [-0.5, 1.0] の arrow shape (tail が y=-0.5、tip が y=+1.0)
    // scale Y = totalLength、scale X = totalWidth。base 位置は sphere 表面から
    // ARROW_BASE_OFFSET 先 (exhaust より離して視覚分離)。
    // geometry tail の y=-0.5 をその位置に合わせるには、中心を offset + 0.5×scaleY に置く
    const totalLength = ARROW_BASE_LENGTH * smoothed;
    const totalWidth = ARROW_BASE_WIDTH * smoothed;
    const centerOffset = ARROW_BASE_OFFSET + 0.5 * totalLength;

    mesh.position.set(
      dp.x + dirX * centerOffset,
      dp.y + dirY * centerOffset,
      dp.t,
    );
    mesh.quaternion.copy(tmpQuat);
    mesh.scale.set(totalWidth, totalLength, 1);

    mat.opacity = smoothed * ARROW_MAX_OPACITY;
  });

  return (
    <mesh ref={meshRef} geometry={sharedGeometries.accelerationArrowFlat}>
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export type SceneContentProps = {
  myId: string | null;
  showInRestFrame: boolean;
  useOrthographic: boolean;
  cameraYawRef: React.RefObject<number>;
  cameraPitchRef: React.RefObject<number>;
  thrustAccelRef: React.RefObject<Vector3>;
  isFiring: boolean;
};

// 3Dシーンコンテンツコンポーネント
export const SceneContent = ({
  myId,
  showInRestFrame,
  useOrthographic,
  cameraYawRef,
  cameraPitchRef,
  thrustAccelRef,
  isFiring,
}: SceneContentProps) => {
  // --- Firing start time (for sequential arrow animation) ---
  const firingStartRef = useRef<number>(0);
  if (isFiring && firingStartRef.current === 0) firingStartRef.current = Date.now();
  if (!isFiring) firingStartRef.current = 0;

  // --- Store selectors ---
  const players = useGameStore((s) => s.players);
  const lasers = useGameStore((s) => s.lasers);
  const spawns = useGameStore((s) => s.spawns);
  const frozenWorldLines = useGameStore((s) => s.frozenWorldLines);
  const debrisRecords = useGameStore((s) => s.debrisRecords);
  const killNotification = useGameStore((s) => s.killNotification);

  const playerList = useMemo(() => Array.from(players.values()), [players]);
  const myPlayer = useMemo(
    () => (myId ? (players.get(myId) ?? null) : null),
    [players, myId],
  );
  const observerPos = myPlayer?.phaseSpace.pos ?? null;
  const observerU = useMemo(
    () =>
      myPlayer
        ? { x: myPlayer.phaseSpace.u.x, y: myPlayer.phaseSpace.u.y }
        : null,
    [myPlayer],
  );
  const observerBoost = useMemo(
    () =>
      showInRestFrame && myPlayer ? lorentzBoost(myPlayer.phaseSpace.u) : null,
    [showInRestFrame, myPlayer],
  );
  // カメラ制御
  useFrame(({ camera }) => {
    if (!myPlayer) return;
    const playerPos = transformEventForDisplay(
      myPlayer.phaseSpace.pos,
      observerPos,
      observerBoost,
    );
    const targetX = playerPos.x;
    const targetY = playerPos.y;
    const targetT = playerPos.t;

    const yaw = cameraYawRef.current;
    const pitch = cameraPitchRef.current;
    const distance = useOrthographic ? CAMERA_DISTANCE_ORTHOGRAPHIC : CAMERA_DISTANCE_PERSPECTIVE;
    const camX = targetX + distance * Math.cos(pitch) * Math.cos(yaw + Math.PI);
    const camY = targetY + distance * Math.cos(pitch) * Math.sin(yaw + Math.PI);
    const camT = targetT + distance * Math.sin(pitch);

    camera.position.set(camX, camY, camT);
    camera.lookAt(targetX, targetY, targetT);
    camera.up.set(0, 0, 1);
  });

  // 世界線の過去光円錐交差（他プレイヤーの現在の worldLine + 凍結世界線）。
  // Lighthouse は LighthouseRenderer が塔の底面を過去光円錐交点に anchor 済なので
  // 球+リングマーカーは冗長 (重なって rendering される) → 除外。
  const worldLineIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];

    const results: { playerId: string; color: string; pos: Vector4 }[] = [];

    // 他プレイヤーの現在の worldLine を検索
    for (const player of playerList) {
      if (player.id === myId) continue;
      if (isLighthouse(player.id)) continue;
      const intersection = pastLightConeIntersectionWorldLine(
        player.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: player.id,
          color: player.color,
          pos: intersection.pos, // world frame
        });
      }
    }

    // 凍結世界線も検索 (灯台は LighthouseRenderer の塔で代替するので除外)
    for (let fi = 0; fi < frozenWorldLines.length; fi++) {
      const fw = frozenWorldLines[fi];
      if (isLighthouse(fw.playerId)) continue;
      const intersection = pastLightConeIntersectionWorldLine(
        fw.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: `frozen-${fi}-${fw.worldLine.history[0]?.pos.t ?? 0}`,
          color: fw.color,
          pos: intersection.pos, // world frame
        });
      }
    }

    return results;
  }, [myPlayer, myId, playerList, frozenWorldLines]);

  const laserIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    return lasers
      .map((laser) => {
        const intersection = pastLightConeIntersectionLaser(
          laser,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return { laser, pos: intersection }; // world frame
      })
      .filter(
        (value): value is { laser: Laser; pos: Vector4 } => value !== null,
      );
  }, [lasers, myPlayer, myId]);

  // Future light cone intersections with lasers
  const laserFutureIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    return lasers
      .map((laser) => {
        const intersection = futureLightConeIntersectionLaser(
          laser,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return { laser, pos: intersection }; // world frame
      })
      .filter(
        (value): value is { laser: Laser; pos: Vector4 } => value !== null,
      );
  }, [lasers, myPlayer, myId]);

  // Future light cone intersections: where a signal from the observer would reach each player
  const futureLightConeIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];
    const results: { playerId: string; color: string; pos: Vector4 }[] = [];
    for (const player of playerList) {
      if (player.id === myId) continue;
      const intersection = futureLightConeIntersectionWorldLine(
        player.worldLine,
        myPlayer.phaseSpace.pos,
      );
      if (intersection) {
        results.push({
          playerId: player.id,
          color: player.color,
          pos: intersection.pos, // world frame
        });
      }
    }
    return results;
  }, [myPlayer, myId, playerList]);

  const displayMatrix = useMemo(
    () => buildDisplayMatrix(observerPos, observerBoost),
    [observerPos, observerBoost],
  );

  return (
    <DisplayFrameProvider
      observerU={observerU}
      observerBoost={observerBoost}
      observerPos={observerPos}
      displayMatrix={displayMatrix}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[5, 5, 5]} intensity={1} />

      {/* 時空星屑 (4D event cloud、world-frame 静止、periodic boundary で無限供給) */}
      <StardustRenderer />

      {/* アリーナ円柱 (視覚ガイド、world-frame 静止、過去光円錐交線ハイライト) */}
      <ArenaRenderer />

      {/* 凍結世界線（世界オブジェクト）を描画 */}
      {frozenWorldLines.map((fw, i) => (
        <WorldLineRenderer
          key={`frozen-${i}-${fw.worldLine.history[0]?.pos.t ?? 0}`}
          worldLine={fw.worldLine}
          color={fw.color}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ))}

      {/* 生存プレイヤーの現在の世界線を描画 */}
      {playerList.map((player) => (
        <WorldLineRenderer
          key={`worldline-${player.id}`}
          worldLine={player.worldLine}
          color={player.color}
          observerPos={observerPos}
          observerBoost={observerBoost}
          {...(isLighthouse(player.id) ? { tubeRadius: 0.06, tubeOpacity: LIGHTHOUSE_WORLDLINE_OPACITY } : {})}
        />
      ))}

      {/* 各プレイヤーのマーカー（死亡中の自分のみ非表示）。
          Lighthouse は専用の塔モデル (LighthouseRenderer)、人間プレイヤーは sphere。 */}
      {playerList.map((player) => {
        if (player.id === myId && player.isDead) return null;

        if (isLighthouse(player.id)) {
          return <LighthouseRenderer key={`player-${player.id}`} player={player} />;
        }

        const wp = player.phaseSpace.pos; // world
        const isMe = player.id === myId;
        const color = getThreeColor(player.color);
        const size = isMe ? PLAYER_MARKER_SIZE_SELF : PLAYER_MARKER_SIZE_OTHER;
        const invUntil = selectInvincibleUntil(useGameStore.getState(), player.id);
        const isInvincible = Date.now() < invUntil;
        // Pulse: opacity oscillates 0.3–1.0 at 2Hz during invincibility
        const pulse = isInvincible ? 0.65 + 0.35 * Math.sin(Date.now() * 0.012) : 1.0;

        // 球は volumetric なので per-vertex Lorentz を掛けない (γ 楕円化を避ける)。
        // display 座標へ並進だけ。isMe は display origin に来る。
        const dp = transformEventForDisplay(wp, observerPos, observerBoost);
        return (
          <group key={`player-${player.id}`} position={[dp.x, dp.y, dp.t]}>
            <mesh
              scale={[size, size, size]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isMe ? 1.0 : 0.4}
                roughness={0.3}
                metalness={0.1}
                transparent
                opacity={(isMe ? PLAYER_MARKER_MAIN_OPACITY_SELF : PLAYER_MARKER_MAIN_OPACITY_OTHER) * pulse}
              />
            </mesh>
            <mesh
              scale={[size * 1.8, size * 1.8, size * 1.8]}
              geometry={sharedGeometries.playerSphere}
            >
              <meshBasicMaterial
                color={color}
                transparent
                opacity={(isMe ? PLAYER_MARKER_GLOW_OPACITY_SELF : PLAYER_MARKER_GLOW_OPACITY_OTHER) * pulse}
              />
            </mesh>
          </group>
        );
      })}

      {/* 自機 exhaust (rest-frame で反推力方向に 2 層 cone、自機のみ、C pattern)。
          プレイヤー色ではなく全機共通の青プラズマ色。識別性は sphere / worldline で担保。
          v0 はステップ 1 (自機の rest-frame 加速度を直接表示) のみ。他機対応 (broadcast +
          観測者 rest-frame に戻す) は phaseSpace に α^μ を乗せる段階で実装予定。 */}
      {myPlayer && !myPlayer.isDead && (
        <>
          <ExhaustCone
            player={myPlayer}
            thrustAccelRef={thrustAccelRef}
            observerPos={observerPos}
            observerBoost={observerBoost}
          />
          <AccelerationArrow
            player={myPlayer}
            thrustAccelRef={thrustAccelRef}
            observerPos={observerPos}
            observerBoost={observerBoost}
          />
        </>
      )}

      {/* 自機光円錐 (プレイヤーごとに自分のみ描画、固定色)。rim は ARENA_RADIUS の円柱側面
          まで延伸 (ρ(θ) 依存)、ray が円柱を外す方向は LIGHT_CONE_HEIGHT にフォールバック。
          geometry / in-place update / shader 適用の詳細は LightConeRenderer 内 JSDoc 参照。 */}
      {myPlayer && <LightConeRenderer observerPos={myPlayer.phaseSpace.pos} />}

      {/* 世界線の過去光円錐交差マーカー（球+コア=位置のみ / リング=D pattern） */}
      {worldLineIntersections.map(({ playerId, color: colorText, pos }) => {
        const c = getThreeColor(colorText);
        const dp = transformEventForDisplay(pos, observerPos, observerBoost);
        return (
          <group key={`intersection-${playerId}`}>
            <group position={[dp.x, dp.y, dp.t]}>
              <mesh geometry={sharedGeometries.intersectionSphere}>
                <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.15} />
              </mesh>
              <mesh geometry={sharedGeometries.intersectionCore}>
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            </group>
            <mesh
              geometry={sharedGeometries.intersectionRing}
              matrix={buildMeshMatrix(pos, displayMatrix)}
              matrixAutoUpdate={false}
            >
              <meshBasicMaterial color={c} transparent opacity={PAST_CONE_WORLDLINE_RING_OPACITY} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}

      {/* レーザー過去光円錐交差マーカー（円錐接平面に貼り付いた三角形、tip=laser.direction の接平面射影） */}
      {observerPos && laserIntersections.map(({ laser, pos }) => {
        const c = getThreeColor(laser.color);
        const rot = computeConeTangentWorldRotation(pos, observerPos, laser.direction);
        if (!rot) return null;
        const m = buildMeshMatrix(pos, displayMatrix);
        m.multiply(rot);
        return (
          <mesh
            key={`laser-intersection-${laser.id}`}
            geometry={sharedGeometries.laserIntersectionTriangle}
            matrix={m}
            matrixAutoUpdate={false}
            scale={[2, 2, 2]}
          >
            <meshBasicMaterial color={c} side={THREE.DoubleSide} />
          </mesh>
        );
      })}

      {/* 未来光円錐交差マーカー（接平面に貼り付いた三角形、うっすら表示） */}
      {observerPos && laserFutureIntersections.map(({ laser, pos }) => {
        const c = getThreeColor(laser.color);
        const rot = computeConeTangentWorldRotation(pos, observerPos, laser.direction);
        if (!rot) return null;
        const m = buildMeshMatrix(pos, displayMatrix);
        m.multiply(rot);
        return (
          <group
            key={`laser-future-${laser.id}`}
            matrix={m}
            matrixAutoUpdate={false}
          >
            <mesh geometry={sharedGeometries.laserIntersectionTriangle} scale={[2, 2, 2]}>
              <meshBasicMaterial color={c} transparent opacity={FUTURE_CONE_LASER_TRIANGLE_OPACITY} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
      {futureLightConeIntersections.map(({ playerId, color: colorText, pos }) => {
        const c = getThreeColor(colorText);
        const dp = transformEventForDisplay(pos, observerPos, observerBoost);
        const ringMatrix = buildMeshMatrix(pos, displayMatrix);
        ringMatrix.multiply(new THREE.Matrix4().makeScale(0.8, 0.8, 0.8));
        return (
          <group key={`future-${playerId}`}>
            <mesh
              geometry={sharedGeometries.intersectionSphere}
              position={[dp.x, dp.y, dp.t]}
              scale={[0.6, 0.6, 0.6]}
            >
              <meshBasicMaterial color={c} transparent opacity={FUTURE_CONE_WORLDLINE_SPHERE_OPACITY} depthWrite={false} />
            </mesh>
            <mesh
              geometry={sharedGeometries.intersectionRing}
              matrix={ringMatrix}
              matrixAutoUpdate={false}
            >
              <meshBasicMaterial color={c} transparent opacity={FUTURE_CONE_WORLDLINE_RING_OPACITY} depthWrite={false} />
            </mesh>
          </group>
        );
      })}

      {/* レーザー描画（バッチ, 頂点 world / matrix = displayMatrix） */}
      <LaserBatchRenderer lasers={lasers} />

      {/* レーザー方向マーカー（自機のみ、トリガー中） */}
      {isFiring && myPlayer && myId && (() => {
        // 自機の最新レーザーから方向取得
        let latestLaser: typeof lasers[0] | null = null;
        for (const l of lasers) {
          if (l.playerId !== myId) continue;
          if (!latestLaser || l.emissionPos.t > latestLaser.emissionPos.t) latestLaser = l;
        }
        if (!latestLaser) return null;
        const dir = latestLaser.direction;
        if (dir.x * dir.x + dir.y * dir.y < 0.000001) return null;
        const aimYaw = Math.atan2(dir.y, dir.x);
        const s2 = Math.SQRT1_2;
        const cy = Math.cos(aimYaw), sy = Math.sin(aimYaw);
        const pastDir = new THREE.Vector3(cy, sy, -1).normalize();
        const rotMatrix = new THREE.Matrix4().set(
          -sy,  -cy * s2,  cy * s2, 0,
           cy,  -sy * s2,  sy * s2, 0,
            0,        s2,       s2, 0,
            0,         0,        0, 1,
        );
        const quat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);
        const pos = transformEventForDisplay(myPlayer.phaseSpace.pos, observerPos, observerBoost);
        const c = getThreeColor(myPlayer.color);
        const spacing = 1.2; // 矢印の全長 (tip 0.75 + base 0.45) と一致させ tip↔base を接合
        // 0s→1個, 0.05s→2個, 0.1s→3個（ループなし、トリガー押し始めから）
        const elapsed = Date.now() - firingStartRef.current;
        const visibleCount = Math.min(3, Math.floor(elapsed / 50) + 1);
        return [1, 2, 3].map((i) => {
          if (i > visibleCount) return null;
          const opacity = AIM_ARROW_BASE_OPACITY - (i - 1) * AIM_ARROW_OPACITY_STEP;
          return (
            <mesh
              key={`aim-arrow-${i}`}
              position={[
                pos.x + pastDir.x * spacing * i,
                pos.y + pastDir.y * spacing * i,
                pos.t + pastDir.z * spacing * i,
              ]}
              quaternion={quat}
              geometry={sharedGeometries.laserArrow}
            >
              <meshBasicMaterial color={c} transparent opacity={opacity} side={THREE.DoubleSide} />
            </mesh>
          );
        });
      })()}

      {/* デブリの世界線とマーカー（世界オブジェクト） */}
      {myPlayer && (
        <DebrisRenderer debrisRecords={debrisRecords} myPlayer={myPlayer} />
      )}

      {/* 時空星屑（個別点のクラウド） */}
      <StardustRenderer />

      {/* キル通知（キル時空点に 3D 表示、球=位置のみ / リング=D pattern） */}
      {killNotification && (() => {
        const wpKill = createVector4(
          killNotification.hitPos.t,
          killNotification.hitPos.x,
          killNotification.hitPos.y,
          killNotification.hitPos.z,
        );
        const wp = {
          x: killNotification.hitPos.x,
          y: killNotification.hitPos.y,
          t: killNotification.hitPos.t,
        };
        const dp = transformEventForDisplay(wpKill, observerPos, observerBoost);
        const kc = getThreeColor(killNotification.color);
        return (
          <group>
            <mesh geometry={sharedGeometries.killSphere} position={[dp.x, dp.y, dp.t]}>
              <meshBasicMaterial color={kc} transparent opacity={KILL_NOTIFICATION_SPHERE_OPACITY} />
            </mesh>
            <mesh
              geometry={sharedGeometries.killRing}
              matrix={buildMeshMatrix(wp, displayMatrix)}
              matrixAutoUpdate={false}
            >
              <meshBasicMaterial color={kc} transparent opacity={KILL_NOTIFICATION_RING_OPACITY} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })()}

      {/* スポーンエフェクト */}
      {spawns.map((spawn) => (
        <SpawnRenderer key={spawn.id} spawn={spawn} />
      ))}
    </DisplayFrameProvider>
  );
};
