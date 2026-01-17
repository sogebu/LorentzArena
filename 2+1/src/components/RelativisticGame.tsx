import { useEffect, useRef, useState, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePeer } from "../hooks/usePeer";
import {
  type PhaseSpace,
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
  lorentzDotVector4,
  subVector4,
  pastLightConeIntersectionWorldLine,
} from "../physics";

const OFFSET = Date.now() / 1000;

type RelativisticPlayer = {
  id: string;
  // in 世界系
  phaseSpace: PhaseSpace;
  worldLine: WorldLine;
  color: string;
};

// ゲーム内での光速（単位/秒）
const LIGHT_SPEED = 10;

// IDから色を生成する関数（高彩度で視認性の良い色）
const getColorFromId = (id: string): string => {
  // IDをハッシュ化して数値に変換
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // 32bit整数に変換
  }

  // ハッシュ値から色相（Hue）を決定（0-360度）
  const hue = Math.abs(hash) % 360;

  // 高彩度（85-100%）で視認性を確保
  const saturation = 85 + (Math.abs(hash >> 8) % 16);

  // 明度は中程度（50-65%）で見やすく
  const lightness = 50 + (Math.abs(hash >> 16) % 16);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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
  intersectionSphere: new THREE.SphereGeometry(0.3, 16, 16),
  lightCone: new THREE.ConeGeometry(40, 40, 32, 1, true),
};

// Material キャッシュ（プレイヤーID + タイプごと）
const materialCache = new Map<string, THREE.Material>();
const getMaterial = (
  key: string,
  factory: () => THREE.Material
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
const WorldLineRenderer = ({ player }: { player: RelativisticPlayer }) => {
  const [geometry, setGeometry] = useState<THREE.TubeGeometry | null>(null);
  const prevLengthRef = useRef<number>(0);

  const history = player.worldLine.history;
  const historyLength = history.length;

  // history.length が変わったときだけ geometry を再生成
  useEffect(() => {
    if (historyLength < 2) return;
    if (historyLength === prevLengthRef.current) return;

    const points: THREE.Vector3[] = history.map(
      (ps) => new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t),
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
    prevLengthRef.current = historyLength;
  }, [history, historyLength]);

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
  const material = getMaterial(`worldline-${player.id}`, () =>
    new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.9,
    })
  );

  if (!geometry) return null;

  return <mesh geometry={geometry} material={material} />;
};

// 3Dシーンコンテンツコンポーネント
type SceneContentProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  cameraYawRef: React.RefObject<number>; // カメラのxy平面内での向き（ラジアン）
  cameraTimeOffsetRef: React.RefObject<number>; // カメラの時間軸方向オフセット（負=過去側、正=未来側）
};

const SceneContent = ({ players, myId, cameraYawRef, cameraTimeOffsetRef }: SceneContentProps) => {
  // カメラの位置をプレイヤー位置から計算
  useFrame(({ camera }) => {
    if (!myId) return;
    const myPlayer = players.get(myId);
    if (!myPlayer) return;

    const myPos = myPlayer.phaseSpace.pos;
    // カメラの距離（xy平面内）
    const cameraDistance = 15;
    // カメラ位置: プレイヤー位置から cameraYaw 方向に離れた位置、時間軸は cameraTimeOffset 分ずらす
    const cameraYaw = cameraYawRef.current;
    const cameraTimeOffset = cameraTimeOffsetRef.current;
    const camX = myPos.x - Math.cos(cameraYaw) * cameraDistance;
    const camY = myPos.y - Math.sin(cameraYaw) * cameraDistance;
    const camT = myPos.t + cameraTimeOffset;

    camera.position.set(camX, camY, camT);
    camera.lookAt(myPos.x, myPos.y, myPos.t);
    camera.up.set(0, 0, 1);
  });

  // プレイヤーリストをメモ化
  const playerList = useMemo(() => Array.from(players.values()), [players]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />

      {/* 全プレイヤーの world line を描画 */}
      {playerList.map((player) => (
        <WorldLineRenderer key={`worldline-${player.id}`} player={player} />
      ))}

      {/* 各プレイヤーのマーカー */}
      {playerList.map((player) => {
        const pos = player.phaseSpace.pos;
        const isMe = player.id === myId;
        const color = getThreeColor(player.color);
        const size = isMe ? 0.2 : 0.1;
        const material = getMaterial(`player-${player.id}-${isMe}`, () =>
          new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: isMe ? 0.8 : 0.5,
          })
        );

        return (
          <mesh
            key={`player-${player.id}`}
            position={[pos.x, pos.y, pos.t]}
            scale={[size, size, size]}
            geometry={sharedGeometries.playerSphere}
            material={material}
          />
        );
      })}

      {/* 各プレイヤーの光円錐を描画 */}
      {playerList.map((player) => {
        const pos = player.phaseSpace.pos;
        const isMe = player.id === myId;
        const color = getThreeColor(player.color);
        const coneHeight = 40;
        const coneMaterial = getMaterial(`lightcone-${player.id}-${isMe}`, () =>
          new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: isMe ? 0.5 : 0.4,
            side: THREE.DoubleSide,
            wireframe: true,
          })
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

      {/* 自分の過去光円錐と他プレイヤーの世界線の交点（または最新点） */}
      {myId &&
        (() => {
          const myPlayer = players.get(myId);
          if (!myPlayer) return null;

          return playerList
            .filter((player) => player.id !== myId)
            .map((player) => {
              const intersection = pastLightConeIntersectionWorldLine(
                player.worldLine,
                myPlayer.phaseSpace.pos,
              );
              // 交点がない場合は世界線の最新点を使用
              const displayState =
                intersection ||
                player.worldLine.history[player.worldLine.history.length - 1];
              if (!displayState) return null;

              const pos = displayState.pos;
              const color = getThreeColor(player.color);
              const material = getMaterial(`intersection-${player.id}`, () =>
                new THREE.MeshStandardMaterial({
                  color: color,
                  emissive: color,
                  emissiveIntensity: 1.0,
                })
              );

              return (
                <mesh
                  key={`intersection-${player.id}`}
                  position={[pos.x, pos.y, pos.t]}
                  geometry={sharedGeometries.intersectionSphere}
                  material={material}
                />
              );
            });
        })()}

    </>
  );
};

