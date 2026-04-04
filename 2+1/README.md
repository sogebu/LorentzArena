# Lorentz Arena 2+1

**Also available in: [Japanese](#japanese)**

This folder contains the **2+1 spacetime** arena (x, y, t) rendered with `three.js` via `@react-three/fiber`.

### Quick start

```bash
pnpm install
pnpm dev
```

Open the URL in multiple browser tabs to play. No ID sharing needed -- everyone on the same URL joins the same room automatically. Use `#room=name` in the URL for separate rooms.

### Controls

| Key | Action |
|-----|--------|
| W / S | Accelerate forward / backward |
| Arrow Left / Right | Rotate camera horizontally |
| Arrow Up / Down | Rotate camera vertically |
| Space | Fire laser |

### Features

- **Relativistic physics**: Lorentz contraction, time dilation, proper time
- **Past light cone rendering**: you see where things *were*, not where they *are*
- **Laser combat**: instant kill on hit, 10-second respawn delay
- **Kill score** with on-screen notifications
- **Rest frame / world frame toggle**: view the spacetime diagram in your own rest frame or the global frame
- **Orthographic / perspective camera**: orthographic preserves 45-degree light cone angles at all distances
- **Persistent debris**: death events produce debris particles with timelike worldlines, rendered with past light cone intersection markers
- **World line history**: severed on death, past lives preserved (up to 20)
- **Host-assigned colors**: the host picks maximally distinct colors for all players
- **Auto-connect**: PeerJS signaling server's duplicate-ID detection used as room discovery

### Networking

- Multiplayer uses PeerJS/WebRTC by default.
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

<a id="japanese"></a>

## Japanese

このフォルダは **2+1 次元（x, y, t）** の対戦アリーナです。`three.js`（@react-three/fiber）で描画。

### 起動

```bash
pnpm install
pnpm dev
```

ブラウザで複数タブを開くだけで対戦可能。ID の共有は不要（同じ URL を開けば自動で同じ部屋に入る）。`#room=名前` で部屋を分けられる。

### 操作

| キー | 操作 |
|------|------|
| W / S | 加速 / 減速 |
| 矢印 左/右 | カメラ水平回転 |
| 矢印 上/下 | カメラ上下回転 |
| Space | レーザー発射 |

### 主な特徴

- **相対論的物理**: ローレンツ収縮、時間膨張、固有時間
- **過去光円錐に基づく描画**: 「今どこにあるか」ではなく「光が届く範囲」を見る
- **レーザー戦闘**: 当たれば即死、10秒後にリスポーン
- **キルスコア** + 画面通知
- **静止系/世界系の切替**: 自分の静止系と世界系の時空図を切り替え
- **正射影/透視投影カメラ**: 正射影なら全距離で光円錐が正確に45度
- **永続デブリ**: 死亡時のデブリが世界線として残り、過去光円錐交差マーカーで可視化
- **世界線の切断**: 死亡で世界線が切れ、過去の命は別表示（最大20本保持）
- **ホストによる色割り当て**: 全プレイヤーの色相が最大限離れるように自動選択
- **自動接続**: PeerJS シグナリングサーバーの ID 重複検出を部屋発見に利用

### 通信

- PeerJS/WebRTC を使用（デフォルト）
- 学校・企業ネットワークで P2P が塞がれる場合は **WS Relay モード** を使用

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
