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
// 灯台専用の当たり判定半径 (塔底面の円柱半径 0.40 と同値、見た目に合わせて広め)
export const LIGHTHOUSE_HIT_RADIUS = 0.2;

// スポーン範囲（x, y）
export const SPAWN_RANGE = 10;

// レーザー連射間隔（ミリ秒）
export const LASER_COOLDOWN = 100;

// レーザー色の生成パラメータ (`getLaserColor` で参照)。プレイヤー色から
// saturation/lightness を嵩上げして「発光体」らしい色にする。旧値は
// sat+10 / light+25 / light_max 90 だったが、明度を上げすぎると淡色に収束
// して LH (teal) のレーザーが「青く見えない」問題が出たため、彩度優先に
// 振り直し (sat+15 / light+10、明度上限も 85 に抑える)。全プレイヤー共通で
// 変わるので、LH だけでなく人間プレイヤーのレーザーも鮮やかになる。
export const LASER_SATURATION_BOOST = 15;
export const LASER_LIGHTNESS_BOOST = 10;
export const LASER_LIGHTNESS_MAX = 85;

// レーザー + スラスト共用エネルギー
export const ENERGY_MAX = 1.0;
export const ENERGY_PER_SHOT = 1.0 / 30; // 30 発で枯渇（≈3 秒連射）
// フル thrust 連続で満タン→0 に 9 秒。fire の 3 倍長持ち。
// 部分 thrust (|a|/PLAYER_ACCELERATION < 1) の場合は使用率に比例。
export const THRUST_ENERGY_RATE = 1.0 / 9;
export const ENERGY_RECOVERY_RATE = 1.0 / 6; // 6 秒で 0→満タン（撃/推どちらもしていないときのみ回復）

// Damage model (Phase C1):
// 灯台専用の被弾ダメージ。LH は無敵 / 回復なし、1.0 → -0.2 で 6 発死。
export const LIGHTHOUSE_HIT_DAMAGE = 0.2;

// 被弾 1 発で energy を HIT_DAMAGE (= 0.5) 消費。energy < 0 で死 (境界 0 は生存)。
// MAX = 1.0 の半分なので、energy 満タンなら 2 発目で死、fire 連射 / thrust 直後なら即死もあり得る。
export const HIT_DAMAGE = ENERGY_MAX / 2;
// 被弾後 500ms は追加 damage を無視 (同 frame 複数 laser hit 事故防止)。
// respawn 無敵 (INVINCIBILITY_DURATION 5s) とは別系統: こちらは damage 数値のみ 0 クランプ、
// kill event そのものは発生しうる (ただし energy が減っていないので実質起きない)。
export const POST_HIT_IFRAME_MS = 500;

// phaseSpace 受信の wall-time gap がこの閾値を超えた場合、受信側は該当プレイヤーの
// 既存 worldLine を frozenWorldLines に凍結し、新しい worldLine を 1 点から始める。
// 目的: ホストマイグレーションの heartbeat timeout (2500ms) や長時間 tab background
// 復帰時に、CatmullRomCurve3 が gap 両端の phaseSpace を直線補間して tube に「橋」を
// 生やすのを回避する。ping interval (1000ms) の半分、通常 relay (~125Hz, 8ms) との
// safety margin は十分、単発 network blip (100-200ms) では発火しない。
// 詳細: DESIGN.md § migration 「phaseSpace gap → worldLine 凍結」
export const WORLDLINE_GAP_THRESHOLD_MS = 500;

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

// Phase C1: 被弾デブリ (hit、lethal/non-lethal 両方) 用パラメータ。
// 設計コンセプト (2026-04-18 夜 UX 統一後): 「広さ・粒・1 粒の派手さは爆発と同じ、
// 個数 + opacity だけ半分にして density 控えめ」。半分なのは count と opacity のみ、
// kick / size / max_lambda は explosion と同値 (Phase C1 着地時の「全パラ半分」から再定義)。
// 色は **撃った人 (killer)** の色 (2026-04-18 odakin 指定、第 2 次改訂)。
// 生成方向: レーザー 4-vec (null) + victim 4-velocity の時空和の spatial 部分を
// baseU として使う (`generateHitParticles`、design/physics.md §被弾デブリ)。
// lethal hit では hit + explosion の 2 層が降る (handleDamage → handleKill)。
export const HIT_DEBRIS_PARTICLE_COUNT = 15;
export const HIT_DEBRIS_KICK = 0.8;
// opacity は explosion の半分 (DEBRIS_WORLDLINE_OPACITY=0.1 / DEBRIS_MARKER_OPACITY=0.7 に対して 0.05 / 0.35)
export const HIT_DEBRIS_WORLDLINE_OPACITY = 0.05;
export const HIT_DEBRIS_MARKER_OPACITY = 0.35;
// hit デブリの世界線長さ (= maxLambda)。
export const HIT_DEBRIS_MAX_LAMBDA = 2.5;

