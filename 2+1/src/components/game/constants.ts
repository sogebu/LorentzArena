// Time origin: each peer uses its own page-load time.
// For non-beacon-holder peers, snapshot.hostTime corrects the offset at join.
export const OFFSET = Date.now() / 1000;

// スポーンエフェクトの持続時間（ミリ秒）
export const SPAWN_EFFECT_DURATION = 1500;

// レーザーの射程
export const LASER_RANGE = 10;

// リスポーン遅延（ミリ秒）
export const RESPAWN_DELAY = 10000;

// 凍結世界線の保持上限（世界オブジェクト）
export const MAX_FROZEN_WORLDLINES = 20;

// デブリの保持上限（世界オブジェクト）
export const MAX_DEBRIS = 20;

// レーザーの最大数（メモリ管理）
export const MAX_LASERS = 1000;

// 当たり判定の半径
export const HIT_RADIUS = 0.25;

// スポーン範囲（x, y）
export const SPAWN_RANGE = 10;

// レーザー連射間隔（ミリ秒）
export const LASER_COOLDOWN = 100;

// レーザーエネルギー
export const ENERGY_MAX = 1.0;
export const ENERGY_PER_SHOT = 1.0 / 30; // 30 発で枯渇（≈3 秒連射）
export const ENERGY_RECOVERY_RATE = 1.0 / 6; // 6 秒で 0→満タン（撃っていないときのみ回復）

// 世界線の最大サンプル数
export const MAX_WORLDLINE_HISTORY = 5000;

// 爆発パーティクル数
export const EXPLOSION_PARTICLE_COUNT = 30;

// Lighthouse（AI 固定砲台）
export const LIGHTHOUSE_ID_PREFIX = "lighthouse-";
export const LIGHTHOUSE_FIRE_INTERVAL = 3000; // ms
export const LIGHTHOUSE_SPAWN_GRACE = 10000; // ms — don't fire for this long after spawn
export const LIGHTHOUSE_COLOR = "hsl(220, 70%, 75%)"; // 薄い青

// リスポーン後の無敵時間（ミリ秒）
export const INVINCIBILITY_DURATION = 10000;

// --- Player physics ---
export const PLAYER_ACCELERATION = 0.8; // c/s
export const FRICTION_COEFFICIENT = 0.5; // 速度に比例する減速

// --- Camera ---
export const CAMERA_YAW_SPEED = 0.8; // rad/s
export const CAMERA_PITCH_SPEED = 0.5; // rad/s
export const CAMERA_PITCH_MIN = (-Math.PI * 89.9) / 180;
export const CAMERA_PITCH_MAX = (Math.PI * 89.9) / 180;
export const CAMERA_DISTANCE_ORTHOGRAPHIC = 50;
export const CAMERA_DISTANCE_PERSPECTIVE = 10;
export const DEFAULT_CAMERA_PITCH = Math.PI / 6;

// --- Causality guard ---
export const CAUSAL_FREEZE_HYSTERESIS = 2.0; // ヒステリシス: 既に凍結中は閾値を上げて振動防止

// --- Game loop ---
export const GAME_LOOP_INTERVAL = 8; // ms
export const PROCESSED_LASERS_CLEANUP_THRESHOLD = 500;

// --- Pending events caps ---
export const MAX_PENDING_SPAWN_EVENTS = 50;

// --- Authority 解体 Stage C: event log safety caps ---
// GC (pair 成立 kill 削除 + latest respawn 残し) が通常働くので通常はこれに
// 届かない。届いたら protection として古いものから切り詰め。
export const MAX_KILL_LOG = 1000;
export const MAX_RESPAWN_LOG = 500;

// --- Light cone rendering ---
export const LIGHT_CONE_HEIGHT = 20;

// --- Player marker sizes ---
export const PLAYER_MARKER_SIZE_SELF = 0.42;
export const PLAYER_MARKER_SIZE_OTHER = 0.2;
