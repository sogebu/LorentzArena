import { useRef } from "react";
import type { RelativisticPlayer } from "../components/game/types";

const STALE_WALL_THRESHOLD = 5000;
const STALE_RATE_WINDOW = 3000;
const STALE_MIN_RATE = 0.1;

export function useStaleDetection() {
  const staleFrozenRef = useRef<Set<string>>(new Set());
  const lastUpdateTimeRef = useRef<Map<string, number>>(new Map());
  const lastCoordTimeRef = useRef<
    Map<string, { wallTime: number; posT: number }>
  >(new Map());

  const checkStale = (
    currentTime: number,
    players: Map<string, RelativisticPlayer>,
    myId: string,
  ) => {
    for (const [id, player] of players) {
      if (id === myId) continue;
      if (player.isDead) continue;
      if (staleFrozenRef.current.has(id)) continue;

      // (1) Wall-clock based: no phaseSpace update for 5 seconds
      const lastUpdate = lastUpdateTimeRef.current.get(id);
      if (lastUpdate && currentTime - lastUpdate > STALE_WALL_THRESHOLD) {
        staleFrozenRef.current.add(id);
        continue;
      }

      // (2) Coordinate time rate: phaseSpace arrives but coord time barely advances (tab throttle)
      const coordRecord = lastCoordTimeRef.current.get(id);
      if (coordRecord) {
        const wallElapsed = currentTime - coordRecord.wallTime;
        if (wallElapsed > STALE_RATE_WINDOW) {
          const coordElapsed = player.phaseSpace.pos.t - coordRecord.posT;
          const rate = coordElapsed / (wallElapsed / 1000);
          if (rate < STALE_MIN_RATE) {
            staleFrozenRef.current.add(id);
          }
        }
      }
    }
  };

  const recoverStale = (playerId: string) => {
    staleFrozenRef.current.delete(playerId);
  };

  const cleanupDisconnected = (connectedIds: Set<string>) => {
    for (const id of staleFrozenRef.current) {
      if (!connectedIds.has(id)) {
        staleFrozenRef.current.delete(id);
      }
    }
    for (const id of lastUpdateTimeRef.current.keys()) {
      if (!connectedIds.has(id)) {
        lastUpdateTimeRef.current.delete(id);
      }
    }
    for (const id of lastCoordTimeRef.current.keys()) {
      if (!connectedIds.has(id)) {
        lastCoordTimeRef.current.delete(id);
      }
    }
  };

  return {
    staleFrozenRef,
    lastUpdateTimeRef,
    lastCoordTimeRef,
    checkStale,
    recoverStale,
    cleanupDisconnected,
  };
}
