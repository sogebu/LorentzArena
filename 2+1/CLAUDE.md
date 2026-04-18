# CLAUDE.md — LorentzArena 2+1

2+1 次元時空図アリーナ（x-y-t）。three.js + React Three Fiber で描画。
全リポ共通の規約は `CONVENTIONS.md`（リポルートの symlink）を参照。

## コマンド

```bash
pnpm install && pnpm dev       # PeerJS モード（http://localhost:5173/LorentzArena/）
pnpm dev:wsrelay               # WS Relay モード（relay-server 同時起動）
pnpm run build                 # tsc + vite build
pnpm run deploy                # GitHub Pages デプロイ (build + gh-pages branch push)
pnpm run lint                  # Biome linter
pnpm run format                # Biome formatter
pnpm run test                  # Vitest (1 回実行)
pnpm run test:watch            # Vitest ウォッチモード
pnpm run analyze               # バンドルサイズ分析
```

### テスト (Vitest)

`pnpm test` で 1 回実行、`pnpm test:watch` でウォッチモード。現有 test:
- `src/physics/worldLine.test.ts` — 光円錐交差 binary search regression (11 本)
- `src/components/game/messageHandler.test.ts` — phaseSpace migration gap 検知 (4 本、2026-04-18)
- `src/components/game/snapshot.test.ts` — applySnapshot migration path 分岐 (4 本、2026-04-18)

物理コア (pure 関数) の TDD 運用 (旧実装を `*Linear` で残し regression → 切替 → 削除) は DESIGN.md §worldLine.history サイズ + メタ原則 M15/M17 参照。

### テスト・デプロイの使い分け

- **スマホ操作に関係しない変更**（エフェクト調整、ゲームロジック、HUD レイアウト等）は **localhost でテストしてから** push・deploy。GitHub Pages のキャッシュ反映にはタイムラグがあり、毎回デプロイして待つのは非効率。視覚的・動作的に観察可能な変更は **deploy 前にユーザーにもローカル URL (`http://localhost:5173/LorentzArena/`) を提示して OK を得てから** push・deploy。詳細規約: `claude-config/conventions/preview.md` §「Deploy 前のユーザー確認を省かない」
- **スマホ実機テストが必要な変更**（タッチ入力、レスポンシブ、ジェスチャ等）は deploy して実機で確認

### デプロイ後の報告ルール

`pnpm run deploy` 時は、**ソースコードも commit + push すること**（deploy は gh-pages ブランチのみで、main は自動 push されない）。

deploy 後は、以下をユーザーに報告すること:
- 本番 URL: https://sogebu.github.io/LorentzArena/
- **build 値**（`dist/` 内のビルドタイムスタンプ）。ユーザーがスマホの HUD で表示される build 値と照合してキャッシュ更新を確認するために使う
- build 値の取得: `grep -oE '[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9:]+' dist/assets/index-*.js | head -1`

### ローカルプレビュー

- **マルチプレイテスト + 室分離**: 同じ URL を複数タブで開く、`#room=<名前>` で分離。本番 (sogebu.github.io) がルーム `default` を使うため localhost テストは `#room=test` 等の別ルーム必須（同名だと PeerJS ID `la-default` が取られて接続不能）
- **preview_start 使用時 + ID 奪取**: launch.json の `lorentz-arena` を使う。起動後は localhost URL をリンクで出力（`~/Claude/CLAUDE.md` 規約）。**preview ブラウザは PeerJS ID `la-{roomName}` を取得してしまう**ため、マルチタブテストには使わず `pnpm dev` バックグラウンド起動にすること
- **HMR と module-level 定数**: `OFFSET = Date.now()/1000` のような module-level 定数変更後は**全タブを手動リロード**（HMR 反映後も評価済み値がキャッシュされることがある）
- **HMR の Provider 再マウント副作用**: `physics/` や `stores/` を編集直後、HMR で **PeerProvider / zustand store が再マウントされ、接続状態・`myId`・`players` が START 前に戻る**ことがある。症状は「自機マーカー・光円錐・世界線・Speedometer HUD が全消え」。コードのバグと誤認しがち — ハードリロード (Cmd+Shift+R) + 再 START で復帰するなら HMR 副作用 (DESIGN.md メタ原則 M15)
- **preview_eval で store 覗きたい時の quirk**: `await import('.../game-store.ts')` すると走行中 app とは別の fresh インスタンスが返る (Vite ESM registry がリクエスト経路で分かれる)。debug は HUD screenshot か `window.__store = useGameStore` を HMR で挿す
- **single-tab preview でカバーできる範囲**: beacon holder 自己 death/respawn、LH kill/respawn、scoring UI、handleKill / selector。**できない範囲**: snapshot の新規 join path、relay 経由の kill/respawn、client ↔ client、beacon migration (multi-tab をユーザーに検証依頼)

### ネットワーク設定

`.env.local`（この `2+1/` 直下）で設定:

