import { useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import WebGLGrid from "./WebGLGrid";
import {
  type Vector3,
  type PhaseSpace,
  type WorldLine,
  createVector3,
  lengthVector3,
  vector3Zero,
  gamma,
  createWorldLine,
  appendWorldLine,
  pastLightConeIntersectionWorldLine,
  createPhaseSpace,
  createVector4,
  evolvePhaseSpace,
  subVector4,
} from "../physics";

type RelativisticPlayer = {
  id: string;
  // in 世界系
  phaseSpace: PhaseSpace;
  worldLine: WorldLine;
  color: string;
};

// ゲーム内での光速（ピクセル/秒）
const LIGHT_SPEED = 200;

// ドップラー効果による色の計算
const calculateDopplerColor = (
  velocity: Vector3,
  baseColor: string,
): string => {
  const beta = lengthVector3(velocity);

  // 速度が0の場合は基本色を返す
  if (beta === 0) {
    return baseColor === "blue" ? "rgb(128, 128, 255)" : "rgb(255, 128, 128)";
  }

  const g = gamma(velocity);

  // 簡略化されたドップラー効果
  // 接近: 青方偏移、離脱: 赤方偏移
  const dopplerFactor = g * (1 - (beta * velocity.x) / beta);

  if (baseColor === "blue") {
    const intensity = Math.max(0, Math.min(255, 128 * dopplerFactor));
    return `rgb(${intensity}, ${intensity}, 255)`;
  }
  const intensity = Math.max(0, Math.min(255, 255 / dopplerFactor));
  return `rgb(255, ${255 - intensity}, ${255 - intensity})`;
};

// グリッドの設定
const GRID_SIZE = 30; // ピクセル単位（より密なグリッド）

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
        createVector4(
          Date.now() / 1000,
          0.0,0.0,0.0,
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
        color: "blue",
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
          
          const phaseSpace = createPhaseSpace(
            msg.position,
            msg.velocity,
          );

          // 既存のプレイヤーのワールドラインに追加、または新規作成
          const existing = prev.get(id);
          let worldLine = existing?.worldLine || createWorldLine();
          worldLine = appendWorldLine(worldLine, phaseSpace);

          next.set(id, {
            id,
            phaseSpace,
            worldLine,
            color: "red",
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
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
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
          const accel = 100 / LIGHT_SPEED; // 加速度 (c/s)

          if (keysPressed.current.has("ArrowLeft")) ax -= accel;
          if (keysPressed.current.has("ArrowRight")) ax += accel;
          if (keysPressed.current.has("ArrowUp")) ay -= accel;
          if (keysPressed.current.has("ArrowDown")) ay += accel;

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

  // グリッドをレンダリング
  const renderGrid = () => {
    const myPlayer = myId ? players.get(myId) : undefined;
    if (!myPlayer) return null;

    return (
      <WebGLGrid
        observerPhaseSpace={myPlayer.phaseSpace}
        screenSize={screenSize}
        LIGHT_SPEED={LIGHT_SPEED}
        GRID_SIZE={GRID_SIZE}
      />
    );
  };

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
        }}
      >
        <div>相対論的アリーナ</div>
        <div>
          矢印キーで移動 (光速の{((1 / LIGHT_SPEED) * 100).toFixed(1)}%/s
          の加速度)
        </div>
        <div
          style={{ marginTop: "5px", color: fps < 30 ? "#ff6666" : "#66ff66" }}
        >
          FPS: {fps}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {renderGrid()}
      </div>

      {/* 自機を常に表示 */}
      {myId &&
        (() => {
          const myPlayer = myId ? players.get(myId) : undefined;
          const vel = myPlayer?.phaseSpace.u ?? vector3Zero();
          const g = gamma(vel);
          const color = myPlayer?.color || "blue";
          const contractionFactor = 1 / g;
          const angle = Math.atan2(vel.y, vel.x);

          return (
            <div
              key="my-player"
              style={{
                position: "absolute",
                left: screenSize.width / 2,
                top: screenSize.height / 2,
                width: "40px",
                height: "40px",
                backgroundColor: myPlayer
                  ? calculateDopplerColor(vel, color)
                  : "blue",
                borderRadius: "50%",
                transform: `translate(-50%, -50%) rotate(${angle}rad) scaleX(${contractionFactor})`,
                boxShadow: `0 0 ${20 * g}px ${myPlayer ? calculateDopplerColor(vel, color) : "blue"}`,
                transition: "none",
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "-30px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  color: "white",
                  fontSize: "10px",
                  whiteSpace: "nowrap",
                  textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
                }}
              >
                You
                <br />v = {(lengthVector3(vel) * 100).toFixed(1)}% c
                <br />γ = {g.toFixed(2)}
                <br />τ ={" "}
                {myPlayer
                  ? myPlayer.phaseSpace.pos.t.toFixed(2)
                  : "0.00"}
              </div>
            </div>
          );
        })()}

      {/* 他のプレイヤー */}
      {Array.from(players.values()).map((player) => {
        if (player.id === myId) return null; // 自機はスキップ

        const myPlayer = myId ? players.get(myId) : undefined;
        if (!myPlayer) return null;

        // 他プレイヤーは過去光円錐との交点を使用
        const displayPhaseSpace = pastLightConeIntersectionWorldLine(player.worldLine, myPlayer.phaseSpace.pos);
        if (!displayPhaseSpace) return null;
        const relativePos = subVector4(
          displayPhaseSpace.pos,
          myPlayer.phaseSpace.pos,
        );
        const displayPos = {
          x: relativePos.x * LIGHT_SPEED + screenSize.width / 2,
          y: relativePos.y * LIGHT_SPEED + screenSize.height / 2,
        };

        const u = displayPhaseSpace.u;
        const g = gamma(u);

        // ローレンツ収縮を表現（進行方向に縮む）
        const contractionFactor = 1 / g;
        const angle = Math.atan2(u.y, u.x);

        return (
          <div
            key={player.id}
            style={{
              position: "absolute",
              left: displayPos.x,
              top: displayPos.y,
              width: "40px",
              height: "40px",
              backgroundColor: calculateDopplerColor(myPlayer.phaseSpace.u, player.color),
              borderRadius: "50%",
              transform: `translate(-50%, -50%) rotate(${angle}rad) scaleX(${contractionFactor})`,
              boxShadow: `0 0 ${20 * g}px ${calculateDopplerColor(u, player.color)}`,
              transition: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "-30px",
                left: "50%",
                transform: "translateX(-50%)",
                color: "white",
                fontSize: "10px",
                whiteSpace: "nowrap",
                textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
              }}
            >
              {player.id === myId ? "You" : player.id.substring(0, 8)}
              <br />v = {(lengthVector3(u) * 100).toFixed(1)}% c
              <br />τ = {displayPhaseSpace.pos.t.toFixed(2)}
              <br />γ = {g.toFixed(2)}
            </div>
          </div>
        );
      })}

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
            }}
          >
            <div>速度: {(v * 100).toFixed(1)}% c</div>
            <div>ガンマ因子: {g.toFixed(3)}</div>
            <div>
              固有時間:{" "}
              {myPlayer.phaseSpace.pos.t.toFixed(2)}s
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default RelativisticGame;
