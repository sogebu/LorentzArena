import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePeer } from "../hooks/usePeer";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector4,
  createWorldLine,
  getVelocity4,
  vector3Zero,
} from "../physics";
import { getLaserColor } from "./game/colors";
import {
  ENERGY_MAX,
  LIGHTHOUSE_ID_PREFIX,
  MAX_WORLDLINE_HISTORY,
  OFFSET,
  SPAWN_RANGE,
} from "./game/constants";
import { HUD } from "./game/HUD";
import { applyKill, applyRespawn } from "./game/killRespawn";
import {
  createLighthouse,
  isLighthouse,
} from "./game/lighthouse";
import { createMessageHandler } from "./game/messageHandler";
import { SceneContent } from "./game/SceneContent";
import { useTouchInput } from "./game/touchInput";
import { generateExplosionParticles } from "./game/debris";
import type {
  DeathEvent,
  DebrisRecord,
  FrozenWorldLine,
  Laser,
  PendingKillEvent,
  PendingSpawnEvent,
  RelativisticPlayer,
  SpawnEffect,
} from "./game/types";
import {
  MAX_DEBRIS,
  MAX_FROZEN_WORLDLINES,
} from "./game/constants";
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
  const [players, setPlayersRaw] = useState<Map<string, RelativisticPlayer>>(
    new Map(),
  );
  // setPlayers ラッパー: ref を即座に同期し、useEffect 遅延による stale 読みを根絶
  const setPlayers = useCallback(
    (updater: (prev: Map<string, RelativisticPlayer>) => Map<string, RelativisticPlayer>) => {
      setPlayersRaw((prev) => {
        const next = updater(prev);
        playersRef.current = next;
        return next;
      });
    },
    [],
  );
  const [lasers, setLasers] = useState<Laser[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [spawns, setSpawns] = useState<SpawnEffect[]>([]);
  const [deathFlash, setDeathFlash] = useState(false);
  const [isFiring, setIsFiring] = useState(false);
  const [killNotification, setKillNotification] = useState<{
    victimName: string;
    color: string;
    hitPos: { t: number; x: number; y: number; z: number };
  } | null>(null);

  // 世界オブジェクト（プレイヤーから独立）
  const [frozenWorldLines, setFrozenWorldLines] = useState<FrozenWorldLine[]>(
    [],
  );
  const [debrisRecords, setDebrisRecords] = useState<DebrisRecord[]>([]);
  const myDeathEventRef = useRef<DeathEvent | null>(null);
  const ghostTauRef = useRef<number>(0);

  const scoresRef = useRef<Record<string, number>>({});
  const [showInRestFrame, setShowInRestFrame] = useState(true);
  const [useOrthographic, setUseOrthographic] = useState(false);
  const playersRef = useRef<Map<string, RelativisticPlayer>>(new Map());
  const lasersRef = useRef<Laser[]>([]);
  const processedLasersRef = useRef<Set<string>>(new Set());
  const deadPlayersRef = useRef<Set<string>>(new Set());
  const deathTimeMapRef = useRef<Map<string, number>>(new Map());
  const pendingKillEventsRef = useRef<PendingKillEvent[]>([]);
  const displayNamesRef = useRef<Map<string, string>>(new Map());
  const pendingSpawnEventsRef = useRef<PendingSpawnEvent[]>([]);
  const causalFrozenRef = useRef<boolean>(false);
  const lighthouseLastFireRef = useRef<Map<string, number>>(new Map());
  const lighthouseSpawnTimeRef = useRef<Map<string, number>>(new Map());
  const lastLaserTimeRef = useRef<number>(0);
  const [_screenSize, setScreenSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frameCount: 0, lastTime: performance.now() });
  const cameraYawRef = useRef(0);
  const cameraPitchRef = useRef(Math.PI / 6);
  const energyRef = useRef(ENERGY_MAX);
  const [energy, setEnergy] = useState(ENERGY_MAX);

  // Extracted hooks
  const keysPressed = useKeyboardInput();
  const touchInput = useTouchInput();
  const stale = useStaleDetection();
  useHighScoreSaver(myId, displayName, peerManager, scoresRef);

  // Stable ref wrapper for handleRespawn (defined further below).
  // Declared here so useHostMigration can reference it without forward-reference issues.
  const handleRespawnRef = useRef<(id: string, pos: { t: number; x: number; y: number; z: number }) => void>(() => {});
  const handleRespawnStable = useCallback(
    (playerId: string, position: { t: number; x: number; y: number; z: number }) => {
      handleRespawnRef.current(playerId, position);
    },
    [],
  );

  const respawnTimeoutsRef = useHostMigration({
    isMigrating,
    peerManager,
    myId,
    connections,
    playersRef,
    scoresRef,
    deadPlayersRef,
    deathTimeMapRef,
    displayNamesRef,
    handleRespawn: handleRespawnStable,
    completeMigration,
  });

  // Kill 処理: 世界線凍結 + デブリ生成 + isDead 設定
  const handleKill = useCallback(
    (
      victimId: string,
      killerId: string,
      hitPos: { t: number; x: number; y: number; z: number },
    ) => {
      const victim = playersRef.current.get(victimId);
      if (!victim) return;

      setFrozenWorldLines((prev) => {
        const frozen: FrozenWorldLine = {
          worldLine: victim.worldLine,
          color: victim.color,
          showHalfLine: victim.worldLine.origin !== null,
        };
        return [...prev, frozen].slice(-MAX_FROZEN_WORLDLINES);
      });

      const explosionParticles = generateExplosionParticles(victim.phaseSpace.u);
      setDebrisRecords((prev) => {
        const newDebris: DebrisRecord = {
          deathPos: hitPos,
          particles: explosionParticles,
          color: victim.color,
        };
        return [...prev, newDebris].slice(-MAX_DEBRIS);
      });

      setPlayers((prev) => applyKill(prev, victimId));

      if (victimId === myId) {
        myDeathEventRef.current = {
          pos: victim.phaseSpace.pos,
          u: getVelocity4(victim.phaseSpace.u),
        };
        ghostTauRef.current = 0;
      }

      deathTimeMapRef.current.set(victimId, Date.now());

      pendingKillEventsRef.current.push({
        victimId,
        killerId,
        hitPos,
        victimName: isLighthouse(victimId) ? "Lighthouse" : (playersRef.current.get(victimId)?.displayName ?? victimId.slice(0, 6)),
        victimColor: victim.color,
      });
      if (pendingKillEventsRef.current.length > 100) {
        pendingKillEventsRef.current =
          pendingKillEventsRef.current.slice(-100);
      }
    },
    [myId, setPlayers],
  );

  // Respawn 処理
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is read at spawn time only, not a reactive dependency
  const handleRespawn = useCallback(
    (
      playerId: string,
      position: { t: number; x: number; y: number; z: number },
    ) => {
      setPlayers((prev) => applyRespawn(prev, playerId, position));

      deathTimeMapRef.current.delete(playerId);

      // Lighthouse: reset spawn grace timer on respawn
      if (isLighthouse(playerId)) {
        lighthouseSpawnTimeRef.current.set(playerId, Date.now());
      }

      if (playerId === myId) {
        myDeathEventRef.current = null;
        ghostTauRef.current = 0;
        cameraYawRef.current = 0;
        cameraPitchRef.current = Math.PI / 6;
        energyRef.current = ENERGY_MAX;
      }

      const spawningPlayer = playersRef.current.get(playerId);
      const color = spawningPlayer?.color ?? getPlayerColor(playerId);
      const now = Date.now();

      if (playerId === myId) {
        setSpawns((prev) => [
          ...prev,
          {
            id: `spawn-${playerId}-${now}`,
            pos: position,
            color,
            startTime: now,
          },
        ]);
      } else {
        pendingSpawnEventsRef.current = [
          ...pendingSpawnEventsRef.current,
          { id: `spawn-${playerId}-${now}`, pos: position, color },
        ];
        if (pendingSpawnEventsRef.current.length > 50) {
          pendingSpawnEventsRef.current =
            pendingSpawnEventsRef.current.slice(-50);
        }
      }
    },
    [myId, setPlayers],
  );

  // Keep handleRespawnRef in sync with the latest handleRespawn
  handleRespawnRef.current = handleRespawn;

  // 初期化: ホストのみプレイヤー作成。
  // クライアントは syncTime 受信時に messageHandler がホストの座標時間でプレイヤーを作成。
  const isHost = peerManager?.getIsHost() ?? false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is read at init time only
  useEffect(() => {
    if (!myId) return;
    if (!isHost) return; // クライアントは syncTime でプレイヤー作成

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
    let initialWorldLine = createWorldLine(MAX_WORLDLINE_HISTORY, initialPhaseSpace);
    initialWorldLine = appendWorldLine(initialWorldLine, initialPhaseSpace);
    const initialColor = getPlayerColor(myId);

    setPlayers((prev) => {
      if (prev.has(myId)) return prev; // Already initialized (reconnect/migration)
      const next = new Map(prev);
      next.set(myId, {
        id: myId,
        phaseSpace: initialPhaseSpace,
        worldLine: initialWorldLine,
        color: initialColor,
        isDead: false,
      });
      return next;
    });

    // Lighthouse AI + score sync to connected clients
    const lighthouseId = `${LIGHTHOUSE_ID_PREFIX}0`;
    const lighthouse = createLighthouse(
      lighthouseId,
      Date.now() / 1000 - OFFSET,
    );

    lighthouseSpawnTimeRef.current.set(lighthouseId, Date.now());
    stale.staleFrozenRef.current.delete(lighthouseId);

    setPlayers((prev) => {
      const next = new Map(prev);
      next.set(lighthouseId, lighthouse);
      return next;
    });

    if (peerManager) {
      for (const conn of connections) {
        if (conn.open) {
          peerManager.sendTo(conn.id, {
            type: "syncTime",
            hostTime: initialPhaseSpace.pos.t,
            scores: scoresRef.current,
          });
        }
      }
    }
  }, [myId, isHost]);

  // playersRef は setPlayers ラッパー内で即座に同期されるため useEffect 不要
  useEffect(() => {
    lasersRef.current = lasers;
  }, [lasers]);

  // 切断したプレイヤーを削除 & 新規接続にsyncTime送信
  const prevConnectionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!myId) return;

    const connectedIds = new Set(connections.map((c) => c.id));
    connectedIds.add(myId);

    if (peerManager?.getIsHost() && !isMigrating) {
      const myPlayer = playersRef.current.get(myId);
      if (myPlayer) {
        for (const conn of connections) {
          if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
            peerManager.sendTo(conn.id, {
              type: "syncTime",
              hostTime: myPlayer.phaseSpace.pos.t,
              scores: scoresRef.current,
            });
          }
        }
      }
    }
    prevConnectionIdsRef.current = new Set(
      connections.filter((c) => c.open).map((c) => c.id),
    );

    setPlayers((prev) => {
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
        deadPlayersRef.current.delete(id);
        deathTimeMapRef.current.delete(id);
      }
      stale.cleanupDisconnected(connectedIds);
      return next;
    });
  }, [connections, myId, peerManager, isMigrating, stale, setPlayers]);

  // joinRegistry 変化時に全プレイヤーの色を再計算
  useEffect(() => {
    if (joinRegistryVersion === 0) return;
    setPlayers((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, player] of next) {
        if (isLighthouse(id)) continue; // Lighthouse uses fixed LIGHTHOUSE_COLOR
        const correctColor = getPlayerColor(id);
        if (player.color !== correctColor) {
          next.set(id, { ...player, color: correctColor });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [joinRegistryVersion, getPlayerColor, setPlayers]);

  // メッセージ受信処理
  // biome-ignore lint/correctness/useExhaustiveDependencies: getPlayerColor is passed to messageHandler but should not trigger re-registration
  useEffect(() => {
    if (!peerManager || !myId) return;

    peerManager.onMessage(
      "relativistic",
      createMessageHandler({
        myId,
        peerManager,
        setPlayers,
        setLasers,
        setScores,
        scoresRef,
        handleKill,
        handleRespawn,
        getPlayerColor,
        lastUpdateTimeRef: stale.lastUpdateTimeRef,
        lastCoordTimeRef: stale.lastCoordTimeRef,
        playersRef,
        staleFrozenRef: stale.staleFrozenRef,
        displayNamesRef,
      }),
    );

    peerManager.send({
      type: "intro",
      senderId: myId,
      displayName,
    });

    displayNamesRef.current.set(myId, displayName);

    return () => {
      peerManager.offMessage("relativistic");
    };
  }, [peerManager, myId, handleKill, handleRespawn]);


  // ウィンドウリサイズの検出
  useEffect(() => {
    const handleResize = () => {
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ゲームループ（useGameLoop hook に委譲）
  useGameLoop({
    peerManager, myId,
    setPlayers, setLasers, setSpawns, setScores, setFps, setEnergy, setIsFiring,
    setDeathFlash, setKillNotification,
    playersRef, lasersRef, processedLasersRef, deadPlayersRef,
    pendingKillEventsRef, pendingSpawnEventsRef, causalFrozenRef,
    lighthouseLastFireRef, lighthouseSpawnTimeRef, lastLaserTimeRef,
    myDeathEventRef, ghostTauRef, cameraYawRef, cameraPitchRef,
    energyRef, fpsRef, scoresRef, respawnTimeoutsRef,
    keysPressed, touchInput,
    handleKill, handleRespawn, stale,
    deathTimeMapRef,
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
        players={players}
        myId={myId}
        scores={scores}
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
        killGlow={killNotification !== null}
        killNotification={killNotification}
        myDeathEvent={myDeathEventRef.current}
        getPlayerColor={getPlayerColor}
      />

      {useOrthographic ? (
        <Canvas
          key="ortho"
          orthographic
          camera={{
            zoom: 30,
            position: [0, 0, 100],
            near: -10000,
            far: 10000,
          }}
        >
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            spawns={spawns}
            frozenWorldLines={frozenWorldLines}
            debrisRecords={debrisRecords}
            killNotification={killNotification}
            showInRestFrame={showInRestFrame}
            useOrthographic={true}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
          />
        </Canvas>
      ) : (
        <Canvas key="persp" camera={{ position: [0, 0, 0], fov: 75 }}>
          <SceneContent
            players={players}
            myId={myId}
            lasers={lasers}
            spawns={spawns}
            frozenWorldLines={frozenWorldLines}
            debrisRecords={debrisRecords}
            killNotification={killNotification}
            showInRestFrame={showInRestFrame}
            useOrthographic={false}
            cameraYawRef={cameraYawRef}
            cameraPitchRef={cameraPitchRef}
          />
        </Canvas>
      )}
    </div>
  );
};

export default RelativisticGame;