```bash
VITE_TURN_CREDENTIAL_URL=      # Cloudflare Worker URL（動的 TURN credential 発行）
VITE_NETWORK_TRANSPORT=auto    # peerjs | wsrelay | auto
VITE_WS_RELAY_URL=             # WS Relay 用 URL
VITE_PEERJS_HOST=0.peerjs.com  # PeerServer ホスト
VITE_WEBRTC_ICE_SERVERS=       # JSON 配列 (RTCIceServer[])。TURN_CREDENTIAL_URL 未設定時の静的フォールバック
VITE_WEBRTC_ICE_TRANSPORT_POLICY=  # "all" | "relay"
```

学校・企業ネットワークで P2P が塞がれる場合の推奨は `VITE_TURN_CREDENTIAL_URL` に Cloudflare TURN Worker の URL を設定（A'）。本番は `.env.production` に設定済み。Worker ソースは `turn-worker/`。詳細は `docs/NETWORKING.ja.md`。

ICE servers 優先順位: dynamic (Worker fetch) > static (`VITE_WEBRTC_ICE_SERVERS`) > PeerJS defaults

詳細: `../docs/NETWORKING.ja.md`, `turn-worker/wrangler.toml`, `relay-deploy/README.md`

## アーキテクチャ

### i18n (`src/i18n/`)

自前の軽量 i18n 基盤（ライブラリなし）。`I18nProvider` で wrap、`useI18n()` hook で `{ lang, setLang, t }` を取得。言語は localStorage `"la-lang"` に永続化。

- `translations/ja.ts` — 日本語辞書（default）+ `TranslationKey` 型定義
- `translations/en.ts` — 英語辞書
- `I18nContext.tsx` — Provider + `useI18n` hook

### ハイスコア・リーダーボード

**ローカルハイスコア** (`src/services/highScores.ts`): localStorage ベース（ブラウザ別）。`loadHighScores()`, `saveHighScore(entry)`, `getTopScores(n)` の純関数。localStorage key `"la-highscores"`、最大 20 件。

**グローバルリーダーボード** (`src/services/leaderboard.ts`): Cloudflare Workers + KV。`VITE_LEADERBOARD_URL` に Worker URL を設定（`.env.production` に設定済み）。`fetchLeaderboard()` で取得、`submitScore()` で送信。Worker ソースは `turn-worker/src/index.ts`（TURN credential proxy と同居）。KV 単一キー `"top"` にトップ 50 を JSON 配列で格納。

**スコア保存タイミング** (`src/hooks/useHighScoreSaver.ts`): `beforeunload` / `pagehide` イベントで発火。ローカル保存 + `navigator.sendBeacon` でグローバル送信。sendBeacon は CORS preflight 不可のため Blob の Content-Type は `text/plain`（CORS セーフリスト）を使用。

### 物理エンジン (`src/physics/`)

- `vector.ts` — 3D/4D ベクトル演算、ミンコフスキー内積 (+,+,+,-)、`isInPastLightCone(event, observer)`、`pastLightConeIntersectionSegment(start, delta, observer)`（汎用光円錐交差ソルバー、laser/debris が共通利用）
- `matrix.ts` — 4x4 ローレンツ変換行列
- `mechanics.ts` — 相対論的運動方程式、phase space (4元位置 + 4元速度)
- `worldLine.ts` — 世界線の離散履歴、過去光円錐交差計算、`origin` フィールドで半直線延長、`version` カウンターで描画スロットリング

単位系: c = 1。ファクトリパターン（クラス不使用）。

### ネットワーク (`src/services/`, `src/contexts/`)

- `PeerManager.ts` — PeerJS/WebRTC ラッパー。**注意: `onPeerStatusChange` / `onConnectionChange` は上書き式（最後の 1 コールバックのみ有効）。`onMessage` はキー付き Map で複数登録可能。**
- `WsRelayManager.ts` — WebSocket Relay フォールバック
- `PeerProvider.tsx` — 自動接続 + ホストマイグレーション

自動接続フロー: START を押すと PeerProvider がマウント → 接続開始。`#room=name` で部屋分離。最初に `la-{roomName}` ビーコンを取得した人がホスト。全員ランダム ID でゲーム接続し、`la-{roomName}` は発見専用 (redirect 送信)。

プレイヤー初期化: ホストは START 直後に自己初期化 (`OFFSET = Date.now()/1000` で座標時間 t ≈ 0 から開始)。新規 join client は beacon holder から `snapshot` で `hostTime` を受け取りスポーン (Authority 解体 Stage F-1 で `syncTime` 廃止、snapshot に統合)。

ホストマイグレーション: beacon holder 切断で最古参クライアントが自動昇格。ハートビート方式 (1s ping / 2.5s timeout、Stage G)。人間の respawn timer は owner がローカル保持で再構築不要。2026-04-18 に `useBeaconMigration` hook + `isMigrating` flag を削除、LH owner 書き換えは `PeerProvider.assumeHostRole` inline に集約し、LH 死亡中の respawn 再 schedule は tick poll 化で不要化 (DESIGN.md §migration 権威は assumeHostRole に集約)。`hostMigration` メッセージは Stage H で完全削除済み。

ビーコンパターン: `la-{roomName}` は常に発見専用。新クライアントがビーコンに接続すると `{ type: "redirect", hostId }` で本当のホスト (ランダム ID) にリダイレクト。既存のゲーム接続には影響しない。dual-host 解消・ビーコン fallback (10s / 8s)・降格経路・`roleVersion` による effect 再評価 は DESIGN.md § Authority 解体 / § ネットワーク 参照。

