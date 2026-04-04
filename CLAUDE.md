# CLAUDE.md — LorentzArena

Claude Code 作業マニュアル。全リポ共通の規約は `CONVENTIONS.md`（claude-config の symlink）を参照。

## プロジェクト構成

2つのフロントエンドアプリで構成:

| ディレクトリ | 内容 | 時空次元 |
|---|---|---|
| `/` (root) | 1+1 時空図レンダラー (x-t) | 1+1 |
| `/2+1/` | 2+1 時空図アリーナ (x-y-t)、three.js + R3F | 2+1 |

GitHub Pages デプロイは `2+1/` が本番（`cd 2+1 && pnpm run deploy`）。
デプロイ後は必ずリンクを出力すること: https://sogebu.github.io/LorentzArena/

## コマンド

### ルート (1+1)

```bash
pnpm install && pnpm dev       # 開発サーバー
pnpm run build                 # ビルド
```

### 2+1（メイン）

```bash
cd 2+1
pnpm install && pnpm dev       # PeerJS モード
pnpm dev:wsrelay               # WS Relay モード（relay-server 同時起動）
pnpm run deploy                # GitHub Pages デプロイ
pnpm run lint                  # Biome linter
pnpm run format                # Biome formatter
pnpm run analyze               # バンドルサイズ分析
```

### ネットワーク設定

`.env.local`（`2+1/` 直下）で設定:

```bash
VITE_NETWORK_TRANSPORT=auto    # peerjs | wsrelay | auto
VITE_WS_RELAY_URL=             # WS Relay 用 URL
VITE_PEERJS_HOST=0.peerjs.com  # PeerServer ホスト
```

詳細: `docs/NETWORKING.md`, `2+1/relay-deploy/README.md`

## アーキテクチャ (2+1)

### 物理エンジン (`2+1/src/physics/`)

- `vector.ts` — 3D/4D ベクトル演算、ミンコフスキー内積 (+,+,+,-)
- `matrix.ts` — 4x4 ローレンツ変換行列
- `mechanics.ts` — 相対論的運動方程式、phase space (4元位置 + 4元速度)
- `worldLine.ts` — 世界線の離散履歴、過去光円錐交差計算

単位系: c = 1。ファクトリパターン（クラス不使用）。

### ネットワーク (`2+1/src/services/`, `2+1/src/contexts/`)

- `PeerManager.ts` — PeerJS/WebRTC ラッパー
- `WsRelayManager.ts` — WebSocket Relay フォールバック
- `PeerProvider.tsx` — 自動接続: ルーム ID でホスト試行 → 失敗時クライアント接続

自動接続フロー: ページを開くだけで同じルームに入る。`#room=name` で部屋分離。

### ゲーム (`2+1/src/components/RelativisticGame.tsx`)

主要機能:
- W/S: 加速/減速、矢印: カメラ回転、Space: レーザー発射
- 正射影/透視投影カメラ切替
- 自分の静止系/世界系表示切替
- 当たり判定（ホスト権威、`findLaserHitPosition`）
- 即死 → 1秒後リスポーン（ホストの世界系 t に同期）
- キルスコア + キル通知エフェクト
- 永続デブリ（死亡イベントからの等速直線運動パーティクル、過去光円錐交差マーカー）
- 世界線管理: `lives: WorldLine[]` で全ライフを管理。kill で新 life を追加、respawn で最初の点を設定
- 世界線の過去延長: origin から半直線を過去方向に延長（最初のライフのみ）
- ホストによる色割り当て（`playerColor` メッセージで全クライアントに配信）
- 因果律の守護者: 他プレイヤーの未来光円錐の内側にいる間、全操作を凍結（DESIGN.md 参照）

### メッセージタイプ (`2+1/src/types/message.ts`)

| type | 方向 | 用途 |
|---|---|---|
| `phaseSpace` | 双方向（host 中継） | 4元位置+速度の同期 |
| `laser` | 双方向（host 中継） | レーザー発射イベント |
| `syncTime` | host → client | 世界系時刻同期 |
| `kill` | host → all | キル通知（hitPos 付き） |
| `respawn` | host → all | リスポーン位置指示 |
| `score` | host → all | スコア更新 |
| `playerColor` | host → all | 色割り当て |
| `peerList` | host → client | 接続ピア一覧 |

### ゲームパラメータ（`RelativisticGame.tsx`）

| パラメータ | 値 | 説明 |
|---|---|---|
| 初期位置 | x,y ∈ [0, 30] | `Math.random() * 30` |
| リスポーン位置 | x,y ∈ [0, 30] | 同上 |
| `RESPAWN_DELAY` | 1000 ms | 死亡→リスポーンの待機時間 |
| `SPAWN_EFFECT_DURATION` | 1500 ms | スポーンエフェクト表示時間 |
| `LASER_RANGE` | 20 | レーザー射程（c=1 単位） |
| `HIT_RADIUS` | 0.5 | 当たり判定の半径 |
| `MAX_LASERS` | 1000 | レーザー保持上限 |
| `MAX_PAST_WORLDLINES` | 5 | ライフ数上限（`lives[]` の最大長） |
| `maxHistorySize` | 5000 | 世界線のサンプル数上限（`worldLine.ts`） |
| 加速度 | 0.8 c/s | `8 / 10` |
| 摩擦係数 | 0.5 | 速度に比例する減速 |
| レーザークールダウン | 100 ms | 連射制限 |
| カメラ距離 | 正射影: 100, 透視: 15 | |
| カメラ回転速度 | yaw: 0.8 rad/s, pitch: 0.5 rad/s | |
| カメラ仰角範囲 | ±89.9° | |
| ビーム opacity | 0.4 | レーザー世界線の透明度 |
| 光円錐高さ | 40 | 描画上の円錐サイズ |
| デブリ速度 | 0.2c〜0.9c | パーティクル30個、ランダム方向 |
| ゲームループ | 8 ms interval | `setInterval`（タブ非アクティブ対応） |
| dτ 上限 | 100 ms | タブ復帰時の巨大ジャンプ防止 |

### ビルド設定

- Vite + React 19 + TypeScript 5.8 + three.js + R3F
- Biome (linter/formatter): ダブルクォート、2スペースインデント
- `__BUILD_TIME__` — Vite define でビルド時刻を埋め込み（HUD 表示）
- base path: `/LorentzArena/`（GitHub Pages）

## 参照ドキュメント

- `DESIGN.md` — 設計判断の記録（正本）
- `CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md`（symlink）
- `docs/NETWORKING.md` — ネットワーク設定の詳細
- `2+1/relay-deploy/README.md` — WS Relay 本番デプロイ手順
