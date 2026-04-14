import { useEffect, useRef } from "react";
import { RESPAWN_DELAY } from "../components/game/constants";
import { createRespawnPosition } from "../components/game/respawnTime";
import { selectDeadPlayerIds, useGameStore } from "../stores/game-store";

interface UseHostMigrationArgs {
  isMigrating: boolean;
  peerManager: {
    getIsHost: () => boolean;
    send: (msg: unknown) => void;
  } | null;
  myId: string | null;
  connections: Array<{ id: string; open: boolean }>;
  getPlayerColor: (id: string) => string;
  completeMigration: () => void;
}

export function useHostMigration({
  isMigrating,
  peerManager,
  myId,
  connections,
  getPlayerColor,
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

    const store = useGameStore.getState();

    // Stage C: deadPlayers / deathTime は killLog / respawnLog から derive。
    // 該当 victim の latest kill wallTime を deathTime として採用。
    const deadIds = selectDeadPlayerIds(store);
    const latestKillWallTime = new Map<string, number>();
    for (const e of store.killLog) {
      const prev = latestKillWallTime.get(e.victimId);
      if (prev === undefined || e.wallTime > prev) {
        latestKillWallTime.set(e.victimId, e.wallTime);
      }
    }
    const deadPlayersList: Array<{ playerId: string; deathTime: number }> = [];
    for (const playerId of deadIds) {
      const deathTime = latestKillWallTime.get(playerId) ?? Date.now();
      deadPlayersList.push({ playerId, deathTime });
    }

    // Broadcast hostMigration to all connected peers
    peerManager.send({
      type: "hostMigration" as const,
      newHostId: myId,
      scores: store.scores,
      deadPlayers: deadPlayersList,
      displayNames: Object.fromEntries(store.displayNames),
    });

    // Reconstruct respawn timers for dead players
    const now = Date.now();
    for (const { playerId, deathTime } of deadPlayersList) {
      const elapsed = now - deathTime;
      const remaining = Math.max(0, RESPAWN_DELAY - elapsed);

      const timerId = setTimeout(() => {
        respawnTimeoutsRef.current.delete(timerId);
        const currentStore = useGameStore.getState();
        const respawnPos = createRespawnPosition(currentStore.players);
        peerManager.send({
          type: "respawn" as const,
          playerId,
          position: respawnPos,
        });
        currentStore.handleRespawn(playerId, respawnPos, myId, getPlayerColor);
      }, remaining);
      respawnTimeoutsRef.current.add(timerId);
    }

    completeMigration();
  }, [
    isMigrating,
    peerManager,
    myId,
    connections,
    getPlayerColor,
    completeMigration,
  ]);

  return respawnTimeoutsRef;
}
