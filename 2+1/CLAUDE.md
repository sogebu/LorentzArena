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

### ローカルプレビュー

- **マルチプレイテスト**: 同じ URL を複数タブで開く。ルーム分離は `#room=<名前>` で可能
- **GitHub Pages と ID 衝突回避**: 本番（sogebu.github.io）がルーム `default` を使っているので、localhost テスト時は `#room=test` 等の別ルーム名を使うこと。同じルーム名だと PeerJS ID `la-default` が取られて接続不能になる
- **preview_start 使用時**: launch.json の `lorentz-arena` を使う。起動後は必ず localhost URL をリンクで出力する（`~/Claude/CLAUDE.md` 規約）。ポートが変わる場合があるのでサーバーログで確認

### ネットワーク設定

`.env.local`（この `2+1/` 直下）で設定:

```bash
VITE_NETWORK_TRANSPORT=auto    # peerjs | wsrelay | auto
VITE_WS_RELAY_URL=             # WS Relay 用 URL
VITE_PEERJS_HOST=0.peerjs.com  # PeerServer ホスト
VITE_WEBRTC_ICE_SERVERS=       # JSON 配列 (RTCIceServer[])。学校 Wi-Fi 突破は公開 TURN がここ
VITE_WEBRTC_ICE_TRANSPORT_POLICY=  # "all" | "relay"
```

学校・企業ネットワークで P2P が塞がれる場合の最小コスト解は `VITE_WEBRTC_ICE_SERVERS` に Open Relay の公開 TURN を入れる（A'）。`.env.example` にコメント済み、詳細は `docs/NETWORKING.ja.md`。

詳細: `../docs/NETWORKING.ja.md`, `relay-deploy/README.md`

## アーキテクチャ

### 物理エンジン (`src/physics/`)

- `vector.ts` — 3D/4D ベクトル演算、ミンコフスキー内積 (+,+,+,-)
- `matrix.ts` — 4x4 ローレンツ変換行列
- `mechanics.ts` — 相対論的運動方程式、phase space (4元位置 + 4元速度)
- `worldLine.ts` — 世界線の離散履歴、過去光円錐交差計算、`origin` フィールドで半直線延長、`version` カウンターで描画スロットリング

単位系: c = 1。ファクトリパターン（クラス不使用）。

### ネットワーク (`src/services/`, `src/contexts/`)

- `PeerManager.ts` — PeerJS/WebRTC ラッパー
- `WsRelayManager.ts` — WebSocket Relay フォールバック
- `PeerProvider.tsx` — 自動接続: ルーム ID でホスト試行 → 失敗時クライアント接続。ホストリレー前に `isRelayable()` でバリデーション

自動接続フロー: ページを開くだけで同じルームに入る。`#room=name` で部屋分離。

### ゲーム (`src/components/`)

`RelativisticGame.tsx` がオーケストレーター。ゲームロジックのモジュールは `game/` サブディレクトリに分離:

| ファイル | 内容 |
|---|---|
| `RelativisticGame.tsx` | state/ref 管理、ゲームループ、Canvas 配置 |
| `game/types.ts` | ゲーム固有型定義（`RelativisticPlayer`, `Laser` 等） |
| `game/constants.ts` | ゲーム定数（射程、リスポーン遅延、スポーン範囲等） |
| `game/colors.ts` | プレイヤー色生成（`colorForPlayerId(id)` 純関数、ID ハッシュ + 黄金角） |
| `game/threeCache.ts` | THREE.js ジオメトリ/マテリアル singleton + デブリマテリアルキャッシュ |
| `game/displayTransform.ts` | ローレンツ変換 → 表示座標変換 |
| `game/laserPhysics.ts` | レーザー当たり判定 + 光円錐交差 |
| `game/debris.ts` | デブリ生成 + 光円錐交差 |
| `game/killRespawn.ts` | `applyKill`/`applyRespawn` 純粋関数（ホスト/クライアント共通） |
| `game/SceneContent.tsx` | 3Dシーン（WorldLine/Laser/Spawn/DebrisRenderer 含む） |
| `game/messageHandler.ts` | ネットワークメッセージ処理（ファクトリ関数、バリデーション付き） |
| `game/HUD.tsx` | オーバーレイUI（コントロール、スピードメーター、キル通知、死亡カウントダウン） |

