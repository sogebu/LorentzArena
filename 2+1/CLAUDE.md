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

`pnpm test` で 1 回実行、`pnpm test:watch` でウォッチモード。現時点のテストは `src/physics/worldLine.test.ts` のみ (光円錐交差 binary search の regression test)。

**物理コア (pure 関数) を触るときの規約**:
1. 旧実装を `*Linear` 等の名前で export 維持 (deprecated だが regression 比較用)
2. `*.test.ts` を先に書き、random input + エッジケースで旧実装と新実装の結果一致を regression test
3. 全 test green 後に呼び出し元を新実装に切り替え
4. feat branch + PR 相当の単位で main に merge、必要なら旧実装を削除 (git history 参照可能)

物理交差計算のような**細かいロジックで bug が視覚異常として即出る部分**は、この TDD 的フローで安全に最適化できる。2026-04-17 の光円錐交差 O(log N) 化がこの運用の事例 (詳細: DESIGN.md §worldLine.history サイズ)。

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

- **マルチプレイテスト**: 同じ URL を複数タブで開く。ルーム分離は `#room=<名前>` で可能
- **GitHub Pages と ID 衝突回避**: 本番（sogebu.github.io）がルーム `default` を使っているので、localhost テスト時は `#room=test` 等の別ルーム名を使うこと。同じルーム名だと PeerJS ID `la-default` が取られて接続不能になる
- **preview_start 使用時**: launch.json の `lorentz-arena` を使う。起動後は必ず localhost URL をリンクで出力する（`~/Claude/CLAUDE.md` 規約）。ポートが変わる場合があるのでサーバーログで確認
- **preview ブラウザが PeerJS ID を奪う**: preview_start でページが開くと PeerJS ルーム ID (`la-{roomName}`) を取得してしまい、ユーザーのブラウザが接続できなくなる。マルチタブテストは `pnpm dev` をバックグラウンドで起動し、preview ブラウザでページを開かないこと
- **HMR と module-level 定数**: `OFFSET = Date.now()/1000` のような module-level 定数を変更した場合、HMR で既存タブに反映されても、変更前に評価された値がキャッシュされることがある。定数変更後は**全タブを手動リロード**すること
- **HMR の Provider 再マウント副作用**: `physics/` や `stores/` のような game state 経路上のファイルを編集した直後、HMR で **PeerProvider / zustand store が再マウントされ、接続状態・`myId`・`players` が START 前に戻る**ことがある。症状は「自機マーカー・光円錐・世界線・Speedometer HUD がすべて消える」「接続設定に ルーム名が出ない」。コードのバグと誤認しがち。ハードリロード (Cmd+Shift+R) + 再 START で復帰するなら HMR 副作用で、edit 自体のバグではない (DESIGN.md M15)。実際、2026-04-17 に `physics/worldLine.ts` の二分探索化試行で同症状が出て、B 案のバグに見えたが revert + リロードで正常復帰 → HMR 副作用と判定 (M15 事例ログ参照)
- **preview_eval で store 覗きたい時の quirk**: `await import('/LorentzArena/src/stores/game-store.ts')` で zustand store を取得すると、走っている app のインスタンスとは **別の fresh インスタンス** が返ってくる (state が空)。Vite ESM の module registry がリクエスト経路で分かれるため。store 経由の debug は諦めて `document.body.innerText` や HUD の screenshot で状態確認するか、開発時だけ `window.__store = useGameStore` 等を追加して HMR させる
- **single-tab preview でカバーできる範囲**: beacon holder 自己 death/respawn、LH kill/respawn、scoring UI、handleKill / selector の動作。**できない範囲**: snapshot の新規 join path、relay 経由の kill/respawn、client ↔ client、beacon migration。これらは multi-tab を開いてユーザーに検証依頼

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

自動接続フロー: START を押すと PeerProvider がマウントされ接続開始。`#room=name` で部屋分離。最初に START を押した人（= 最初に `la-{roomName}` ビーコンを取得した人）がホスト。全員ランダム ID でゲーム接続し、`la-{roomName}` はビーコン（発見専用、redirect 送信）のみに使用。

プレイヤー初期化: ホストは START 直後に自己初期化（`OFFSET = Date.now()/1000` で座標時間 t ≈ 0 から開始）。新規 join client は beacon holder から `snapshot` メッセージで `hostTime` を受け取り、その coord-time にスポーン（Authority 解体 Stage F-1 で `syncTime` 廃止、snapshot に統合済み）。

