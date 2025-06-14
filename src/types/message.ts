export type Message =
  | { type: "text"; text: string }
  | { type: "position"; x: number; y: number };