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
import { buildSnapshot } from "./game/snapshot";
import { useTouchInput } from "./game/touchInput";
import { useStaleDetection } from "../hooks/useStaleDetection";
import { useKeyboardInput } from "../hooks/useKeyboardInput";
import { useHighScoreSaver } from "../hooks/useHighScoreSaver";
import { useSnapshotRetry } from "../hooks/useSnapshotRetry";
import { useGameLoop } from "../hooks/useGameLoop";

const RelativisticGame = ({ displayName }: { displayName: string }) => {
  const {
    peerManager,
    myId,
    connections,
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
  // 自機の最新 thrust 加速度 (world coords、friction 除外)。exhaust 描画用。
  const thrustAccelRef = useRef(vector3Zero());

  // Extracted hooks
  const keysPressed = useKeyboardInput();
  const touchInput = useTouchInput();
  const stale = useStaleDetection();
  useHighScoreSaver(myId, displayName, peerManager);

  // Timers for LH / non-self respawn (sub-tick precision). Kept here (not
  // inside useGameLoop) because the ref survives [peerManager, myId] deps
  // changes of the game loop effect — the cleanup clears pending timers but
  // the ref itself persists across the component lifetime. Previously owned
  // by useBeaconMigration (deleted 2026-04-18 along with isMigrating).
  const respawnTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );

  // 新規 join の pull-based snapshot retry. push (host-side diff 送信) が race
  // で届かないケースの保険として、client 側で players.get(myId) が埋まるまで
  // snapshotRequest を再送する。
  useSnapshotRetry({ peerManager, myId });

  // 初期化: beacon holder のみプレイヤー作成。
  // それ以外の peer は snapshot 受信時に applySnapshot が host の座標時間でプレイヤーを作成。
  const isBeaconHolder = peerManager?.getIsBeaconHolder() ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is read at init time only
  useEffect(() => {
    console.log("[init] myId=", myId, "isBeaconHolder=", isBeaconHolder);
    if (!myId) return;
    if (!isBeaconHolder) return; // 非 beacon holder は snapshot でプレイヤー作成

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

    // Stage F: 初期 host の init effect では既存 connection へ何も送らない。
    // 新規 join への snapshot 送信は下の useEffect (prevConnectionIdsRef) で
    // 差分検出して行う。host migration で init effect が再実行されても既存
    // 接続は prevConnectionIdsRef に残っているので差分ゼロ → 送信されない。
  }, [myId, isBeaconHolder]);

  // 切断したプレイヤーを削除 & 新規接続に snapshot 送信
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!myId) return;

    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    const store = useGameStore.getState();

    const isHost = peerManager?.getIsBeaconHolder();
    if (isHost) {
      const myPlayer = store.players.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            // Stage F: syncTime 単独ではなく snapshot 一式を送る
            peerManager.sendTo(conn.id, buildSnapshot(myId));
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
  }, [connections, myId, peerManager, stale]);

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
    cameraYawRef, cameraPitchRef, thrustAccelRef, respawnTimeoutsRef,
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
            thrustAccelRef={thrustAccelRef}
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
            thrustAccelRef={thrustAccelRef}
            isFiring={isFiring}
          />
        </Canvas>
      )}
    </div>
  );
};

export default RelativisticGame;
