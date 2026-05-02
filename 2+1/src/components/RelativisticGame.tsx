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
import { WebGLLostOverlay } from "./game/WebGLLostOverlay";
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
  // headingYawRef: 自機の進行方向 (heading) の source of truth。
  //   - classic: 矢印キーで連続旋回 + WASD body-relative thrust。phaseSpace.heading に同期、
  //     SelfShipRenderer / Radar / camera (classic) がこの値を読む。
  //   - shooter: WASD screen-relative の atan2 + camera basis で決まる。Body が lerp 追従回転。
  // cameraYawRef: shooter mode の camera yaw offset (world basis からの回転)。
  //   - 矢印キーで連続旋回。SceneContent shooter camera が読む (= 機体周りで camera が回る)。
  //   - WASD interpretation の basis にも使う (camera が回ると screen-relative 入力も追従)。
  //   - classic mode では未使用 (camera は heading に同期するので不要)。
  // (plans/2026-04-25-viewpoint-controls.md)
  const headingYawRef = useRef(0);
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
          x: (Math.random() - 0.5) * SPAWN_RANGE,
          y: (Math.random() - 0.5) * SPAWN_RANGE,
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
          x: (Math.random() - 0.5) * SPAWN_RANGE,
          y: (Math.random() - 0.5) * SPAWN_RANGE,
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
    headingYawRef, cameraYawRef, cameraPitchRef, thrustAccelRef, respawnTimeoutsRef,
    keysPressed, touchInput, stale,
  });

  /**
   * WebGL context loss を **invisible auto-recovery** で透過的に吸収する設計。
   *
   * **戦略**:
   * 1. DOM polling で canvas 要素を探し、 webglcontextlost listener を attach (R3F の
   *    `onCreated` / `useThree` 経由は実機で fire しないケースを確認したため DOM 直)
   * 2. context loss 検知時、 store の `incrementCanvasGeneration()` を call (= state 変更)
   * 3. 各 `<Canvas key="...">` に generation を含めているので、 React が **古い Canvas を
   *    unmount → 新 generation の Canvas を mount** → R3F が新 WebGL context を作成 →
   *    scene tree (= geometry / material / texture) を全て新規構築 → render 復帰
   * 4. zustand store (= physics / killLog / score / players) は unmount に左右されず保持、
   *    user は 1-2 frame の flash で済む (= page reload 不要)
   *
   * **watchdog**: 通常 1 回の loss は auto-remount で消化されるが、 短時間 (= 1.5s) 内に
   * 2 回目の loss が起きたら catastrophic と判定 (= remount しても loss が連発する状況、
   * GPU 圧が解消していない) して `webglContextLost: true` を立て、 `WebGLLostOverlay` で
   * 「再読込」 UI を出す escape hatch にする。
   *
   * 注意: 2D radar / Speedometer canvas は対象外 (= WebGL context を持たないため
   * `getContext("webgl2") || getContext("webgl")` で除外)。
   */
  const lastLostAtRef = useRef<number>(0);
  useEffect(() => {
    const tryAttach = () => {
      const canvases = document.querySelectorAll<HTMLCanvasElement>("canvas");
      for (const canvas of canvases) {
        const tagged = canvas as HTMLCanvasElement & {
          __webglLostAttached?: boolean;
        };
        if (tagged.__webglLostAttached) continue;
        const ctx = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!ctx) continue;
        tagged.__webglLostAttached = true;
        canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          const now = Date.now();
          const sinceLast = now - lastLostAtRef.current;
          lastLostAtRef.current = now;
          console.warn(
            `[WebGL] context lost (sinceLast=${sinceLast}ms) — auto-remounting Canvas`,
          );
          useGameStore.getState().incrementCanvasGeneration();
          // watchdog: 1.5s 以内の 2 回目は auto-remount で復旧不能と判断、 overlay 表示
          if (sinceLast > 0 && sinceLast < 1500) {
            console.error(
              "[WebGL] chronic context loss detected (2 losses within 1.5s) — showing reload overlay",
            );
            useGameStore.getState().setWebglContextLost(true);
          }
        });
        canvas.addEventListener("webglcontextrestored", () => {
          console.log("[WebGL] context restored");
        });
      }
    };
    tryAttach();
    const intervalId = setInterval(tryAttach, 200);
    return () => clearInterval(intervalId);
  }, []);

  const canvasGeneration = useGameStore((s) => s.canvasGeneration);

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
        <Canvas
          key={`plc3d-gen${canvasGeneration}`}
          camera={{ position: [0, -12, 20], fov: 60 }}
        >
          <SceneContent
            myId={myId}
            showInRestFrame={false}
            useOrthographic={false}
            plc3d={true}
            headingYawRef={headingYawRef}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            thrustAccelRef={thrustAccelRef}
            isFiring={isFiring}
          />
        </Canvas>
      ) : useOrthographic ? (
        <Canvas
          key={`ortho-gen${canvasGeneration}`}
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
            headingYawRef={headingYawRef}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            thrustAccelRef={thrustAccelRef}
            isFiring={isFiring}
          />
        </Canvas>
      ) : (
        <Canvas
          key={`persp-gen${canvasGeneration}`}
          camera={{ position: [0, 0, 0], fov: 75 }}
        >
          <SceneContent
            myId={myId}
            showInRestFrame={showInRestFrame}
            useOrthographic={false}
            plc3d={false}
            headingYawRef={headingYawRef}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
            thrustAccelRef={thrustAccelRef}
            isFiring={isFiring}
          />
        </Canvas>
      )}

      {/* WebGL context lost recovery: 全世界凍結 (= GPU resource 回収) 時に再読込 UI を出す。
          詳細: WebGLLostOverlay の docstring。 */}
      <WebGLLostOverlay />

      {/* モバイル初回チュートリアル (localStorage でブラウザ毎 1 回のみ)。
          touch 非対応端末では render されない。z-index: 1000 で HUD 上に overlay。 */}
      <TutorialOverlay />
    </div>
  );
};

export default RelativisticGame;
