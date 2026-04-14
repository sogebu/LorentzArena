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

---

### Relativistic algorithms

Everything in this game is governed by special relativity with c = 1 and Minkowski metric (+,+,+,-). Below is how each core mechanic works.

#### Past light cone rendering

You don't see where things *are* -- you see where light from them can reach you. For each object, we find where the observer's past light cone intersects the object's world line.

Given an observer at spacetime position O and a world line segment X(lambda) = P + lambda * Delta (lambda in [0,1]), the intersection satisfies:

```
eta(O - X, O - X) = 0    (null separation, on the light cone)
O_t > X_t                 (in the observer's past, not future)
```

where eta is the Minkowski inner product eta(A, B) = A_x*B_x + A_y*B_y + A_z*B_z - A_t*B_t.

Substituting X(lambda) and expanding yields a quadratic in lambda:

```
a*lambda^2 + b*lambda + c = 0

a = eta(Delta, Delta)
b = -2 * eta(O - P, Delta)
c = eta(O - P, O - P)
```

We solve for lambda in [0,1], keep solutions in the observer's past, and pick the latest one (closest to "now"). This solver (`pastLightConeIntersectionSegment` in `physics/vector.ts`) is the shared foundation for rendering world lines, lasers, and debris.

For a full world line (a chain of segments), we binary-search by time to find the relevant segment range, then walk backward from newest to oldest, solving the quadratic at each step. Early exit when both endpoints are in the observer's future.

#### Laser hit detection

A laser is a lightlike world line: L(lambda) = E + lambda * (d_x, d_y, 0, 1), where E is the emission event, (d_x, d_y) is the spatial direction (|d| = 1 because c = 1), and lambda in [0, range].

To test whether a laser hits a player, we check each segment W(mu) = P1 + mu * (P2 - P1) of the target's world line. At time t = P1_t + mu * dT, the laser has reached lambda = t - E_t. The spatial distance between the laser and the world line at that instant is:

```
dist^2 = (E_x + d_x*lambda - W_x(mu))^2 + (E_y + d_y*lambda - W_y(mu))^2
```

We minimize this over mu by differentiation (critical point mu* = -(a*A + b*B) / (a^2 + b^2)), check endpoints mu=0 and mu=1, and report a hit when the distance falls within the hit radius. The host runs this authoritatively.

#### Causality guard

If player B is inside player A's future light cone, then A acting on information about B's current position would constitute superluminal information transfer. The game enforces this: your controls freeze when another living player is in your future light cone.

The check is a single Lorentz dot product per player pair per frame:

```
diff = B.pos - A.pos
if eta(diff, diff) < 0 and B.t < A.t:
    freeze A's controls
```

This means diff is timelike and B is in A's past -- equivalently, A is in B's future light cone, so A has already "seen" B and must not act on newer information. In practice, this feels like a brief lag when you boost to high speed, which is physically natural: time dilation means you've jumped ahead relative to others.

Dead and stale-frozen players are excluded from the guard (a dead player cannot "send" information, so there is no causal violation).

#### Causal-delay notifications

Kill and spawn events are not displayed immediately. Instead, they're queued and checked each frame:

```
if isInPastLightCone(eventPos, observerPos):
    fire the notification
```

where `isInPastLightCone(event, observer)` = eta(event - observer, event - observer) <= 0 AND observer_t > event_t.

This means you see an explosion when (and only when) light from it reaches you. Your own kill/spawn is displayed instantly (the event is at your location, so the light cone condition is trivially satisfied).

#### Lighthouse AI: relativistic intercept

The Lighthouse is a stationary turret that solves the relativistic intercept problem. Given:
- Turret at position P_t
- Enemy last observed on the past light cone at position p_e with 4-velocity u^mu = (gamma, gamma*v_x, gamma*v_y, 0)

The enemy's inertial world line is p(tau) = p_e + u^mu * tau. We need the intercept point to lie on the turret's future light cone:

```
(t_intercept - T)^2 = (x_intercept - X_t)^2 + (y_intercept - Y_t)^2
```

Substituting the enemy trajectory gives a quadratic in tau:

```
a = u_t^2 - u_x^2 - u_y^2    (= 1 by mass shell: u^mu * u_mu = -1)
b = 2*(dt*u_t - dx*u_x - dy*u_y)
c = dt^2 - dx^2 - dy^2
```

where (dt, dx, dy) = p_e - P_t. The smallest positive root gives the intercept proper time. The laser direction is then the normalized spatial displacement to the intercept point.

Because the quadratic coefficient a = 1 (mass-shell condition), the equation always has real roots when the enemy is visible. The result: a laser aimed at the intercept point will hit any inertially-moving target with certainty. The only way to dodge is to *accelerate* after the turret observes you, invalidating its inertial prediction.

#### Rest frame view (Lorentz boost)

Toggling "rest frame" applies a Lorentz boost to the entire scene, transforming all world lines into the player's instantaneous rest frame. The boost matrix for spatial 4-velocity u = (u_x, u_y, u_z) is:

```
Lambda^0_0 = gamma
Lambda^0_i = Lambda^i_0 = -u_i
Lambda^i_j = delta_ij + (gamma - 1) * u_i * u_j / |u|^2
```