### ゲーム (`src/components/`)

`RelativisticGame.tsx` がオーケストレーター。ゲームロジックのモジュールは `game/` サブディレクトリに分離:

| ファイル | 内容 |
|---|---|
| `RelativisticGame.tsx` | state/ref 管理、ゲームループ配線、Canvas 配置 |
| `game/types.ts` | ゲーム固有型定義（`RelativisticPlayer`, `Laser` 等） |
| `Lobby.tsx` | ロビー画面（言語選択 + プレイヤー名入力 + ハイスコア表）※ `game/` の外 |
| `game/constants.ts` | ゲーム定数（射程、リスポーン遅延、スポーン範囲等） |
| `game/colors.ts` | プレイヤー色生成。`colorForJoinOrder(index)` が主（接続順 × 黄金角で保証分離）、`colorForPlayerId(id)` はフォールバック |
| `game/threeCache.ts` | THREE.js ジオメトリ/マテリアル singleton + デブリマテリアルキャッシュ |
| `game/displayTransform.ts` | ローレンツ変換 → 表示座標変換 (`transformEventForDisplay`, `buildDisplayMatrix`) |
| `game/DisplayFrameContext.tsx` | D pattern インフラ: `displayMatrix` と observer 情報を配信。`buildMeshMatrix(worldPos, displayMatrix)` helper |
| `game/laserPhysics.ts` | レーザー当たり判定 + 光円錐交差 |
| `game/debris.ts` | デブリ生成 + 光円錐交差 |
| `game/killRespawn.ts` | `applyKill`/`applyRespawn` 純粋関数（全 peer 共通、players Map を返す） |
| `game/respawnTime.ts` | `computeSpawnCoordTime(players, excludeId?)` (初回/リスポーン/新 joiner 共通、LH 含む)、`createRespawnPosition`。excludeId の役割・ghost thrust 自由化との関係は DESIGN.md §物理「スポーン座標時刻」 |
| `game/lighthouse.ts` | Lighthouse AI（`createLighthouse` ファクトリ、`isLighthouse` 判定、`computeInterceptDirection` 相対論的偏差射撃） |
| `game/gameLoop.ts` | ゲームループ内の純関数群（カメラ制御、プレイヤー物理、Lighthouse AI、当たり判定、ゴースト移動、因果律ガード、レーザー発射） |
| `game/causalEvents.ts` | 因果律遅延イベント処理（キル通知・スポーンエフェクトの過去光円錐チェック） |
| `game/SceneContent.tsx` | 3Dシーンオーケストレーター（交差計算 + カメラ制御 + 子コンポーネント配置） |
| `game/WorldLineRenderer.tsx` | 世界線チューブ描画（TubeGeometry、version throttling、per-vertex 時間 fade） |
| `game/LaserBatchRenderer.tsx` | レーザー世界線バッチ描画（LineSegments、per-vertex 時間 fade） |
| `game/SpawnRenderer.tsx` | スポーンエフェクト描画（アニメーション付きリング+ピラー） |
| `game/DebrisRenderer.tsx` | デブリ世界線描画（InstancedMesh シリンダー + 光円錐交差マーカー、per-instance 時間 fade） |
| `game/ArenaRenderer.tsx` | アリーナ円柱描画（4 geometry: surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線、共有 BufferAttribute で in-place update、per-vertex 時間 fade） |
| `game/StardustRenderer.tsx` | 時空星屑 (案 17) 描画。N=`STARDUST_COUNT` 個の 4D event を world 座標で pre-generated、`THREE.Points` + D pattern。観測者が box 外に出ると periodic wrap、境界は time fade で不可視。詳細: DESIGN.md §描画「時空星屑」 |
| `game/timeFadeShader.ts` | 時間的距離 opacity fade (Lorentzian) の onBeforeCompile inject utility。Mesh*/Line*/Points の全 D pattern material + InstancedMesh に適用。詳細: DESIGN.md §描画「時間的距離 opacity fade」 |
| `game/messageHandler.ts` | ネットワークメッセージ処理（ファクトリ関数、バリデーション付き） |
| `game/HUD.tsx` | HUD オーケストレーター（子コンポーネント配置） |
| `game/hud/ControlPanel.tsx` | 左上パネル（操作説明、トグルスイッチ、FPS、build、スコアボード） |
| `game/hud/Speedometer.tsx` | 右下パネル（エネルギーゲージ、速度、γ、固有時、座標） |
| `game/hud/Overlays.tsx` | 全オーバーレイ（死亡フラッシュ、ゴースト、FIRING、KILL 通知、CSS keyframes） |
| `game/hud/utils.ts` | HUD ユーティリティ（isTouchDevice、hslToComponents） |
| `game/touchInput.ts` | モバイルタッチ入力（全画面ジェスチャ: スワイプ heading/thrust + ダブルタップ fire） |

カスタムフック（`src/hooks/`）:

