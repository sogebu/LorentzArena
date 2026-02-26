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

// レーザーの射程
const LASER_RANGE = 20;

// レーザーの最大数（メモリ管理）
const MAX_LASERS = 1000;

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

// 3Dシーンコンテンツコンポーネント
type SceneContentProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  lasers: Laser[];
  showInRestFrame: boolean;
  cameraYawRef: React.RefObject<number>; // カメラのxy平面内での向き（ラジアン）
  cameraPitchRef: React.RefObject<number>; // カメラの仰角（ラジアン、0=水平、正=上から見下ろす）
};

const SceneContent = ({
  players,
  myId,
  lasers,
  showInRestFrame,
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
    const cameraDistance = 15;
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

      {/* 全プレイヤーの world line を描画 */}
      {playerList.map((player) => (
        <WorldLineRenderer
          key={`worldline-${player.id}`}
          player={player}
          observerPos={observerPos}
          observerBoost={observerBoost}
        />
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
    </>
  );
};

const RelativisticGame = () => {
  const { peerManager, myId, connections } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const [lasers, setLasers] = useState<Laser[]>([]);
  const [showInRestFrame, setShowInRestFrame] = useState(true);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const lastLaserTimeRef = useRef<number>(0); // レーザー発射クールダウン用
  const playersRef = useRef<Map<string, RelativisticPlayer>>(new Map()); // ゲームループ用
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
          Math.random() * 10,
          Math.random() * 10,
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
        color: getColorFromId(myId),
      });
      return next;
    });
  }, [myId]);

  // playersRef を最新のplayers状態に同期
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  // 切断したプレイヤーを削除
  useEffect(() => {
    if (!myId) return;

    // 接続中のピアIDセット（自分自身を含む）
    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

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
  }, [connections, myId]);

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
            color: existing?.color || getColorFromId(playerId), // 既存の色を保持
          });
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
      const dTau = (currentTime - lastTimeRef.current) / 1000; // フレーム差分=固有時の増加量
      lastTimeRef.current = currentTime;

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

      // レーザー発射（スペースキー）
      const laserCooldown = 100; // ミリ秒
      if (
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

      setPlayers((prev) => {
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
        const accel = 4 / 10; // 加速度 (c/s)

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

        // 他のプレイヤーに送信
        if (peerManager) {
          const msg = {
            type: "phaseSpace" as const,
            senderId: myId,
            position: newPhaseSpace.pos,
            velocity: newPhaseSpace.u,
          };

          if (peerManager.getIsHost()) {
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

        return next;
      });

      animationRef.current = requestAnimationFrame(gameLoop);
    };

    animationRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
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
        <div
          style={{ marginTop: "5px", color: fps < 30 ? "#ff6666" : "#66ff66" }}
        >
          FPS: {fps}
        </div>
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

      <Canvas camera={{ position: [0, 0, 0], fov: 75 }}>
        <SceneContent
          players={players}
          myId={myId}
          lasers={lasers}
          showInRestFrame={showInRestFrame}
          cameraYawRef={cameraYawRef}
          cameraPitchRef={cameraPitchRef}
        />
      </Canvas>
    </div>
  );
};

export default RelativisticGame;
