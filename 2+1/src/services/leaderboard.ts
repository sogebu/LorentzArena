import type { HighScoreEntry } from "./highScores";

const FETCH_TIMEOUT_MS = 5000;

export const fetchLeaderboard = async (
  baseUrl: string,
  n = 50,
): Promise<HighScoreEntry[]> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(`${baseUrl}/leaderboard`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, n) as HighScoreEntry[];
  } catch {
    return [];
  }
};

export const submitScore = (baseUrl: string, entry: HighScoreEntry): void => {
  // Use sendBeacon for reliability during beforeunload.
  // Falls back to fire-and-forget fetch if sendBeacon is unavailable.
  const body = JSON.stringify(entry);
  const url = `${baseUrl}/leaderboard`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
  } else {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
};