| ファイル | 内容 |
|---|---|
| `usePeer.ts` | PeerProvider コンテキスト hook |
| `useKeyboardInput.ts` | キーボード入力管理（WASD + 矢印 + Space の preventDefault + keysPressed ref） |
| `useStaleDetection.ts` | stale プレイヤー検知（壁時計/座標時間進行率ベース）、add/delete/cleanup を一箇所に集約 |
| `useHighScoreSaver.ts` | beforeunload でハイスコア/リーダーボード保存 |
| ~~`useBeaconMigration.ts`~~ | 2026-04-18 削除。LH owner 書き換えは `PeerProvider.assumeHostRole` inline に移動、LH respawn 再 schedule は tick poll 化で不要 (DESIGN.md §migration 権威は assumeHostRole に集約) |
| `useSnapshotRetry.ts` | 新規 join client が snapshot 未受信 (players.get(myId) 未定義) で 2 秒経過したら `snapshotRequest` を beacon holder に送信、最大 3 回。host push (connections diff) の race フォールバック |
| `useGameLoop.ts` | ゲームループ本体（setInterval ライフサイクル + 全フェーズの dispatch） |

**D pattern の描画**: 物理オブジェクト (world line / light cone / ring / cone 接平面 / debris / laser batch) は「world 座標 geometry + `mesh.matrix = displayMatrix × T(worldEventPos) × [rotation]`」で per-vertex Lorentz 変換 (`DisplayFrameContext` + `buildMeshMatrix` helper)。観測者静止系/世界系で同一経路、3+1 化時は boost matrix を差し替えるだけ。**例外 (C pattern)**: 球ジオメトリ (player marker, intersection sphere, kill sphere, debris particle) は γ 楕円化回避のため display 並進のみ。照準矢印は 2+1 固有で D pattern 化スコープ外。詳細は DESIGN.md § 描画「D pattern」。

主要機能:
- PC: W/S: 前進/後退、A/D: 横移動、矢印: カメラ回転、Space: レーザー発射
- モバイル: 横スワイプ heading、縦変位 thrust（連続値）、ダブルタップ 射撃（全操作同時実行可）
- 正射影/透視投影カメラ切替
- 自分の静止系/世界系表示切替
- 当たり判定（target-authoritative、`findLaserHitPosition`）: 各 peer が自分 owner のプレイヤー (人間=自分、beacon holder=LH) に対してのみ判定。hit 検出した target 本人が `kill` を broadcast、host が relay。詳細: DESIGN.md § Authority 解体 Stage B
- Kill/Respawn: kill → 世界線を `frozenWorldLines` に移動 + デブリ生成 → ゴースト（DeathEvent ベース等速直線）→ `RESPAWN_DELAY` 後リスポーン（新 WorldLine）→ `INVINCIBILITY_DURATION` の無敵時間（opacity パルスで表示、Lighthouse 除外）
- 世界オブジェクト分離: 死亡で生まれるオブジェクト（凍結世界線、デブリ、ゴースト）はプレイヤーから独立した state。レーザーも同様
- 死亡の設計哲学: 凍結世界線・デブリは世界オブジェクトとして独立描画。過去光円錐交差で自然に可視性が決まる
- 死亡状態管理: `isDead` フラグ + `DeathEvent`（ゴーストカメラの決定論的計算）。`handleKill`/`handleRespawn` コールバックで一元化
- ゴースト UI: 死亡中は青白い半透明オーバーレイ + DEAD カウントダウン。生存時と同じ物理 (`processPlayerPhysics`) で ghost 位置を更新し、thrust で動かせる。カメラ回転は PC 矢印キー (yaw + pitch) / モバイル横スワイプ (yaw のみ、縦スワイプは thrust に固定)
- キルスコア + キル通知エフェクト（因果律遅延: 過去光円錐到達時に発火）
- スポーンエフェクト（因果律遅延: 他プレイヤーのリスポーンは `pendingSpawnEventsRef` に積み、過去光円錐到達時に発火。自分のリスポーンは即時）
- 永続デブリ: 死亡イベントからの等速直線運動パーティクル。lineSegments でバッチ描画。マーカーは過去光円錐交差で表示（maxLambda は固定値、observer 非依存）
- 世界線管理: `player.worldLine` 1本のみ。過去のライフは `frozenWorldLines[]` に格納
- 世界線の過去延長: 廃止済み。`WorldLine.origin` は常に null、半直線延長コードは削除済み (詳細: DESIGN.md § 物理「初回スポーン = リスポーン統一」)
- プレイヤー色は `colorForJoinOrder(index)` が主（接続順 × 黄金角）、peerList 未受信時は `colorForPlayerId(id)` にフォールバック。ネットワーク同期不要の純関数方式。詳細は DESIGN.md § 描画「色割り当て」
- 因果律の守護者: 他プレイヤーの未来光円錐内で操作凍結。死亡プレイヤー・灯台は除外。灯台は別方式: 誰かの過去光円錐に落ちたら最も過去の生存プレイヤーの座標時間にジャンプ
- 光円錐描画: DoubleSide 半透明サーフェス（`LIGHT_CONE_SURFACE_OPACITY`）+ ワイヤーフレーム（`LIGHT_CONE_WIRE_OPACITY`）の 2 層構造で未来/過去光円錐を表示
- アリーナ円柱 (`ArenaRenderer`): world-frame 静止、中心 `(ARENA_CENTER_X, ARENA_CENTER_Y)` 半径 `ARENA_RADIUS` の半透明円柱で戦闘領域の視覚ガイド (物理判定なし)。D pattern で per-vertex Lorentz 変換、時間方向半幅 = `max(ρ(θ), ARENA_MIN_HALF_HEIGHT)` (ρ 大で光円錐交点まで伸び、ρ 小では固定半幅でガード)。過去光円錐 × 円柱交線 (pastCone) は下限なしで独立 position attribute に描画。毎 frame in-place 更新 (DESIGN.md §メタ原則 M17)。詳細: DESIGN.md §描画「アリーナ円柱」
- Exhaust (推進ジェット、自機のみ v0、C pattern): 自機球の反推力方向に 2 層 cone (青外 + 白内、additive で青白プラズマ)。magnitude は EMA smoothing (60/180ms) で点滅解消、方向は非 smoothing。energy 枯渇で自動非表示。他機対応 (D pattern + Lorentz 収縮、phaseSpace に共変 α^μ 同梱) は未実装。詳細: DESIGN.md §描画「Exhaust」
- 時間的距離 opacity fade (Lorentzian、per-vertex shader): `fade = r²/(r² + Δt²)`、`r = TIME_FADE_SCALE = LCH = 20`。`applyTimeFadeShader` を `onBeforeCompile` で全 D pattern material に inject。適用: 世界線 tube (生存/凍結)・デブリ・自己光円錐・アリーナ円柱・レーザー batch。観測者時刻 ±LCH で半透明、±2×LCH で 0.2、±3×LCH で 0.1 の緩やか減衰。詳細: DESIGN.md §描画「時間的距離 opacity fade」

