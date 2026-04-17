import { useEffect, useRef } from "react";
import { RESPAWN_DELAY } from "../components/game/constants";
import { isLighthouse } from "../components/game/lighthouse";
import { createRespawnPosition } from "../components/game/respawnTime";
import { selectDeadPlayerIds, useGameStore } from "../stores/game-store";

interface UseBeaconMigrationArgs {
  isMigrating: boolean;
  peerManager: {
    getIsBeaconHolder: () => boolean;
    send: (msg: unknown) => void;
  } | null;
  myId: string | null;
  connections: Array<{ id: string; open: boolean }>;
  getPlayerColor: (id: string) => string;
  completeMigration: () => void;
}

/**
 * Authority 解体 Stage F: 旧 useHostMigration。Stage D-1 で respawn timer
 * 再構築を削除、Stage F-1 で hostMigration メッセージ送信を廃止した結果、
 * このフックの仕事は Lighthouse handoff (owner 書き換え + 死亡中の残り時間で
 * respawn 再 schedule) のみに縮退している。
 */
export function useBeaconMigration({
  isMigrating,
  peerManager,
  myId,
  connections,
  getPlayerColor,
  completeMigration,
}: UseBeaconMigrationArgs) {
  const respawnTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );

  useEffect(() => {
    if (!isMigrating) return;
    if (!peerManager) return;
    if (!peerManager.getIsBeaconHolder()) return;
    if (!myId) return;

    const openConns = connections.filter((c) => c.open);

    console.log(
      "[useBeaconMigration] Beacon migration: handoff to",
      openConns.length,
      "peers",
    );

    // Clear any previously pending respawn timers
    for (const id of respawnTimeoutsRef.current) {
      clearTimeout(id);
    }
    respawnTimeoutsRef.current.clear();

    const store = useGameStore.getState();

    // Stage F: 既存 peer には何も broadcast しない。各 peer の state は
    // event log (killLog / respawnLog) から自己維持されており、migration の
    // state 転送は不要。host 識別 ID は peerProvider の peerOrderRef ベース
    // 選出で各 peer が独立に決める (hostMigration メッセージに依存しない)。
    //
    // Stage D-1 での人間 respawn timer 再構築撤去 + Stage F での hostMigration
    // 廃止で、useHostMigration の仕事は Lighthouse handoff のみに縮退済み。

    const deadIds = selectDeadPlayerIds(store);
    const latestKillWallTime = new Map<string, number>();
    for (const e of store.killLog) {
      const prev = latestKillWallTime.get(e.victimId);
      if (prev === undefined || e.wallTime > prev) {
        latestKillWallTime.set(e.victimId, e.wallTime);
      }
    }

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
        const respawnPos = createRespawnPosition(currentStore.players, playerId);
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
