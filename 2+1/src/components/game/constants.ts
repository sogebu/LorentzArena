export const OFFSET = Date.now() / 1000;

// スポーンエフェクトの持続時間（ミリ秒）
export const SPAWN_EFFECT_DURATION = 1500;

// レーザーの射程
export const LASER_RANGE = 20;

// リスポーン遅延（ミリ秒）
export const RESPAWN_DELAY = 10000;

// 凍結世界線の保持上限（世界オブジェクト）
export const MAX_FROZEN_WORLDLINES = 20;

// デブリの保持上限（世界オブジェクト）
export const MAX_DEBRIS = 20;

// レーザーの最大数（メモリ管理）
export const MAX_LASERS = 1000;

// 当たり判定の半径
export const HIT_RADIUS = 0.5;

// スポーン範囲（x, y）
export const SPAWN_RANGE = 20;

// レーザー連射間隔（ミリ秒）
export const LASER_COOLDOWN = 100;

// レーザーエネルギー
export const ENERGY_MAX = 1.0;
export const ENERGY_PER_SHOT = 1.0 / 30; // 30 発で枯渇（≈3 秒連射）
export const ENERGY_RECOVERY_RATE = 1.0 / 6; // 6 秒で 0→満タン（撃っていないときのみ回復）

// 爆発パーティクル数
export const EXPLOSION_PARTICLE_COUNT = 30;
