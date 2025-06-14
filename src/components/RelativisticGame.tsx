import { useEffect, useRef, useState, type JSX } from "react";
import { usePeer } from "../hooks/usePeer";
import { Vector3, Vector4, PhaseSpace, WorldLine, Matrix4 } from "../physics";

type RelativisticPlayer = {
  id: string;
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
};

// グリッドの設定
const GRID_SIZE = 50; // ピクセル単位
const GRID_RANGE = 30; // 中心から何マスまで表示するか

// グリッド点の座標を生成
const createGridPoints = (): Vector3[][] => {
  const points: Vector3[][] = [];

  for (let i = -GRID_RANGE; i <= GRID_RANGE; i++) {
    const row: Vector3[] = [];
    for (let j = -GRID_RANGE; j <= GRID_RANGE; j++) {
      // 各グリッド点の位置（ワールド座標）
      const position = new Vector3(
        (i * GRID_SIZE) / LIGHT_SPEED,
        (j * GRID_SIZE) / LIGHT_SPEED,
        0,
      );
      row.push(position);
    }
    points.push(row);
  }

  return points;
};

const RelativisticGame = () => {
  const { peerManager, myId } = usePeer();
  const [players, setPlayers] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(Date.now());
  const keysPressed = useRef<Set<string>>(new Set());
  const gridPoints = useRef<Vector3[][]>(createGridPoints());

  // 初期化
  useEffect(() => {
    if (!peerManager || !myId) return;

    // 自分のプレイヤーを初期化
    const initialPhaseSpace = PhaseSpace.fromPosition3Velocity3(
      Vector3.zero(),
      Vector3.zero(),
      0,
    );
    const worldLine = new WorldLine();
    worldLine.append(initialPhaseSpace);

    setPlayers((prev) => {
      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        phaseSpace: initialPhaseSpace,
        worldLine,
        color: "blue",
      });
      return next;
    });

    // メッセージ受信処理
    peerManager.onMessage("relativistic", (id, msg) => {
      if (msg.type === "phaseSpace") {
        setPlayers((prev) => {
          const next = new Map(prev);
          const phaseSpace = PhaseSpace.fromPosition3Velocity3(
            new Vector3(msg.position.x, msg.position.y, msg.position.z),
            new Vector3(msg.velocity.x, msg.velocity.y, msg.velocity.z),
            msg.coordinateTime,
          );

          // 既存のプレイヤーのワールドラインに追加、または新規作成
          const existing = prev.get(id);
          const worldLine = existing?.worldLine || new WorldLine();
          worldLine.append(phaseSpace);

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
            myPlayer.worldLine.append(newPhaseSpace);
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
                coordinateTime: newPhaseSpace.coordinateTime,
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

  // グリッドラインをレンダリング
  const renderGrid = () => {
    const myPlayer = players.get(myId);
    if (!myPlayer) return null;

    const observerPhaseSpace = myPlayer.phaseSpace;
    const observerPos4 = observerPhaseSpace.position4;
    const observerVel = observerPhaseSpace.velocity;

    const gridLines: JSX.Element[] = [];

    // 観測者の速度によるローレンツ変換を適用
    const applyLorentzTransform = (
      worldPos: Vector3,
      worldTime: number,
    ): Vector3 => {
      // 世界座標系での4元位置
      const worldPos4 = new Vector4(
        worldTime,
        worldPos.x,
        worldPos.y,
        worldPos.z,
      );

      // 観測者の静止系への変換
      if (observerVel.lengthSquared() === 0) {
        return worldPos.sub(observerPhaseSpace.position);
      }

      // 観測者の速度の逆向きでローレンツ変換（観測者の静止系への変換）
      const boostToObserver = Matrix4.lorentzBoost(observerVel.scale(-1));

      // 観測者の位置を原点に移動してから変換
      const relativePos4 = worldPos4.sub(observerPos4);
      const transformedPos4 = boostToObserver.multiplyVector4(relativePos4);

      return transformedPos4.spatial();
    };

    // 横線を描画
    for (let i = 0; i < gridPoints.current.length; i++) {
      for (let j = 0; j < gridPoints.current[i].length - 1; j++) {
        const pos1 = gridPoints.current[i][j];
        const pos2 = gridPoints.current[i][j + 1];

        // ローレンツ変換を適用（現在時刻での位置として変換）
        const currentTime = observerPhaseSpace.coordinateTime;
        const transformedPos1 = applyLorentzTransform(pos1, currentTime);
        const transformedPos2 = applyLorentzTransform(pos2, currentTime);

        gridLines.push(
          <line
            key={`h-${i}-${j}`}
            x1={transformedPos1.x * LIGHT_SPEED + 400}
            y1={transformedPos1.y * LIGHT_SPEED + 300}
            x2={transformedPos2.x * LIGHT_SPEED + 400}
            y2={transformedPos2.y * LIGHT_SPEED + 300}
            stroke="#444"
            strokeWidth="1"
            opacity="0.8"
          />,
        );
      }
    }

    // 縦線を描画
    for (let i = 0; i < gridPoints.current.length - 1; i++) {
      for (let j = 0; j < gridPoints.current[i].length; j++) {
        const pos1 = gridPoints.current[i][j];
        const pos2 = gridPoints.current[i + 1][j];

        // ローレンツ変換を適用（現在時刻での位置として変換）
        const currentTime = observerPhaseSpace.coordinateTime;
        const transformedPos1 = applyLorentzTransform(pos1, currentTime);
        const transformedPos2 = applyLorentzTransform(pos2, currentTime);

        gridLines.push(
          <line
            key={`v-${i}-${j}`}
            x1={transformedPos1.x * LIGHT_SPEED + 400}
            y1={transformedPos1.y * LIGHT_SPEED + 300}
            x2={transformedPos2.x * LIGHT_SPEED + 400}
            y2={transformedPos2.y * LIGHT_SPEED + 300}
            stroke="#444"
            strokeWidth="1"
            opacity="0.8"
          />,
        );
      }
    }

    // 原点マーカーを追加（デバッグ用）
    const currentTime = observerPhaseSpace.coordinateTime;
    const originTransformed = applyLorentzTransform(
      Vector3.zero(),
      currentTime,
    );
    gridLines.push(
      <circle
        key="origin"
        cx={originTransformed.x * LIGHT_SPEED + 400}
        cy={originTransformed.y * LIGHT_SPEED + 300}
        r="5"
        fill="red"
      />,
    );

    return (
      <svg style={{ position: "absolute", width: "100%", height: "100%" }}>
        <title>Relativistic grid</title>
        {gridLines}
      </svg>
    );
  };

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

      {renderGrid()}

      {Array.from(players.values()).map((player) => {
        const myPlayer = players.get(myId);
        if (!myPlayer) return null;

        // 観測者の4元位置
        const observerPos4 = myPlayer.phaseSpace.position4;
        const observerPos = myPlayer.phaseSpace.position;

        // 表示する位相空間（過去光円錐との交点）
        let displayPhaseSpace: PhaseSpace;
        let displayPos: { x: number; y: number };

        if (player.id === myId) {
          // 自機は現在の状態を使用
          displayPhaseSpace = player.phaseSpace;
          displayPos = { x: 400, y: 300 };
        } else {
          // 他プレイヤーは過去光円錐との交点を使用
          displayPhaseSpace =
            player.worldLine.pastLightConeIntersection(observerPos4) ||
            player.phaseSpace;
          const relativePos = displayPhaseSpace.position.sub(observerPos);
          displayPos = {
            x: relativePos.x * LIGHT_SPEED + 400,
            y: relativePos.y * LIGHT_SPEED + 300,
          };
        }

        const vel = displayPhaseSpace.velocity;
        const gamma = displayPhaseSpace.gamma;

        // ローレンツ収縮を表現（進行方向に縮む）
        const contractionFactor = 1 / gamma;
        const angle = Math.atan2(vel.y, vel.x);

        return (
          <div
            key={player.id}
            style={{
              position: "absolute",
              left: displayPos.x,
              top: displayPos.y,
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
