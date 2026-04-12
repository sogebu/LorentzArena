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
| A / D | Move left / right |
| Arrow Left / Right | Rotate camera horizontally |
| Arrow Up / Down | Rotate camera vertically |
| Space | Fire laser |

Mobile: horizontal swipe for heading, vertical displacement for thrust, double-tap to fire.

### Features

- **Relativistic physics**: Lorentz contraction, time dilation, proper time
- **Past light cone rendering**: you see where things *were*, not where they *are*
- **Laser combat**: instant kill on hit, energy management (30 shots to depletion, 6s full recovery), 10-second respawn delay
- **Kill score** with causal-delay notifications (fired when the kill event enters your past light cone)
- **Host migration**: automatic recovery when the host disconnects (heartbeat-based detection, deterministic election)
- **Lighthouse AI turret**: stationary NPC with relativistic aiming -- perfect against inertial targets, dodgeable by accelerating
- **Rest frame / world frame toggle**: view the spacetime diagram in your own rest frame or the global frame
- **Orthographic / perspective camera**: orthographic preserves 45-degree light cone angles at all distances
- **Persistent debris**: death events produce debris particles with timelike worldlines, rendered with past light cone intersection markers
- **World line history**: severed on death, past lives preserved (up to 20)
- **Deterministic per-player colors**: join-order-based golden-angle hue separation, with hash-based fallback. No network sync needed
- **Auto-connect**: PeerJS signaling server's duplicate-ID detection used as room discovery

### Networking

- Multiplayer uses PeerJS/WebRTC by default.
- For restrictive networks (school/enterprise), **Cloudflare TURN** is the recommended first fix -- set `VITE_TURN_CREDENTIAL_URL` to a Cloudflare Worker endpoint. See `docs/NETWORKING.md`.
- If P2P is completely blocked, use **WS Relay mode** (client-server relay).

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
| A / D | 左右移動 |
| 矢印 左/右 | カメラ水平回転 |
| 矢印 上/下 | カメラ上下回転 |
| Space | レーザー発射 |

モバイル: 横スワイプで方向転換、縦変位で推力、ダブルタップで射撃。

### 主な特徴

- **相対論的物理**: ローレンツ収縮、時間膨張、固有時間
- **過去光円錐に基づく描画**: 「今どこにあるか」ではなく「光が届く範囲」を見る
- **レーザー戦闘**: 当たれば即死、エネルギー制（30 発で枯渇、6 秒で全回復）、10 秒後にリスポーン
- **キルスコア** + 因果律遅延通知（キルイベントが過去光円錐に入った瞬間に発火）
- **ホストマイグレーション**: ホスト切断時に自動引き継ぎ（ハートビート検知、決定論的選出）
- **Lighthouse AI 固定砲台**: 相対論的照準で慣性運動する敵には必中、加速で回避可能
- **静止系/世界系の切替**: 自分の静止系と世界系の時空図を切り替え
- **正射影/透視投影カメラ**: 正射影なら全距離で光円錐が正確に 45 度
- **永続デブリ**: 死亡時のデブリが世界線として残り、過去光円錐交差マーカーで可視化
- **世界線の切断**: 死亡で世界線が切れ、過去の命は別表示（最大 20 本保持）
- **決定的プレイヤー色**: 接続順 × 黄金角で色相分離。ハッシュベースのフォールバック付き。ネットワーク同期不要
- **自動接続**: PeerJS シグナリングサーバーの ID 重複検出を部屋発見に利用

### 通信

- PeerJS/WebRTC を使用（デフォルト）
- 制約の厳しいネットワーク（学校・企業）では **Cloudflare TURN** が推奨。`VITE_TURN_CREDENTIAL_URL` に Worker URL を設定。詳細: `docs/NETWORKING.ja.md`
- P2P が完全に塞がれる場合は **WS Relay モード**（クライアント・サーバ中継）を使用

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