### Store 構造 (`src/stores/game-store.ts`、Stage C 以降)

**Reactive state** (selector で購読):
- `players: Map<id, RelativisticPlayer>`, `lasers: Laser[]`, `scores: Record<id, number>`, `spawns: SpawnEffect[]`, `frozenWorldLines`, `debrisRecords`, `killNotification`, `myDeathEvent`

**Authoritative event log** (Stage C 導入、source of truth):
- `killLog: KillEventRecord[]` — 全 kill の不変記録。`firedForUi` フラグで UI 反映待ちを表現
- `respawnLog: RespawnEventRecord[]` — 全 respawn の不変記録 (初回 spawn も含む)
- GC は useGameLoop tick 末尾で `gcLogs` を毎フレーム実行 (pair 成立 kill を除去、respawn は latest 1 件/player のみ残す)

**Non-reactive helpers** (getState で読む、購読不要):
- `processedLasers: Set<string>` — 自分の hit detection で既に処理済みのレーザー ID
- `pendingSpawnEvents: PendingSpawnEvent[]` — 他プレイヤー respawn の UI 反映待ち (因果律遅延)
- `displayNames: Map<id, string>`
- `lighthouseSpawnTime: Map<id, number>` — LH spawn grace 起点
- `lighthouseLastFireTime: Map<id, number>` — 全 peer が LH laser 観測時に更新。beacon migration 時の fire 連続性を自動確保

**Selectors** (log から derive):
- `selectIsDead(state, id)` / `selectDeadPlayerIds(state)` — 現在死亡中か
- `selectInvincibleUntil(state, id)` / `selectInvincibleIds(state, now)` — 無敵終了時刻
- `selectPendingKillEvents(state)` — UI 反映待ちの kill events (`firedForUi === false`)

**撤去済み**: `deadPlayers: Set`, `invincibleUntil: Map`, `pendingKillEvents[]`, `deathTimeMap: Map` — Stage C で全て event log 由来の selector に置換。

設計判断の詳細は DESIGN.md § Authority 解体 Stage C。

### メッセージタイプ (`src/types/message.ts`)

| type | 発信者 | 経路 | 用途 |
|---|---|---|---|
| `phaseSpace` | owner | beacon holder relay | 4元位置+速度の同期 (LH も同じ経路) |
| `laser` | owner | beacon holder relay | レーザー発射イベント |
| `kill` | target (= owner) | beacon holder relay | 自己死亡申告（hitPos 付き） |
| `respawn` | owner | beacon holder relay | 自分の復活（位置含む） |
| `snapshot` | beacon holder → new joiner | 直接 | 新規 join 用 state 一式（players / killLog / respawnLog / scores / displayNames / hostTime for OFFSET） |
| `intro` | 本人 | beacon holder relay | プレイヤー表示名通知（接続時に 1 回送信） |
| `peerList` | beacon holder → all | 直接 | 接続ピア一覧 + joinRegistry 全履歴（接続変化時に proactive 送信） |
| `ping` | beacon holder → all | 直接 | ハートビート（Stage G: 1秒間隔、2.5秒タイムアウト） |
| `redirect` | beacon → client | 直接 | beacon migration 後の beacon holder ID リダイレクト |

**削除済み**:
- `score` (Stage C-1、全 peer が `killLog` から独立集計するため不要)
- `syncTime` / `hostMigration` (Stage H、`snapshot` 1 本に統合)

**relay 対象 (`PeerProvider.isRelayable`)**: `phaseSpace` / `laser` / `intro` / `kill` / `respawn`。beacon holder が非 owner の発信を他 peer へ転送。

