import { useEffect } from "react";
import type { NetworkManager } from "../contexts/PeerProvider";
import { useGameStore } from "../stores/game-store";

interface UseSnapshotRetryArgs {
  peerManager: NetworkManager | null;
  myId: string | null;
}

const RETRY_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 3;

/**
 * Pull-based snapshot retry for new joiners.
 *
 * The host push (RelativisticGame `prevConnectionIdsRef` diff) is the primary
 * path for initial state transfer, but it can miss if the client registers
 * its message handler after the snapshot arrives (race between `onMessage`
 * registration and the host-side `connections` effect firing). When the push
 * is lost, the client has no `players.get(myId)` and remains blank.
 *
 * This hook watches `players.has(myId)`: if still false after
 * `RETRY_INTERVAL_MS` for a non-host client, it sends a `snapshotRequest`
 * to the beacon holder. Retries up to `MAX_ATTEMPTS` times with the same
 * interval. The host's handler (in `messageHandler.ts`) replies with a fresh
 * snapshot.
 *
 * No-op for hosts (they don't need a snapshot) and for clients that already
 * have their player state.
 */
export function useSnapshotRetry({ peerManager, myId }: UseSnapshotRetryArgs) {
  const hasMyPlayer = useGameStore((s) =>
    myId ? s.players.has(myId) : false,
  );

  useEffect(() => {
    if (!peerManager || !myId) return;
    if (peerManager.getIsBeaconHolder()) return;
    if (hasMyPlayer) return;

    let attempts = 0;
    const timer = setInterval(() => {
      const store = useGameStore.getState();
      if (store.players.has(myId)) {
        clearInterval(timer);
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
        return;
      }
      const hostId = peerManager.getBeaconHolderId();
      if (!hostId) return;
      attempts++;
      console.log(
        "[useSnapshotRetry] no snapshot after",
        RETRY_INTERVAL_MS * attempts,
        "ms — requesting from",
        hostId,
      );
      peerManager.sendTo(hostId, { type: "snapshotRequest" as const });
    }, RETRY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [peerManager, myId, hasMyPlayer]);
}
