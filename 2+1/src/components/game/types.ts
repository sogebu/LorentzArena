import type { PhaseSpace, Vector4, WorldLine } from "../../physics";
import type { lorentzBoost } from "../../physics";

// 死亡時の爆散デブリ（等速直線運動、永続データ）
export type DebrisRecord = {
  readonly deathPos: { t: number; x: number; y: number; z: number };
  readonly particles: ReadonlyArray<{ dx: number; dy: number; size: number }>;
  readonly color: string;
};

// 世界に残された凍結世界線（死んだプレイヤーの痕跡）
export type FrozenWorldLine = {
  readonly worldLine: WorldLine;
  readonly color: string;
  readonly showHalfLine: boolean; // 最初のライフのみ true
};

// 死亡イベント（ゴーストカメラの起点）
export type DeathEvent = {
  readonly pos: Vector4; // 死亡位置（4元位置）
  readonly u: Vector4; // 死亡時の4元速度（ローレンツブースト計算用）
};

export type RelativisticPlayer = {
  id: string;
  phaseSpace: PhaseSpace;
  worldLine: WorldLine; // 現在の命の世界線（1本のみ）
  color: string;
  isDead: boolean;
};

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
  frozenWorldLines: FrozenWorldLine[];
  debrisRecords: DebrisRecord[];
  showInRestFrame: boolean;
  useOrthographic: boolean;
  cameraYawRef: React.RefObject<number>;
  cameraPitchRef: React.RefObject<number>;
};