**色は同期しない**: 全ピアが `colorForJoinOrder(index)` で接続順に基づく色を独立に算出。ホストが peerList に `joinRegistry`（全履歴）を含めて送信し、クライアントは丸ごと置換（ホストが唯一の正本）。peerList 未受信時は `colorForPlayerId(id)` にフォールバック。詳細: DESIGN.md § 描画「色割り当て」

**Authority の所在** (Authority 解体 Stage A〜H 完了後):
- `phaseSpace` / `laser` / `kill` / `respawn` はすべて owner 発信 (target-authoritative)。beacon holder は relay hub
- 受信側は二重処理防止を log / selectors に委ねる (例: `handleKill` は `selectIsDead` でガード)
- beacon holder 特有の仕事は: (a) relay、(b) Lighthouse の AI 駆動（LH owner 兼任）、(c) beacon 所有、(d) ping 送信、(e) 新規 join 対応 (snapshot 送信) のみ

メッセージバリデーション: `messageHandler.ts` で全メッセージに `isFiniteNumber`/`isValidVector4`/`isValidVector3`/`isValidColor`/`isValidString` のランタイム検証を実施。laser range は `0 < range <= 100`。body の sender 検証は意図的にしない（spoofing 防御にならないため、詳細は DESIGN.md § Authority 解体 Stage B）。

### ゲームパラメータ（`game/constants.ts`）

全パラメータは `constants.ts` に集約（一部描画パラメータはコード内）:

