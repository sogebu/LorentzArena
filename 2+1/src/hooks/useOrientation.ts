import { useEffect, useState } from "react";

export type Orientation = "portrait" | "landscape";

const QUERY = "(orientation: landscape)";

/**
 * Track browser orientation (portrait / landscape) reactively.
 *
 * Uses `matchMedia("(orientation: landscape)")` + `change` event subscription.
 * Updates synchronously on rotation, immediately re-rendering subscribers.
 *
 * Server-safe: falls back to "portrait" when `window` is unavailable.
 *
 * 設計:
 * - hook を呼ぶ component が増えても overhead は無視できる (= 各々が同 mediaQueryList
 *   listener を独立 attach、 browser native dedupe で実装 cost 低)。 必要なら将来 React
 *   context に上げて 1 つの listener に集約も可
 * - orientation は browser-state なので zustand store には載せない (= store は
 *   game-state、 react state は browser-state という分離を維持)
 */
export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(() => {
    if (typeof window === "undefined") return "portrait";
    return window.matchMedia(QUERY).matches ? "landscape" : "portrait";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => {
      setOrientation(e.matches ? "landscape" : "portrait");
    };
    mql.addEventListener("change", handler);
    // initial sync (mql.matches may have changed between SSR initial state and mount)
    setOrientation(mql.matches ? "landscape" : "portrait");
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, []);

  return orientation;
}
