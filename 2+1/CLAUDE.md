# CLAUDE.md — LorentzArena 2+1

2+1 次元時空図アリーナ（x-y-t）。three.js + React Three Fiber で描画。
全リポ共通の規約は `CONVENTIONS.md`（リポルートの symlink）を参照。

## コマンド

```bash
pnpm install && pnpm dev       # PeerJS モード（http://localhost:5173/LorentzArena/）
pnpm dev:wsrelay               # WS Relay モード（relay-server 同時起動）
pnpm run deploy                # GitHub Pages デプロイ
pnpm run lint                  # Biome linter
pnpm run format                # Biome formatter
pnpm run analyze               # バンドルサイズ分析
```

### テスト・デプロイの使い分け

- **スマホ操作に関係しない変更**（エフェクト調整、ゲームロジック、HUD レイアウト等）は **localhost（preview_start）でテストしてから** push・deploy。GitHub Pages のキャッシュ反映にはタイムラグがあり、毎回デプロイして待つのは非効率
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

### ハイスコア (`src/services/highScores.ts`)

localStorage ベースの永続スコア。`loadHighScores()`, `saveHighScore(entry)`, `getTopScores(n)` の純関数。localStorage key `"la-highscores"`、最大 20 件。

### 物理エンジン (`src/physics/`)

- `vector.ts` — 3D/4D ベクトル演算、ミンコフスキー内積 (+,+,+,-)、`isInPastLightCone(event, observer)`、`pastLightConeIntersectionSegment(start, delta, observer)`（汎用光円錐交差ソルバー、laser/debris が共通利用）
- `matrix.ts` — 4x4 ローレンツ変換行列
- `mechanics.ts` — 相対論的運動方程式、phase space (4元位置 + 4元速度)
- `worldLine.ts` — 世界線の離散履歴、過去光円錐交差計算、`origin` フィールドで半直線延長、`version` カウンターで描画スロットリング

単位系: c = 1。ファクトリパターン（クラス不使用）。

### ネットワーク (`src/services/`, `src/contexts/`)

- `PeerManager.ts` — PeerJS/WebRTC ラッパー
- `WsRelayManager.ts` — WebSocket Relay フォールバック
- `PeerProvider.tsx` — 自動接続 + ホストマイグレーション

自動接続フロー: ページを開くだけで同じルームに入る。`#room=name` で部屋分離。最初に `la-{roomName}` PeerJS ID を取得したピアがホスト。

プレイヤー初期化: ホスト・クライアント共に START 直後に自己初期化（`OFFSET = Date.now()/1000` で座標時間 t ≈ 0 から開始）。クライアントがホストに接続すると `syncTime` で時刻座標を補正。ホスト未 START でもクライアントは独立にプレイ開始可能。

ホストマイグレーション: ホストが切断すると最古参クライアントが自動昇格。ハートビート方式（3 秒間隔 `ping`、8 秒タイムアウト）で即時検知。新ホストは `hostMigration` メッセージでスコア・dead players を引き継ぎ、respawn タイマーを残り時間で再構築。

ビーコンパターン: マイグレーション後、新ホスト（ランダム ID）が `la-{roomName}` で発見専用のビーコン PeerManager を作成。新クライアントがビーコンに接続すると `{ type: "redirect", hostId }` で本当のホストにリダイレクト。既存のゲーム接続には影響しない。設計判断は DESIGN.md「ホストマイグレーション」参照。

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
| `game/displayTransform.ts` | ローレンツ変換 → 表示座標変換 |
| `game/laserPhysics.ts` | レーザー当たり判定 + 光円錐交差 |
| `game/debris.ts` | デブリ生成 + 光円錐交差 |
| `game/killRespawn.ts` | `applyKill`/`applyRespawn` 純粋関数（ホスト/クライアント共通） |
| `game/lighthouse.ts` | Lighthouse AI（`createLighthouse` ファクトリ、`isLighthouse` 判定、`computeInterceptDirection` 相対論的偏差射撃） |
| `game/gameLoop.ts` | ゲームループ内の純関数群（カメラ制御、プレイヤー物理、Lighthouse AI、当たり判定、ゴースト移動、因果律ガード、レーザー発射） |
| `game/causalEvents.ts` | 因果律遅延イベント処理（キル通知・スポーンエフェクトの過去光円錐チェック） |
| `game/SceneContent.tsx` | 3Dシーンオーケストレーター（交差計算 + カメラ制御 + 子コンポーネント配置） |
| `game/WorldLineRenderer.tsx` | 世界線チューブ描画（TubeGeometry、version throttling） |
| `game/LaserBatchRenderer.tsx` | レーザー世界線バッチ描画（LineSegments） |
| `game/SpawnRenderer.tsx` | スポーンエフェクト描画（アニメーション付きリング+ピラー） |
| `game/DebrisRenderer.tsx` | デブリ世界線描画（InstancedMesh シリンダー + 光円錐交差マーカー） |
| `game/messageHandler.ts` | ネットワークメッセージ処理（ファクトリ関数、バリデーション付き） |
| `game/HUD.tsx` | オーバーレイUI（コントロール、スピードメーター、キル通知、死亡カウントダウン） |
| `game/touchInput.ts` | モバイルタッチ入力（全画面ジェスチャ: スワイプ heading/thrust + ダブルタップ fire） |