| パラメータ | 値 | 説明 |
|---|---|---|
| `SPAWN_RANGE` | 10 | スポーン範囲 x,y ∈ [0, SPAWN_RANGE] |
| `RESPAWN_DELAY` | 10000 ms | 死亡→リスポーンの待機時間 |
| `INVINCIBILITY_DURATION` | 5000 ms | スポーン/リスポーン後の無敵時間 |
| `LIGHTHOUSE_FIRE_INTERVAL` | 2000 ms | 灯台の射撃間隔 |
| `LIGHTHOUSE_SPAWN_GRACE` | 5000 ms | 灯台がスポーン後に沈黙する時間 |
| `LIGHTHOUSE_AIM_JITTER_SIGMA` | 0.3 rad | 灯台の照準ジッタ (N(0,σ²) を 3σ clamp、距離比で横ズレ RMS ≈ σ·D) |
| `SPAWN_EFFECT_DURATION` | 1500 ms | スポーンエフェクト表示時間 |
| `LASER_RANGE` | 10 | レーザー射程（アフィンパラメータ λ の上限、c=1 で座標時間=空間距離） |
| `LASER_COOLDOWN` | 100 ms | レーザー連射間隔 |
| `HIT_RADIUS` | 0.25 | 当たり判定の半径 |
| `MAX_LASERS` | 1000 | レーザー保持上限 |
| `MAX_FROZEN_WORLDLINES` | 20 | 凍結世界線の保持上限 |
| `MAX_DEBRIS` | 20 | デブリの保持上限 |
| `EXPLOSION_PARTICLE_COUNT` | 30 | デブリパーティクル数 |
| `MAX_WORLDLINE_HISTORY` | 1000 | 世界線サンプル数上限。FPS balance で 5000 → 1000 に削減 (交差 O(log N) 化で 5000 復帰可、SESSION.md パフォ残課題参照) |
| `MAX_KILL_LOG` | 1000 | kill event log の安全 cap (通常は GC で届かない) |
| `MAX_RESPAWN_LOG` | 500 | respawn event log の安全 cap |
| `PLAYER_ACCELERATION` | 0.8 c/s | プレイヤー加速度 |
| `FRICTION_COEFFICIENT` | 0.5 | 速度に比例する減速 |
| `CAMERA_DISTANCE_*` | 正射影: 50, 透視: 10 | カメラ距離 |
| `CAMERA_YAW/PITCH_SPEED` | yaw: 0.8, pitch: 0.5 rad/s | カメラ回転速度 |
| `CAMERA_PITCH_MIN/MAX` | ±89.9° | カメラ仰角範囲 |
| `PLAYER_MARKER_SIZE_SELF` | 0.42 | 自機マーカーサイズ（playerSphere geo 0.5 × scale） |
| `PLAYER_MARKER_SIZE_OTHER` | 0.2 | 他機マーカーサイズ |
| `ARENA_CENTER_X/Y` | SPAWN_RANGE/2 = 5 | アリーナ円柱の中心（= spawn 一様分布の中心） |
| `ARENA_RADIUS` | 20 | アリーナ円柱半径（= LASER_RANGE × 2） |
| `ARENA_MIN_HALF_HEIGHT` | `= LIGHT_CONE_HEIGHT` = 20 | 円柱時間方向半幅下限。`max(ρ(θ), ARENA_MIN_HALF_HEIGHT)` のガード (pastCone は下限なし、独立描画)。DESIGN.md §描画「アリーナ円柱」 |
| `ARENA_RADIAL_SEGMENTS` | 128 | 円柱側面の周方向分割数（surface / 垂直線 / 上端 rim / 過去光円錐交線で共有、光行差表現のため細かく） |
| `ARENA_COLOR` | `hsl(180,40%,70%)` | アリーナ円柱の色 (暫定シアン、surface / 垂直線 / 交線同色)。プレイヤー色や LH 色と干渉しない色相帯。パステル化時に再検討 |
| `ARENA_SURFACE_OPACITY` | 0.1 | 円柱側面 surface の透明度 (= 光円錐 surface と同値) |
| `ARENA_VERTICAL_LINE_OPACITY` | 0.05 | 時間方向に伸びる垂直線 (ARENA_RADIAL_SEGMENTS 本) の透明度 (= 光円錐 wireframe と同値)。CylinderGeometry + wireframe だと三角形の対角線も出てジグザグになるため、LineSegments で純粋な縦線のみ描画 |
| `ARENA_PAST_CONE_OPACITY` | 1.0 | 過去光円錐交線の透明度。下限 H で clamp されず `pos.t − ρ(θ)` をそのまま独立 position attribute で描く物理的に意味のある線 (「今まさに光が届いている円柱上の事象」) |
| `ARENA_FUTURE_CONE_OPACITY` | 0.3 | 円柱「上端 rim」(= `pos.t + max(ρ, HALF_HEIGHT)`) の透明度。ρ > HALF_HEIGHT の θ では未来光円錐交線と一致、ρ < HALF_HEIGHT の θ では固定半幅 H による rim。pastCone の 1.0 より控えめ (既に起きた event vs まだ起きていない event の情報量差) |
| `STARDUST_COUNT` | 20000 | 時空星屑 spark 総数 (案 17)。size 縮小と連動で段階増量、調整履歴は git log |
| `STARDUST_SPATIAL_HALF_RANGE` | 60 | x, y の ±範囲 (world 単位)。observer boost で display z にミックスされても大半が view 内 |
| `STARDUST_TIME_HALF_RANGE` | `TIME_FADE_SCALE × 3` = 60 | t の ±範囲。fade ≈ 0.1 の境界で自然消失 |
| `STARDUST_SIZE` | 0.04 | point size (world 単位、sizeAttenuation) |
| `STARDUST_COLOR` | `hsl(48, 85%, 65%)` | 黄色寄り。LH `hsl(190,65%,60%)` teal と暖色⇔寒色コントラスト。旧 amber `hsl(42,55%,80%)` を彩度上げ明度下げで再チューン (旧は LH 旧 `hsl(220,70%,75%)` 淡青と time fade 後近接。rose-pink を経由して 2026-04-18 Phase B2 追調整で黄色に戻した) |
| `STARDUST_OPACITY` | 0.5 | base opacity (per-vertex time fade で乗算) |
| `LIGHT_CONE_HEIGHT` | 20 | 描画上の円錐サイズ（c=1 で radius=height） |
| `LIGHT_CONE_SURFACE_OPACITY` | 0.1 | 光円錐サーフェスの透明度 |
| `LIGHT_CONE_WIRE_OPACITY` | 0.05 | 光円錐ワイヤーフレームの透明度 |
| `TIME_FADE_SCALE` | `= LCH` = 20 | 時間的距離 fade の Lorentzian scale `r` (`fade = r²/(r² + Δt²)`)。LCH と連動 |
| `PLAYER_WORLDLINE_OPACITY` | 0.65 | 人間プレイヤーの世界線チューブ透明度 |
| `LIGHTHOUSE_WORLDLINE_OPACITY` | 0.4 | 灯台の世界線チューブ透明度 |
| `LASER_WORLDLINE_OPACITY` | 0.2 | レーザー世界線の透明度 |
| `GC_PAST_LCH_MULTIPLIER` | 5 | Temporal GC 閾値 (= 5×LCH = 100)、time fade ≈ 0.04 の不可視域を刈る。laser / frozen WL / debris が earliestPlayerT − 5×LCH より過去で削除 |
| `DEBRIS_MAX_LAMBDA` | 2.5 | デブリ 1 粒子の coord time 方向の長さ。`DebrisRenderer` の segment 生成と Temporal GC の両方で参照 |
| `EXHAUST_BASE_LENGTH` | 1.2 | 推進ジェット cone の最大長 (`smoothedMag=1` のとき) |
| `EXHAUST_BASE_RADIUS` | 0.22 | 推進ジェット cone 底面最大半径 |
| `EXHAUST_RADIUS_MIN_SCALE` | 0.5 | radius を smoothed magnitude 連動させる下限倍率 (0.5×〜1.0×)。mobile 連続 thrust で視覚フィードバック明示 |
| `EXHAUST_OFFSET` | 0.3 | 自機球表面から cone 底面までのすき間 (矢印の base もここ) |
| `EXHAUST_MAX_OPACITY` | 0.6 | cone opacity 上限 (smoothedMag に比例)。プラズマ噴射らしい透明感 |
| `EXHAUST_OUTER_COLOR` | `hsl(210, 85%, 60%)` | 外側 cone 色 (明るい青、全機共通。識別性は sphere / worldline 側) |
| `EXHAUST_INNER_COLOR` | `hsl(210, 70%, 92%)` | 内側 core cone 色 (冷たい白、外側と additive で青白プラズマ) |
| `EXHAUST_ATTACK_TIME` | 60 ms | magnitude EMA の立ち上がり時定数 (PC binary 入力の点滅防止、方向は smoothing しない) |
| `EXHAUST_RELEASE_TIME` | 180 ms | 同じ EMA の減衰時定数 (キー離し後の余韻) |
| `EXHAUST_VISIBILITY_THRESHOLD` | 0.01 | smoothed magnitude がこれ未満で cone / 矢印 非表示 |
| `ARROW_BASE_LENGTH` | 2.4 | 加速度矢印 (flat 2D ShapeGeometry) の全長最大値 |
| `ARROW_BASE_WIDTH` | 0.95 | 加速度矢印の最大幅。geometry unit 幅 0.7 をこの値でスケール |
| `ARROW_BASE_OFFSET` | 0.9 | 球表面から矢印 tail までのすき間。`EXHAUST_OFFSET = 0.3` より大きく取り、噴射炎と矢印の視覚分離を強める |
| `ARROW_COLOR` | `hsl(45, 85%, 70%)` | 矢印色 amber。exhaust 青白と補色、重なっても識別可 |
| `ARROW_MAX_OPACITY` | 0.55 | 矢印 opacity 上限。flat + DoubleSide で視認性重視 |
| `LIGHT_CONE_COLOR` | `hsl(200, 35%, 85%)` | 自機光円錐 surface/wire 色 (固定、プレイヤー色非依存)。アリーナ円柱 hue 180° と 20° 差、パステル化時再調整 |
| `GAME_LOOP_INTERVAL` | 8 ms | `setInterval`（タブ非アクティブ対応） |
| `CAUSAL_FREEZE_HYSTERESIS` | 2.0 | 因果律凍結の振動防止閾値 |

