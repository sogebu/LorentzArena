import type { PhaseSpace } from "../physics/mechanics";

export type Player = {
  id: string;
  x: number;
  y: number;
};

export type RelativisticPlayer = {
  id: string;
  phaseSpace: PhaseSpace;
  // 観測者から見た見かけの位置
  apparentX: number;
  apparentY: number;
  // 最後に更新された時刻
  lastUpdateTime: number;
};
