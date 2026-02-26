# Lorentz Arena 2+1

[English](#english) | [日本語](#日本語)

## English

This folder contains the **2+1 spacetime** version (x, y, t) rendered with `three.js` via `@react-three/fiber`.

Quick start:

```bash
pnpm install
pnpm dev
```

Visualization cues:
- Player colors are generated deterministically from peer IDs (high-separation palette).
- Markers are shown for:
  - intersections of **your past light cone** with other players' world lines
  - intersections of **your past light cone** with other players' laser world-lines

Networking notes:
- Multiplayer uses PeerJS/WebRTC.
- Some networks (school/enterprise) block P2P. In that case use **WS Relay mode**.

### WS Relay mode (for restrictive networks)

0) One-command local start (recommended):

```bash
pnpm dev:wsrelay
```

This starts both relay server and Vite with relay env (`auto` + localhost URL).

1) (First time only) install relay deps:

```bash
pnpm relay:install
```

2) Start relay server:

```bash
pnpm relay:dev
```

3) Create `.env.local`:

```bash
VITE_NETWORK_TRANSPORT=wsrelay
VITE_WS_RELAY_URL=ws://localhost:8787
```

4) Run app:

```bash
pnpm dev
```

`VITE_NETWORK_TRANSPORT=auto` also works. It starts with PeerJS and auto-fallbacks to WS Relay on signaling errors.

For public deployment (`wss://...:443`), see:

- `relay-deploy/README.md`

## 日本語

このフォルダは **2+1 次元（x, y, t）** 版です。`three.js`（@react-three/fiber）で描画します。

起動手順:

```bash
pnpm install
pnpm dev
```

可視化について:
- プレイヤー色は peer ID から決定論的に生成（色分離を強化）。
- 次の交点にマーカーを表示します:
  - **自分の過去光円錐** と他プレイヤー world line の交点
  - **自分の過去光円錐** と他プレイヤー laser world-line の交点

通信について:
- PeerJS/WebRTC を使っています。
- 学校・企業 Wi‑Fi だと P2P が塞がれて動かないことがあります。その場合は **WS Relay モード** を使ってください。

### WS Relay モード（厳しいネットワーク向け）

0) まずは1コマンド起動（推奨）:

```bash
pnpm dev:wsrelay
```

relay サーバと Vite を relay 用 env（`auto` + localhost URL）で同時起動します。

1) （初回のみ）relay 依存をインストール:

```bash
pnpm relay:install
```

2) 中継サーバを起動:

```bash
pnpm relay:dev
```

3) `.env.local` を作成:

```bash
VITE_NETWORK_TRANSPORT=wsrelay
VITE_WS_RELAY_URL=ws://localhost:8787
```

4) アプリ起動:

```bash
pnpm dev
```

`VITE_NETWORK_TRANSPORT=auto` でも動きます。PeerJS で始めて、シグナリング失敗時は WS Relay へ自動切替します。

公開用（`wss://...:443`）の手順は以下:

- `relay-deploy/README.md`