const RelativisticGame = () => {
  const { peerManager, myId } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const [_screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  // カメラ制御用の状態（ref のみで管理し、不要な再レンダーを防ぐ）
  const cameraYawRef = useRef(0); // xy平面内でのカメラの向き（ラジアン）
  const cameraTimeOffsetRef = useRef(-5); // 時間軸方向のオフセット（負=過去側から見る）

  // 初期化
  useEffect(() => {
    if (!myId) return;

    // 自分のプレイヤーを初期化（まだ存在しない場合のみ）
    setPlayers((prev) => {
      if (prev.has(myId)) {
        return prev;
      }

      const initialPhaseSpace = createPhaseSpace(
        createVector4(Date.now() / 1000 - OFFSET, Math.random() * 10, Math.random() * 10, 0.0),
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
      // 矢印キーとW/Sキーの場合はデフォルトの動作（スクロール）を防ぐ
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(e.key)) {
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

      // カメラ制御: 左右キーでyaw回転、上下キーで時間軸オフセット
      const yawSpeed = 1.5; // rad/s
      const timeOffsetSpeed = 10; // units/s

      if (keysPressed.current.has("ArrowLeft")) {
        cameraYawRef.current += yawSpeed * dTau;
      }
      if (keysPressed.current.has("ArrowRight")) {
        cameraYawRef.current -= yawSpeed * dTau;
      }
      if (keysPressed.current.has("ArrowUp")) {
        cameraTimeOffsetRef.current -= timeOffsetSpeed * dTau; // 過去側へ移動 → 未来が見える
      }
      if (keysPressed.current.has("ArrowDown")) {
        cameraTimeOffsetRef.current += timeOffsetSpeed * dTau; // 未来側へ移動 → 過去が見える
      }

      setPlayers((prev) => {
        const myPlayer = prev.get(myId);
        if (!myPlayer) return prev;
        // 他の誰かの未来光円錐を未来側に超えてしまうと因果律の守護者に時間停止を喰らう
        for (const [id, player] of prev) {
          if (id === myId) continue;
          if (player.phaseSpace.pos.t > myPlayer.phaseSpace.pos.t) continue;
          const diff = subVector4(player.phaseSpace.pos, myPlayer.phaseSpace.pos);
          const l = lorentzDotVector4(diff, diff);
          if (l < 0) return prev;
        }

        const next = new Map(prev);

        // 加速度を計算（W/Sキー入力に基づく、カメラの向きに沿った方向）
        let forwardAccel = 0;
        const accel = 4 / LIGHT_SPEED; // 加速度 (c/s)

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
        <div>←/→: カメラ回転</div>
        <div>↑/↓: 時間軸移動</div>
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
            <div>
              固有時間: {(myPlayer.phaseSpace.pos.t).toFixed(2)}s
            </div>
            <div>
              位置: ({myPlayer.phaseSpace.pos.x.toFixed(2)},{" "}
              {myPlayer.phaseSpace.pos.y.toFixed(2)})
            </div>
          </div>
        );
      })()}

      <Canvas camera={{ position: [0, 0, 0], fov: 75 }}>
        <SceneContent players={players} myId={myId} cameraYawRef={cameraYawRef} cameraTimeOffsetRef={cameraTimeOffsetRef} />
      </Canvas>
    </div>
  );
};

export default RelativisticGame;
