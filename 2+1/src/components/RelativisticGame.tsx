import { useEffect, useRef, useState, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePeer } from "../hooks/usePeer";
import {
  type PhaseSpace,
  type Vector4,
  type WorldLine,
  createVector3,
  lengthVector3,
  vector3Zero,
  gamma,
  createWorldLine,
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  evolvePhaseSpace,
  lorentzBoost,
  lorentzDotVector4,
  multiplyVector4Matrix4,
  subVector4,
  pastLightConeIntersectionWorldLine,
} from "../physics";

/**
 * RelativisticGame (2+1 spacetime).
 *
 * English:
 *   - Renders an x-y-time arena in 3D using three.js (@react-three/fiber).
 *   - Time coordinate t is mapped to the Z axis for visualization.
 *   - Multiplayer state is synced via PeerJS (WebRTC). In this app, clients send to the host and the host relays.
 *
 * 日本語:
 *   - x-y-t のアリーナを three.js（@react-three/fiber）で 3D 表示します。
 *   - 可視化のため、時間座標 t を Z 軸に割り当てています。
 *   - マルチプレイ同期は PeerJS（WebRTC）。このアプリは基本的にホスト中継型です。
 */

const OFFSET = Date.now() / 1000;

type RelativisticPlayer = {
  id: string;
  // in 世界系
  phaseSpace: PhaseSpace;
  worldLine: WorldLine;
  pastWorldLines: WorldLine[]; // 死亡で切断された過去の世界線
  color: string;
};

type Laser = {
  readonly id: string;
  readonly playerId: string;
  readonly emissionPos: { t: number; x: number; y: number; z: number };
  readonly direction: { x: number; y: number; z: number };
  readonly range: number;
  readonly color: string;
};

type Explosion = {
  readonly id: string;
  readonly pos: { t: number; x: number; y: number; z: number };
  readonly color: string;
  readonly startTime: number; // Date.now()
};

// レーザーの射程
const LASER_RANGE = 20;

// 爆発エフェクトの持続時間（ミリ秒）
const EXPLOSION_DURATION = 1000;

// リスポーン遅延（ミリ秒）
const RESPAWN_DELAY = 1000;

// 過去の世界線の保持上限
const MAX_PAST_WORLDLINES = 5;

// レーザーの最大数（メモリ管理）
const MAX_LASERS = 1000;

// 当たり判定の半径
const HIT_RADIUS = 0.5;

/**
 * Check if a laser hits a world line (spatial proximity at simultaneous world-frame time).
 *
 * Laser trajectory: L(λ) = emissionPos + λ * (dir, 1),  λ ∈ [0, range]
 * World line segment: W(μ) = p1 + μ * (p2 - p1),  μ ∈ [0, 1]
 *
 * Solve L.t = W.t for simultaneous time, then check spatial distance.
 */
const checkLaserHit = (
  laser: Laser,
  worldLine: WorldLine,
  hitRadius: number,
): boolean => {
  const history = worldLine.history;
  if (history.length < 2) return false;

  const eT = laser.emissionPos.t;
  const eX = laser.emissionPos.x;
  const eY = laser.emissionPos.y;
  const dX = laser.direction.x;
  const dY = laser.direction.y;
  const range = laser.range;
  const r2 = hitRadius * hitRadius;

  for (let i = 1; i < history.length; i++) {
    const p1 = history[i - 1].pos;
    const p2 = history[i].pos;

    // World line segment: W(μ) = p1 + μ * (p2 - p1)
    const wdT = p2.t - p1.t;
    const wdX = p2.x - p1.x;
    const wdY = p2.y - p1.y;

    // Laser time: L.t = eT + λ
    // World line time: W.t = p1.t + μ * wdT
    // Simultaneous: eT + λ = p1.t + μ * wdT

    // For each world line segment, sweep μ ∈ [0,1]:
    //   λ(μ) = (p1.t + μ * wdT) - eT
    //   Spatial distance² at that time:
    //     dx = (eX + dX * λ) - (p1.x + μ * wdX)
    //     dy = (eY + dY * λ) - (p1.y + μ * wdY)
    //     dist² = dx² + dy²

    // Check endpoints μ=0 and μ=1, plus the analytical minimum

    const checkAtMu = (mu: number): boolean => {
      if (mu < 0 || mu > 1) return false;
      const lambda = p1.t + mu * wdT - eT;
      if (lambda < 0 || lambda > range) return false;

      const dx = eX + dX * lambda - (p1.x + mu * wdX);
      const dy = eY + dY * lambda - (p1.y + mu * wdY);
      return dx * dx + dy * dy <= r2;
    };

    // Check segment endpoints
    if (checkAtMu(0) || checkAtMu(1)) return true;

    // Analytical minimum: d(dist²)/dμ = 0
    // dist²(μ) = (eX + dX*(p1.t + μ*wdT - eT) - p1.x - μ*wdX)² + (same for y)²
    // Let A = eX + dX*(p1.t - eT) - p1.x,  a = dX*wdT - wdX
    //     B = eY + dY*(p1.t - eT) - p1.y,  b = dY*wdT - wdY
    // dist²(μ) = (A + a*μ)² + (B + b*μ)²
    // d/dμ = 2a(A + a*μ) + 2b(B + b*μ) = 0
    // μ* = -(a*A + b*B) / (a² + b²)

    const lambda0 = p1.t - eT;
    const A = eX + dX * lambda0 - p1.x;
    const a = dX * wdT - wdX;
    const B = eY + dY * lambda0 - p1.y;
    const b = dY * wdT - wdY;

    const denom = a * a + b * b;
    if (denom > 1e-12) {
      const muStar = -(a * A + b * B) / denom;
      if (checkAtMu(muStar)) return true;
    }
  }

  return false;
};

// 32bit FNV-1a hash（IDカラー生成用）
const hashString32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

