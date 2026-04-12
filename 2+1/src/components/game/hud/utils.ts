export const isTouchDevice =
  "ontouchstart" in window || navigator.maxTouchPoints > 0;

/** Convert "hsl(H, S%, L%)" to "H, S%, L%" for use in hsla(). */
export const hslToComponents = (hsl: string): string => {
  const match = hsl.match(/hsl\((.+)\)/);
  return match ? match[1] : "30, 80%, 60%"; // fallback orange
};
