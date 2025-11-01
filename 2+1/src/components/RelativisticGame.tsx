import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
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

// hsl文字列からThree.jsのColorオブジェクトに変換
const hslToThreeColor = (hslString: string): THREE.Color => {
  return new THREE.Color(hslString);
};

// 3Dシーンコンテンツコンポーネント
type SceneContentProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
};

const SceneContent = ({ players, myId }: SceneContentProps) => {
  // カメラの位置を自機の未来側に設定
  useFrame(({ camera }) => {
    if (!myId) return;
    const myPlayer = players.get(myId);
    if (!myPlayer) return;

    const myPos = myPlayer.phaseSpace.pos;
    // カメラを自機の若干未来側（+t方向）、少し上から見下ろす位置に配置
    camera.position.set(myPos.x, myPos.y + 10, myPos.t + 5 - OFFSET);
    camera.lookAt(myPos.x, myPos.y, myPos.t - OFFSET);
    camera.up.set(0, 0, 1);
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />

      {/* 全プレイヤーの world line を描画 */}
      {Array.from(players.values()).map((player) => {
        const history = player.worldLine.history;
        if (history.length < 2) return null;

        const points: THREE.Vector3[] = history.map(
          (ps) => new THREE.Vector3(ps.pos.x, ps.pos.y, ps.pos.t - OFFSET),
        );

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeometry = new THREE.TubeGeometry(
          curve,
          points.length * 2,
          0.05,
          8,
          false,
        );
        const color = hslToThreeColor(player.color);

        return (
          <mesh key={`worldline-${player.id}`} geometry={tubeGeometry}>
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.9}
            />
          </mesh>
        );
      })}

      {/* 各プレイヤーのマーカー */}
      {Array.from(players.values()).map((player) => {
        const pos = player.phaseSpace.pos;
        const isMe = player.id === myId;
        const color = hslToThreeColor(player.color);
        const size = isMe ? 0.2 : 0.1;

        return (
          <mesh
            key={`player-${player.id}`}
            position={[pos.x, pos.y, pos.t - OFFSET]}
          >
            <sphereGeometry args={[size, 8, 8]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isMe ? 0.8 : 0.5}
            />
          </mesh>
        );
      })}

      {/* 各プレイヤーの光円錐を描画 */}
      {Array.from(players.values()).map((player) => {
        const pos = player.phaseSpace.pos;
        const isMe = player.id === myId;
        const color = hslToThreeColor(player.color);
        const coneHeight = 40;
        const coneRadius = coneHeight; // 光速 = 1 の場合、半径 = 高さ

        return (
          <group key={`lightcone-${player.id}`}>
            {/* 未来光円錐 */}
            <mesh
              position={[pos.x, pos.y, pos.t + coneHeight / 2 - OFFSET]}
              rotation={[-Math.PI / 2, 0.0, 0.0]}
            >
              <coneGeometry args={[coneRadius, coneHeight, 32, 1, true]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isMe ? 0.5 : 0.4}
                side={THREE.DoubleSide}
                wireframe
              />
            </mesh>
            {/* 過去光円錐 */}
            <mesh
              position={[pos.x, pos.y, pos.t - coneHeight / 2 - OFFSET]}
              rotation={[Math.PI / 2, 0.0, 0.0]}
            >
              <coneGeometry args={[coneRadius, coneHeight, 32, 1, true]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isMe ? 0.5 : 0.4}
                side={THREE.DoubleSide}
                wireframe
              />
            </mesh>
          </group>
        );
      })}

      <OrbitControls enableDamping dampingFactor={0.05} />
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
  const [screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });

  // 初期化
  useEffect(() => {
    if (!myId) return;

    // 自分のプレイヤーを初期化（まだ存在しない場合のみ）
    setPlayers((prev) => {
      if (prev.has(myId)) {
        return prev;
      }

      const initialPhaseSpace = createPhaseSpace(
        createVector4(Date.now() / 1000, 0.0, 0.0, 0.0),
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
    peerManager.onMessage("relativistic", (id, msg) => {
      if (msg.type === "phaseSpace") {
        setPlayers((prev) => {
          const next = new Map(prev);

          const phaseSpace = createPhaseSpace(msg.position, msg.velocity);

          // 既存のプレイヤーのワールドラインに追加、または新規作成
          const existing = prev.get(id);
          let worldLine = existing?.worldLine || createWorldLine();
          worldLine = appendWorldLine(worldLine, phaseSpace);

          next.set(id, {
            id,
            phaseSpace,
            worldLine,
            color: existing?.color || getColorFromId(id), // 既存の色を保持
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
    const handleKeyDown = (e: KeyboardEvent) => {
      // 矢印キーの場合はデフォルトの動作（スクロール）を防ぐ
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
      }
      keysPressed.current.add(e.key);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key);
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

      setPlayers((prev) => {
        const next = new Map(prev);
        const myPlayer = next.get(myId);

        if (myPlayer) {
          // 加速度を計算（キー入力に基づく）
          let ax = 0;
          let ay = 0;
          const accel = 4 / LIGHT_SPEED; // 加速度 (c/s)

          if (keysPressed.current.has("ArrowLeft")) ax += accel;
          if (keysPressed.current.has("ArrowRight")) ax -= accel;
          if (keysPressed.current.has("ArrowUp")) ay += accel;
          if (keysPressed.current.has("ArrowDown")) ay -= accel;

          const acceleration = createVector3(ax, ay, 0);

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
            peerManager.send({
              type: "phaseSpace",
              position: newPhaseSpace.pos,
              velocity: newPhaseSpace.u,
            });
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
        <div>矢印キーで移動</div>
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
              固有時間: {(myPlayer.phaseSpace.pos.t - OFFSET).toFixed(2)}s
            </div>
            <div>
              位置: ({myPlayer.phaseSpace.pos.x.toFixed(2)},{" "}
              {myPlayer.phaseSpace.pos.y.toFixed(2)})
            </div>
          </div>
        );
      })()}

      <Canvas camera={{ position: [0, 0, 0], fov: 75 }}>
        <SceneContent players={players} myId={myId} />
      </Canvas>
    </div>
  );
};

export default RelativisticGame;