// IDから色を生成する関数（高彩度で視認性の良い色）
const getColorFromId = (id: string): string => {
  const hash = hashString32(id);
  // 連番・類似IDでも色相が偏りにくいように黄金角で拡散
  const hue = Math.floor(((hash * 137.50776405) % 360 + 360) % 360);
  const saturation = 80 + ((hash >> 8) % 17); // 80-96%
  const lightness = 50 + ((hash >> 16) % 14); // 50-63%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// プレイヤーの色からレーザーの色を生成（より明るく、彩度を上げる）
const getLaserColor = (playerColor: string): string => {
  // HSL形式をパース: hsl(hue, saturation%, lightness%)
  const match = playerColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return playerColor;

  const hue = Number.parseInt(match[1], 10);
  const saturation = Math.min(100, Number.parseInt(match[2], 10) + 10); // 彩度を上げる
  const lightness = Math.min(90, Number.parseInt(match[3], 10) + 25); // 明度を上げて明るく

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

/**
 * Find intersection of "observer past light cone" and a laser world-line segment.
 *
 * English:
 *   - Laser trajectory is modeled as a spacetime segment:
 *       X(lambda) = start + lambda * (end - start), lambda in [0, 1]
 *   - We solve lorentzDot(observer - X, observer - X) = 0 and keep the past solution.
 *
 * 日本語:
 *   - レーザー軌跡を時空区間として扱い、
 *       X(lambda) = start + lambda * (end - start), lambda in [0, 1]
 *   - lorentzDot(observer - X, observer - X) = 0 を解いて、
 *     観測者より過去にある解のみ採用します。
 */
const pastLightConeIntersectionLaser = (
  laser: Laser,
  observerPos: Vector4,
): Vector4 | null => {
  const start = createVector4(
    laser.emissionPos.t,
    laser.emissionPos.x,
    laser.emissionPos.y,
    laser.emissionPos.z,
  );
  const end = createVector4(
    laser.emissionPos.t + laser.range,
    laser.emissionPos.x + laser.direction.x * laser.range,
    laser.emissionPos.y + laser.direction.y * laser.range,
    laser.emissionPos.z + laser.direction.z * laser.range,
  );

  const delta = subVector4(end, start);
  const separationAtStart = subVector4(observerPos, start);

  // a*lambda^2 + b*lambda + c = 0
  const a = lorentzDotVector4(delta, delta);
  const b = -2 * lorentzDotVector4(separationAtStart, delta);
  const c = lorentzDotVector4(separationAtStart, separationAtStart);

  const EPS = 1e-9;
  const candidates: number[] = [];

  // Laser segment is (almost) lightlike, so treat near-linear case robustly.
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) return null;
    candidates.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
    candidates.push((-b - sqrtDiscriminant) / (2 * a));
    candidates.push((-b + sqrtDiscriminant) / (2 * a));
  }

  let best: Vector4 | null = null;
  for (const lambda of candidates) {
    if (lambda < -EPS || lambda > 1 + EPS) continue;
    const t = Math.min(1, Math.max(0, lambda));
    const point = createVector4(
      start.t + delta.t * t,
      start.x + delta.x * t,
      start.y + delta.y * t,
      start.z + delta.z * t,
    );

    // We only want events in observer's past.
    if (observerPos.t - point.t <= EPS) continue;
    if (!best || point.t > best.t) best = point;
  }

  return best;
};

/**
 * Convert a world-frame event into display coordinates.
 *
 * English:
 *   - When `observerBoost` is present, we display in the observer's instantaneous rest frame.
 *   - Otherwise, we keep world-frame coordinates.
 *
 * 日本語:
 *   - `observerBoost` がある場合は観測者の瞬間静止系で表示します。
 *   - ない場合は世界系のまま表示します。
 */
const transformEventForDisplay = (
  worldEvent: Vector4,
  observerPos: Vector4 | null,
  observerBoost: ReturnType<typeof lorentzBoost> | null,
): Vector4 => {
  if (!observerPos || !observerBoost) return worldEvent;
  return multiplyVector4Matrix4(observerBoost, subVector4(worldEvent, observerPos));
};

// Color キャッシュ
const colorCache = new Map<string, THREE.Color>();
const getThreeColor = (hslString: string): THREE.Color => {
  let color = colorCache.get(hslString);
  if (!color) {
    color = new THREE.Color(hslString);
    colorCache.set(hslString, color);
  }
  return color;
};

// 共有ジオメトリ（シングルトン）
const sharedGeometries = {
  playerSphere: new THREE.SphereGeometry(1, 8, 8),
  intersectionSphere: new THREE.SphereGeometry(0.45, 16, 16),
  intersectionCore: new THREE.SphereGeometry(0.15, 12, 12),
  intersectionRing: new THREE.TorusGeometry(0.7, 0.07, 12, 24),
  laserIntersectionDot: new THREE.SphereGeometry(0.25, 12, 12),
  lightCone: new THREE.ConeGeometry(40, 40, 32, 1, true),
  explosionParticle: new THREE.SphereGeometry(1, 6, 6), // スケールで size 調整
};

// Material キャッシュ（プレイヤーID + タイプごと）
const materialCache = new Map<string, THREE.Material>();
const getMaterial = (
  key: string,
  factory: () => THREE.Material,
): THREE.Material => {
  let mat = materialCache.get(key);
  if (!mat) {
    mat = factory();
    materialCache.set(key, mat);
  }
  return mat;
};

// デバッグ用: キャッシュサイズの監視（ブラウザコンソールで window.debugCaches を参照）
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).debugCaches = {
    colorCache,
    materialCache,
    sharedGeometries,
  };
}

// WorldLineRenderer コンポーネント - 個別のワールドラインを描画
type WorldLineRendererProps = {
  player: RelativisticPlayer;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
};

const WorldLineRenderer = ({
  player,
  observerPos,
  observerBoost,
}: WorldLineRendererProps) => {
  const [geometry, setGeometry] = useState<THREE.TubeGeometry | null>(null);

  const history = player.worldLine.history;

  useEffect(() => {
    if (history.length < 2) return;

    const points: THREE.Vector3[] = history.map(
      (ps) => {
        const pos = transformEventForDisplay(ps.pos, observerPos, observerBoost);
        return new THREE.Vector3(pos.x, pos.y, pos.t);
      },
    );

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeometry = new THREE.TubeGeometry(
      curve,
      Math.min(points.length * 2, 1000),
      0.05,
      8,
      false,
    );

    setGeometry((prev) => {
      // 古い geometry を破棄
      if (prev) {
        prev.dispose();
      }
      return tubeGeometry;
    });
  }, [history, observerPos, observerBoost]);

  // アンマウント時に geometry を破棄
  useEffect(() => {
    return () => {
      setGeometry((prev) => {
        if (prev) {
          prev.dispose();
        }
        return null;
      });
    };
  }, []);

  const color = getThreeColor(player.color);
  const material = getMaterial(
    `worldline-${player.id}`,
    () =>
      new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.9,
      }),
  );

  if (!geometry) return null;

  return <mesh geometry={geometry} material={material} />;
};

