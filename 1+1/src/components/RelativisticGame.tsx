import { useEffect, useRef, useState } from "react";
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
        createVector4(Date.now() / 1000, Math.random() * 10, 0.0, 0.0),
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
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
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
        // 加速度を計算（キー入力に基づく）
        let ax = 0;
        const accel = 100 / LIGHT_SPEED; // 加速度 (c/s)

        if (keysPressed.current.has("ArrowLeft")) ax -= accel;
        if (keysPressed.current.has("ArrowRight")) ax += accel;

        const acceleration = createVector3(ax, 0, 0);

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

  // 時空図での座標変換（自分のプレイヤーを基準とする）
  const toScreenCoords = (
    pos: { t: number; x: number },
    myPos: { t: number; x: number },
  ) => {
    return {
      x: (pos.x - myPos.x) * LIGHT_SPEED + screenSize.width / 2,
      y: (myPos.t - pos.t) * LIGHT_SPEED + screenSize.height / 2, // 上が未来、下が過去
    };
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
        <div>相対論的アリーナ (1+1次元 時空図)</div>
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

      {/* World Lines と時空図の座標軸を SVG で描画 */}
      {myId &&
        (() => {
          const myPlayer = players.get(myId);
          if (!myPlayer) return null;

          const centerX = screenSize.width / 2;
          const centerY = screenSize.height / 2;

          return (
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {/* 時空図の座標軸 */}
              {/* x軸（空間軸）*/}
              <line
                x1={0}
                y1={centerY}
                x2={screenSize.width}
                y2={centerY}
                stroke="#333333"
                strokeWidth={1}
                strokeDasharray="5,5"
              />
              {/* t軸（時間軸）*/}
              <line
                x1={centerX}
                y1={0}
                x2={centerX}
                y2={screenSize.height}
                stroke="#333333"
                strokeWidth={1}
                strokeDasharray="5,5"
              />

              {/* 軸ラベル */}
              <text
                x={screenSize.width - 30}
                y={centerY - 10}
                fill="#888888"
                fontSize="14"
                fontFamily="monospace"
              >
                x
              </text>
              <text
                x={centerX + 10}
                y={20}
                fill="#888888"
                fontSize="14"
                fontFamily="monospace"
              >
                t (未来)
              </text>

              {/* 全プレイヤーの world line を描画 */}
              {Array.from(players.values()).map((player) => {
                const history = player.worldLine.history;
                if (history.length < 2) return null;

                // world line の各点を画面座標に変換
                const points = history.map((phaseSpace) =>
                  toScreenCoords(
                    { t: phaseSpace.pos.t, x: phaseSpace.pos.x },
                    {
                      t: myPlayer.phaseSpace.pos.t,
                      x: myPlayer.phaseSpace.pos.x,
                    },
                  ),
                );

                // 画面外の点を除外して SVG パスを生成
                const pathData = points.reduce((acc, point, idx) => {
                  const isVisible =
                    point.x >= -100 &&
                    point.x <= screenSize.width + 100 &&
                    point.y >= -100 &&
                    point.y <= screenSize.height + 100;

                  if (!isVisible) return acc;

                  if (idx === 0 || acc === "") {
                    return `M ${point.x} ${point.y}`;
                  }
                  return `${acc} L ${point.x} ${point.y}`;
                }, "");

                if (pathData === "") return null;

                const isMe = player.id === myId;

                return (
                  <path
                    key={player.id}
                    d={pathData}
                    stroke={player.color}
                    strokeWidth={isMe ? 3 : 2}
                    fill="none"
                    opacity={0.8}
                  />
                );
              })}

              {/* 各プレイヤーの光円錐を描画 */}
              {Array.from(players.values()).map((player) => {
                const playerScreenPos = toScreenCoords(
                  { t: player.phaseSpace.pos.t, x: player.phaseSpace.pos.x },
                  {
                    t: myPlayer.phaseSpace.pos.t,
                    x: myPlayer.phaseSpace.pos.x,
                  },
                );

                const isMe = player.id === myId;
                const coneColor = player.color;
                const coneOpacity = isMe ? 0.5 : 0.3;

                // 光円錐の長さ（画面の対角線の長さを使用）
                const coneLength = Math.max(
                  screenSize.width,
                  screenSize.height,
                );

                return (
                  <g key={`lightcone-${player.id}`}>
                    {/* 未来の光円錐（右上）*/}
                    <line
                      x1={playerScreenPos.x}
                      y1={playerScreenPos.y}
                      x2={playerScreenPos.x + coneLength}
                      y2={playerScreenPos.y - coneLength}
                      stroke={coneColor}
                      strokeWidth={isMe ? 1.5 : 1}
                      strokeDasharray="3,3"
                      opacity={coneOpacity}
                    />
                    {/* 未来の光円錐（左上）*/}
                    <line
                      x1={playerScreenPos.x}
                      y1={playerScreenPos.y}
                      x2={playerScreenPos.x - coneLength}
                      y2={playerScreenPos.y - coneLength}
                      stroke={coneColor}
                      strokeWidth={isMe ? 1.5 : 1}
                      strokeDasharray="3,3"
                      opacity={coneOpacity}
                    />
                    {/* 過去の光円錐（右下）*/}
                    <line
                      x1={playerScreenPos.x}
                      y1={playerScreenPos.y}
                      x2={playerScreenPos.x + coneLength}
                      y2={playerScreenPos.y + coneLength}
                      stroke={coneColor}
                      strokeWidth={isMe ? 1.5 : 1}
                      strokeDasharray="3,3"
                      opacity={coneOpacity}
                    />
                    {/* 過去の光円錐（左下）*/}
                    <line
                      x1={playerScreenPos.x}
                      y1={playerScreenPos.y}
                      x2={playerScreenPos.x - coneLength}
                      y2={playerScreenPos.y + coneLength}
                      stroke={coneColor}
                      strokeWidth={isMe ? 1.5 : 1}
                      strokeDasharray="3,3"
                      opacity={coneOpacity}
                    />
                  </g>
                );
              })}
            </svg>
          );
        })()}

      {/* プレイヤーのマーカーを時空図上に表示 */}
      {myId &&
        (() => {
          const myPlayer = players.get(myId);
          if (!myPlayer) return null;

          return Array.from(players.values()).map((player) => {
            const screenPos = toScreenCoords(
              { t: player.phaseSpace.pos.t, x: player.phaseSpace.pos.x },
              { t: myPlayer.phaseSpace.pos.t, x: myPlayer.phaseSpace.pos.x },
            );

            const isMe = player.id === myId;
            const vel = player.phaseSpace.u;
            const g = gamma(vel);

            return (
              <div
                key={player.id}
                style={{
                  position: "absolute",
                  left: screenPos.x,
                  top: screenPos.y,
                  width: isMe ? "12px" : "10px",
                  height: isMe ? "12px" : "10px",
                  backgroundColor: player.color,
                  borderRadius: "50%",
                  transform: "translate(-50%, -50%)",
                  boxShadow: `0 0 ${isMe ? 12 : 8}px ${player.color}`,
                  transition: "none",
                  zIndex: isMe ? 20 : 15,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: isMe ? "-60px" : "-50px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    color: "white",
                    fontSize: "10px",
                    whiteSpace: "nowrap",
                    textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
                  }}
                >
                  {isMe ? "You" : player.id.substring(0, 8)}
                  <br />x = {player.phaseSpace.pos.x.toFixed(2)}
                  <br />v = {(lengthVector3(vel) * 100).toFixed(1)}% c
                  <br />γ = {g.toFixed(2)}
                  <br />τ = {player.phaseSpace.pos.t.toFixed(2)}
                </div>
              </div>
            );
          });
        })()}

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
            <div>固有時間: {myPlayer.phaseSpace.pos.t.toFixed(2)}s</div>
          </div>
        );
      })()}
    </div>
  );
};

export default RelativisticGame;
