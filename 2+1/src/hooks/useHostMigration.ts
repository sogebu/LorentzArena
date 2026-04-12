import { useEffect, useRef } from "react";
import { RESPAWN_DELAY, SPAWN_RANGE } from "../components/game/constants";
import { getRespawnCoordTime } from "../components/game/respawnTime";
import type { RelativisticPlayer } from "../components/game/types";
interface UseHostMigrationArgs {
  isMigrating: boolean;
  peerManager: {
    getIsHost: () => boolean;
    send: (msg: unknown) => void;
  } | null;
  myId: string | null;
  connections: Array<{ id: string; open: boolean }>;
  playersRef: React.RefObject<Map<string, RelativisticPlayer>>;
  scoresRef: React.RefObject<Record<string, number>>;
  deadPlayersRef: React.RefObject<Set<string>>;
  deathTimeMapRef: React.RefObject<Map<string, number>>;
  displayNamesRef: React.RefObject<Map<string, string>>;
  handleRespawn: (
    playerId: string,
    position: { t: number; x: number; y: number; z: number },
  ) => void;
  completeMigration: () => void;
}

export function useHostMigration({
  isMigrating,
  peerManager,
  myId,
  connections,
  playersRef,
  scoresRef,
  deadPlayersRef,
  deathTimeMapRef,
  displayNamesRef,
  handleRespawn,
  completeMigration,
}: UseHostMigrationArgs) {
  const respawnTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );

  useEffect(() => {
    if (!isMigrating) return;
    if (!peerManager) return;
    if (!peerManager.getIsHost()) return;
    if (!myId) return;

    const openConns = connections.filter((c) => c.open);

    console.log(
      "[RelativisticGame] Host migration: broadcasting state to",
      openConns.length,
      "peers",
    );

    // Clear any previously pending respawn timers
    for (const id of respawnTimeoutsRef.current) {
      clearTimeout(id);
    }
    respawnTimeoutsRef.current.clear();

    // Reconstruct deadPlayersRef from player state
    deadPlayersRef.current.clear();
    for (const [id, player] of playersRef.current) {
      if (player.isDead) {
        deadPlayersRef.current.add(id);
      }
    }

    // Build dead player list with death times
    const deadPlayersList: Array<{ playerId: string; deathTime: number }> = [];
    for (const playerId of deadPlayersRef.current) {
      const deathTime = deathTimeMapRef.current.get(playerId) ?? Date.now();
      deadPlayersList.push({ playerId, deathTime });
    }

    // Broadcast hostMigration to all connected peers
    peerManager.send({
      type: "hostMigration" as const,
      newHostId: myId,
      scores: scoresRef.current,
      deadPlayers: deadPlayersList,
      displayNames: Object.fromEntries(displayNamesRef.current),
    });

    // Reconstruct respawn timers for dead players
    const now = Date.now();
    for (const { playerId, deathTime } of deadPlayersList) {
      const elapsed = now - deathTime;
      const remaining = Math.max(0, RESPAWN_DELAY - elapsed);

      const timerId = setTimeout(() => {
        respawnTimeoutsRef.current.delete(timerId);
        const respawnPos = {
          t: getRespawnCoordTime(playersRef.current),
          x: Math.random() * SPAWN_RANGE,
          y: Math.random() * SPAWN_RANGE,
          z: 0,
        };
        deadPlayersRef.current.delete(playerId);
        peerManager.send({
          type: "respawn" as const,
          playerId,
          position: respawnPos,
        });
        handleRespawn(playerId, respawnPos);
      }, remaining);
      respawnTimeoutsRef.current.add(timerId);
    }

    completeMigration();
  }, [
    isMigrating,
    peerManager,
    myId,
    connections,
    handleRespawn,
    completeMigration,
    playersRef,
    scoresRef,
    deadPlayersRef,
    deathTimeMapRef,
    displayNamesRef,
  ]);

  return respawnTimeoutsRef;
}