| パラメータ（コード内） | 値 | 説明 |
|---|---|---|
| デブリ opacity | 0.10 | デブリ世界線の透明度（レーザーより薄く区別） |
| デブリ速度 | 被撃破機の固有速度 + kick 0〜0.8 | 固有速度空間で加算後 3速度に正規化（\|v\|<1 自動保証） |
| `TUBE_REGEN_INTERVAL` | 8 | TubeGeometry 再生成の間引き（version を 8 で量子化） |
| `INNER_CORE_SCALE` | 0.45 | exhaust 内側 core cone の radius/length 倍率 (白熱コアは外側 cone に内包される) |

| タッチパラメータ（`touchInput.ts`） | 値 | 説明 |
|---|---|---|
| `DOUBLE_TAP_INTERVAL` | 300 ms | ダブルタップ判定の最大間隔 |
| `DOUBLE_TAP_DISTANCE` | 30 px | ダブルタップ判定の最大距離 |
| `SWIPE_SENSITIVITY` | 0.008 rad/px | 横スワイプ → yaw 回転の感度。pitch には反映しない (ghost 物理統合後の衝突回避) |
| `THRUST_SENSITIVITY_Y` | 0.015 /px | 縦変位 → thrust の感度（67px で最大推力）。生死問わず適用 (死亡中は ghost phaseSpace が動く) |

| エネルギーパラメータ（`constants.ts`） | 値 | 説明 |
|---|---|---|
| `ENERGY_MAX` | 1.0 | エネルギー満タン値。fire と thrust が共有する単一プール |
| `ENERGY_PER_SHOT` | 1/30 ≈ 0.033 | 1 発あたりの消費。30 発で枯渇（≈3 秒連射） |
| `THRUST_ENERGY_RATE` | 1/9 ≈ 0.111/s | フル thrust 連続で 9 秒で空。部分 thrust は使用率 (`\|a\|/PLAYER_ACCELERATION`) に比例。fire と同時で ~2.25 秒で枯渇 |
| `ENERGY_RECOVERY_RATE` | 1/6 ≈ 0.167/s | 6 秒で 0→満タン。**fire も thrust もしていない**ときのみ回復 |

HUD: `energy < 0.001` で "FUEL" 赤ラベル + バー点滅 (`fuel-empty-pulse` 0.7s)、`energy < 0.2` で赤色化。設計根拠は DESIGN.md § Thrust energy。

### Relay サーバーセキュリティ（`relay-server/server.mjs`）

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | WebSocket ping 送信間隔（サーバー→クライアント） |
| `HEARTBEAT_TIMEOUT_MS` | 10s | WebSocket pong 応答タイムアウト |

注: 上記は **relay server の WebSocket レベル heartbeat**。ゲームクライアントの beacon holder 切断検知は `PeerProvider` の `ping` (1s / 2.5s) で別経路。

### ビルド設定

- Vite + React 19 + TypeScript 5.8 + three.js + R3F
- Biome (linter/formatter): ダブルクォート、2スペースインデント
- `__BUILD_TIME__` — Vite define でビルド時刻を埋め込み（HUD 表示）
- base path: `/LorentzArena/`（GitHub Pages）

## 参照ドキュメント

- `DESIGN.md` — 設計判断の記録（このディレクトリ内）
- `plans/` — 複数 Stage にまたがるリファクタの計画書
  - `plans/2026-04-14-authority-dissolution.md` — host 権威解体、target-authoritative 化（**完了**、2026-04-15）
  - `plans/2026-04-15-design-reorg.md` — DESIGN.md 再編の作業メモ（完了）
- `../CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md`（symlink）
- `../docs/NETWORKING.md` — ネットワーク設定の詳細
- `relay-deploy/README.md` — WS Relay 本番デプロイ手順