カスタムフック（`src/hooks/`）:

| ファイル | 内容 |
|---|---|
| `usePeer.ts` | PeerProvider コンテキスト hook |
| `useKeyboardInput.ts` | キーボード入力管理（WASD + 矢印 + Space の preventDefault + keysPressed ref） |
| `useStaleDetection.ts` | stale プレイヤー検知（壁時計/座標時間進行率ベース）、add/delete/cleanup を一箇所に集約 |
| `useHighScoreSaver.ts` | beforeunload でハイスコア/リーダーボード保存 |
| `useHostMigration.ts` | ホストマイグレーション（state ブロードキャスト + respawn タイマー再構築） |
| `useGameLoop.ts` | ゲームループ本体（setInterval ライフサイクル + 全フェーズの dispatch） |

主要機能:
- PC: W/S: 前進/後退、A/D: 横移動、矢印: カメラ回転、Space: レーザー発射
- モバイル: 横スワイプ heading、縦変位 thrust（連続値）、ダブルタップ 射撃（全操作同時実行可）
- 正射影/透視投影カメラ切替
- 自分の静止系/世界系表示切替
- 当たり判定（ホスト権威、`findLaserHitPosition`）
- Kill/Respawn: kill → 世界線を `frozenWorldLines` に移動 + デブリ生成 → ゴースト（DeathEvent ベース等速直線）→ 10秒後リスポーン（新 WorldLine）
- 世界オブジェクト分離: 死亡で生まれるオブジェクト（凍結世界線、デブリ、ゴースト）はプレイヤーから独立した state。レーザーも同様
- 死亡の設計哲学: 凍結世界線・デブリは世界オブジェクトとして独立描画。過去光円錐交差で自然に可視性が決まる
- 死亡状態管理: `isDead` フラグ + `DeathEvent`（ゴーストカメラの決定論的計算）。`handleKill`/`handleRespawn` コールバックで一元化
- ゴースト UI: 死亡中は青白い半透明オーバーレイ + DEAD カウントダウン。カメラ回転は可能
- キルスコア + キル通知エフェクト（因果律遅延: 過去光円錐到達時に発火）
- スポーンエフェクト（因果律遅延: 他プレイヤーのリスポーンは `pendingSpawnEventsRef` に積み、過去光円錐到達時に発火。自分のリスポーンは即時）
- 永続デブリ: 死亡イベントからの等速直線運動パーティクル。lineSegments でバッチ描画。マーカーは過去光円錐交差で表示（maxLambda は固定値、observer 非依存）
- 世界線管理: `player.worldLine` 1本のみ。過去のライフは `frozenWorldLines[]` に格納
- 世界線の過去延長: `WorldLine.origin` で制御。最初のライフのみ origin から半直線延長
- プレイヤー色は `colorForPlayerId(id)` で決定的に算出（純関数、ネットワーク同期不要）。詳細は DESIGN.md「色割り当て: 決定的純関数」
- 因果律の守護者: 他プレイヤーの未来光円錐内で操作凍結。死亡プレイヤー・灯台は除外。灯台は別方式: 誰かの過去光円錐に落ちたら最も過去の生存プレイヤーの座標時間にジャンプ
- 光円錐描画: FrontSide 半透明サーフェス（opacity 0.2）+ FrontSide ワイヤーフレーム（opacity 0.3）で手前/奥の区別

### メッセージタイプ (`src/types/message.ts`)

| type | 方向 | 用途 |
|---|---|---|
| `phaseSpace` | 双方向（host 中継） | 4元位置+速度の同期 |
| `laser` | 双方向（host 中継） | レーザー発射イベント |
| `syncTime` | host → client | 世界系時刻同期 |
| `kill` | host → all | キル通知（hitPos 付き） |
| `respawn` | host → all | リスポーン位置指示 |
| `score` | host → all | スコア更新 |
| `ping` | host → all | ハートビート（3秒間隔、8秒タイムアウトでホスト切断検知） |
| `hostMigration` | new host → all | ホストマイグレーション（スコア + dead players + displayNames 引継ぎ） |
| `intro` | 双方向（host 中継） | プレイヤー表示名通知（接続時に 1 回送信） |
| `peerList` | host → all | 接続ピア一覧（接続変化時に proactive 送信） |
| `requestPeerList` | client → host | ピア一覧要求 |
| `redirect` | beacon → client | マイグレーション後のホスト ID リダイレクト |

**色は同期しない**: 全ピアが `colorForJoinOrder(index)` で接続順に基づく色を独立に算出（peerList から各自 append-only joinRegistry を構築）。peerList 未受信時は `colorForPlayerId(id)` にフォールバック。ネットワークで色を直接同期するメッセージはない。詳細: DESIGN.md「色割り当て」

