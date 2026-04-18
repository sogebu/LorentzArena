import type { RelativisticPlayer } from "./types";

/**
 * Kill: isDead=true にするだけ。
 * 世界線の凍結（frozenWorldLines への移動）とデブリ生成は呼び出し元で行う。
 */
export const applyKill = (
  prev: Map<string, RelativisticPlayer>,
  victimId: string,
): Map<string, RelativisticPlayer> => {
  const victim = prev.get(victimId);
  if (!victim) return prev;
  const next = new Map(prev);
  next.set(victimId, { ...victim, isDead: true });
  return next;
};
