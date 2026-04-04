import type { PhaseSpace, Vector4, WorldLine } from "../../physics";
import type { lorentzBoost } from "../../physics";

// 死亡時の爆散デブリ（等速直線運動、永続データ）
export type DebrisRecord = {
  readonly deathPos: { t: number; x: number; y: number; z: number };
  readonly particles: ReadonlyArray<{ dx: number; dy: number; size: number }>;
  readonly color: string;
};

export type RelativisticPlayer = {
  id: string;
  // in 世界系
  phaseSpace: PhaseSpace;
  lives: WorldLine[]; // 全ライフ（最後が現在の命）
  debrisRecords: DebrisRecord[]; // 死亡時の爆散デブリ（永続）
  color: string;
};

export const currentLife = (p: RelativisticPlayer): WorldLine =>
  p.lives[p.lives.length - 1];

export type Laser = {
  readonly id: string;
  readonly playerId: string;
  readonly emissionPos: { t: number; x: number; y: number; z: number };
  readonly direction: { x: number; y: number; z: number };
  readonly range: number;
  readonly color: string;
};

export type SpawnEffect = {
  readonly id: string;
  readonly pos: { t: number; x: number; y: number; z: number };
  readonly color: string;
  readonly startTime: number;
};

export type DisplayLaser = {
  readonly id: string;
  readonly color: string;
  readonly start: Vector4;
  readonly end: Vector4;
};

export type WorldLineRendererProps = {
  worldLine: WorldLine;
  color: string;
  showHalfLine: boolean;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
};

export type SceneContentProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  lasers: Laser[];
  spawns: SpawnEffect[];
  showInRestFrame: boolean;
  useOrthographic: boolean;
  cameraYawRef: React.RefObject<number>;
  cameraPitchRef: React.RefObject<number>;
};