ホスト権威メッセージ（kill, respawn, score）: ホストはゲームループで処理済みのため messageHandler でスキップ（二重処理防止）。

メッセージバリデーション: `messageHandler.ts` で全メッセージに `isFiniteNumber`/`isValidVector4`/`isValidVector3`/`isValidColor`/`isValidString` のランタイム検証を実施。laser range は `0 < range <= 100`、score は全エントリ検証。

### ゲームパラメータ（`game/constants.ts`）

| パラメータ | 値 | 説明 |
|---|---|---|
| `SPAWN_RANGE` | 20 | スポーン範囲 x,y ∈ [0, SPAWN_RANGE] |
| `RESPAWN_DELAY` | 10000 ms | 死亡→リスポーンの待機時間 |
| `SPAWN_EFFECT_DURATION` | 1500 ms | スポーンエフェクト表示時間 |
| `LASER_RANGE` | 20 | レーザー射程（アフィンパラメータ λ の上限、c=1 で座標時間=空間距離） |
| `LASER_COOLDOWN` | 100 ms | レーザー連射間隔 |
| `HIT_RADIUS` | 0.5 | 当たり判定の半径 |
| `MAX_LASERS` | 1000 | レーザー保持上限 |
| `MAX_FROZEN_WORLDLINES` | 20 | 凍結世界線の保持上限（世界オブジェクト） |
| `MAX_DEBRIS` | 20 | デブリの保持上限（世界オブジェクト） |
| `EXPLOSION_PARTICLE_COUNT` | 30 | デブリパーティクル数 |

| パラメータ（コード内） | 値 | 説明 |
|---|---|---|
| `MAX_WORLDLINE_HISTORY` | 5000 | 世界線のサンプル数上限（`constants.ts`、`worldLine.ts` 内部名は `maxHistorySize`） |
| 加速度 | 0.8 c/s | `8 / 10` |
| 摩擦係数 | 0.5 | 速度に比例する減速 |
| カメラ距離 | 正射影: 100, 透視: 15 | |
| カメラ回転速度 | yaw: 0.8 rad/s, pitch: 0.5 rad/s | |
| カメラ仰角範囲 | ±89.9° | |
| ビーム opacity | 0.4 | レーザー世界線の透明度 |
| デブリ opacity | 0.10 | デブリ世界線の透明度（InstancedMesh シリンダー、レーザーより薄く区別） |
| 光円錐高さ | 40 | 描画上の円錐サイズ |
| デブリ速度 | 被撃破機の固有速度 + kick 0.1〜1.0 | 固有速度空間で加算後 3速度に正規化（\|v\|<1 自動保証） |
| `TUBE_REGEN_INTERVAL` | 8 | TubeGeometry 再生成の間引き（version を 8 で量子化） |
| ゲームループ | 8 ms interval | `setInterval`（タブ非アクティブ対応） |
| dτ 上限 | 100 ms | タブ復帰時の巨大ジャンプ防止 |

| タッチパラメータ（`touchInput.ts`） | 値 | 説明 |
|---|---|---|
| `DOUBLE_TAP_INTERVAL` | 300 ms | ダブルタップ判定の最大間隔 |
| `DOUBLE_TAP_DISTANCE` | 30 px | ダブルタップ判定の最大距離 |
| `SWIPE_SENSITIVITY` | 0.008 rad/px | スワイプ → yaw/pitch 回転の感度（両軸共通） |
| `THRUST_SENSITIVITY_Y` | 0.015 /px | 縦変位 → thrust の感度（67px で最大推力） |

| エネルギーパラメータ（`constants.ts`） | 値 | 説明 |
|---|---|---|
| `ENERGY_MAX` | 1.0 | エネルギー満タン値 |
| `ENERGY_PER_SHOT` | 1/30 ≈ 0.033 | 1 発あたりの消費。30 発で枯渇（≈3 秒連射） |
| `ENERGY_RECOVERY_RATE` | 1/6 ≈ 0.167/s | 6 秒で 0→満タン。撃っていないときのみ回復 |

### Relay サーバーセキュリティ（`relay-server/server.mjs`）

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | WebSocket ping 送信間隔（サーバー→クライアント） |
| `HEARTBEAT_TIMEOUT_MS` | 10s | WebSocket pong 応答タイムアウト |

注: 上記は **relay server の WebSocket レベル heartbeat**。ゲームクライアントのホスト切断検知は別の仕組み（`PeerProvider` の `ping` メッセージ: 3 秒間隔、8 秒タイムアウト）。

### ビルド設定

- Vite + React 19 + TypeScript 5.8 + three.js + R3F
- Biome (linter/formatter): ダブルクォート、2スペースインデント
- `__BUILD_TIME__` — Vite define でビルド時刻を埋め込み（HUD 表示）
- base path: `/LorentzArena/`（GitHub Pages）

## 参照ドキュメント

- `DESIGN.md` — 設計判断の記録（このディレクトリ内）
- `../CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md`（symlink）
- `../docs/NETWORKING.md` — ネットワーク設定の詳細
- `relay-deploy/README.md` — WS Relay 本番デプロイ手順
