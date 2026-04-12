# Lorentz Arena

**Also available in: [Japanese](#japanese)**

Lorentz Arena is a multiplayer arena game where **special relativity is a gameplay mechanic**.

Players move at relativistic speeds, fire lasers, and see everything through their past light cone. The game renders a 2+1 dimensional spacetime diagram in real-time with three.js. What you see is not “where things are”, but “where light from them can reach you”.

Features:
- Relativistic physics: Lorentz contraction, time dilation, light cone rendering
- Laser combat with energy management (instant kill, 10s respawn)
- WASD movement + arrow keys for camera rotation
- Mobile touch controls (swipe + double-tap)
- Automatic room joining (just open the URL)
- Host migration (seamless recovery when the host disconnects)
- Lighthouse AI turret (relativistic aiming, perfect against inertial targets)
- Rest frame / world frame toggle
- Orthographic / perspective camera toggle
- Persistent debris worldlines with past light cone intersection markers
- Kill score with causal-delay notifications (fired when the kill enters your past light cone)

> **The `2+1/` app is the actively developed main game.** The root app is an earlier 1+1 prototype that is no longer maintained.

This repository contains two front-end apps:

- **`2+1/`** (main): 2+1 spacetime arena (x-y-t) using `three.js` / `@react-three/fiber`
- **Root app** (legacy): 1+1 spacetime diagram renderer (x-t)

### Live demo

GitHub Pages (default):

- https://sogebu.github.io/LorentzArena/

> Note: only one app can be deployed to GitHub Pages at a time with the current repo layout (the `deploy` script publishes a single `dist/`).

### Quick start

Requirements:

- Node.js 18+ recommended
- pnpm (or npm)

Root app:

```bash
pnpm install
pnpm dev
```

2+1 app:

```bash
cd 2+1
pnpm install
pnpm dev
```

2+1 app (relay one-command start):

```bash
cd 2+1
pnpm install
pnpm dev:wsrelay
```

### Networking (important)

Networking supports:

- **PeerJS/WebRTC (P2P)** via PeerJS
- **WS Relay mode** (client-server relay; useful on restrictive networks)

That means:

- With PeerJS: you need a signaling server (PeerServer) and possibly TURN on restrictive networks.
- With WS Relay mode: gameplay messages are relayed through a WebSocket server.

If multiplayer works at home but fails at school, read:

- `docs/NETWORKING.md`

### Configuration

The client can be configured via Vite environment variables.

Create `.env.local` (root or `2+1/`) and set values as needed:

```bash
# PeerJS / PeerServer
VITE_PEERJS_HOST=0.peerjs.com
VITE_PEERJS_PORT=443
VITE_PEERJS_PATH=/
VITE_PEERJS_SECURE=true

# WebRTC ICE servers (STUN/TURN). JSON string.
# Example (replace with your own TURN):
VITE_WEBRTC_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":["turns:turn.example.com:443?transport=tcp"],"username":"USER","credential":"PASS"}
]'

# Optional: force relay-only (TURN) if direct P2P is blocked
VITE_WEBRTC_ICE_TRANSPORT_POLICY=relay

# PeerJS debug logs: 0 (none) - 3 (verbose)
VITE_PEERJS_DEBUG=2

# Transport mode: peerjs | wsrelay | auto
# auto = start on PeerJS and fallback to WS Relay on signaling error
VITE_NETWORK_TRANSPORT=auto

# WebSocket relay URL (used when wsrelay mode is selected)
# Example (local):
# VITE_WS_RELAY_URL=ws://localhost:8787
# Example (public 443/TLS):
# VITE_WS_RELAY_URL=wss://relay.example.com
VITE_WS_RELAY_URL=
```

For production relay deployment over `wss://:443`, see:

- `2+1/relay-deploy/README.md`

### Deploy

```bash
pnpm run deploy
```

This publishes `dist/` to the `gh-pages` branch.

### License

MIT

---

<a id="japanese"></a>

## Japanese

Lorentz Arena は、**特殊相対論をゲームの仕組みにした**マルチプレイヤー対戦アリーナです。

相対論的な速度で動き、レーザーを撃ち合い、すべてを過去光円錐を通して見る。見えているのは「今そこにある位置」ではなく「光が届く範囲」です。

主な特徴:
- 相対論的物理: ローレンツ収縮、時間膨張、光円錐描画
- レーザー戦闘（エネルギー制、即死 + 10 秒リスポーン）
- WASD 移動 + 矢印キーでカメラ回転
- モバイルタッチ操作（スワイプ + ダブルタップ）
- 自動接続（URL を開くだけで同じ部屋に参加）
- ホストマイグレーション（ホスト切断時に自動引き継ぎ）
- Lighthouse AI 固定砲台（相対論的照準、慣性運動する敵には必中）
- 静止系/世界系表示の切替
- 正射影/透視投影カメラの切替
- 永続デブリの世界線 + 過去光円錐交差マーカー
- キルスコア + 因果律遅延通知（キルが過去光円錐に入った瞬間に発火）

> **`2+1/` がアクティブに開発中のメインゲームです。** ルートのアプリは初期の 1+1 プロトタイプで、現在はメンテナンスされていません。

このリポジトリには 2 つのフロントエンドアプリが入っています。

- **`2+1/`**（メイン）: 2+1 次元の時空図アリーナ（x-y-t）（`three.js` / `@react-three/fiber`）
- **ルート（root）**（レガシー）: 1+1 次元の時空図（x-t）スタイル

### デモ

GitHub Pages（標準）：

- https://sogebu.github.io/LorentzArena/

> 注意: 現状の構成だと、GitHub Pages に同時に複数アプリは出せません（`deploy` は単一の `dist/` を公開します）。

### 起動方法

必要なもの:

- Node.js 18+ 推奨
- pnpm（または npm）

ルート（root）:

```bash
pnpm install
pnpm dev
```

2+1:

```bash
cd 2+1
pnpm install
pnpm dev
```

2+1（relay を同時起動する1コマンド）:

```bash
cd 2+1
pnpm install
pnpm dev:wsrelay
```

### 通信まわり（重要）

通信方式は次の2つに対応しています。

- **PeerJS/WebRTC の P2P**
- **WS Relay モード**（クライアント・サーバ中継、制限ネットワーク向け）

つまり:

- PeerJS 方式では「シグナリングサーバ（PeerServer）」が必要で、環境によっては TURN が必要
- WS Relay 方式では WebSocket サーバ経由でゲーム通信を中継

家だと動くのに学校・企業ネットワークだと動かない場合は、まずここを読んでください。

- `docs/NETWORKING.ja.md`

### 設定

Vite の環境変数でクライアント設定を差し替えられます。

`.env.local`（ルート or `2+1/`）を作って必要に応じて設定してください。

```bash
# PeerJS / PeerServer
VITE_PEERJS_HOST=0.peerjs.com
VITE_PEERJS_PORT=443
VITE_PEERJS_PATH=/
VITE_PEERJS_SECURE=true

# WebRTC ICE サーバ（STUN/TURN）。JSON 文字列。
# 例（TURN は自前に置き換えてください）
VITE_WEBRTC_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":["turns:turn.example.com:443?transport=tcp"],"username":"USER","credential":"PASS"}
]'

# 直P2P が塞がれている環境では relay 固定（TURN 強制）も有効
VITE_WEBRTC_ICE_TRANSPORT_POLICY=relay

# PeerJS のデバッグログ: 0（なし）〜 3（詳細）
VITE_PEERJS_DEBUG=2

# 通信方式: peerjs | wsrelay | auto
# auto = PeerJS で開始し、シグナリング失敗時に WS Relay へ自動切替
VITE_NETWORK_TRANSPORT=auto

# WS Relay 用 URL（wsrelay モード時に使用）
# 例（ローカル）:
# VITE_WS_RELAY_URL=ws://localhost:8787
# 例（公開/TLS 443）:
# VITE_WS_RELAY_URL=wss://relay.example.com
VITE_WS_RELAY_URL=
```

公開 relay を `wss://:443` で立てる場合は以下を参照:

- `2+1/relay-deploy/README.md`

### デプロイ

```bash
pnpm run deploy
```

`dist/` を `gh-pages` ブランチへ公開します。

### ライセンス

MIT
