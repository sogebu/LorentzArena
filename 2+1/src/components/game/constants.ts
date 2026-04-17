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

// 時間的オブジェクトの GC 閾値 (laser / frozen worldline / debris 共通):
// オブジェクトの最未来点 が 全プレイヤー最早時刻 (LH 含む) より
// LCH × `GC_PAST_LCH_MULTIPLIER` 以上過去なら削除。
//
// 時間 fade `r²/(r²+Δt²)` で Δt = 5×LCH のとき fade ≈ 0.038 (実質不可視) なので
// 5 がデフォルト。交差計算 / 世界線 tube 再生成 / InstancedMesh 更新が per-object
// 線形コストなので、古いものを落とすと FPS 改善。
//
// 各オブジェクトの「最未来点」:
// - laser: `emissionPos.t + range`
// - debris: `deathPos.t + DEBRIS_MAX_LAMBDA` (≈ deathPos.t + 2.5)
// - frozen worldline: `history[last].t` (= 死亡時刻)
export const GC_PAST_LCH_MULTIPLIER = 5;
// デブリ 1 粒子の coord time 方向の長さ。DebrisRenderer の segment 生成と GC の両方で参照。
export const DEBRIS_MAX_LAMBDA = 2.5;

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
export const EXHAUST_MAX_OPACITY = 0.45; // 透明度高めでプラズマ噴射らしく
// プレイヤー識別は sphere / worldline で担保されているので、exhaust は
// 全機共通の青系プラズマ色に統一。additive blending で重なると青白く光る。
export const EXHAUST_OUTER_COLOR = "hsl(210, 85%, 60%)"; // 明るい青 (外炎)
export const EXHAUST_INNER_COLOR = "hsl(210, 70%, 92%)"; // 冷たい白 (コア)
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
export const LIGHT_CONE_SURFACE_OPACITY = 0.1;
export const LIGHT_CONE_WIRE_OPACITY = 0.05;

// --- Time-distance opacity fade (Lorentzian, 2026-04-17) ---
// fade = r² / (r² + Δt²)、r = TIME_FADE_SCALE = LIGHT_CONE_HEIGHT。
// Δt = LCH でちょうど 0.5 (半透明)、Δt = 2×LCH で 0.2、Δt = 3×LCH で 0.1。
// per-vertex shader で光円錐・円柱・世界線・レーザーが自然グラデーションする
// ため、scale は LCH と同値の緩やかな減衰で十分 (LCH/2 だと急峻すぎた)。
// 時間距離の 2 乗反比例、物理の逆 2 乗法則と同型。
// 詳細: DESIGN.md §描画「時間的距離 opacity fade」
export const TIME_FADE_SCALE = LIGHT_CONE_HEIGHT;

// --- Stardust (時空星屑、案 17、2026-04-17) ---
// N 個の 4D event (spark) を world 座標で一様分布、THREE.Points で D pattern 描画。
// Lorentz 変換・光行差は per-vertex で自動。時間 fade shader を適用して境界で自然消失。
//
// **recycling 方式**: 初回 useMemo で固定 N 個を乱数配置、観測者が box 外に出ると
// 反対側へ wrap-around (periodic boundary)。時間 fade で境界 spark は既に透明なので
// recycling は視認されない。grid+hash 方式 (=観測者が cell を跨ぐと spark 群が全差し替え
// = 視覚ポッピング) は **採用しない**。
//
// 詳細: EXPLORING.md §進行方向・向きの認知支援 §追加案「案 17」
export const STARDUST_COUNT = 6000;
// 空間方向の ±範囲 (world 単位)。observer boost で display frame に mix されても
// 大半が視認 window 内に残るよう、TIME_HALF_RANGE と同程度に取る。
export const STARDUST_SPATIAL_HALF_RANGE = 60;
// 時間方向の ±範囲 (world 単位)。fade ≈ 0.1 となる 3×LCH で境界を置く。
// LCH 変更時に自動追従。
export const STARDUST_TIME_HALF_RANGE = TIME_FADE_SCALE * 3;
// Point size (world 単位、sizeAttenuation で perspective 縮小)
export const STARDUST_SIZE = 0.06;
// 暖色 amber (彩度上げて LH の light blue `hsl(220, 70%, 75%)` との視覚混同を回避)。
// arena cyan / exhaust blue / LH blue 全て寒色側なので、暖色方向で明確に分離。
export const STARDUST_COLOR = "hsl(42, 55%, 80%)";
// Base opacity。per-vertex time fade shader で乗算される (境界で ~0 まで減衰)。
export const STARDUST_OPACITY = 0.5;

