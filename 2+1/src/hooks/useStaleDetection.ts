import { useMemo, useRef } from "react";
import { isLighthouse } from "../components/game/lighthouse";
import type { RelativisticPlayer } from "../components/game/types";

const STALE_WALL_THRESHOLD = 5000; // 5 seconds with no phaseSpace update → stale
const STALE_RATE_WINDOW = 3000; // 3 second window for rate calculation
const STALE_MIN_RATE = 0.1; // coordinate time must advance at least 10% of wall time

/** Remove entries from a Map/Set whose keys are not in connectedIds. */
const purgeDisconnected = (
  collection: Map<string, unknown> | Set<string>,
  connectedIds: Set<string>,
) => {
  for (const id of collection.keys()) {
    if (!connectedIds.has(id)) {
      collection.delete(id);
    }
  }
};

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
      if (isLighthouse(id)) continue; // S-1: Lighthouse はホストが進行させるので stale 対象外
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
    // S-4: リセットして即座再 stale を防止
    lastCoordTimeRef.current.delete(playerId);
  };

  const cleanupDisconnected = (connectedIds: Set<string>) => {
    purgeDisconnected(staleFrozenRef.current, connectedIds);
    purgeDisconnected(lastUpdateTimeRef.current, connectedIds);
    purgeDisconnected(lastCoordTimeRef.current, connectedIds); // S-3: cleanup 漏れ修正
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: all values are stable refs or closures over refs — never change
  return useMemo(
    () => ({
      staleFrozenRef,
      lastUpdateTimeRef,
      lastCoordTimeRef,
      checkStale,
      recoverStale,
      cleanupDisconnected,
    }),
    [],
  );
}
