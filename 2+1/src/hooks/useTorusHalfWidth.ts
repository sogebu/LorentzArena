import { ARENA_HALF_WIDTH } from "../components/game/constants";
import { useGameStore } from "../stores/game-store";

/**
 * `boundaryMode === "torus"` のとき `ARENA_HALF_WIDTH`、 そうでなければ `undefined` を返す。
 *
 * `pastLightConeIntersectionWorldLine` / `findLaserHitPosition` 等の torus-aware な
 * 物理関数に渡す `torusHalfWidth?: number` 引数の元として使う。 各 renderer / hook で同じ
 * pattern を書かずに済むよう薄い wrapper として提供。
 */
export const useTorusHalfWidth = (): number | undefined => {
  const boundaryMode = useGameStore((s) => s.boundaryMode);
  return boundaryMode === "torus" ? ARENA_HALF_WIDTH : undefined;
};