type DisplayLaser = {
  readonly id: string;
  readonly color: string;
  readonly start: Vector4;
  readonly end: Vector4;
};

// LaserRenderer コンポーネント - 個別のレーザーを描画
const LaserRenderer = ({ laser }: { laser: DisplayLaser }) => {
  const geometry = useMemo(() => {
    const startPoint = new THREE.Vector3(laser.start.x, laser.start.y, laser.start.t);
    const endPoint = new THREE.Vector3(laser.end.x, laser.end.y, laser.end.t);
    const curve = new THREE.LineCurve3(startPoint, endPoint);
    return new THREE.TubeGeometry(curve, 2, 0.05, 8, false);
  }, [laser]);

  const color = useMemo(() => getThreeColor(laser.color), [laser.color]);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.8,
      }),
    [color],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <mesh geometry={geometry} material={material} />;
};

// 爆発パーティクルの方向を事前生成（未来光円錐内をランダムに飛散）
const EXPLOSION_PARTICLE_COUNT = 30;
const generateExplosionParticles = () => {
  const particles: { dx: number; dy: number; speed: number; size: number }[] = [];
  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    // speed < 1 (光速未満) → 未来光円錐の内側を進む
    const speed = 0.2 + Math.random() * 0.7; // 0.2c ~ 0.9c
    particles.push({
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      speed,
      size: 0.1 + Math.random() * 0.25,
    });
  }
  return particles;
};

// 爆発エフェクトコンポーネント
const ExplosionRenderer = ({
  explosion,
  observerPos,
  observerBoost,
}: {
  explosion: Explosion;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
}) => {
  // パーティクル方向をメモ化（爆発ごとに固定）
  const particles = useMemo(() => generateExplosionParticles(), []);

  const elapsed = Date.now() - explosion.startTime;
  const progress = Math.min(elapsed / EXPLOSION_DURATION, 1);
  const opacity = 1 - progress * progress; // 二乗で急速にフェード

  const color = useMemo(() => getThreeColor(explosion.color), [explosion.color]);

  if (opacity <= 0) return null;

  // 経過した世界系時間（c=1 単位で、時空図上の距離に対応）
  const dt = progress * 8; // 最大8単位先の未来まで飛散

  return (
    <>
      {particles.map((p, i) => {
        // 各パーティクルの世界系時空位置: 死亡イベント + (dt, dx*dt, dy*dt, 0)
        // speed < 1 なので未来光円錐の内側（時間的領域）を進む
        const worldPos = createVector4(
          explosion.pos.t + dt,
          explosion.pos.x + p.dx * dt,
          explosion.pos.y + p.dy * dt,
          0,
        );
        const displayPos = transformEventForDisplay(worldPos, observerPos, observerBoost);

        return (
          <mesh
            key={i}
            position={[displayPos.x, displayPos.y, displayPos.t]}
            scale={[p.size, p.size, p.size]}
            geometry={sharedGeometries.explosionParticle}
          >
            <meshBasicMaterial
              color={i % 5 === 0 ? "white" : color}
              transparent
              opacity={opacity * (0.5 + p.size)}
            />
          </mesh>
        );
      })}
    </>
  );
};

// 3Dシーンコンテンツコンポーネント
type SceneContentProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  lasers: Laser[];
  explosions: Explosion[];
  showInRestFrame: boolean;
  useOrthographic: boolean;
  cameraYawRef: React.RefObject<number>; // カメラのxy平面内での向き（ラジアン）
  cameraPitchRef: React.RefObject<number>; // カメラの仰角（ラジアン、0=水平、正=上から見下ろす）
};

