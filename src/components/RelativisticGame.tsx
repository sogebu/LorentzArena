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
const GRID_SIZE = 40; // ピクセル単位（少し密にする）

// グリッド点の座標を生成（動的にオフセットを適用）
const createGridPoints = (offsetX: number, offsetY: number): Vector3[][] => {
  const points: Vector3[][] = [];

  // 画面に表示される範囲を計算
  const visibleRange = 10; // 画面に表示するグリッドの範囲

  for (let i = -visibleRange; i <= visibleRange; i++) {
    const row: Vector3[] = [];
    for (let j = -visibleRange; j <= visibleRange; j++) {
      // 各グリッド点の位置（ワールド座標）
      const position = new Vector3(
        ((j + offsetX) * GRID_SIZE) / LIGHT_SPEED,
        ((i + offsetY) * GRID_SIZE) / LIGHT_SPEED,
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
  const [screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

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
    const observerPos = observerPhaseSpace.position;

    // プレイヤーの位置に基づいてグリッドのオフセットを計算
    const gridOffsetX = Math.floor((observerPos.x * LIGHT_SPEED) / GRID_SIZE);
    const gridOffsetY = Math.floor((observerPos.y * LIGHT_SPEED) / GRID_SIZE);

    // 動的にグリッドポイントを生成
    const gridPoints = createGridPoints(gridOffsetX, gridOffsetY);

    const gridLines: JSX.Element[] = [];

    // 過去光円錐上の点を計算してローレンツ変換を適用
    const applyPastLightConeTransform = (worldPos: Vector3): Vector3 => {
      // 観測者から見た空間的距離
      const spatialDistance = worldPos.sub(observerPos).length();

      // 光が観測者に届くまでの時間（過去にさかのぼる）
      const lightTravelTime = spatialDistance;

      // グリッド点が光を発した時刻（過去の時刻）
      const emissionTime = observerPhaseSpace.coordinateTime - lightTravelTime;

      // 過去の時刻での4元位置
      const worldPos4 = new Vector4(
        emissionTime,
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

    // まず、すべてのグリッド点を過去光円錐上で変換
    const transformedPoints: Vector3[][] = [];

    for (let i = 0; i < gridPoints.length; i++) {
      const transformedRow: Vector3[] = [];
      for (let j = 0; j < gridPoints[i].length; j++) {
        const transformedPoint = applyPastLightConeTransform(gridPoints[i][j]);
        transformedRow.push(transformedPoint);
      }
      transformedPoints.push(transformedRow);
    }

    // 速度に応じてグリッドの基本色を計算
    const velocity = observerVel.length();
    const baseGridOpacity = Math.max(0.3, 0.8 - velocity * 0.5);
    const baseGridColor = velocity > 0.5 ? "#666" : "#444";

    // 横線を描画（変換済みの点を使用）
    for (let i = 0; i < transformedPoints.length; i++) {
      for (let j = 0; j < transformedPoints[i].length - 1; j++) {
        const pos1 = transformedPoints[i][j];
        const pos2 = transformedPoints[i][j + 1];

        // 元のグリッド点の距離に基づいて色を調整（過去光円錐効果）
        const originalPos = gridPoints[i][j];
        const distance = originalPos.sub(observerPos).length();
        const distanceFactor = Math.exp(-distance * 0.5); // 距離による減衰
        const gridOpacity = baseGridOpacity * distanceFactor;

        gridLines.push(
          <line
            key={`h-${i}-${j}`}
            x1={pos1.x * LIGHT_SPEED + screenSize.width / 2}
            y1={pos1.y * LIGHT_SPEED + screenSize.height / 2}
            x2={pos2.x * LIGHT_SPEED + screenSize.width / 2}
            y2={pos2.y * LIGHT_SPEED + screenSize.height / 2}
            stroke={baseGridColor}
            strokeWidth="1"
            opacity={gridOpacity}
          />,
        );
      }
    }

    // 縦線を描画（変換済みの点を使用）
    for (let i = 0; i < transformedPoints.length - 1; i++) {
      for (let j = 0; j < transformedPoints[i].length; j++) {
        const pos1 = transformedPoints[i][j];
        const pos2 = transformedPoints[i + 1][j];

        // 元のグリッド点の距離に基づいて色を調整（過去光円錐効果）
        const originalPos = gridPoints[i][j];
        const distance = originalPos.sub(observerPos).length();
        const distanceFactor = Math.exp(-distance * 0.5); // 距離による減衰
        const gridOpacity = baseGridOpacity * distanceFactor;

        gridLines.push(
          <line
            key={`v-${i}-${j}`}
            x1={pos1.x * LIGHT_SPEED + screenSize.width / 2}
            y1={pos1.y * LIGHT_SPEED + screenSize.height / 2}
            x2={pos2.x * LIGHT_SPEED + screenSize.width / 2}
            y2={pos2.y * LIGHT_SPEED + screenSize.height / 2}
            stroke={baseGridColor}
            strokeWidth="1"
            opacity={gridOpacity}
          />,
        );
      }
    }

    return (
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: "none",
        }}
        viewBox={`0 0 ${screenSize.width} ${screenSize.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>Relativistic grid</title>
        {gridLines}
      </svg>
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
          displayPos = { x: screenSize.width / 2, y: screenSize.height / 2 };
        } else {
          // 他プレイヤーは過去光円錐との交点を使用
          displayPhaseSpace =
            player.worldLine.pastLightConeIntersection(observerPos4) ||
            player.phaseSpace;
          const relativePos = displayPhaseSpace.position.sub(observerPos);
          displayPos = {
            x: relativePos.x * LIGHT_SPEED + screenSize.width / 2,
            y: relativePos.y * LIGHT_SPEED + screenSize.height / 2,
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
