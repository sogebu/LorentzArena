# Lorentz Arena

[English](#english) | [日本語](#日本語)

---

## English

Lorentz Arena is a small multiplayer arena experiment where **special relativity is a gameplay mechanic**.

Players move at relativistic speeds, and what you see is not “what is now”, but “what can reach you” (past light cone). The result is a game that feels like physics is trolling you… in a mathematically honest way.

This repository contains multiple front-end apps:

- **Root app**: a 1+1 spacetime diagram style renderer (x–t)
- **`2+1/` app**: a 2+1 spacetime diagram renderer (x–y–t) using `three.js` / `@react-three/fiber`

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

## 日本語

Lorentz Arena は、**特殊相対論をゲームの仕組みにした**マルチプレイヤー実験です。

相対論的な速度で動くと、見えているのは「今そこにある位置」ではなく「光が届く範囲（過去光円錐）」になります。物理が素直すぎて、プレイヤー側が混乱するやつです。

このリポジトリには複数のフロントエンドアプリが入っています。

- **ルート（root）**: 1+1 次元の時空図（x–t）スタイル
- **`2+1/`**: 2+1 次元の時空図（x–y–t）スタイル（`three.js` / `@react-three/fiber`）

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

家だと動くのに学校だと動かない場合は、まずここを読んでください。

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
