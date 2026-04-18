# 2+1/docs/architecture.md — LorentzArena 2+1 アーキテクチャ詳細

`CLAUDE.md` から抽出した reference content。毎 session auto-load せず、必要時のみ pointer 経由で参照する (auto-context budget 削減のための radical delegation、2026-04-18 Level-2 migration)。

## i18n (`src/i18n/`)

自前の軽量 i18n 基盤 (ライブラリなし)。`I18nProvider` で wrap、`useI18n()` hook で `{ lang, setLang, t }` を取得。言語は localStorage `"la-lang"` に永続化。

- `translations/ja.ts` — 日本語辞書 (default) + `TranslationKey` 型定義
- `translations/en.ts` — 英語辞書
- `I18nContext.tsx` — Provider + `useI18n` hook

## ハイスコア・リーダーボード

**ローカルハイスコア** (`src/services/highScores.ts`): localStorage ベース (ブラウザ別)。`loadHighScores()`, `saveHighScore(entry)`, `getTopScores(n)` の純関数。localStorage key `"la-highscores"`、最大 20 件。

**グローバルリーダーボード** (`src/services/leaderboard.ts`): Cloudflare Workers + KV。`VITE_LEADERBOARD_URL` に Worker URL (`.env.production` 設定済)。`fetchLeaderboard()` / `submitScore()`。Worker ソースは `turn-worker/src/index.ts` (TURN credential proxy と同居)。KV キー `"top"` にトップ 50 を JSON 配列。

**保存タイミング** (`src/hooks/useHighScoreSaver.ts`): `beforeunload` / `pagehide` / `visibilitychange` で発火。`sessionId` (`crypto.randomUUID()` generated、localStorage 固定) 付与で server-side dedup。sendBeacon は CORS preflight 不可のため Blob Content-Type は `text/plain` (CORS セーフリスト)。

## 物理エンジン (`src/physics/`)

- `vector.ts` — 3D/4D ベクトル演算、ミンコフスキー内積 (+,+,+,-)、`isInPastLightCone(event, observer)`、`pastLightConeIntersectionSegment(start, delta, observer)` (汎用光円錐交差ソルバー、laser/debris 共通利用)
- `matrix.ts` — 4x4 ローレンツ変換行列
- `mechanics.ts` — 相対論的運動方程式、phase space (4元位置 + 4元速度)
- `worldLine.ts` — 世界線の離散履歴、過去光円錐交差計算 (binary search、O(log N + K=16))、`version` カウンターで描画スロットリング

単位系: c = 1。ファクトリパターン (クラス不使用)。TDD 運用 (`*Linear` 旧実装残存 + regression test → 新実装切替) は DESIGN.md §worldLine.history サイズ。

## ネットワーク (`src/services/`, `src/contexts/`)

- `PeerManager.ts` — PeerJS/WebRTC ラッパー。**注意: `onPeerStatusChange` / `onConnectionChange` は上書き式 (最後の 1 コールバックのみ有効)。`onMessage` はキー付き Map で複数登録可能**
- `WsRelayManager.ts` — WebSocket Relay フォールバック
- `PeerProvider.tsx` — 自動接続 + ホストマイグレーション

**自動接続フロー**: START を押すと PeerProvider がマウント → 接続開始。`#room=name` で部屋分離。最初に `la-{roomName}` ビーコンを取得した人がホスト。全員ランダム ID でゲーム接続、`la-{roomName}` は発見専用 (redirect 送信)。

**プレイヤー初期化**: ホストは START 直後に自己初期化 (`OFFSET = Date.now()/1000` で座標時間 t ≈ 0 から開始)。新規 join client は beacon holder から `snapshot` で `hostTime` を受け取りスポーン (Authority 解体 Stage F-1 で `syncTime` 廃止、snapshot に統合)。

**ホストマイグレーション**: beacon holder 切断で最古参クライアントが自動昇格。ハートビート方式 (1s ping / 2.5s timeout、Stage G)。人間の respawn timer は owner がローカル保持で再構築不要。2026-04-18 に `useBeaconMigration` hook + `isMigrating` flag を削除、LH owner 書き換えは `PeerProvider.assumeHostRole` inline に集約し、LH 死亡中の respawn 再 schedule は tick poll 化で不要化 (DESIGN.md §migration 権威は assumeHostRole に集約)。`hostMigration` メッセージは Stage H で完全削除済。