where gamma = sqrt(1 + |u|^2). This is applied as a THREE.js Matrix4 transformation to the scene group, so all geometry is transformed in the GPU without recomputing world line data.

---

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
- **Lighthouse AI 固定砲台**: 相対論的照準 + 照準ジッタ (`LIGHTHOUSE_AIM_JITTER_SIGMA`) — 距離に応じて当たる／外れる、加速で回避可能
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

---

### 相対論的アルゴリズム

ミンコフスキー計量 (+,+,+,-), c = 1 で統一。以下が各メカニクスの仕組み。

#### 過去光円錐による描画

プレイヤーが見るのは「今の位置」ではなく「光が届く範囲」。各オブジェクトについて、観測者の過去光円錐が世界線と交わる点を求める。

観測者が時空位置 O にいるとき、世界線セグメント X(lambda) = P + lambda * Delta (lambda in [0,1]) との交差条件は:

```
eta(O - X, O - X) = 0    (光的分離: 光円錐上)
O_t > X_t                (過去側)
```

eta はミンコフスキー内積 eta(A, B) = A_x*B_x + A_y*B_y + A_z*B_z - A_t*B_t。

X(lambda) を代入して展開すると lambda の二次方程式:

```
a*lambda^2 + b*lambda + c = 0

a = eta(Delta, Delta)
b = -2 * eta(O - P, Delta)
c = eta(O - P, O - P)
```

lambda in [0,1] の解のうち、観測者の過去にあって最も未来側のものを採用する。このソルバー (`pastLightConeIntersectionSegment`) が世界線・レーザー・デブリの描画すべての共通基盤。

#### レーザー当たり判定

レーザーは光的世界線: L(lambda) = E + lambda * (d_x, d_y, 0, 1)。E は発射イベント、(d_x, d_y) は空間方向（|d| = 1, c = 1）、lambda in [0, range]。

ターゲット世界線の各セグメント W(mu) = P1 + mu * (P2 - P1) について、同一時刻でのレーザーとの空間距離を計算:

```
dist^2 = (E_x + d_x*lambda - W_x(mu))^2 + (E_y + d_y*lambda - W_y(mu))^2
```

mu で微分して最小値 mu* = -(a*A + b*B) / (a^2 + b^2) を求め、端点 mu=0, 1 も確認。距離が当たり判定半径以内ならヒット。ホストが権威的に判定する。

#### 因果律ガード

プレイヤー B がプレイヤー A の未来光円錐の内側にいるとき、A が B の現在位置に基づいて行動すると超光速情報伝達になる。ゲームはこれを強制する: 他の生存プレイヤーが自分の未来光円錐にいると操作凍結。

判定は毎フレーム、各プレイヤーペアに対して 1 回のローレンツ内積:

```
diff = B.pos - A.pos
eta(diff, diff) < 0 かつ B.t < A.t → A の操作を凍結
```

体感としては、高速にブーストしたときの短い「ラグ」。物理的にも自然（時間膨張で相対的に「先に進んだ」ため）。死亡プレイヤーと stale プレイヤーはガードから除外。

#### 因果律遅延通知

キル・スポーンイベントは即座に表示されない。毎フレーム:

```
isInPastLightCone(eventPos, observerPos) → 通知発火
```

光がその場所から観測者に届いた瞬間にのみ爆発が見える。自分のキル/スポーンは即時（イベントが自分の位置にあるため光円錐条件が自明に成立）。

#### Lighthouse AI: 相対論的迎撃

Lighthouse は固定砲台。相対論的迎撃問題を解く:
- 砲台位置 P_t
- 敵は過去光円錐上で観測: 位置 p_e、4 元速度 u^mu = (gamma, gamma*v_x, gamma*v_y, 0)

敵の慣性運動世界線 p(tau) = p_e + u^mu * tau が砲台の未来光円錐と交わる条件:

```
(t_intercept - T)^2 = (x_intercept - X_t)^2 + (y_intercept - Y_t)^2
```

これを tau の二次方程式に展開:

```
a = u_t^2 - u_x^2 - u_y^2    (= 1、質量殻条件 u^mu * u_mu = -1)
b = 2*(dt*u_t - dx*u_x - dy*u_y)
c = dt^2 - dx^2 - dy^2
```

最小の正の根が迎撃固有時間。レーザー方向は迎撃点への正規化変位。

二次方程式の係数 a = 1（質量殻条件）なので、敵が可視である限り常に実根が存在する。結果: 慣性運動するターゲットは確実に命中する。唯一の回避法は、砲台が観測した **後** に加速して慣性予測を無効化すること。

#### 静止系表示（ローレンツブースト）

「静止系」切替で、プレイヤーの瞬間静止系へのローレンツブーストをシーン全体に適用。空間 4 元速度 u = (u_x, u_y, u_z) に対するブースト行列:

```
Lambda^0_0 = gamma
Lambda^0_i = Lambda^i_0 = -u_i
Lambda^i_j = delta_ij + (gamma - 1) * u_i * u_j / |u|^2
```

gamma = sqrt(1 + |u|^2)。THREE.js の Matrix4 変換としてシーングループに適用し、世界線データの再計算なしに GPU 上で変換。
