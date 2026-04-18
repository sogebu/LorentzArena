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
  // fetch keepalive — not sendBeacon. Brave Shields blocks cross-origin
  // Request Type=ping (sendBeacon) as tracker traffic, so submissions were
  // silently dropped on unload. fetch keepalive survives the page unload and
  // isn't categorized as a beacon by content blockers.
  fetch(`${baseUrl}/leaderboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
    keepalive: true,
  }).catch(() => {});
};