const SceneContent = ({
  players,
  myId,
  lasers,
  explosions,
  showInRestFrame,
  useOrthographic,
  cameraYawRef,
  cameraPitchRef,
}: SceneContentProps) => {
  // プレイヤーリストをメモ化
  const playerList = useMemo(() => Array.from(players.values()), [players]);
  const myPlayer = useMemo(
    () => (myId ? players.get(myId) ?? null : null),
    [players, myId],
  );
  const observerPos = myPlayer?.phaseSpace.pos ?? null;
  const observerBoost = useMemo(
    () => (showInRestFrame && myPlayer ? lorentzBoost(myPlayer.phaseSpace.u) : null),
    [showInRestFrame, myPlayer],
  );
  const displayLasers = useMemo<DisplayLaser[]>(() => {
    return lasers.map((laser) => {
      const worldStart = createVector4(
        laser.emissionPos.t,
        laser.emissionPos.x,
        laser.emissionPos.y,
        laser.emissionPos.z,
      );
      const worldEnd = createVector4(
        laser.emissionPos.t + laser.range,
        laser.emissionPos.x + laser.direction.x * laser.range,
        laser.emissionPos.y + laser.direction.y * laser.range,
        laser.emissionPos.z + laser.direction.z * laser.range,
      );

      return {
        id: laser.id,
        color: laser.color,
        start: transformEventForDisplay(worldStart, observerPos, observerBoost),
        end: transformEventForDisplay(worldEnd, observerPos, observerBoost),
      };
    });
  }, [lasers, observerPos, observerBoost]);

  // カメラの位置をプレイヤー位置から計算（球面座標）
  useFrame(({ camera }) => {
    if (!myPlayer) return;

    const targetX = showInRestFrame ? 0 : myPlayer.phaseSpace.pos.x;
    const targetY = showInRestFrame ? 0 : myPlayer.phaseSpace.pos.y;
    const targetT = showInRestFrame ? 0 : myPlayer.phaseSpace.pos.t;
    // カメラの距離（プレイヤーからの距離、固定）
    const cameraDistance = useOrthographic ? 100 : 15;
    // カメラ位置: プレイヤーを中心とした球面上
    const cameraYaw = cameraYawRef.current;
    const cameraPitch = cameraPitchRef.current;
    // 球面座標からデカルト座標へ変換
    const camX =
      targetX - Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;
    const camY =
      targetY - Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance;
    const camT = targetT - Math.sin(cameraPitch) * cameraDistance;

    camera.position.set(camX, camY, camT);
    camera.lookAt(targetX, targetY, targetT);
    camera.up.set(0, 0, 1);
  });
  const worldLineIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];

    return playerList
      .filter((player) => player.id !== myId)
      .map((player) => {
        const intersection = pastLightConeIntersectionWorldLine(
          player.worldLine,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return {
          playerId: player.id,
          color: player.color,
          pos: transformEventForDisplay(
            intersection.pos,
            observerPos,
            observerBoost,
          ),
        };
      })
      .filter(
        (
          value,
        ): value is { playerId: string; color: string; pos: Vector4 } =>
          value !== null,
      );
  }, [myPlayer, myId, playerList, observerPos, observerBoost]);
  const laserIntersections = useMemo(() => {
    if (!myPlayer || !myId) return [];

    return lasers
      .map((laser) => {
        const intersection = pastLightConeIntersectionLaser(
          laser,
          myPlayer.phaseSpace.pos,
        );
        if (!intersection) return null;
        return {
          laser,
          pos: transformEventForDisplay(intersection, observerPos, observerBoost),
        };
      })
      .filter(
        (
          value,
        ): value is { laser: Laser; pos: Vector4 } => value !== null,
      );
  }, [lasers, myPlayer, myId, observerPos, observerBoost]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />

      {/* 全プレイヤーの world line を描画（現在 + 過去の命） */}
      {playerList.map((player) => (
        <group key={`worldlines-${player.id}`}>
          <WorldLineRenderer
            key={`worldline-${player.id}`}
            player={player}
            observerPos={observerPos}
            observerBoost={observerBoost}
          />
          {player.pastWorldLines.map((pastWl, i) => (
            <WorldLineRenderer
              key={`worldline-past-${player.id}-${i}`}
              player={{ ...player, worldLine: pastWl }}
              observerPos={observerPos}
              observerBoost={observerBoost}
            />
          ))}
        </group>
      ))}

      {/* 各プレイヤーのマーカー */}
      {playerList.map((player) => {
        const pos = transformEventForDisplay(
          player.phaseSpace.pos,
          observerPos,
          observerBoost,
        );
        const isMe = player.id === myId;
        const color = getThreeColor(player.color);
        const size = isMe ? 0.42 : 0.34;
        const material = getMaterial(
          `player-core-${player.id}-${isMe}`,
          () =>
            new THREE.MeshStandardMaterial({
              color: color,
              emissive: color,
              emissiveIntensity: isMe ? 1.0 : 0.75,
              roughness: 0.3,
              metalness: 0.1,
            }),
        );
        const haloMaterial = getMaterial(
          `player-halo-${player.id}-${isMe}`,
          () =>
            new THREE.MeshBasicMaterial({
              color: color,
              transparent: true,
              opacity: isMe ? 0.32 : 0.22,
            }),
        );

        return (
          <group key={`player-${player.id}`} position={[pos.x, pos.y, pos.t]}>
            <mesh
              scale={[size, size, size]}
              geometry={sharedGeometries.playerSphere}
              material={material}
            />
            <mesh
              scale={[size * 1.8, size * 1.8, size * 1.8]}
              geometry={sharedGeometries.playerSphere}
              material={haloMaterial}
            />
          </group>
        );
      })}

      {/* 各プレイヤーの光円錐を描画 */}
      {playerList.map((player) => {
        const pos = transformEventForDisplay(
          player.phaseSpace.pos,
          observerPos,
          observerBoost,
        );
        const isMe = player.id === myId;
        const color = getThreeColor(player.color);
        const coneHeight = 40;
        const coneMaterial = getMaterial(
          `lightcone-${player.id}-${isMe}`,
          () =>
            new THREE.MeshBasicMaterial({
              color: color,
              transparent: true,
              opacity: isMe ? 0.5 : 0.4,
              side: THREE.DoubleSide,
              wireframe: true,
            }),
        );

        return (
          <group key={`lightcone-${player.id}`}>
            {/* 未来光円錐 */}
            <mesh
              position={[pos.x, pos.y, pos.t + coneHeight / 2]}
              rotation={[-Math.PI / 2, 0.0, 0.0]}
              geometry={sharedGeometries.lightCone}
              material={coneMaterial}
            />
            {/* 過去光円錐 */}
            <mesh
              position={[pos.x, pos.y, pos.t - coneHeight / 2]}
              rotation={[Math.PI / 2, 0.0, 0.0]}
              geometry={sharedGeometries.lightCone}
              material={coneMaterial}
            />
          </group>
        );
      })}

      {/* 自分の過去光円錐と他プレイヤーの世界線の交点 */}
      {worldLineIntersections.map(({ playerId, color: colorText, pos }) => {
        const color = getThreeColor(colorText);
        const markerMaterial = getMaterial(
          `intersection-marker-${playerId}`,
          () =>
            new THREE.MeshStandardMaterial({
              color: color,
              emissive: color,
              emissiveIntensity: 1.15,
            }),
        );
        const coreMaterial = getMaterial(
          `intersection-core-${playerId}`,
          () =>
            new THREE.MeshBasicMaterial({
              color: new THREE.Color("#ffffff"),
            }),
        );
        const ringMaterial = getMaterial(
          `intersection-ring-${playerId}`,
          () =>
            new THREE.MeshBasicMaterial({
              color: color,
              transparent: true,
              opacity: 0.9,
              side: THREE.DoubleSide,
            }),
        );

        return (
          <group key={`intersection-${playerId}`} position={[pos.x, pos.y, pos.t]}>
            <mesh
              geometry={sharedGeometries.intersectionSphere}
              material={markerMaterial}
            />
            <mesh
              geometry={sharedGeometries.intersectionCore}
              material={coreMaterial}
            />
            <mesh
              geometry={sharedGeometries.intersectionRing}
              material={ringMaterial}
            />
          </group>
        );
      })}

      {/* 各レーザーと自分の過去光円錐の交点（自分のレーザーも含む） */}
      {laserIntersections.map(({ laser, pos }) => {
        const color = getThreeColor(laser.color);
        const dotMaterial = getMaterial(
          `laser-intersection-dot-${laser.color}`,
          () =>
            new THREE.MeshStandardMaterial({
              color: color,
              emissive: color,
              emissiveIntensity: 1.1,
              roughness: 0.25,
              metalness: 0.1,
            }),
        );

        return (
          <group
            key={`laser-intersection-${laser.id}`}
            position={[pos.x, pos.y, pos.t]}
          >
            <mesh
              geometry={sharedGeometries.laserIntersectionDot}
              material={dotMaterial}
            />
          </group>
        );
      })}

      {/* レーザーを描画 */}
      {displayLasers.map((laser) => (
        <LaserRenderer key={laser.id} laser={laser} />
      ))}

      {/* 爆発エフェクトを描画 */}
      {explosions.map((explosion) => (
        <ExplosionRenderer
          key={explosion.id}
          explosion={explosion}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
      ))}
    </>
  );
};

