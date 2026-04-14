import { useEffect, useRef } from "react";
import { RESPAWN_DELAY } from "../components/game/constants";
import { isLighthouse } from "../components/game/lighthouse";
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

    // Stage D: 人間プレイヤーの respawn timer は owner (= 本人) が持ち続けて
    // いる。migration で再構築しない。ここで扱うのは Lighthouse のみ
    // (owner = beacon holder = 自分に移管)。
    //
    // hostMigration payload は Stage F で廃止予定。今は deadPlayers / scores /
    // displayNames を歴史的互換で送る (クライアントは scores / displayNames
    // だけ消費)。
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
      deadPlayersList.push({
        playerId,
        deathTime: latestKillWallTime.get(playerId) ?? Date.now(),
      });
    }

    // Broadcast hostMigration to all connected peers
    peerManager.send({
      type: "hostMigration" as const,
      newHostId: myId,
      scores: store.scores,
      deadPlayers: deadPlayersList,
      displayNames: Object.fromEntries(store.displayNames),
    });

    // Lighthouse owner を新 host (自分) に書き換え
    store.setPlayers((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, player] of next) {
        if (isLighthouse(id) && player.ownerId !== myId) {
          next.set(id, { ...player, ownerId: myId });
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // LH の respawn timer を張り直し (killLog から残り時間を計算)
    const now = Date.now();
    for (const playerId of deadIds) {
      if (!isLighthouse(playerId)) continue;
      const deathTime = latestKillWallTime.get(playerId) ?? now;
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