// --- Stardust light-cone flash (観測者光円錐通過時のきらめき、2026-04-17 夜) ---
// spark が観測者の光円錐面 (dt = ±ρ) に近いと Gaussian kernel で alpha をブースト。
// 未来側は「まだ届いていない event」の情報量が相対的に少ないため控えめ。
// flash 幅 σ (coord time 単位)。σ が小さいほど瞬間的 (パチッと)、大きいと緩やか。
export const STARDUST_FLASH_SIGMA = 0.1;
// 過去光円錐 flash 強さ (alpha 乗算係数、peak 時 `1 + BOOST` 倍)。0 で無効。
export const STARDUST_FLASH_PAST_BOOST = 2.0;
// 未来光円錐 flash 強さ。過去より控えめ。
export const STARDUST_FLASH_FUTURE_BOOST = 1.0;

// --- Worldline / laser opacity ---
export const PLAYER_WORLDLINE_OPACITY = 0.65;
export const LIGHTHOUSE_WORLDLINE_OPACITY = 0.4;
export const LASER_WORLDLINE_OPACITY = 0.2;

// --- Debris opacity ---
// InstancedMesh 全 instance 共通 (per-vertex 時間 fade が shader で乗算される)。
export const DEBRIS_WORLDLINE_OPACITY = 0.1;
// 過去光円錐との交差時に出現する球マーカーの透明度 (C pattern、fade 非適用)。
export const DEBRIS_MARKER_OPACITY = 0.7;

// --- Player marker sizes ---
export const PLAYER_MARKER_SIZE_SELF = 0.42;
export const PLAYER_MARKER_SIZE_OTHER = 0.2;

// --- Player marker opacity (C pattern、時間 fade 非対象、pulse で無敵点滅) ---
export const PLAYER_MARKER_MAIN_OPACITY_SELF = 1.0;
export const PLAYER_MARKER_MAIN_OPACITY_OTHER = 0.5;
// 外層 1.8x scale の halo (glow) 部分。
export const PLAYER_MARKER_GLOW_OPACITY_SELF = 0.32;
export const PLAYER_MARKER_GLOW_OPACITY_OTHER = 0.1;

// --- Intersection marker opacity ---
// 世界線 × 自機過去光円錐 ring (sphere + core は emissive、opacity 不要)。
export const PAST_CONE_WORLDLINE_RING_OPACITY = 0.9;
// 世界線 × 自機未来光円錐 sphere + ring (過去より控えめ、まだ届いていない event)。
export const FUTURE_CONE_WORLDLINE_SPHERE_OPACITY = 0.15;
export const FUTURE_CONE_WORLDLINE_RING_OPACITY = 0.12;
// レーザー × 自機未来光円錐 接平面三角形 (過去側の gnomon は solid=1.0)。
export const FUTURE_CONE_LASER_TRIANGLE_OPACITY = 0.2;

// --- Aim arrow opacity (射撃中 1..3 本順次表示) ---
// 1 本目の opacity。i 本目 (1-indexed) は `BASE - (i-1) × STEP` で計算。
export const AIM_ARROW_BASE_OPACITY = 0.9;
export const AIM_ARROW_OPACITY_STEP = 0.15;

// --- Kill notification opacity (因果律遅延で発火する kill event の 3D マーカー) ---
export const KILL_NOTIFICATION_SPHERE_OPACITY = 0.6;
export const KILL_NOTIFICATION_RING_OPACITY = 0.8;

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
export const ARENA_SURFACE_OPACITY = 0.1;
// 時間方向に伸びる垂直線 ARENA_RADIAL_SEGMENTS 本の opacity (対角線のない純粋な縦線)
export const ARENA_VERTICAL_LINE_OPACITY = 0.05;
// 過去光円錐 × 円柱交線 LineLoop の透明度。サンプル数は surface と共有するため
// `ARENA_RADIAL_SEGMENTS` と同じ (shared position attribute で surface/ 交線 の頂点ズレ回避)。
export const ARENA_PAST_CONE_OPACITY = 1.0;
// 未来光円錐 × 円柱交線 (上端) の透明度。過去光円錐より控えめ (既に起きた event vs
// まだ起きていない event の情報量差を視覚で反映)。
export const ARENA_FUTURE_CONE_OPACITY = 0.3;