**ビーコンパターン**: `la-{roomName}` は常に発見専用。新クライアントがビーコンに接続すると `{ type: "redirect", hostId }` で本物のホスト (ランダム ID) にリダイレクト。既存のゲーム接続には影響しない。dual-host 解消・ビーコン fallback (10s / 8s)・降格経路・`roleVersion` による effect 再評価は DESIGN.md § Authority 解体 / § ネットワーク 参照。

## ゲーム (`src/components/`)

`RelativisticGame.tsx` がオーケストレーター。ゲームロジックのモジュールは `game/` サブディレクトリに分離:

| ファイル | 内容 |
|---|---|
| `RelativisticGame.tsx` | state/ref 管理、ゲームループ配線、Canvas 配置 |
| `game/types.ts` | ゲーム固有型定義 (`RelativisticPlayer`, `Laser` 等) |
| `Lobby.tsx` | ロビー画面 (言語選択 + プレイヤー名入力 + ハイスコア表) ※ `game/` の外 |
| `game/constants.ts` | ゲーム定数 (射程、リスポーン遅延、スポーン範囲、色等)。**canonical source**、JSDoc + section コメントで分類 |
| `game/colors.ts` | プレイヤー色生成。`colorForJoinOrder(index)` が主 (接続順 × 黄金角で保証分離)、`colorForPlayerId(id)` はフォールバック |
| `game/threeCache.ts` | THREE.js ジオメトリ/マテリアル singleton + デブリマテリアルキャッシュ |
| `game/displayTransform.ts` | ローレンツ変換 → 表示座標変換 (`transformEventForDisplay`, `buildDisplayMatrix`) |
| `game/DisplayFrameContext.tsx` | D pattern インフラ: `displayMatrix` と observer 情報を配信、`buildMeshMatrix(worldPos, displayMatrix)` helper |
| `game/laserPhysics.ts` | レーザー当たり判定 + 光円錐交差 |
| `game/debris.ts` | デブリ生成 + 光円錐交差 |
| `game/killRespawn.ts` | `applyKill`/`applyRespawn` 純粋関数 (全 peer 共通、players Map を返す) |
| `game/respawnTime.ts` | `computeSpawnCoordTime(players, excludeId?)` (初回/リスポーン/新 joiner 共通、LH 含む)、`createRespawnPosition`。excludeId の役割は DESIGN.md §物理「スポーン座標時刻」 |
| `game/lighthouse.ts` | Lighthouse AI (`createLighthouse` ファクトリ、`isLighthouse` 判定、`computeInterceptDirection` 相対論的偏差射撃) |
| `game/gameLoop.ts` | ゲームループ内の純関数群 (カメラ制御、プレイヤー物理、Lighthouse AI、当たり判定、ゴースト移動、因果律ガード、レーザー発射) |
| `game/causalEvents.ts` | 因果律遅延イベント処理 (キル通知・スポーンエフェクトの過去光円錐チェック) |
| `game/SceneContent.tsx` | 3D シーンオーケストレーター (交差計算 + カメラ制御 + 子コンポーネント配置) |
| `game/WorldLineRenderer.tsx` | 世界線チューブ描画 (TubeGeometry、version throttling、per-vertex 時間 fade) |
| `game/LightConeRenderer.tsx` | 光円錐描画 (BufferGeometry + 2 共有 attribute で future/past、per-frame in-place update、apex-fan)。各 θ で `cylinderHitDistance` により ρ(θ) を解いてアリーナ円柱境界まで延伸 (B1、2026-04-18)、観測者が円柱外を向く方向は `LIGHT_CONE_HEIGHT` fallback |
| `game/LaserBatchRenderer.tsx` | レーザー世界線バッチ描画 (LineSegments、per-vertex 時間 fade) |
| `game/SpawnRenderer.tsx` | スポーンエフェクト描画 (アニメーション付きリング+ピラー) |
| `game/DebrisRenderer.tsx` | デブリ世界線描画 (InstancedMesh シリンダー + 光円錐交差マーカー、per-instance 時間 fade) |
| `game/ArenaRenderer.tsx` | アリーナ円柱描画 (4 geometry: surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線、共有 BufferAttribute で in-place update、per-vertex 時間 fade) |
| `game/StardustRenderer.tsx` | 時空星屑 (案 17) 描画。`STARDUST_COUNT` 個の 4D event を world 座標 pre-generated、`THREE.Points` + D pattern。観測者が box 外に出ると periodic wrap、境界は time fade で不可視 |
| `game/timeFadeShader.ts` | 時間的距離 opacity fade (Lorentzian) の onBeforeCompile inject utility。Mesh*/Line*/Points の全 D pattern material + InstancedMesh に適用 (`FRAGMENT_APPLY_KEYS` fallback で material 種別差異を吸収) |
| `game/messageHandler.ts` | ネットワークメッセージ処理 (ファクトリ関数、バリデーション付き)。型は `src/types/message.ts` 参照 |
| `game/HUD.tsx` | HUD オーケストレーター (子コンポーネント配置) |
| `game/hud/ControlPanel.tsx` | 左上パネル (操作説明、トグルスイッチ、FPS、build、スコアボード) |
| `game/hud/Speedometer.tsx` | 右下パネル (エネルギーゲージ、速度、γ、固有時、座標) |
| `game/hud/Overlays.tsx` | 全オーバーレイ (死亡フラッシュ、ゴースト、FIRING、KILL 通知、CSS keyframes) |
| `game/hud/utils.ts` | HUD ユーティリティ (isTouchDevice、hslToComponents) |
| `game/TutorialOverlay.tsx` | モバイル初回チュートリアル (localStorage `la-tutorial-shown` で 1 回限り、`isTouchDevice` gate、4 秒自動 dismiss) |
| `game/touchInput.ts` | モバイルタッチ入力 (全画面ジェスチャ: スワイプ heading/thrust + ダブルタップ fire)、visibilitychange/blur/pagehide で stale reset |