const RelativisticGame = () => {
  const { peerManager, myId, connections } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const [lasers, setLasers] = useState<Laser[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [explosions, setExplosions] = useState<Explosion[]>([]);
  const [deathFlash, setDeathFlash] = useState(false);
  const [killNotification, setKillNotification] = useState<{ victimName: string; color: string } | null>(null);
  const scoresRef = useRef<Record<string, number>>({});
  const [showInRestFrame, setShowInRestFrame] = useState(true);
  const [useOrthographic, setUseOrthographic] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const lastLaserTimeRef = useRef<number>(0); // レーザー発射クールダウン用
  const playersRef = useRef<Map<string, RelativisticPlayer>>(new Map()); // ゲームループ用
  const lasersRef = useRef<Laser[]>([]); // ゲームループ用（当たり判定）
  const timeSyncedRef = useRef<boolean>(false); // syncTime 受信済みフラグ（クライアント用）
  const processedLasersRef = useRef<Set<string>>(new Set()); // 判定済みレーザーID
  const deadUntilRef = useRef<number>(0); // 死亡中は Date.now() < deadUntil
  const [_screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  // カメラ制御用の状態（ref のみで管理し、不要な再レンダーを防ぐ）
  const cameraYawRef = useRef(0); // xy平面内でのカメラの向き（ラジアン）
  const cameraPitchRef = useRef(Math.PI / 6); // 仰角（ラジアン、0=水平、正=上から見下ろす）初期値は30度

  // 初期化
  useEffect(() => {
    if (!myId) return;

    // 自分のプレイヤーを初期化（まだ存在しない場合のみ）
    setPlayers((prev) => {
      if (prev.has(myId)) {
        return prev;
      }

      const initialPhaseSpace = createPhaseSpace(
        createVector4(
          Date.now() / 1000 - OFFSET,
          Math.random() * 100,
          Math.random() * 100,
          0.0,
        ),
        vector3Zero(),
      );
      let worldLine = createWorldLine();
      worldLine = appendWorldLine(worldLine, initialPhaseSpace);

      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        phaseSpace: initialPhaseSpace,
        worldLine,
        pastWorldLines: [],
        color: getColorFromId(myId),
      });
      return next;
    });
  }, [myId]);

  // ref を最新の state に同期
  useEffect(() => {
    playersRef.current = players;
  }, [players]);
  useEffect(() => {
    lasersRef.current = lasers;
  }, [lasers]);

  // 切断したプレイヤーを削除 & 新規接続にsyncTime送信
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!myId) return;

    // 接続中のピアIDセット（自分自身を含む）
    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    // ホストの場合、新しく open した peer に syncTime を送信
    if (peerManager?.getIsHost()) {
      const myPlayer = playersRef.current.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: myPlayer.phaseSpace.pos.t,
            });
          }
        }
      }
    }
    // open な接続のみ記録（open前に記録すると open時に「既知」扱いされてしまう）
    prevConnectionIdsRef.current = new Set(
      connections.filter((c) => c.open).map((c) => c.id),
    );

    setPlayers((prev) => {
      const idsToRemove: string[] = [];
      for (const playerId of prev.keys()) {
        if (!connectedIds.has(playerId)) {
          idsToRemove.push(playerId);
        }
      }

      if (idsToRemove.length === 0) return prev;

      const next = new Map(prev);
      for (const id of idsToRemove) {
        next.delete(id);
      }
      return next;
    });
  }, [connections, myId, peerManager]);

  // メッセージ受信処理
  useEffect(() => {
    if (!peerManager || !myId) return;

    // メッセージ受信処理
    peerManager.onMessage("relativistic", (_, msg) => {
      if (msg.type === "phaseSpace") {
        const playerId = msg.senderId;
        setPlayers((prev) => {
          const next = new Map(prev);

          const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

          // 既存のプレイヤーのワールドラインに追加、または新規作成
          const existing = prev.get(playerId);
          let worldLine = existing?.worldLine || createWorldLine();
          worldLine = appendWorldLine(worldLine, phaseSpace);

          next.set(playerId, {
            id: playerId,
            phaseSpace,
            worldLine,
            pastWorldLines: existing?.pastWorldLines || [],
            color: existing?.color || getColorFromId(playerId), // 既存の色を保持
          });
          return next;
        });
      } else if (msg.type === "syncTime") {
        // ホストから世界系時刻を受信 → 自分の t を揃える
        timeSyncedRef.current = true;
        setPlayers((prev) => {
          const me = prev.get(myId);
          if (!me) return prev;
          const synced = createPhaseSpace(
            createVector4(
              msg.hostTime,
              me.phaseSpace.pos.x,
              me.phaseSpace.pos.y,
              me.phaseSpace.pos.z,
            ),
            me.phaseSpace.u,
          );
          let worldLine = createWorldLine();
          worldLine = appendWorldLine(worldLine, synced);
          const next = new Map(prev);
          next.set(myId, { ...me, phaseSpace: synced, worldLine });
          return next;
        });
      } else if (msg.type === "laser") {
        // 他プレイヤーからのレーザーを追加
        const receivedLaser: Laser = {
          id: msg.id,
          playerId: msg.playerId,
          emissionPos: msg.emissionPos,
          direction: msg.direction,
          range: msg.range,
          color: msg.color,
        };
        setLasers((prev) => {
          // 重複チェック
          if (prev.some((l) => l.id === receivedLaser.id)) {
            return prev;
          }
          const updated = [...prev, receivedLaser];
          // 最大数を超えたら古いものを削除
          if (updated.length > MAX_LASERS) {
            return updated.slice(updated.length - MAX_LASERS);
          }
          return updated;
        });
      } else if (msg.type === "respawn") {
        // リスポーン: 現在の worldLine を退避し、新しい worldLine で再開
        setPlayers((prev) => {
          const player = prev.get(msg.playerId);
          if (!player) return prev;
          const respawnPhaseSpace = createPhaseSpace(
            createVector4(msg.position.t, msg.position.x, msg.position.y, msg.position.z),
            vector3Zero(),
          );
          let worldLine = createWorldLine();
          worldLine = appendWorldLine(worldLine, respawnPhaseSpace);
          const pastWorldLines = player.worldLine.history.length > 1
            ? [...player.pastWorldLines, player.worldLine].slice(-MAX_PAST_WORLDLINES)
            : player.pastWorldLines;
          const next = new Map(prev);
          next.set(msg.playerId, { ...player, phaseSpace: respawnPhaseSpace, worldLine, pastWorldLines });
          return next;
        });
      } else if (msg.type === "score") {
        scoresRef.current = msg.scores;
        setScores(msg.scores);
      } else if (msg.type === "kill") {
        // 自分が死んだら画面フラッシュ + 物理停止
        if (msg.victimId === myId) {
          setDeathFlash(true);
          setTimeout(() => setDeathFlash(false), 600);
          deadUntilRef.current = Date.now() + RESPAWN_DELAY;
        }
        // 自分がキラーならキル通知
        if (msg.killerId === myId && msg.victimId !== myId) {
          const v = playersRef.current.get(msg.victimId);
          setKillNotification({ victimName: msg.victimId.slice(0, 6), color: v?.color ?? "white" });
          setTimeout(() => setKillNotification(null), 1500);
        }
        // 爆発エフェクトを追加
        const victim = playersRef.current.get(msg.victimId);
        if (victim) {
          setExplosions((prev) => [
            ...prev,
            {
              id: `${msg.victimId}-${Date.now()}`,
              pos: { t: victim.phaseSpace.pos.t, x: victim.phaseSpace.pos.x, y: victim.phaseSpace.pos.y, z: 0 },
              color: victim.color,
              startTime: Date.now(),
            },
          ]);
        }
      }
    });

    return () => {
      peerManager.offMessage("relativistic");
    };
  }, [peerManager, myId]);

  // ウィンドウリサイズの検出
  useEffect(() => {
    const handleResize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // キーボード入力処理
  useEffect(() => {
    const normalizeKey = (key: string) => {
      // 矢印キーはそのまま、それ以外は小文字に
      if (key.startsWith("Arrow")) return key;
      return key.toLowerCase();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // 矢印キーとW/Sキーとスペースキーの場合はデフォルトの動作（スクロール）を防ぐ
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "w",
          "W",
          "s",
          "S",
          " ",
        ].includes(e.key)
      ) {
        e.preventDefault();
      }
      keysPressed.current.add(normalizeKey(e.key));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(normalizeKey(e.key));
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ゲームループ
  useEffect(() => {
    if (!peerManager || !myId) return;

    const gameLoop = () => {
      const currentTime = Date.now();
      const rawDTau = (currentTime - lastTimeRef.current) / 1000;
      const dTau = Math.min(rawDTau, 0.1); // 上限100ms（タブ復帰時の巨大ジャンプ防止）
      lastTimeRef.current = currentTime;

      // 期限切れの爆発エフェクトを削除
      setExplosions((prev) => {
        const alive = prev.filter((e) => currentTime - e.startTime < EXPLOSION_DURATION);
        return alive.length === prev.length ? prev : alive;
      });

      // FPS計算
      const now = performance.now();
      fpsRef.current.frameCount++;
      const elapsed = now - fpsRef.current.lastTime;

      if (elapsed >= 1000) {
        const calculatedFps = Math.round(
          (fpsRef.current.frameCount * 1000) / elapsed,
        );
        setFps(calculatedFps);
        fpsRef.current.frameCount = 0;
        fpsRef.current.lastTime = now;
      }

      // カメラ制御: 左右キーでyaw回転、上下キーでpitch回転（プレイヤーを中心に球面上を移動）
      const yawSpeed = 1.5; // rad/s
      const pitchSpeed = 1.0; // rad/s
      const pitchMin = (-Math.PI * 89.9) / 180; // 下限
      const pitchMax = (Math.PI * 89.9) / 180; // 上限

      if (keysPressed.current.has("ArrowLeft")) {
        cameraYawRef.current += yawSpeed * dTau;
      }
      if (keysPressed.current.has("ArrowRight")) {
        cameraYawRef.current -= yawSpeed * dTau;
      }
      if (keysPressed.current.has("ArrowUp")) {
        cameraPitchRef.current = Math.min(
          pitchMax,
          cameraPitchRef.current + pitchSpeed * dTau,
        );
      }
      if (keysPressed.current.has("ArrowDown")) {
        cameraPitchRef.current = Math.max(
          pitchMin,
          cameraPitchRef.current - pitchSpeed * dTau,
        );
      }

      // 死亡中は物理更新・レーザー発射・ネットワーク送信をスキップ
      const isDead = currentTime < deadUntilRef.current;

      // レーザー発射（スペースキー）
      const laserCooldown = 100; // ミリ秒
      if (
        !isDead &&
        keysPressed.current.has(" ") &&
        currentTime - lastLaserTimeRef.current > laserCooldown
      ) {
        const myPlayer = playersRef.current.get(myId);
        if (myPlayer) {
          lastLaserTimeRef.current = currentTime;

          // カメラyawから方向を計算
          const dx = Math.cos(cameraYawRef.current);
          const dy = Math.sin(cameraYawRef.current);

          const newLaser: Laser = {
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

          // ローカルで追加
          setLasers((prev) => {
            const updated = [...prev, newLaser];
            // 最大数を超えたら古いものを削除
            if (updated.length > MAX_LASERS) {
              return updated.slice(updated.length - MAX_LASERS);
            }
            return updated;
          });

          // ネットワーク送信
          const laserMsg = {
            type: "laser" as const,
            id: newLaser.id,
            playerId: newLaser.playerId,
            emissionPos: newLaser.emissionPos,
            direction: newLaser.direction,
            range: newLaser.range,
            color: newLaser.color,
          };

          if (peerManager.getIsHost()) {
            peerManager.send(laserMsg);
          } else {
            const hostId = peerManager.getHostId();
            if (hostId) {
              peerManager.sendTo(hostId, laserMsg);
            }
          }
        }
      }

      if (isDead) {
        // 死亡中: 当たり判定のみ実行（物理更新・送信はスキップ）
      } else setPlayers((prev) => {
        const myPlayer = prev.get(myId);
        if (!myPlayer) return prev;
        // 他の誰かの未来光円錐を未来側に超えてしまうと因果律の守護者に時間停止を喰らう
        for (const [id, player] of prev) {
          if (id === myId) continue;
          if (player.phaseSpace.pos.t > myPlayer.phaseSpace.pos.t) continue;
          const diff = subVector4(
            player.phaseSpace.pos,
            myPlayer.phaseSpace.pos,
          );
          const l = lorentzDotVector4(diff, diff);
          if (l < 0) return prev;
        }

        const next = new Map(prev);

        // 加速度を計算（W/Sキー入力に基づく、カメラの向きに沿った方向）
        let forwardAccel = 0;
        const accel = 8 / 10; // 加速度 (c/s)

        if (keysPressed.current.has("w")) forwardAccel += accel;
        if (keysPressed.current.has("s")) forwardAccel -= accel;

        // カメラの向き（yaw）から前進方向を計算
        const ax = Math.cos(cameraYawRef.current) * forwardAccel;
        const ay = Math.sin(cameraYawRef.current) * forwardAccel;

        // 摩擦
        const mu = 0.5;
        const frictionX = -myPlayer.phaseSpace.u.x * mu;
        const frictionY = -myPlayer.phaseSpace.u.y * mu;

        const acceleration = createVector3(ax + frictionX, ay + frictionY, 0);

        // 相対論的運動方程式で更新
        const newPhaseSpace = evolvePhaseSpace(
          myPlayer.phaseSpace,
          acceleration,
          dTau,
        );
        const updatedWorldLine = appendWorldLine(
          myPlayer.worldLine,
          newPhaseSpace,
        );
        next.set(myId, {
          ...myPlayer,
          phaseSpace: newPhaseSpace,
          worldLine: updatedWorldLine,
        });

        // 他のプレイヤーに送信（クライアントは syncTime 受信後のみ）
        if (peerManager) {
          const isHost = peerManager.getIsHost();
          if (isHost || timeSyncedRef.current) {
            const msg = {
              type: "phaseSpace" as const,
              senderId: myId,
              position: newPhaseSpace.pos,
              velocity: newPhaseSpace.u,
            };

            if (isHost) {
              // ホストは直接全員に送信
              peerManager.send(msg);
            } else {
              // クライアントはホストにのみ送信
              const hostId = peerManager.getHostId();
              if (hostId) {
                peerManager.sendTo(hostId, msg);
              }
            }
          }
        }

        return next;
      });

      // ホストのみ: 当たり判定
      if (peerManager.getIsHost()) {
        const currentPlayers = playersRef.current;
        const currentLasers = lasersRef.current;
        const hitLaserIds: string[] = [];
        const kills: { victimId: string; killerId: string }[] = [];

        // 全プレイヤーの最小 t を取得（レーザー期限切れ判定用）
        let minPlayerT = Number.POSITIVE_INFINITY;
        for (const [, player] of currentPlayers) {
          if (player.phaseSpace.pos.t < minPlayerT) {
            minPlayerT = player.phaseSpace.pos.t;
          }
        }

        const killedThisFrame = new Set<string>(); // 同フレーム二重キル防止
        for (const laser of currentLasers) {
          if (processedLasersRef.current.has(laser.id)) continue;

          // レーザーの到達時刻を超えていたらもう当たらない → 判定済みにする
          const laserEndT = laser.emissionPos.t + laser.range;
          if (minPlayerT > laserEndT) {
            processedLasersRef.current.add(laser.id);
            continue;
          }

          for (const [playerId, player] of currentPlayers) {
            if (playerId === laser.playerId) continue; // 自分のレーザーは除外
            if (killedThisFrame.has(playerId)) continue; // 既にこのフレームでキル済み
            if (checkLaserHit(laser, player.worldLine, HIT_RADIUS)) {
              kills.push({ victimId: playerId, killerId: laser.playerId });
              hitLaserIds.push(laser.id);
              killedThisFrame.add(playerId);
              break; // 1レーザーにつき1キルまで
            }
          }
        }

        // processedLasersRef のクリーンアップ: lasers に存在しないIDを除去
        const currentLaserIds = new Set(currentLasers.map((l) => l.id));
        for (const id of processedLasersRef.current) {
          if (!currentLaserIds.has(id)) {
            processedLasersRef.current.delete(id);
          }
        }

        if (kills.length > 0) {
          // スコア更新
          const newScores = { ...scoresRef.current };
          for (const { killerId } of kills) {
            newScores[killerId] = (newScores[killerId] || 0) + 1;
          }
          scoresRef.current = newScores;
          setScores(newScores);

          // 判定済みレーザーを記録
          for (const id of hitLaserIds) {
            processedLasersRef.current.add(id);
          }

          // キル通知 → 爆発エフェクト → 遅延リスポーン
          for (const { victimId, killerId } of kills) {
            const victim = currentPlayers.get(victimId);
            const deathPos = victim
              ? { t: victim.phaseSpace.pos.t, x: victim.phaseSpace.pos.x, y: victim.phaseSpace.pos.y, z: 0 }
              : { t: 0, x: 0, y: 0, z: 0 };

            // kill 通知をブロードキャスト
            peerManager.send({ type: "kill" as const, victimId, killerId });

            // 自分が死んだら画面フラッシュ + 物理停止
            if (victimId === myId) {
              setDeathFlash(true);
              setTimeout(() => setDeathFlash(false), 600);
              deadUntilRef.current = Date.now() + RESPAWN_DELAY;
            }
            // 自分がキラーならキル通知
            if (killerId === myId && victimId !== myId) {
              setKillNotification({ victimName: victimId.slice(0, 6), color: victim?.color ?? "white" });
              setTimeout(() => setKillNotification(null), 1500);
            }

            // ローカルで爆発エフェクト追加
            setExplosions((prev) => [
              ...prev,
              { id: `${victimId}-${Date.now()}`, pos: deathPos, color: victim?.color ?? "white", startTime: Date.now() },
            ]);

            // 遅延リスポーン
            setTimeout(() => {
              const hostPlayer = playersRef.current.get(myId);
              const hostT = hostPlayer?.phaseSpace.pos.t ?? 0;
              const respawnPos = {
                t: hostT,
                x: Math.random() * 100,
                y: Math.random() * 100,
                z: 0,
              };

              peerManager.send({ type: "respawn" as const, playerId: victimId, position: respawnPos });

              // ローカルでもリスポーン適用（worldLine を退避して切断）
              setPlayers((prev) => {
                const v = prev.get(victimId);
                if (!v) return prev;
                const respawnPhaseSpace = createPhaseSpace(
                  createVector4(respawnPos.t, respawnPos.x, respawnPos.y, respawnPos.z),
                  vector3Zero(),
                );
                let worldLine = createWorldLine();
                worldLine = appendWorldLine(worldLine, respawnPhaseSpace);
                const pastWorldLines = v.worldLine.history.length > 1
                  ? [...v.pastWorldLines, v.worldLine].slice(-MAX_PAST_WORLDLINES)
                  : v.pastWorldLines;
                const next = new Map(prev);
                next.set(victimId, { ...v, phaseSpace: respawnPhaseSpace, worldLine, pastWorldLines });
                return next;
              });
            }, RESPAWN_DELAY);
          }

          peerManager.send({ type: "score" as const, scores: newScores });
        }
      }

    };

    // setInterval を使用（requestAnimationFrame はタブ非アクティブ時に停止するため）
    intervalRef.current = setInterval(gameLoop, 8); // ~120fps

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [peerManager, myId]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          color: "white",
          fontSize: "14px",
          fontFamily: "monospace",
          zIndex: 100,
        }}
      >
        <div>相対論的アリーナ (2+1次元 時空図)</div>
        <div>W/S: 前進/後退</div>
        <div>←/→: カメラ水平回転</div>
        <div>↑/↓: カメラ上下回転</div>
        <div>Space: レーザー発射</div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginTop: "6px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showInRestFrame}
            onChange={(e) => setShowInRestFrame(e.target.checked)}
          />
          <span>自分の静止系で表示</span>
        </label>
        <div style={{ opacity: 0.9 }}>
          表示系: {showInRestFrame ? "自分の静止系（デフォルト）" : "世界系"}
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={useOrthographic}
            onChange={(e) => setUseOrthographic(e.target.checked)}
          />
          <span>正射影カメラ</span>
        </label>
        <div
          style={{ marginTop: "5px", color: fps < 30 ? "#ff6666" : "#66ff66" }}
        >
          FPS: {fps}
        </div>
        <div style={{ marginTop: "2px", fontSize: "13px", opacity: 0.6 }}>
          build: {__BUILD_TIME__}
        </div>
        {Object.keys(scores).length > 0 && (
          <div style={{
            marginTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.3)",
            paddingTop: "6px",
            transition: "transform 0.15s ease-out",
            transform: killNotification ? "scale(1.4)" : "scale(1)",
            transformOrigin: "top left",
          }}>
            <div style={{ fontWeight: "bold", marginBottom: "2px" }}>Kill</div>
            {Object.entries(scores)
              .sort(([, a], [, b]) => b - a)
              .map(([id, kills]) => (
                <div key={id} style={{ color: players.get(id)?.color ?? "white" }}>
                  {id === myId ? "You" : id.slice(0, 6)}: {kills}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 速度計 */}
      {(() => {
        const myPlayer = myId ? players.get(myId) : undefined;
        if (!myPlayer) return null;
        const v = lengthVector3(myPlayer.phaseSpace.u);
        const g = gamma(myPlayer.phaseSpace.u);

        return (
          <div
            style={{
              position: "absolute",
              bottom: "10px",
              right: "10px",
              color: "white",
              fontSize: "14px",
              fontFamily: "monospace",
              textAlign: "right",
              zIndex: 100,
            }}
          >
            <div>速度: {(v * 100).toFixed(1)}% c</div>
            <div>ガンマ因子: {g.toFixed(3)}</div>
            <div>固有時間: {myPlayer.phaseSpace.pos.t.toFixed(2)}s</div>
            <div>
              位置: ({myPlayer.phaseSpace.pos.x.toFixed(2)},{" "}
              {myPlayer.phaseSpace.pos.y.toFixed(2)})
            </div>
          </div>
        );
      })()}

      {/* 死亡フラッシュ */}
      {deathFlash && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(255, 50, 50, 0.6)",
            zIndex: 200,
            pointerEvents: "none",
            animation: "flash-fade 0.6s ease-out forwards",
          }}
        />
      )}
      {/* キル通知 */}
      {killNotification && (
        <div
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 300,
            pointerEvents: "none",
            textAlign: "center",
            animation: "kill-notify 1.5s ease-out forwards",
          }}
        >
          <div style={{
            fontSize: "48px",
            fontWeight: "bold",
            fontFamily: "monospace",
            color: killNotification.color,
            textShadow: "0 0 20px rgba(255,215,0,0.8), 0 0 40px rgba(255,215,0,0.4)",
          }}>
            KILL
          </div>
          <div style={{
            fontSize: "20px",
            color: killNotification.color,
            opacity: 0.9,
          }}>
            {killNotification.victimName}
          </div>
        </div>
      )}

      {/* 金色ボーダーグロー（キル時） */}
      {killNotification && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 199,
            pointerEvents: "none",
            boxShadow: "inset 0 0 80px rgba(255,215,0,0.5), inset 0 0 30px rgba(255,215,0,0.3)",
            animation: "kill-glow 1.5s ease-out forwards",
          }}
        />
      )}

      <style>{`
        @keyframes flash-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes kill-notify {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
          30% { transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -60%) scale(1); }
        }
        @keyframes kill-glow {
          0% { opacity: 0; }
          15% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      {useOrthographic ? (
        <Canvas key="ortho" orthographic camera={{ zoom: 30, position: [0, 0, 100], near: -10000, far: 10000 }}>
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            explosions={explosions}
            showInRestFrame={showInRestFrame}
            useOrthographic={true}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
          />
        </Canvas>
      ) : (
        <Canvas key="persp" camera={{ position: [0, 0, 0], fov: 75 }}>
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            explosions={explosions}
            showInRestFrame={showInRestFrame}
            useOrthographic={false}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
          />
        </Canvas>
      )}
    </div>
  );
};

export default RelativisticGame;
