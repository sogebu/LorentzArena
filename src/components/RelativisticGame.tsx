import { useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import { Vector3, PhaseSpace } from "../physics";

type RelativisticPlayer = {
  id: string;
  phaseSpace: PhaseSpace;
  color: string;
};

// ゲーム内での光速（ピクセル/秒）
const LIGHT_SPEED = 200;

// ドップラー効果による色の計算
const calculateDopplerColor = (velocity: Vector3, baseColor: string): string => {
  const beta = velocity.length();
  const gamma = velocity.gamma();

  // 簡略化されたドップラー効果
  // 接近: 青方偏移、離脱: 赤方偏移
  const dopplerFactor = gamma * (1 - (beta * velocity.x) / velocity.length());

  if (baseColor === "blue") {
    const intensity = Math.max(0, Math.min(255, 128 * dopplerFactor));
    return `rgb(${intensity}, ${intensity}, 255)`;
  }
  const intensity = Math.max(0, Math.min(255, 255 / dopplerFactor));
  return `rgb(255, ${255 - intensity}, ${255 - intensity})`;
}

const RelativisticGame = () => {
  const { peerManager, myId } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());

  // 初期化
  useEffect(() => {
    if (!peerManager || !myId) return;

    // 自分のプレイヤーを初期化
    const initialPhaseSpace = new PhaseSpace(Vector3.zero(), Vector3.zero(), 0);
    setPlayers((prev) => {
      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        phaseSpace: initialPhaseSpace,
        color: "blue",
      });
      return next;
    });

    // メッセージ受信処理
    peerManager.onMessage("relativistic", (id, msg) => {
      if (msg.type === "phaseSpace") {
        setPlayers((prev) => {
          const next = new Map(prev);
          const phaseSpace = new PhaseSpace(
            new Vector3(msg.position.x, msg.position.y, msg.position.z),
            new Vector3(msg.velocity.x, msg.velocity.y, msg.velocity.z),
            msg.properTime,
          );
          next.set(id, {
            id,
            phaseSpace,
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

  // キーボード入力処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      const dt = (currentTime - lastTimeRef.current) / 1000; // 秒単位
      lastTimeRef.current = currentTime;

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

          const acceleration = new Vector3(ax, ay, 0);

          // 相対論的運動方程式で更新
          try {
            const newPhaseSpace = myPlayer.phaseSpace.evolve(acceleration, dt);
            next.set(myId, {
              ...myPlayer,
              phaseSpace: newPhaseSpace,
            });

            // 他のプレイヤーに送信
            if (peerManager) {
              peerManager.send({
                type: "phaseSpace",
                position: {
                  x: newPhaseSpace.position.x,
                  y: newPhaseSpace.position.y,
                  z: newPhaseSpace.position.z,
                },
                velocity: {
                  x: newPhaseSpace.velocity.x,
                  y: newPhaseSpace.velocity.y,
                  z: newPhaseSpace.velocity.z,
                },
                properTime: newPhaseSpace.properTime,
              });
            }
          } catch (error) {
            console.error("Physics update error:", error);
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
        width: "800px",
        height: "600px",
        border: "2px solid #333",
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
      </div>

      {Array.from(players.values()).map((player) => {
        const pos = player.phaseSpace.position;
        const vel = player.phaseSpace.velocity;
        const gamma = player.phaseSpace.gamma;

        // ローレンツ収縮を表現（進行方向に縮む）
        const contractionFactor = 1 / gamma;
        const angle = Math.atan2(vel.y, vel.x);

        return (
          <div
            key={player.id}
            style={{
              position: "absolute",
              left: pos.x * LIGHT_SPEED + 400,
              top: pos.y * LIGHT_SPEED + 300,
              width: "40px",
              height: "40px",
              backgroundColor: calculateDopplerColor(vel, player.color),
              borderRadius: "50%",
              transform: `translate(-50%, -50%) rotate(${angle}rad) scaleX(${contractionFactor})`,
              boxShadow: `0 0 ${20 * gamma}px ${calculateDopplerColor(vel, player.color)}`,
              transition: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "-20px",
                left: "50%",
                transform: "translateX(-50%)",
                color: "white",
                fontSize: "10px",
                whiteSpace: "nowrap",
              }}
            >
              {player.id === myId ? "You" : player.id.substring(0, 8)}
              <br />v = {(vel.length() * 100).toFixed(1)}% c
              <br />γ = {gamma.toFixed(2)}
            </div>
          </div>
        );
      })}

      {/* 速度計 */}
      {(() => {
        const myPlayer = players.get(myId);
        if (!myPlayer) return null;
        const v = myPlayer.phaseSpace.velocity.length();
        const gamma = myPlayer.phaseSpace.gamma;

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
            <div>ガンマ因子: {gamma.toFixed(3)}</div>
            <div>固有時間: {myPlayer.phaseSpace.properTime.toFixed(2)}s</div>
          </div>
        );
      })()}
    </div>
  );
};

export default RelativisticGame;