ホストマイグレーション: beacon holder が切断すると最古参クライアントが自動昇格。ハートビート方式（1 秒間隔 `ping`、2.5 秒タイムアウト、Stage G 以降）で即時検知。Authority 解体 Stage D 以降、人間の respawn timer は各 owner がローカルに持ち続けるので migration で再構築不要。`useBeaconMigration`（旧 `useHostMigration`）の仕事は Lighthouse owner 書き換え + LH 死亡中なら残り時間で respawn 再 schedule のみ。`hostMigration` メッセージは Stage H で完全削除済み。

ビーコンパターン: `la-{roomName}` は常にビーコン（発見専用）。初期ホストは Phase 1 でビーコンを取得し `beaconRef` に保持、マイグレーション後のホストはビーコン effect で取得。新クライアントがビーコンに接続すると `{ type: "redirect", hostId }` で本当のホスト（ランダム ID）にリダイレクト。既存のゲーム接続には影響しない。

マイグレーションのフォールバック: 選出ホストが 10 秒応答しない場合、ビーコン経由で発見を試みる。ビーコンも 8 秒応答なければソロホスト化。peerOrderRef が空の場合もビーコン優先。新規クライアントの redirect 先がオフラインなら最大 3 回リトライ。

ビーコンベースのホスト降格: peerOrderRef のずれで 2 ノードが同時にホスト化した場合（dual-host）、ビーコン PeerJS ID の一意性で解決。ビーコン取得に 3 回失敗したホストは、ビーコン経由で本物のホストを発見 → 自分のクライアントに redirect を broadcast → 自分はクライアントに降格。`roleVersion` state で全 role 依存 effect を再評価。

設計判断は DESIGN.md § Authority 解体 / § ネットワーク参照。

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
| `game/respawnTime.ts` | `computeSpawnCoordTime(players, excludeId?)`（excludeId 除外した全プレイヤー最大 t。自機の self-respawn では excludeId=myId を渡して ghost thrust 自由化に伴う自己参照暴走を避ける。LH は含む。初回/リスポーン/新 joiner 共通。詳細: DESIGN.md §物理「スポーン座標時刻」）、`createRespawnPosition`（座標時間 + ランダム空間位置） |
| `game/lighthouse.ts` | Lighthouse AI（`createLighthouse` ファクトリ、`isLighthouse` 判定、`computeInterceptDirection` 相対論的偏差射撃） |
| `game/gameLoop.ts` | ゲームループ内の純関数群（カメラ制御、プレイヤー物理、Lighthouse AI、当たり判定、ゴースト移動、因果律ガード、レーザー発射） |
| `game/causalEvents.ts` | 因果律遅延イベント処理（キル通知・スポーンエフェクトの過去光円錐チェック） |
| `game/SceneContent.tsx` | 3Dシーンオーケストレーター（交差計算 + カメラ制御 + 子コンポーネント配置） |
| `game/WorldLineRenderer.tsx` | 世界線チューブ描画（TubeGeometry、version throttling、per-vertex 時間 fade） |
| `game/LaserBatchRenderer.tsx` | レーザー世界線バッチ描画（LineSegments、per-vertex 時間 fade） |
| `game/SpawnRenderer.tsx` | スポーンエフェクト描画（アニメーション付きリング+ピラー） |
| `game/DebrisRenderer.tsx` | デブリ世界線描画（InstancedMesh シリンダー + 光円錐交差マーカー、per-instance 時間 fade） |
| `game/ArenaRenderer.tsx` | アリーナ円柱描画（4 geometry: surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線、共有 BufferAttribute で in-place update、per-vertex 時間 fade） |
| `game/timeFadeShader.ts` | 時間的距離 opacity fade (Lorentzian) の onBeforeCompile shader inject utility。全 D pattern material に適用 (MeshStandardMaterial / MeshBasicMaterial / LineBasicMaterial、InstancedMesh は `USE_INSTANCING` 分岐で対応)。詳細: DESIGN.md §描画「時間的距離 opacity fade」 |
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
| `useBeaconMigration.ts` | beacon ownership handoff。Stage F-1 で hostMigration 送信撤去、仕事は LH owner 書き換え + LH respawn 再 schedule のみ。Stage F-2 で `useHostMigration` から改名 (`b5579fe` 相当) |
| `useGameLoop.ts` | ゲームループ本体（setInterval ライフサイクル + 全フェーズの dispatch） |