// Lighthouse（AI 固定砲台）
export const LIGHTHOUSE_ID_PREFIX = "lighthouse-";
export const LIGHTHOUSE_FIRE_INTERVAL = 2000; // ms
export const LIGHTHOUSE_SPAWN_GRACE = 5000; // ms — don't fire for this long after spawn
// LH sphere + worldline 色。teal 系で stardust `hsl(48, 85%, 65%)` (濃い黄) と
// 寒色⇔暖色の対比。旧 `hsl(220, 70%, 75%)` は淡青で stardust 旧 amber と
// time fade 後近接する問題があったため Phase B2 で彩度上げ明度下げ。レーザー変換は
// `getLaserColor` の調整 (sat +15 / light +10) 後 `hsl(190, 80%, 70%)` になり teal 感が残る。
// arena `hsl(180, 40%, 70%)` とは hue 10° 差だが、彩度 65% vs 40%、明度 60% vs 70% で区別。
export const LIGHTHOUSE_COLOR = "hsl(190, 65%, 60%)";
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
// 後退中 (カメラ前方に exhaust) でも球体で隠れないよう 2x サイズ化 (2026-04-18)。
export const EXHAUST_BASE_LENGTH = 1.2; // cone の最大長 (magnitude=1 のとき)
export const EXHAUST_BASE_RADIUS = 0.22; // cone 底面最大半径 (magnitude=1 のとき)
// 低 thrust で完全な針状にならないための radius の下限倍率 (0.5×〜1.0× に連動)。
// mobile の連続 thrust で視覚フィードバックを明示する目的。
export const EXHAUST_RADIUS_MIN_SCALE = 0.5;
export const EXHAUST_OFFSET = 0.3; // 球表面から cone 底面までのすき間
export const EXHAUST_MAX_OPACITY = 0.6; // 視認性向上 (additive で飽和しない程度)
// プレイヤー識別は sphere / worldline で担保されているので、exhaust は
// 全機共通の青系プラズマ色に統一。additive blending で重なると青白く光る。
export const EXHAUST_OUTER_COLOR = "hsl(210, 85%, 60%)"; // 明るい青 (外炎)
export const EXHAUST_INNER_COLOR = "hsl(210, 70%, 92%)"; // 冷たい白 (コア)
// PC 入力は on/off の 2 値なので、magnitude を描画層で EMA smoothing して
// 点滅感を避ける (方向は即時)。Mobile の連続値には attack=60ms でほぼ即時。
export const EXHAUST_ATTACK_TIME = 60; // ms: 0 → 1 の追従時定数
export const EXHAUST_RELEASE_TIME = 180; // ms: 1 → 0 の追従時定数 (余韻)
export const EXHAUST_VISIBILITY_THRESHOLD = 0.01; // smoothed magnitude < これ で非表示

// --- Acceleration arrow (入力意図の可視化、自機のみ、視覚のみ) ---
// exhaust は「反推力噴射」として物理的に船の後方に出るため、後退時に船体で
// 隠れて前進/後退が見分けにくい。矢印は加速度方向 (= exhaust の逆) に xy 平面上の
// flat 2D 矢印で出して「どこに向かって加速しているか」を明示する。
// flat (xy 平面) にすることで任意視点から「矢印」として常に認識できる (cone 頭だけ
// だと視線方向に揃うと潰れて blob になる、という問題を回避)。
// EMA smoothed magnitude を exhaust と共有。
export const ARROW_BASE_LENGTH = 2.4; // 矢印の全長最大値 (magnitude=1)。視認性重視で exhaust より長い
export const ARROW_BASE_WIDTH = 0.95; // 矢印の最大幅 (magnitude=1)、geometry の 0.7 unit 幅をスケール
// 球表面から矢印 tail (geometry y=-0.5) までの空隙。exhaust (EXHAUST_OFFSET=0.3) より
// 大きく取ることで、前進中に噴射炎 (船の後方) と矢印 (船の前方) の根元が離れ、
// 「これは噴射炎じゃなく別物」として視覚分離が強くなる。
export const ARROW_BASE_OFFSET = 0.9;
// exhaust の青白と補色関係の amber、重なっても識別可能
export const ARROW_COLOR = "hsl(45, 85%, 70%)";
export const ARROW_MAX_OPACITY = 0.55; // flat shape + DoubleSide で視認性重視

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
// Phase C1: hitLog cap (i-frame 判定 + UI flash trigger)。
// 通常 i-frame は 500ms なので過去数 s 分あれば十分。GC は不要 (tail slice のみ)。
export const MAX_HIT_LOG = 200;

