import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  vector3Zero,
} from "../physics";
import { useGameStore } from "../stores/game-store";
import { getLaserColor } from "./game/colors";
import {
  DEFAULT_CAMERA_PITCH,
  ENERGY_MAX,
  LIGHTHOUSE_ID_PREFIX,
  MAX_WORLDLINE_HISTORY,
  OFFSET,
  SPAWN_RANGE,
} from "./game/constants";
import { HUD } from "./game/HUD";
import {
  createLighthouse,
  isLighthouse,
} from "./game/lighthouse";
import { createMessageHandler } from "./game/messageHandler";
import { SceneContent } from "./game/SceneContent";
import { useTouchInput } from "./game/touchInput";
import { useStaleDetection } from "../hooks/useStaleDetection";
import { useKeyboardInput } from "../hooks/useKeyboardInput";
import { useHighScoreSaver } from "../hooks/useHighScoreSaver";
import { useHostMigration } from "../hooks/useHostMigration";
import { useGameLoop } from "../hooks/useGameLoop";

const RelativisticGame = ({ displayName }: { displayName: string }) => {
  const {
    peerManager,
    myId,
    connections,
    isMigrating,
    completeMigration,
    getPlayerColor,
    joinRegistryVersion,
  } = usePeer();

  // --- Store selectors (only what RelativisticGame itself needs) ---
  const players = useGameStore((s) => s.players);

  // --- Local UI state (not shared across modules) ---
  const [deathFlash, setDeathFlash] = useState(false);
  const [isFiring, setIsFiring] = useState(false);
  const [showInRestFrame, setShowInRestFrame] = useState(true);
  const [useOrthographic, setUseOrthographic] = useState(false);
  const [fps, setFps] = useState(0);
  const [energy, setEnergy] = useState(ENERGY_MAX);

  // --- Per-frame local refs (shared with SceneContent) ---
  const cameraYawRef = useRef(0);
  const cameraPitchRef = useRef(DEFAULT_CAMERA_PITCH);

  // Extracted hooks
  const keysPressed = useKeyboardInput();
  const touchInput = useTouchInput();
  const stale = useStaleDetection();
  useHighScoreSaver(myId, displayName, peerManager);

  const respawnTimeoutsRef = useHostMigration({
    isMigrating,
    peerManager,
    myId,
    connections,
    getPlayerColor,
    completeMigration,
  });

  // 初期化: ホストのみプレイヤー作成。
  // クライアントは syncTime 受信時に messageHandler がホストの座標時間でプレイヤーを作成。
  const isHost = peerManager?.getIsHost() ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is read at init time only
  useEffect(() => {
    if (!myId) return;
    if (!isHost) return; // クライアントは syncTime でプレイヤー作成

    const store = useGameStore.getState();

    // 非決定的な値を reducer 外で計算（StrictMode 安全）
    const initialPhaseSpace = createPhaseSpace(
      createVector4(
        Date.now() / 1000 - OFFSET,
        Math.random() * SPAWN_RANGE,
        Math.random() * SPAWN_RANGE,
        0.0,
      ),
      vector3Zero(),
    );
    let initialWorldLine = createWorldLine(MAX_WORLDLINE_HISTORY);
    initialWorldLine = appendWorldLine(initialWorldLine, initialPhaseSpace);
    const initialColor = getPlayerColor(myId);

    store.setPlayers((prev) => {
      if (prev.has(myId)) return prev; // Already initialized (reconnect/migration)
      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        ownerId: myId,
        phaseSpace: initialPhaseSpace,
        worldLine: initialWorldLine,
        color: initialColor,
        isDead: false,
        displayName,
      });
      return next;
    });
    // Stage C: 初期 invincibility は respawnLog 経由で derive。
    // 「初回スポーン = 初回 respawn」として扱う (selectInvincibleUntil が拾う)。
    useGameStore.setState((state) => ({
      respawnLog: [
        ...state.respawnLog,
        {
          playerId: myId,
          position: {
            t: initialPhaseSpace.pos.t,
            x: initialPhaseSpace.pos.x,
            y: initialPhaseSpace.pos.y,
            z: 0,
          },
          wallTime: Date.now(),
        },
      ],
    }));

    // 初回スポーンエフェクト（過去光円錐到達時に発火）
    useGameStore.setState((state) => ({
      pendingSpawnEvents: [
        ...state.pendingSpawnEvents,
        {
          id: `spawn-${myId}-${Date.now()}`,
          playerId: myId,
          pos: { t: initialPhaseSpace.pos.t, x: initialPhaseSpace.pos.x, y: initialPhaseSpace.pos.y, z: 0 },
          color: initialColor,
        },
      ],
    }));

    // Lighthouse AI + score sync to connected clients
    const lighthouseId = `${LIGHTHOUSE_ID_PREFIX}0`;
    const existingLh = store.players.get(lighthouseId);

    if (existingLh) {
      // Migration path: LH は既に存在する (旧 host の phaseSpace 履歴を全 peer が
      // 共有している)。位置・世界線をリセットせず owner だけ自分に差し替える。
      // spawn エフェクトや grace reset は不要。
      if (existingLh.ownerId !== myId) {
        store.setPlayers((prev) => {
          const lh = prev.get(lighthouseId);
          if (!lh) return prev;
          const next = new Map(prev);
          next.set(lighthouseId, { ...lh, ownerId: myId });
          return next;
        });
      }
      stale.staleFrozenRef.current.delete(lighthouseId);
    } else {
      // Fresh boot: create LH from scratch
      const lighthouse = createLighthouse(
        lighthouseId,
        Date.now() / 1000 - OFFSET,
        myId,
      );

      store.lighthouseSpawnTime.set(lighthouseId, Date.now());
      stale.staleFrozenRef.current.delete(lighthouseId);

      store.setPlayers((prev) => {
        const next = new Map(prev);
        next.set(lighthouseId, lighthouse);
        return next;
      });

      // Lighthouse スポーンエフェクト (初回のみ、migration 時は発火しない)
      useGameStore.setState((state) => ({
        pendingSpawnEvents: [
          ...state.pendingSpawnEvents,
          {
            id: `spawn-${lighthouseId}-${Date.now()}`,
            playerId: lighthouseId,
            pos: {
              t: lighthouse.phaseSpace.pos.t,
              x: lighthouse.phaseSpace.pos.x,
              y: lighthouse.phaseSpace.pos.y,
              z: 0,
            },
            color: lighthouse.color,
          },
        ],
      }));
    }

    if (peerManager) {
      for (const conn of connections) {
        if (conn.open) {
          peerManager.sendTo(conn.id, {
            type: "syncTime",
            hostTime: initialPhaseSpace.pos.t,
            scores: store.scores,
          });
        }
      }
    }
  }, [myId, isHost]);

  // 切断したプレイヤーを削除 & 新規接続にsyncTime送信
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!myId) return;

    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    const store = useGameStore.getState();

    if (peerManager?.getIsHost() && !isMigrating) {
      const myPlayer = store.players.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: myPlayer.phaseSpace.pos.t,
              scores: store.scores,
            });
          }
        }
      }
    }
    prevConnectionIdsRef.current = new Set(
      connections.filter((c) => c.open).map((c) => c.id),
    );

    store.setPlayers((prev) => {
      const idsToRemove: string[] = [];
      for (const playerId of prev.keys()) {
        if (!connectedIds.has(playerId) && !isLighthouse(playerId)) {
          idsToRemove.push(playerId);
        }
      }
      if (idsToRemove.length === 0) return prev;
      const next = new Map(prev);
      for (const id of idsToRemove) {
        next.delete(id);
      }
      // Stage C: log エントリは残す (未 respawn kill が残っていても GC は
      // Stage C-4 の pair 成立ベース。切断時の個別削除は不要)。
      stale.cleanupDisconnected(connectedIds);
      return next;
    });
  }, [connections, myId, peerManager, isMigrating, stale]);

  // joinRegistry 変化時に全プレイヤーの色を再計算
  useEffect(() => {
    if (joinRegistryVersion === 0) return;
    useGameStore.getState().setPlayers((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, player] of next) {
        if (isLighthouse(id)) continue;
        const correctColor = getPlayerColor(id);
        if (player.color !== correctColor) {
          next.set(id, { ...player, color: correctColor });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [joinRegistryVersion, getPlayerColor]);

  // メッセージ受信処理
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is passed to messageHandler but should not trigger re-registration
  useEffect(() => {
    if (!peerManager || !myId) return;

    peerManager.onMessage(
      "relativistic",
      createMessageHandler({
        myId,
        peerManager,
        getPlayerColor,
        lastUpdateTimeRef: stale.lastUpdateTimeRef,
        lastCoordTimeRef: stale.lastCoordTimeRef,
        staleFrozenRef: stale.staleFrozenRef,
      }),
    );

    peerManager.send({
      type: "intro",
      senderId: myId,
      displayName,
    });

    useGameStore.getState().setDisplayName(myId, displayName);

    return () => {
      peerManager.offMessage("relativistic");
    };
  }, [peerManager, myId]);

  // ゲームループ（useGameLoop hook に委譲）
  useGameLoop({
    peerManager, myId, getPlayerColor,
    setFps, setEnergy, setIsFiring, setDeathFlash,
    cameraYawRef, cameraPitchRef, respawnTimeoutsRef,
    keysPressed, touchInput, stale,
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100dvw",
        height: "100dvh",
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <HUD
        myId={myId}
        fps={fps}
        showInRestFrame={showInRestFrame}
        setShowInRestFrame={setShowInRestFrame}
        useOrthographic={useOrthographic}
        setUseOrthographic={setUseOrthographic}
        energy={energy}
        isFiring={isFiring}
        myLaserColor={
          myId
            ? getLaserColor(
                players.get(myId)?.color ?? getPlayerColor(myId),
              )
            : ""
        }
        deathFlash={deathFlash}
        getPlayerColor={getPlayerColor}
      />

      {useOrthographic ? (
        <Canvas
          key="ortho"
          orthographic
          camera={{
            zoom: 30,
            position: [0, 0, 50],
            near: -10000,
            far: 10000,
          }}
        >
          <SceneContent
            myId={myId}
            showInRestFrame={showInRestFrame}
            useOrthographic={true}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            isFiring={isFiring}
          />
        </Canvas>
      ) : (
        <Canvas key="persp" camera={{ position: [0, 0, 0], fov: 75 }}>
          <SceneContent
            myId={myId}
            showInRestFrame={showInRestFrame}
            useOrthographic={false}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            isFiring={isFiring}
          />
        </Canvas>
      )}
    </div>
  );
};

export default RelativisticGame;