### カスタムフック (`src/hooks/`)

| ファイル | 内容 |
|---|---|
| `usePeer.ts` | PeerProvider コンテキスト hook |
| `useKeyboardInput.ts` | キーボード入力 (WASD + 矢印 + Space preventDefault + keysPressed ref)、visibilitychange/blur/pagehide で stale reset |
| `useStaleDetection.ts` | stale プレイヤー検知 (壁時計/座標時間進行率ベース)、add/delete/cleanup を一箇所に集約 |
| `useHighScoreSaver.ts` | beforeunload / pagehide / visibilitychange でハイスコア保存、sessionId 管理 |
| ~~`useBeaconMigration.ts`~~ | 2026-04-18 削除。LH owner 書き換えは `PeerProvider.assumeHostRole` inline 移動、LH respawn 再 schedule は tick poll 化で不要 |
| `useSnapshotRetry.ts` | 新規 join client が snapshot 未受信 (players.get(myId) 未定義) で 2s 経過で `snapshotRequest` を beacon holder に送信、最大 3 回。host push (connections diff) の race フォールバック |
| `useGameLoop.ts` | ゲームループ本体 (setInterval ライフサイクル + 全フェーズの dispatch) |

### D pattern の描画

物理オブジェクト (world line / light cone / ring / cone 接平面 / debris / laser batch / arena / stardust) は「world 座標 geometry + `mesh.matrix = displayMatrix × T(worldEventPos) × [rotation]`」で per-vertex Lorentz 変換 (`DisplayFrameContext` + `buildMeshMatrix` helper)。観測者静止系/世界系で同一経路、3+1 化時は boost matrix を差し替えるだけ。

**例外 (C pattern / position-based)**: 球ジオメトリ (player marker, intersection sphere, kill sphere, debris particle) は γ 楕円化回避のため display 並進のみ。自機 Exhaust は v0 で C pattern (他機対応で D pattern 化予定)。照準矢印は 2+1 固有で D pattern 化スコープ外。

詳細は DESIGN.md § 描画「D pattern」。

### 主要機能

- **入力**:
  - PC: W/S (前進/後退)、A/D (横移動)、矢印 (カメラ回転)、Space (レーザー発射)
  - モバイル: 横スワイプ heading、縦変位 thrust (連続値)、ダブルタップ fire (全操作同時実行可)、visibilitychange で stale reset
