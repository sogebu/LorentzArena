import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import { vector3Zero } from "../physics";
import { useGameStore } from "../stores/game-store";
import { getLaserColor } from "./game/colors";
import {
  DEFAULT_CAMERA_PITCH,
  ENERGY_MAX,
  LIGHTHOUSE_COLOR,
  LIGHTHOUSE_ID_PREFIX,
  OFFSET,
  PEER_REMOVAL_GRACE_MS,
  SPAWN_RANGE,
} from "./game/constants";
import { HUD } from "./game/HUD";
import { TutorialOverlay } from "./game/TutorialOverlay";
import { isLighthouse } from "./game/lighthouse";
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
  const [showPLCSlice, setShowPLCSlice] = useState(false);
  const [plcMode, setPlcMode] = useState<"2d" | "3d">("2d");
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

    // Self spawn: handleSpawn で respawn と同じ経路を通す。StrictMode 二重実行は
    // players.has(myId) 早期 return で吸収 (handleSpawn 内に dedup 無い前提)。
    if (!store.players.has(myId)) {
      const t = Date.now() / 1000 - OFFSET;
      store.handleSpawn(
        myId,
        {
          t,
          x: Math.random() * SPAWN_RANGE,
          y: Math.random() * SPAWN_RANGE,
          z: 0,
        },
        myId,
        getPlayerColor(myId),
        { displayName, ownerId: myId },
      );
    }

    // Lighthouse: 初回 boot では handleSpawn で新規作成。migration 経路では既に
    // players Map に存在し、LH ownerId の host への差し替えは assumeHostRole が
    // 同期で完了させているため、ここでは何もしない (existingLh があれば skip)。
    const lighthouseId = `${LIGHTHOUSE_ID_PREFIX}0`;
    const existingLh = store.players.get(lighthouseId);
    stale.staleFrozenRef.current.delete(lighthouseId);

    if (!existingLh) {
      const t = Date.now() / 1000 - OFFSET;
      store.handleSpawn(
        lighthouseId,
        {
          t,
          x: Math.random() * SPAWN_RANGE,
          y: Math.random() * SPAWN_RANGE,
          z: 0,
        },
        myId,
        LIGHTHOUSE_COLOR,
        { ownerId: myId },
      );
    }

    // Stage F: 初期 host の init effect では既存 connection へ何も送らない。
    // 新規 join への snapshot 送信は下の useEffect (prevConnectionIdsRef) で
    // 差分検出して行う。host migration で init effect が再実行されても既存
    // 接続は prevConnectionIdsRef に残っているので差分ゼロ → 送信されない。
  }, [myId, isBeaconHolder]);

  // 切断したプレイヤーを削除 & 新規接続に snapshot 送信
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  // 症状 5 fix: peer removal を grace period 付き setTimeout に切り替え。
  // host migration / tab 復帰 / 一過的 blip で一瞬 connections から消えた相手を
  // 即座に players map から蒸発させると 3D シーンから ship が消える。猶予中に
  // 再接続したら cancel、真に切れていたら PEER_REMOVAL_GRACE_MS 後に削除。
  const pendingRemovalTimeoutsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  useEffect(() => {
    if (!myId) return;

    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    const store = useGameStore.getState();

    // 新規接続 peer を抽出。登録時の 1 回 broadcast (onMessage register 時) は
    // 「送信時点で開いている connection」にしか届かず、後から繋いできた peer には
    // 自分の displayName が伝わらない → 撃破数リストで `id.slice(0, 6)` の素の
    // peerId prefix が出る症状 3 の root cause。new connection ごとに unicast intro
    // を送り直すことで確実に到達。
    const newPeerIds: string[] = [];
    for (const conn of connections) {
      if (!conn.open) continue;
      if (prevConnectionIdsRef.current.has(conn.id)) continue;
      newPeerIds.push(conn.id);
    }

    if (peerManager && newPeerIds.length > 0) {
      for (const newId of newPeerIds) {
        peerManager.sendTo(newId, {
          type: "intro",
          senderId: myId,
          displayName,
        });
      }
    }

    if (peerManager?.getIsBeaconHolder()) {
      const myPlayer = store.players.get(myId);
      if (myPlayer) {
        for (const newId of newPeerIds) {
          // Stage F: 既存 peer (= store に entry がある) は event log から
          // self-maintained。migration 経路で元 client 同士が初接続する場合も
          // ここで弾くことで「既存 peer は snapshot を受け取らない」設計を保つ。
          // 真の new joiner は player entry を未保持 → has=false → 送信。
          if (store.players.has(newId)) continue;
          peerManager.sendTo(newId, buildSnapshot(myId, true));
        }
      }
    }
    prevConnectionIdsRef.current = new Set(
      connections.filter((c) => c.open).map((c) => c.id),
    );

    // 再接続したら pending removal をキャンセル (players map に残ったまま復帰)。
    for (const id of connectedIds) {
      const pending = pendingRemovalTimeoutsRef.current.get(id);
      if (pending !== undefined) {
        clearTimeout(pending);
        pendingRemovalTimeoutsRef.current.delete(id);
      }
    }

    // connections から落ちた peer に対し、まだ pending が無ければ removal を予約。
    // Stage C: log エントリは残す (未 respawn kill が残っていても GC は Stage C-4
    // の pair 成立ベース)。
    for (const playerId of store.players.keys()) {
      if (isLighthouse(playerId)) continue;
      if (connectedIds.has(playerId)) continue;
      if (pendingRemovalTimeoutsRef.current.has(playerId)) continue;

      const timeout = setTimeout(() => {
        pendingRemovalTimeoutsRef.current.delete(playerId);
        useGameStore.getState().setPlayers((prev) => {
          if (!prev.has(playerId)) return prev;
          const next = new Map(prev);
          next.delete(playerId);
          return next;
        });
        stale.cleanupPeer(playerId);
      }, PEER_REMOVAL_GRACE_MS);
      pendingRemovalTimeoutsRef.current.set(playerId, timeout);
    }
  }, [connections, myId, peerManager, stale, displayName]);

  // unmount 時に pending removal timeouts を全解除 (orphan setTimeout 防止)。
  useEffect(() => {
    return () => {
      for (const timeout of pendingRemovalTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      pendingRemovalTimeoutsRef.current.clear();
    };
  }, []);

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
        showPLCSlice={showPLCSlice}
        setShowPLCSlice={setShowPLCSlice}
        plcMode={plcMode}
        setPlcMode={setPlcMode}
        cameraYawRef={cameraYawRef}
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

      {showPLCSlice && plcMode === "3d" ? (
        <Canvas key="plc3d" camera={{ position: [0, -12, 20], fov: 60 }}>
          <SceneContent
            myId={myId}
            showInRestFrame={false}
            useOrthographic={false}
            plc3d={true}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            thrustAccelRef={thrustAccelRef}
            isFiring={isFiring}
          />
        </Canvas>
      ) : useOrthographic ? (
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
            plc3d={false}
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
            plc3d={false}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            thrustAccelRef={thrustAccelRef}
            isFiring={isFiring}
          />
        </Canvas>
      )}

      {/* モバイル初回チュートリアル (localStorage でブラウザ毎 1 回のみ)。
          touch 非対応端末では render されない。z-index: 1000 で HUD 上に overlay。 */}
      <TutorialOverlay />
    </div>
  );
};

export default RelativisticGame;
