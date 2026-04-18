import { useEffect, useRef } from "react";

const GAME_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "w",
  "W",
  "a",
  "A",
  "s",
  "S",
  "d",
  "D",
  " ",
];

function normalizeKey(key: string): string {
  if (key.startsWith("Arrow")) return key;
  return key.toLowerCase();
}

export function useKeyboardInput() {
  const keysPressed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (GAME_KEYS.includes(e.key)) {
        e.preventDefault();
      }
      keysPressed.current.add(normalizeKey(e.key));
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(normalizeKey(e.key));
    };

    // タブ離席時に押下中キーが stale で残り、復帰後に勝手に加速を続ける問題を防ぐ。
    // visibilitychange / blur / pagehide のどれかが発火すれば reset。
    const clearKeys = () => {
      keysPressed.current.clear();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) clearKeys();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearKeys);
    window.addEventListener("pagehide", clearKeys);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeys);
      window.removeEventListener("pagehide", clearKeys);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return keysPressed;
}
