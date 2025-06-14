export type Message =
  | { type: "text"; text: string }
  | { type: "position"; x: number; y: number }
  | {
      type: "phaseSpace";
      position: { x: number; y: number; z: number };
      velocity: { x: number; y: number; z: number };
      properTime: number;
    };