- **カメラ**: 正射影/透視投影切替、自分の静止系/世界系表示切替
- **当たり判定**: target-authoritative、`findLaserHitPosition`。各 peer が自分 owner のプレイヤー (人間=自分、beacon holder=LH) に対してのみ判定、hit 検出した target 本人が `kill` を broadcast、host が relay (DESIGN.md § Authority 解体 Stage B)
- **Kill/Respawn**: kill → 世界線を `frozenWorldLines` に移動 + デブリ生成 → ゴースト (DeathEvent ベース、生存時と同じ `processPlayerPhysics` で動的更新、thrust で動かせる) → `RESPAWN_DELAY` 後リスポーン → `INVINCIBILITY_DURATION` 無敵 (opacity パルス、LH 除外)
- **世界オブジェクト分離**: 死亡で生まれるオブジェクト (凍結世界線、デブリ、ゴースト)、レーザーはプレイヤーから独立した state。過去光円錐交差で自然に可視性が決まる
- **死亡状態管理**: `isDead` selector (event log 由来) + `DeathEvent` (ゴーストカメラの決定論的計算) + `ghostPhaseSpace` (動的更新)。`handleKill`/`handleRespawn` コールバックで一元化
- **ゴースト UI**: 死亡中は青白い半透明オーバーレイ + DEAD カウントダウン。カメラ回転は PC 矢印キー (yaw + pitch) / モバイル横スワイプ (yaw のみ、縦スワイプは thrust 固定)
- **キルスコア + キル通知 + スポーンエフェクト**: 因果律遅延 (過去光円錐到達時に発火)。自分のリスポーンは即時、他プレイヤーは `pendingSpawnEventsRef`
- **永続デブリ**: 死亡イベントからの等速直線運動パーティクル。lineSegments でバッチ描画。光円錐交差マーカーは observer 非依存 (maxLambda 固定)
- **世界線管理**: `player.worldLine` 1 本、過去ライフは `frozenWorldLines[]`。`origin` は常に null (半直線延長は廃止、DESIGN.md §物理「初回スポーン = リスポーン統一」)
- **プレイヤー色**: `colorForJoinOrder(index)` が主 (接続順 × 黄金角)、peerList 未受信時は `colorForPlayerId(id)` fallback。ネットワーク同期不要の純関数方式
- **因果律の守護者**: 他プレイヤーの未来光円錐内で操作凍結。死亡プレイヤー・灯台は除外。灯台は別方式 (誰かの過去光円錐に落ちたら最も過去の生存プレイヤーの座標時間にジャンプ)
- **光円錐描画** (`LightConeRenderer`): DoubleSide 半透明 surface + wireframe の 2 層、各 θ で `cylinderHitDistance` でアリーナ円柱境界まで延伸。色は `LIGHT_CONE_COLOR` 固定 (プレイヤー色非依存、2026-04-18 A4)
- **アリーナ円柱** (`ArenaRenderer`): world-frame 静止、中心 `(ARENA_CENTER_X, ARENA_CENTER_Y)` 半径 `ARENA_RADIUS` の半透明円柱で戦闘領域の視覚ガイド (物理判定なし)。D pattern、時間方向半幅 = `max(ρ(θ), ARENA_MIN_HALF_HEIGHT)`。過去光円錐 × 円柱交線 (pastCone) は下限なしで独立 position attribute。毎 frame in-place 更新 (DESIGN.md §メタ原則 M17)
- **Exhaust (推進ジェット、自機のみ v0、C pattern)**: 反推力方向に 2 層 cone (青外 + 白内、additive で青白プラズマ)。magnitude は EMA smoothing (60/180ms) で点滅解消、方向は非 smoothing、radius は smoothed magnitude 連動。energy 枯渇で自動非表示。他機対応は未実装
- **AccelerationArrow (入力意図、flat 2D)**: ShapeGeometry で xy 平面上の矢印、任意視点で「矢印」として常に認識可能、DoubleSide、amber。Exhaust (反推力) と視覚分離 (2026-04-18 A2)
- **時間的距離 opacity fade (Lorentzian、per-vertex shader)**: `fade = r²/(r² + Δt²)`、`r = TIME_FADE_SCALE = LCH`。`applyTimeFadeShader` を `onBeforeCompile` で全 D pattern material に inject。観測者時刻 ±LCH で半透明、±2×LCH で 0.2、±3×LCH で 0.1 の緩やか減衰 (時間距離の 2 乗反比例、物理の逆 2 乗法則と同型)

## Store 構造 (`src/stores/game-store.ts`、Stage C 以降)

**Reactive state** (selector で購読): `players: Map<id, RelativisticPlayer>`, `lasers: Laser[]`, `scores: Record<id, number>`, `spawns: SpawnEffect[]`, `frozenWorldLines`, `debrisRecords`, `killNotification`, `myDeathEvent`

**Authoritative event log** (Stage C 導入、source of truth):
- `killLog: KillEventRecord[]` — 全 kill の不変記録。`firedForUi` フラグで UI 反映待ちを表現
- `respawnLog: RespawnEventRecord[]` — 全 respawn の不変記録 (初回 spawn も含む)
- GC は useGameLoop tick 末尾で `gcLogs` を毎フレーム実行 (pair 成立 kill を除去、respawn は latest 1 件/player のみ残す)