**D pattern の描画**: scene の物理オブジェクト (world line、light cone、ring 系マーカー、cone 接平面三角形、debris、laser batch) は「world 座標で geometry + `mesh.matrix = displayMatrix × T(worldEventPos) × [rotation]`」で per-vertex Lorentz 変換。`DisplayFrameContext` が `displayMatrix` を配信、`buildMeshMatrix` helper で mesh 合成。観測者静止系/世界系どちらでも同一経路、3+1 化時は boost matrix を差し替えるだけ。詳細は DESIGN.md § 描画「D pattern」。**例外** (C pattern / position-based): 球ジオメトリ (player marker, intersection sphere + core, kill sphere, debris particle) は per-vertex Lorentz で γ 楕円化を避けるため display 並進のみ。照準矢印は 2+1 固有のため D pattern 化スコープ外。

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
- アリーナ円柱 (`ArenaRenderer`): world-frame 静止、中心 `(ARENA_CENTER_X, ARENA_CENTER_Y)` 半径 `ARENA_RADIUS` の半透明円柱で戦闘領域の視覚ガイドを提示。物理判定なし（drifter 封じ込めは thrust energy で既済、視覚的境界として補完）。D pattern で per-vertex Lorentz 変換し、rest frame では光行差で楕円歪みを表現。**時間方向は観測者の因果コーンで切り出される**: 各 θ で `(x(θ), y(θ))` から観測者への空間距離 `ρ(θ)` を計算し、下端 = `observer.t − ρ(θ)` (過去光円錐交点)、上端 = `observer.t + ρ(θ)` (未来光円錐交点)。観測者が中心なら均一な円、離れると「観測者双円錐で切り出された」形に歪む。副産物として、観測者が円柱外から眺めた時の overdraw 問題も自動解消。**4 geometry (surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線) は共有 BufferAttribute で 1 セットの N×2 頂点を index だけ違えて描画** (surface 下辺と pastCone loop が完全一致、密度差による線ズレ解消)。geometry は初回 1 回作成、毎 frame `useFrame` で position を in-place 更新 + `needsUpdate=true` (allocation ゼロ、GPU upload 1 回/frame、DESIGN.md §メタ原則 M17)。`frustumCulled={false}` で in-place update 時の boundingSphere 問題を回避。過去光円錐交線は濃く (1.0)、未来光円錐交線は控えめ (0.3) で情報量の非対称を反映。詳細: DESIGN.md §描画「アリーナ円柱」
- Exhaust (推進ジェット、自機のみ v0): 自機球の反推力方向に 2 層 cone (外=`EXHAUST_OUTER_COLOR` 明るい青、内=`EXHAUST_INNER_COLOR` 冷たい白、`MeshBasicMaterial` + `THREE.AdditiveBlending` + `toneMapped=false` で青白プラズマ発光)。プレイヤー色依存は廃止、識別は sphere / worldline に任せる。**v0 は C pattern (rest-frame 固定)**、`transformEventForDisplay` 経由で自機球と同じ display 座標に並進のみ、共変 α^μ を phaseSpace に載せる段階 (他機対応) で D pattern + Lorentz 収縮に昇格予定。magnitude は描画層で EMA smoothing (attack 60ms / release 180ms) して PC binary 入力の点滅を解消、方向は smoothing しない。energy 枯渇で `thrustAcceleration=0` になり自動非表示。物理モデルの 3 ステップ (①rest frame で与える / ②world frame に boost して broadcast / ③観測者 rest frame に戻して表示) のうち v0 は ① のみ実装、②③ は他機対応時。詳細: DESIGN.md §描画「Exhaust」
- 時間的距離 opacity fade (Lorentzian、per-vertex shader): `fade = r²/(r² + Δt²)`、`r = TIME_FADE_SCALE = LIGHT_CONE_HEIGHT = 20`。`applyTimeFadeShader` を `onBeforeCompile` で全 D pattern material に inject、各 vertex の world 座標を `modelMatrix × position` で display frame に変換した z 成分から per-vertex fade を計算、`gl_FragColor.a` に乗算。適用対象: 世界線 tube (生存・凍結)・デブリ (InstancedMesh、`USE_INSTANCING` 分岐)・自己光円錐 4 mesh・アリーナ円柱 4 mesh・レーザー batch。観測者時刻近傍が濃く、±LCH で半透明、±2×LCH で 0.2、±3×LCH で 0.1 と緩やかに減衰 (時間距離の 2 乗反比例、物理の逆 2 乗法則と同型)。**生存世界線も tail vertex は display z < 0 で fade される** (per-mesh v0 時代と異なる、per-vertex の自然な挙動)。詳細: DESIGN.md §描画「時間的距離 opacity fade」

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
| `MAX_WORLDLINE_HISTORY` | 1000 | 世界線のサンプル数上限。5000 から削減 (SceneContent useMemo と game loop の交差計算が毎フレーム O(N) で history 走査 → 長時間プレイで FPS 低下、1000 に下げて視覚妥協と FPS 改善のバランス取り)。中期対策: 交差計算を O(log N) 化すれば 5000 に戻せる |
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
| ~~`ARENA_HEIGHT`~~ | (廃止) | 旧実装は observer.t 中心の固定高さで描画していたが、現実装は各 θ の上下端を観測者の過去/未来光円錐交点 (`observer.t ± ρ(θ)`) に動的設定するため固定 height 定数は不要 |
| `ARENA_RADIAL_SEGMENTS` | 128 | 円柱側面の周方向分割数（surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線で共有、光行差表現のため細かく） |
| `ARENA_COLOR` | `hsl(180,40%,70%)` | アリーナ円柱の色 (暫定シアン、surface / 垂直線 / 交線同色)。プレイヤー色や LH 色と干渉しない色相帯。パステル化時に再検討 |
| `ARENA_SURFACE_OPACITY` | 0.1 | 円柱側面 surface の透明度 (= 光円錐 surface と同値) |
| `ARENA_VERTICAL_LINE_OPACITY` | 0.05 | 時間方向に伸びる垂直線 (ARENA_RADIAL_SEGMENTS 本) の透明度 (= 光円錐 wireframe と同値)。CylinderGeometry + wireframe だと三角形の対角線も出てジグザグになるため、LineSegments で純粋な縦線のみ描画 |
| `ARENA_PAST_CONE_OPACITY` | 1.0 | 過去光円錐交線 (下地平線) の透明度。「いま光が届いている周縁」を強調 |
| `ARENA_FUTURE_CONE_OPACITY` | 0.3 | 未来光円錐交線 (上地平線) の透明度。過去より控えめ (まだ起きていない event の情報量差を視覚反映) |
| `LIGHT_CONE_HEIGHT` | 20 | 描画上の円錐サイズ（c=1 で radius=height） |
| `LIGHT_CONE_SURFACE_OPACITY` | 0.1 | 光円錐サーフェスの透明度 |
| `LIGHT_CONE_WIRE_OPACITY` | 0.05 | 光円錐ワイヤーフレームの透明度 |
| `TIME_FADE_SCALE` | `= LIGHT_CONE_HEIGHT` = 20 | 時間的距離 opacity fade の Lorentzian scale。`fade = r²/(r² + Δt²)` の r。per-vertex shader (`timeFadeShader.ts`) で全 D pattern material に適用。LCH を変更すると自動追従 |
| `PLAYER_WORLDLINE_OPACITY` | 0.65 | 人間プレイヤーの世界線チューブ透明度 |
| `LIGHTHOUSE_WORLDLINE_OPACITY` | 0.4 | 灯台の世界線チューブ透明度 |
| `LASER_WORLDLINE_OPACITY` | 0.3 | レーザー世界線の透明度 |
| `EXHAUST_BASE_LENGTH` | 0.8 | 推進ジェット cone の最大長 (`smoothedMag=1` のとき) |
| `EXHAUST_BASE_RADIUS` | 0.15 | 推進ジェット cone 底面半径 (固定) |
| `EXHAUST_OFFSET` | 0.3 | 自機球表面から cone 底面までのすき間 |
| `EXHAUST_MAX_OPACITY` | 0.45 | cone opacity 上限 (smoothedMag に比例)。プラズマ噴射らしい透明感 |
| `EXHAUST_OUTER_COLOR` | `hsl(210, 85%, 60%)` | 外側 cone 色 (明るい青、全機共通。識別性は sphere / worldline 側) |
| `EXHAUST_INNER_COLOR` | `hsl(210, 70%, 92%)` | 内側 core cone 色 (冷たい白、外側と additive で青白プラズマ) |
| `EXHAUST_ATTACK_TIME` | 60 ms | magnitude EMA の立ち上がり時定数 (PC binary 入力の点滅防止、方向は smoothing しない) |
| `EXHAUST_RELEASE_TIME` | 180 ms | 同じ EMA の減衰時定数 (キー離し後の余韻) |
| `EXHAUST_VISIBILITY_THRESHOLD` | 0.01 | smoothed magnitude がこれ未満で cone 非表示 |
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
| `SWIPE_SENSITIVITY` | 0.008 rad/px | 横スワイプ → yaw 回転の感度。`pitchDelta` 生成には使うが `processCamera` 内で pitch には反映しない (ghost 物理統合後の衝突回避、2026-04-17 以降) |
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

注: 上記は **relay server の WebSocket レベル heartbeat**。ゲームクライアントの beacon holder 切断検知は別の仕組み（`PeerProvider` の `ping` メッセージ: Stage G 以降 1 秒間隔 / 2.5 秒タイムアウト、visibility 復帰時に lastPingRef reset で false positive 回避）。

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
