import { useEffect, useRef } from "react";
import { saveHighScore } from "../services/highScores";
import { submitScore } from "../services/leaderboard";
import { isLighthouse } from "../components/game/lighthouse";
export function useHighScoreSaver(
  myId: string | null,
  displayName: string,
  peerManager: { getIsHost: () => boolean } | null,
  scoresRef: React.RefObject<Record<string, number>>,
) {
  const sessionStartTimeRef = useRef<number>(Date.now());
  const savedRef = useRef(false);

  useEffect(() => {
    const saveScores = () => {
      if (savedRef.current) return;
      if (!myId) return;
      savedRef.current = true;

      const duration = (Date.now() - sessionStartTimeRef.current) / 1000;
      const leaderboardUrl = import.meta.env.VITE_LEADERBOARD_URL;
      const now = new Date().toISOString();

      const myKills = scoresRef.current[myId] ?? 0;
      if (myKills > 0) {
        const entry = { name: displayName, kills: myKills, date: now, duration };
        saveHighScore(entry);
        if (leaderboardUrl) submitScore(leaderboardUrl, entry);
      }

      if (peerManager?.getIsHost()) {
        for (const [id, kills] of Object.entries(scoresRef.current)) {
          if (isLighthouse(id) && kills > 0) {
            const entry = { name: "Lighthouse", kills, date: now, duration };
            saveHighScore(entry);
            if (leaderboardUrl) submitScore(leaderboardUrl, entry);
          }
        }
      }
    };

    // pagehide fires on mobile when backgrounding (beforeunload often doesn't)
    const handlePageHide = () => saveScores();
    const handleBeforeUnload = () => saveScores();
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) savedRef.current = false; // bfcache restore → allow re-save
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [myId, displayName, peerManager, scoresRef]);
}