**Non-reactive helpers** (getState で読む、購読不要):
- `processedLasers: Set<string>` — 自分の hit detection で既に処理済みのレーザー ID
- `pendingSpawnEvents: PendingSpawnEvent[]` — 他プレイヤー respawn の UI 反映待ち (因果律遅延)
- `displayNames: Map<id, string>`
- `lighthouseSpawnTime: Map<id, number>` — LH spawn grace 起点
- `lighthouseLastFireTime: Map<id, number>` — 全 peer が LH laser 観測時に更新、beacon migration 時の fire 連続性を自動確保

**Selectors** (log から derive):
- `selectIsDead(state, id)` / `selectDeadPlayerIds(state)` — 現在死亡中か
- `selectInvincibleUntil(state, id)` / `selectInvincibleIds(state, now)` — 無敵終了時刻
- `selectPendingKillEvents(state)` — UI 反映待ちの kill events (`firedForUi === false`)

**撤去済み**: `deadPlayers: Set`, `invincibleUntil: Map`, `pendingKillEvents[]`, `deathTimeMap: Map` — Stage C で全て event log 由来の selector に置換。

設計判断の詳細は DESIGN.md § Authority 解体 Stage C。

## メッセージタイプ

Canonical 型定義は **`src/types/message.ts`**、validation と handler は `game/messageHandler.ts`。

| type | 発信者 | 経路 | 用途 |
|---|---|---|---|
| `phaseSpace` | owner | beacon holder relay | 4元位置+速度の同期 (LH も同じ経路) |
| `laser` | owner | beacon holder relay | レーザー発射イベント |
| `kill` | target (= owner) | beacon holder relay | 自己死亡申告 (hitPos 付き) |
| `respawn` | owner | beacon holder relay | 自分の復活 (位置含む) |
| `snapshot` | beacon holder → new joiner | 直接 | 新規 join 用 state 一式 (players / killLog / respawnLog / scores / displayNames / hostTime for OFFSET) |
| `intro` | 本人 | beacon holder relay | プレイヤー表示名通知 (接続時に 1 回送信) |
| `peerList` | beacon holder → all | 直接 | 接続ピア一覧 + joinRegistry 全履歴 (接続変化時に proactive 送信) |
| `ping` | beacon holder → all | 直接 | ハートビート (1s 間隔、2.5s タイムアウト) |
| `redirect` | beacon → client | 直接 | beacon migration 後の beacon holder ID リダイレクト |

**削除済み**: `score` (Stage C-1、全 peer が `killLog` から独立集計)、`syncTime` / `hostMigration` (Stage H、`snapshot` 1 本に統合)

**relay 対象** (`PeerProvider.isRelayable`): `phaseSpace` / `laser` / `intro` / `kill` / `respawn`。beacon holder が非 owner の発信を他 peer へ転送。

**色は同期しない**: 全ピアが `colorForJoinOrder(index)` で接続順に基づく色を独立算出。ホストが peerList に `joinRegistry` (全履歴) を含めて送信、クライアントは丸ごと置換 (ホストが唯一の正本)。peerList 未受信時は `colorForPlayerId(id)` fallback。詳細: DESIGN.md § 描画「色割り当て」。

**Authority の所在** (Authority 解体 Stage A〜H 完了後):
- `phaseSpace` / `laser` / `kill` / `respawn` はすべて owner 発信 (target-authoritative)。beacon holder は relay hub
- 受信側は二重処理防止を log / selectors に委ねる (例: `handleKill` は `selectIsDead` でガード)
- beacon holder 特有の仕事は: (a) relay、(b) Lighthouse の AI 駆動 (LH owner 兼任)、(c) beacon 所有、(d) ping 送信、(e) 新規 join 対応 (snapshot 送信) のみ

**メッセージバリデーション**: `messageHandler.ts` で全メッセージに `isFiniteNumber` / `isValidVector4` / `isValidVector3` / `isValidColor` / `isValidString` のランタイム検証。laser range は `0 < range <= 100`。body の sender 検証は意図的にしない (spoofing 防御にならないため、詳細は DESIGN.md § Authority 解体 Stage B)。

## Relay サーバーセキュリティ (`relay-server/server.mjs`)

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | WebSocket ping 送信間隔 (サーバー → クライアント) |
| `HEARTBEAT_TIMEOUT_MS` | 10s | WebSocket pong 応答タイムアウト |

注: 上記は relay server の WebSocket レベル heartbeat。ゲームクライアントの beacon holder 切断検知は `PeerProvider` の `ping` (1s / 2.5s) で別経路。
