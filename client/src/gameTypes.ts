export type GameState = {
  paddle1: { x: number; y: number; width: number; height: number };
  paddle2: { x: number; y: number; width: number; height: number };
  ball: { x: number; y: number; radius: number; dx: number; dy: number };
  score: { player1: number; player2: number };
};

export type GameMessage = {
  type: "paddle_move" | "game_state" | "game_start" | "game_end";
  payload: {
    y?: number;
    gameState?: GameState;
  };
};
