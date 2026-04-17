// Time origin: each peer uses its own page-load time.
// 最初の beacon holder の自己スポーンと LH 初期化 (RelativisticGame.tsx) でのみ使用。
// 非 beacon holder の新 joiner は snapshot に同梱される `hostTime`
// (= computeSpawnCoordTime 算出の全プレイヤー最大 .pos.t) からスポーン時刻を取るので、
// この OFFSET には依存しない (peer ごとに OFFSET が違っても問題ない)。
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

// レーザー + スラスト共用エネルギー
export const ENERGY_MAX = 1.0;
export const ENERGY_PER_SHOT = 1.0 / 30; // 30 発で枯渇（≈3 秒連射）
// フル thrust 連続で満タン→0 に 9 秒。fire の 3 倍長持ち。
// 部分 thrust (|a|/PLAYER_ACCELERATION < 1) の場合は使用率に比例。
export const THRUST_ENERGY_RATE = 1.0 / 9;
export const ENERGY_RECOVERY_RATE = 1.0 / 6; // 6 秒で 0→満タン（撃/推どちらもしていないときのみ回復）

// 世界線の最大サンプル数。
// 本来は 5000 だったが、長時間プレイで SceneContent.tsx の
// `worldLineIntersections` / `laserIntersections` / `futureLightConeIntersections`
// useMemo と game loop の交差計算が毎フレーム history を走査する O(N) コストで
// FPS が 10 まで低下 (固有時間 ~170s 付近)。切り分けで worldLine.history 走査が
// 主因と確定したため、短期対策として 1000 に削減 (視覚的には世界線がやや短く切れる)。
// 中期対策: `pastLightConeIntersectionWorldLine` 等を二分探索で O(log N) 化
// (history は時系列順 t 単調なので可)。実装後に history を 5000 に戻せる。
export const MAX_WORLDLINE_HISTORY = 1000;

// 爆発パーティクル数
export const EXPLOSION_PARTICLE_COUNT = 30;

// Lighthouse（AI 固定砲台）
export const LIGHTHOUSE_ID_PREFIX = "lighthouse-";
export const LIGHTHOUSE_FIRE_INTERVAL = 2000; // ms
export const LIGHTHOUSE_SPAWN_GRACE = 5000; // ms — don't fire for this long after spawn
export const LIGHTHOUSE_COLOR = "hsl(220, 70%, 75%)"; // 薄い青
// 照準ジッタ (rad)。N(0, σ²) を 3σ で clamp。距離 D での横ズレ RMS ≈ σ·D。
// σ=0.3 で射程 10 では 3σ 時に最大 tan(0.9)·10 ≈ 12.6 マス外す (実質どこへでも)。
export const LIGHTHOUSE_AIM_JITTER_SIGMA = 0.3;

// リスポーン後の無敵時間（ミリ秒）
export const INVINCIBILITY_DURATION = 5000;

// --- Player physics ---
export const PLAYER_ACCELERATION = 0.8; // c/s
export const FRICTION_COEFFICIENT = 0.5; // 速度に比例する減速

// --- Exhaust (推進ジェット、視覚のみ) ---
// 自機 rest frame での thrust 加速度方向の反対側に cone を描画。
// v0 は自機のみ、他機対応は phaseSpace に α^μ を乗せたら同じ描画経路で拡張予定。
export const EXHAUST_BASE_LENGTH = 0.8; // cone の最大長 (magnitude=1 のとき)
export const EXHAUST_BASE_RADIUS = 0.15; // cone 底面半径 (固定)
export const EXHAUST_OFFSET = 0.3; // 球表面から cone 底面までのすき間
export const EXHAUST_MAX_OPACITY = 0.7;
// PC 入力は on/off の 2 値なので、magnitude を描画層で EMA smoothing して
// 点滅感を避ける (方向は即時)。Mobile の連続値には attack=60ms でほぼ即時。
export const EXHAUST_ATTACK_TIME = 60; // ms: 0 → 1 の追従時定数
export const EXHAUST_RELEASE_TIME = 180; // ms: 1 → 0 の追従時定数 (余韻)
export const EXHAUST_VISIBILITY_THRESHOLD = 0.01; // smoothed magnitude < これ で非表示

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
export const LIGHT_CONE_SURFACE_OPACITY = 0.08;
export const LIGHT_CONE_WIRE_OPACITY = 0.04;

// --- Worldline / laser opacity ---
export const PLAYER_WORLDLINE_OPACITY = 0.65;
export const LIGHTHOUSE_WORLDLINE_OPACITY = 0.4;
export const LASER_WORLDLINE_OPACITY = 0.3;

// --- Player marker sizes ---
export const PLAYER_MARKER_SIZE_SELF = 0.42;
export const PLAYER_MARKER_SIZE_OTHER = 0.2;

// --- Arena (world-frame static cylinder, visual guide only) ---
// スポーン中心 (= [0, SPAWN_RANGE]² 一様分布の中心) に配置。
export const ARENA_CENTER_X = SPAWN_RANGE / 2;
export const ARENA_CENTER_Y = SPAWN_RANGE / 2;
// 半径: LASER_RANGE (=10) の 2 倍、光円錐 HEIGHT と同じスケール感。
export const ARENA_RADIUS = 20;
// 円柱の時間方向レンジは観測者の因果コーン (過去・未来光円錐) で動的に切り出される
// ため、固定の ARENA_HEIGHT 定数は不要 (ArenaRenderer で observer.t ± ρ(θ) を直接計算)。
export const ARENA_RADIAL_SEGMENTS = 128;
// 暫定色 (シアン, 仮想空間境界のメタファー)。パステル化時に再検討。
// プレイヤー色 (HSL 黄金角分散) と Lighthouse (hsl(220,70%,75%)) の色相帯を避ける
export const ARENA_COLOR = "hsl(180, 40%, 70%)";
export const ARENA_SURFACE_OPACITY = 0.08;
// 時間方向に伸びる垂直線 ARENA_RADIAL_SEGMENTS 本の opacity (対角線のない純粋な縦線)
export const ARENA_VERTICAL_LINE_OPACITY = 0.04;
// 過去光円錐 × 円柱交線 LineLoop の透明度。サンプル数は surface と共有するため
// `ARENA_RADIAL_SEGMENTS` と同じ (shared position attribute で surface/ 交線 の頂点ズレ回避)。
export const ARENA_PAST_CONE_OPACITY = 1.0;
// 未来光円錐 × 円柱交線 (上端) の透明度。過去光円錐より控えめ (既に起きた event vs
// まだ起きていない event の情報量差を視覚で反映)。
export const ARENA_FUTURE_CONE_OPACITY = 0.3;