主要機能:
- W/S: 加速/減速、矢印: カメラ回転、Space: レーザー発射
- 正射影/透視投影カメラ切替
- 自分の静止系/世界系表示切替
- 当たり判定（ホスト権威、`findLaserHitPosition`）
- Kill/Respawn: kill → 世界線を `frozenWorldLines` に移動 + デブリ生成 → ゴースト（DeathEvent ベース等速直線）→ 10秒後リスポーン（新 WorldLine）
- 世界オブジェクト分離: 死亡で生まれるオブジェクト（凍結世界線、デブリ、ゴースト）はプレイヤーから独立した state。レーザーも同様
- 死亡の設計哲学: 凍結世界線・デブリは世界オブジェクトとして独立描画。過去光円錐交差で自然に可視性が決まる
- 死亡状態管理: `isDead` フラグ + `DeathEvent`（ゴーストカメラの決定論的計算）。`handleKill`/`handleRespawn` コールバックで一元化
- ゴースト UI: 死亡中は青白い半透明オーバーレイ + DEAD カウントダウン。カメラ回転は可能
- キルスコア + キル通知エフェクト（因果律遅延: 過去光円錐到達時に発火）
- 永続デブリ: 死亡イベントからの等速直線運動パーティクル。lineSegments でバッチ描画。マーカーは過去光円錐交差で表示（maxLambda は固定値、observer 非依存）
- 世界線管理: `player.worldLine` 1本のみ。過去のライフは `frozenWorldLines[]` に格納
- 世界線の過去延長: `WorldLine.origin` で制御。最初のライフのみ origin から半直線延長
- プレイヤー色は `colorForPlayerId(id)` で決定的に算出（純関数、ネットワーク同期不要）。詳細は DESIGN.md「色割り当て: 決定的純関数」
- 因果律の守護者: 他プレイヤーの未来光円錐内で操作凍結。死亡プレイヤーは除外（DESIGN.md 参照）
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
| `peerList` | host → client | 接続ピア一覧 |
| `requestPeerList` | client → host | ピア一覧要求 |

**色は同期しない**: `playerColor` メッセージは 2026-04-06 に廃止。全ピアが `colorForPlayerId(id)` で同じ色を決定論的に算出するため、ネットワーク同期不要。詳細: DESIGN.md「色割り当て: 決定的純関数」

ホスト権威メッセージ（kill, respawn, score）: ホストはゲームループで処理済みのため messageHandler でスキップ（二重処理防止）。

メッセージバリデーション: `messageHandler.ts` で全メッセージに `isFiniteNumber`/`isValidVector4`/`isValidVector3`/`isValidColor`/`isValidString` のランタイム検証を実施。laser range は `0 < range <= 100`、score は全エントリ検証。

### ゲームパラメータ（`game/constants.ts`）

| パラメータ | 値 | 説明 |
|---|---|---|
| `SPAWN_RANGE` | 30 | スポーン範囲 x,y ∈ [0, SPAWN_RANGE] |
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
| `maxHistorySize` | 5000 | 世界線のサンプル数上限（`worldLine.ts`） |
| 加速度 | 0.8 c/s | `8 / 10` |
| 摩擦係数 | 0.5 | 速度に比例する減速 |
| カメラ距離 | 正射影: 100, 透視: 15 | |
| カメラ回転速度 | yaw: 0.8 rad/s, pitch: 0.5 rad/s | |
| カメラ仰角範囲 | ±89.9° | |
| ビーム opacity | 0.4 | レーザー世界線の透明度 |
| 光円錐高さ | 40 | 描画上の円錐サイズ |
| デブリ速度 | 0.2c〜0.9c | ランダム方向 |
| `TUBE_REGEN_INTERVAL` | 8 | TubeGeometry 再生成の間引き（version を 8 で量子化） |
| ゲームループ | 8 ms interval | `setInterval`（タブ非アクティブ対応） |
| dτ 上限 | 100 ms | タブ復帰時の巨大ジャンプ防止 |

### Relay サーバーセキュリティ（`relay-server/server.mjs`）

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | ping 送信間隔 |
| `HEARTBEAT_TIMEOUT_MS` | 10s | pong 応答タイムアウト |

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
