import { useEffect, useRef } from "react";
import { saveHighScore } from "../services/highScores";
import { submitScore } from "../services/leaderboard";
import { isLighthouse, LIGHTHOUSE_DISPLAY_NAME } from "../components/game/lighthouse";
import { useGameStore } from "../stores/game-store";

const makeSessionId = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export function useHighScoreSaver(
  myId: string | null,
  displayName: string,
  peerManager: { getIsBeaconHolder: () => boolean } | null,
) {
  const sessionStartTimeRef = useRef<number>(Date.now());
  const sessionIdRef = useRef<string>(makeSessionId());
  const savedRef = useRef(false);

  useEffect(() => {
    const saveScores = () => {
      if (savedRef.current) return;
      if (!myId) return;
      savedRef.current = true;

      const scores = useGameStore.getState().scores;
      const duration = (Date.now() - sessionStartTimeRef.current) / 1000;
      const leaderboardUrl = import.meta.env.VITE_LEADERBOARD_URL;
      const now = new Date().toISOString();
      const sessionId = sessionIdRef.current;

      const myKills = scores[myId] ?? 0;
      if (myKills > 0) {
        const entry = {
          name: displayName,
          kills: myKills,
          date: now,
          duration,
          sessionId,
        };
        saveHighScore(entry);
        if (leaderboardUrl) submitScore(leaderboardUrl, entry);
      }

      if (peerManager?.getIsBeaconHolder()) {
        for (const [id, kills] of Object.entries(scores)) {
          if (isLighthouse(id) && kills > 0) {
            const entry = {
              name: LIGHTHOUSE_DISPLAY_NAME,
              kills,
              date: now,
              duration,
              sessionId: `${sessionId}-${id}`,
            };
            saveHighScore(entry);
            if (leaderboardUrl) submitScore(leaderboardUrl, entry);
          }
        }
      }
    };

    // pagehide fires on mobile when backgrounding (beforeunload often doesn't).
    // visibilitychange is the most reliable signal on iOS Safari when the user
    // swipes home or switches apps without fully closing the tab.
    const handlePageHide = () => saveScores();
    const handleBeforeUnload = () => saveScores();
    const handleVisibilityChange = () => {
      if (document.hidden) {
        saveScores();
      } else {
        savedRef.current = false; // back to foreground — allow a later hide to re-save
      }
    };
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) savedRef.current = false; // bfcache restore → allow re-save
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [myId, displayName, peerManager]);
}