// --- Light cone rendering ---
export const LIGHT_CONE_HEIGHT = 20;
export const LIGHT_CONE_SURFACE_OPACITY = 0.1;
export const LIGHT_CONE_WIRE_OPACITY = 0.05;
// 各プレイヤーは自分の光円錐しか見えない設計なので固定色で OK。
// アリーナ `hsl(180,40%,70%)` と hue 20° 差の薄い空色 neutral。
// 彩度低めで背景寄り、パステル化時に再調整前提。
export const LIGHT_CONE_COLOR = "hsl(200, 35%, 85%)";

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
export const STARDUST_COUNT = 40000;
// 空間方向の ±範囲 (world 単位)。observer boost で display frame に mix されても
// 大半が視認 window 内に残るよう、TIME_HALF_RANGE と同程度に取る。
export const STARDUST_SPATIAL_HALF_RANGE = 60;
// 時間方向の ±範囲 (world 単位)。fade ≈ 0.1 となる 3×LCH で境界を置く。
// LCH 変更時に自動追従。
export const STARDUST_TIME_HALF_RANGE = TIME_FADE_SCALE * 3;
// Point size (world 単位、sizeAttenuation で perspective 縮小)
export const STARDUST_SIZE = 0.04;
// 黄色寄り。LH `hsl(190, 65%, 60%)` teal との寒色⇔暖色コントラストを維持しつつ、
// 「星屑」の素直な暖色選択 (2026-04-18 Phase B2 追調整: rose-pink → yellow)。
// 旧 amber `hsl(42, 55%, 80%)` を彩度上げ明度下げで再チューン、time fade で
// 淡色化しても「黄色っぽさ」が残るようにした。`colorForJoinOrder` (黄金角循環)
// で黄色系プレイヤー色が出る可能性は rose-pink 時より上がるが、stardust は
// time fade で遠方ほど薄まるため実害は小さい。
export const STARDUST_COLOR = "hsl(51, 100%, 50%)";
// Base opacity。per-vertex time fade shader で乗算される (境界で ~0 まで減衰)。
export const STARDUST_OPACITY = 0.5;

// --- Stardust light-cone flash (観測者光円錐通過時のきらめき、2026-04-17 夜) ---
// spark が観測者の光円錐面 (dt = ±ρ) に近いと Gaussian kernel で alpha をブースト。
// 未来側は「まだ届いていない event」の情報量が相対的に少ないため控えめ。
// flash 幅 σ (coord time 単位)。σ が小さいほど瞬間的 (パチッと)、大きいと緩やか。
export const STARDUST_FLASH_SIGMA = 0.1;
// 過去光円錐 flash 強さ (alpha 乗算係数、peak 時 `1 + BOOST` 倍)。0 で無効。
// 2026-04-18: 2.0 → 1.6 → 1.5。微減で「気持ち弱く」。
export const STARDUST_FLASH_PAST_BOOST = 1.5;
// 未来光円錐 flash 強さ。過去より控えめ。
// 2026-04-18: 1.0 → 0.8 → 0.5。past の 1/3 に引き下げ、未来 event の情報量の少なさを強く反映。
export const STARDUST_FLASH_FUTURE_BOOST = 0.5;

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
export const PLAYER_MARKER_SIZE_SELF = 0.21;
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
// 円柱の時間方向「半幅」下限: 観測者の光円錐との交線 (= ρ(θ)) と max を取り、半幅 =
// max(ρ, ARENA_MIN_HALF_HEIGHT)。ρ が小さい θ (観測者に近い円柱上の点) では固定半幅
// でガードし円柱が極端に狭くならないようにし、ρ が大きい (観測者が円柱から遠い) θ では
// 光円錐 ∩ 円柱 の交点まで伸ばす。旧 ARENA_HEIGHT = LIGHT_CONE_HEIGHT × 2 の半幅相当で、
// 観測者が円柱中心にいる既存ケース (全 θ で ρ = R = LCH) ではちょうど ±LCH 描画される。
export const ARENA_MIN_HALF_HEIGHT = LIGHT_CONE_HEIGHT;
export const ARENA_RADIAL_SEGMENTS = 128;
// 暫定色 (シアン, 仮想空間境界のメタファー)。パステル化時に再検討。
// プレイヤー色 (HSL 黄金角分散) と Lighthouse (hsl(220,70%,75%)) の色相帯を避ける
export const ARENA_COLOR = "hsl(180, 40%, 70%)";
export const ARENA_SURFACE_OPACITY = 0.1;
// 時間方向に伸びる垂直線 ARENA_RADIAL_SEGMENTS 本の opacity (対角線のない純粋な縦線)
export const ARENA_VERTICAL_LINE_OPACITY = 0.05;
// 過去光円錐 × 円柱交線 LineLoop の透明度。clamp されず `pos.t - ρ(θ)` をそのまま
// 描く独立 position attribute を持つ (円柱上端/下端 rim とは別の線)。
// 「今まさに光が届いている円柱上の事象の集合」として意味を保持するため濃く描く。
export const ARENA_PAST_CONE_OPACITY = 1.0;
// 円柱「上端 rim」(= 位置 pos.t + max(ρ, HALF_HEIGHT)) の透明度。ρ > HALF_HEIGHT
// の θ では未来光円錐交線と一致し、ρ < HALF_HEIGHT の θ では固定半幅 H による rim。
// pastCone の 1.0 より控えめ (既に起きた event vs まだ起きていない event の情報量差)。
export const ARENA_FUTURE_CONE_OPACITY = 0.3;
