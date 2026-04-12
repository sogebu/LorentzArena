const STORAGE_KEY = "la-highscores";
const MAX_ENTRIES = 20;

export type HighScoreEntry = {
  name: string;
  kills: number;
  date: string; // ISO date string
  duration: number; // seconds
};

export const loadHighScores = (): HighScoreEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown) =>
        e != null &&
        typeof e === "object" &&
        typeof (e as HighScoreEntry).name === "string" &&
        typeof (e as HighScoreEntry).kills === "number" &&
        typeof (e as HighScoreEntry).date === "string" &&
        typeof (e as HighScoreEntry).duration === "number",
    ) as HighScoreEntry[];
  } catch {
    return [];
  }
};

export const saveHighScore = (entry: HighScoreEntry): void => {
  try {
    const existing = loadHighScores();
    existing.push(entry);
    existing.sort((a, b) => b.kills - a.kills);
    const trimmed = existing.slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable
  }
};

export const getTopScores = (n: number): HighScoreEntry[] => {
  return loadHighScores().slice(0, n);
};
