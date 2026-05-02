# 因果律処理の対称化: Rule A 凍結 + Rule B ジャンプ

**Status**: 設計合意済 (2026-05-02)、 実装未着手。 SESSION の Bug 5 / 8 / 9 を共通根因で同時解消する中期 refactor。

**目的**: per-player coord time gap 蓄積による causality cliff edge bug 群 (Bug 5 LH 時刻ジャンプ、 Bug 8 LH 遥か未来、 Bug 9 新 join 即凍結) を、 因果律ベースの対称ルール 2 本で構造的に解消する。

---

## 1. 背景: 現状の設計柱と破綻点

### 1.1 設計柱 (= 維持すべき)

詳細は `design/physics.md` の以下セクション参照。 **`pos.t` semantics を変更する PR は基本却下** (= L141-151)。

| 柱 | 内容 | 由来 |
|---|---|---|
| **(P1) per-player coord time** | `dτ = wall_dt`、 `pos.t += γ·dτ` → 動いた人ほど `pos.t` が未来へ進む | `design/physics.md` §pos.t の物理的意味 |
| **(P2) Authority 解体** | host は pure relay、 駆動権 (kill / respawn / 物理) は本人 / owner | Stage A-H 完了 (`plans/2026-04-14-authority-dissolution.md`) |
| **(P3) 有界アリーナ** | `ARENA_RADIUS = 40`、 `LIGHT_CONE_HEIGHT` 有限 | `constants.ts` |

### 1.2 構造問題: P1 と P3 の衝突

`pos.t = γ·wall_clock` で任意 player ペアの `pos.t` 差は wall_time に対し単調増加。 30 分セッションで γ_max=2 なら ~1800 ls の gap。

`LIGHT_CONE_HEIGHT` (= 因果論的「相手と通信できる時刻幅」) は有限 (= O(40 ls))。

→ **`pos.t` gap が `LIGHT_CONE_HEIGHT` を超えた瞬間、 全ての causality 判定 (spawn / freeze / LH AI) が gracefully ではなく cliff edge で破綻する**。

### 1.3 顕在化した bug (= SESSION.md Bug ledger 参照)

| # | 観察 | cliff edge メカニズム |
|---|---|---|
| 5 | LH が host 時刻に固定、 client から見て遠い過去 | `processLighthouseAI` の minPlayerT jump 仕様、 host が静止 + client が動く場面で LH = host.t に anchor |
| 8 | 長時間 hidden 復帰後、 LH が遥か未来で見えない | `if (dτ > 0.2)` ballistic catchup が **alive 自機のみ** advance、 LH は止まる → 復帰 1 tick 目で minPlayerT (= host.t、 1800s 先) に巨大 jump → past cone 到達まで invisible |
| 9 | 新 tab 参加直後に既存 host が「因果律凍結」 | 新 joiner.t = `(min+max)/2` → host.t > 新 joiner.t with spatial 近 → host の `checkCausalFreeze` で timelike past 判定 → freeze |

3 bug すべて、 **gap 蓄積を扱う algorithm の設計選択 (min/max/中間 / 早期 return) が gap 増大シナリオで cliff edge 破綻するパターン**。

### 1.4 既存の partial 対応と漏れ

| 機能 | 現状 | 漏れ |
|---|---|---|
| `checkCausalFreeze` | stale + 1.5s grace で skip (`gameLoop.ts:574`) | gap 自体は対処せず、 stale 認定前 (= 5 秒未満) は対処漏れ |
| `computeSpawnCoordTime` | (min+max)/2 + alive 非 stale (`respawnTime.ts:44`) | min-max が大きくなると **どちらに寄せても causality 違反**、 (min+max)/2 は「両側 lag を半減」 だけ (= 4/28 fix の限界) |
| `processLighthouseAI` 因果律ジャンプ | minPlayerT に jump (`gameLoop.ts:347-367`) | hidden 復帰直後の host 大 jump (Bug 8)、 動いてない host 引っ張り (Bug 5) |
| `ballisticCatchupPhaseSpace` | `dτ > 0.2` で alive 自機のみ + thrust 継続 sub-step 再生 (`gameLoop.ts:263+`) | LH (host owned) は catchup されず → Bug 8 mechanism |
| `if (document.hidden) return` | 早期 return (`useGameLoop.ts:161`) | doc (`design/state-ui.md:156`) は「`lastTimeRef.current = Date.now()` 併記」 と書いてあるがコードに無い |

---

## 2. 提案: 因果律対称ルール

### 2.1 Rule A (= 既存維持): 「自分が誰かの未来光円錐に入った (= 未来側に来た)」 → 凍結

トリガー: `other.t < me.t` AND timelike `(me - other)`。

意味: `me` は `other` の未来光円錐内 = `other` から見て `me` は通信不可 (光速で追いつけない)。

挙動: `me.t` の advance 停止 (= `processPlayerPhysics` の physics skip)。

### 2.2 Rule B (= 新規): 「自分が誰かの過去光円錐に入った (= 過去側に来た)」 → 自 u^μ 方向にジャンプ

トリガー: `other.t > me.t` AND timelike `(other - me)`。

意味: `me` は `other` の過去光円錐内 = `other` から見て `me` は既に観測済の過去事象。 `me` は遅れすぎている。

挙動: `me` を `me + λ·u^μ` で advance、 `λ_exit = max_P λ_P` (= 全 peer の過去光円錐から脱出する最大値)。

### 2.3 二者の関係

|me と other の関係|Rule|挙動|
|---|---|---|
|`me` が `other` の未来 timelike (= I'm too far ahead)|A|凍結 (advance 停止)|
|`me` が `other` の過去 timelike (= I'm too far behind)|B|ジャンプ (advance forward)|
|`me` が `other` と spacelike (= 近接、 互いに観測中)|—|何もしない|
|`me` が `other` と null (= 光円錐表面)|—|何もしない|

両ルール同時 trigger (= `Q.t < me.t < P.t` で両 timelike): **Rule B 優先**。 ジャンプで P 圏外へ脱出。 ジャンプ後も Q の未来 timelike なら Rule A で凍結。 やがて Q が wall_dt で進み Q.t > me.t になれば凍結解除、 convoy 収束。

### 2.4 結果として得られる "convoy" 性質

全 peer 間で `pos.t` の差は spatial 距離 + LIGHT_CONE_HEIGHT 程度の bound に自動収束。 任意 2 peer は常に互いの過去光円錐の境界付近で causal 接触状態を保つ。 「離れすぎたら待つ / 戻ってくる」 が emergent。

---

## 3. 数学: λ_exit の計算

> **Signature 注記**: 本節の B / C は座標直接計算 (= Minkowski 内積を介さず `Δt² − |Δxy|²` 等を
> 直書き) で signature 不変。 codebase `physics/vector.ts` の `lorentzDotVector4` は
> **(+,+,+,-)** signature (= spacelike positive、 timelike では `lorentzDot < 0`)。 cf. plan
> 初版の (+,-,-,-) 表記は撤去済 (= 内部不整合だったため)。

### 3.1 設定

- `me = (t_m, x_m, y_m, 0)` (現在位置)
- `me.u = (u_x, u_y, 0)` (3-velocity 空間成分)
- `γ = √(1 + u_x² + u_y²)` (= 4-velocity の time 成分)
- `u^μ = (γ, u_x, u_y, 0)` (timelike 規格化、 制約 `γ² − u_x² − u_y² = 1` が常に成立)
- `other = (t_o, x_o, y_o, 0)`
- `Δ ≡ other - me = (Δt, Δx, Δy, 0)` で `Δt > 0` (= other は me の未来) AND `Δt² − Δx² − Δy² > 0` (= timelike past、 me は other の過去 cone 内)

### 3.2 cone 表面到達条件

`me + λ·u^μ` が `other` の過去 null cone 上 (= 光速線上):
```
(t_o - (t_m + λγ))² = (x_o - (x_m + λu_x))² + (y_o - (y_m + λu_y))²
```

展開し `γ² - u_x² - u_y² = 1` を使うと:
```
(Δt - λγ)² = (Δx - λu_x)² + (Δy - λu_y)²

λ²(γ² - u_x² - u_y²) - 2λ(γΔt - u_x·Δx - u_y·Δy) + (Δt² - Δx² - Δy²) = 0

λ² - 2Bλ + C = 0

ただし
  B = γΔt - u_x·Δx - u_y·Δy
  C = Δt² - Δx² - Δy²          (= timelike past で C > 0、 codebase signature (+,+,+,-) では `lorentzDot(Δ, Δ) = -C < 0` に対応)
```

### 3.3 forward exit の選択

`f(λ) = λ² - 2Bλ + C` は parabola opens up。 `f(0) = C > 0` (= λ=0 で me は cone 内 timelike past)。

**B > 0 の保証**: timelike past で `Δt > |Δxy|`。 さらに `|u|² = γ² − 1 < γ²` から `|u| < γ`、 通常の Cauchy-Schwarz で `|u·Δxy| ≤ |u|·|Δxy| < γ|Δxy| < γΔt`。 ゆえに `B = γΔt − u·Δxy > 0` (厳密)。

**disc ≥ 0 の保証** (= forward-directed timelike vectors の reverse Cauchy-Schwarz inequality):

```
B² = (γΔt - u·Δxy)² ≥ (γ² - |u|²)(Δt² - |Δxy|²) = 1 · C = C
```

から `B² ≥ C`、 ゆえに `disc = B² − C ≥ 0`。 **等号は `u^μ ∝ Δ` の degenerate case で達成可能** (= `u^μ = (1/√C)·Δ` と置くと `γ = Δt/√C`、 `u = Δxy/√C`、 `γ² − |u|² = (Δt²−|Δxy|²)/C = 1` で内部整合、 me が peer の 4-position に向けてちょうど飛んでいるケース)。 この場合 `λ_exit = B = √C` で me_new = peer のスポット (= cone 頂点) に到達。 数値誤差以外で disc < 0 にはならないため、 実装は `if (disc < 0) return 0` で safety net をかけるのみ。

**forward exit の選択** (= 2 根のうち時系列の早い方):

```
λ_exit = B - √(B² - C)
```

cone surface 通過の物理意味:
- `λ ∈ [0, λ₁]` (λ₁ ≡ λ_exit): peer's past cone **内側** (= timelike past、 peer は me を「未来からの像」 として観測中)
- `λ ∈ (λ₁, λ₂)` (λ₂ = B + √(B²−C)): cone **外側** (= spacelike、 peer は me を観測不可)
- `λ ∈ [λ₂, ∞)`: peer's **future** cone 内側 (= timelike future、 me_new が peer を観測可能側)

Rule B は「peer から見て me が観測される境界に達する瞬間」 を取る = λ₁ = forward exit。

### 3.4 全 peer に対する max

```
λ = max_{P ∈ peers, in_past_timelike(me, P)} λ_exit(P)
```

`in_past_timelike(me, P)`: `P.t > me.t AND (P.t - me.t)² > (P.x - me.x)² + (P.y - me.y)²` (= 座標直接、 signature 不変)。 spacelike / future / dead-future 対象外。

### 3.5 適用後

```
me_new.t = me.t + λγ
me_new.x = me.x + λu_x
me_new.y = me.y + λu_y
```

= u^μ 方向に λ だけ advance。 me_new はジャンプを与えた peer の過去 null cone 表面上 (= 視覚的にちょうど見え始める瞬間)、 他 peer の過去 cone は (P を選んだ理由から) 既に脱出済。

### 3.6 特殊ケース

> **直感は逆になる**: 「peer に向かって進めば cone 脱出が速い」 と思いがちだが、 peer の past
> null cone は peer.t に向けて狭くなる (= 円錐の頂点)。 空間的に peer に近づくと「狭くなる
> cone の中央軸」 を追走する形になり、 むしろ cone 脱出に時間がかかる。 逆に peer から空間的
> に離れる方向は、 cone surface を spatial 方向で速やかに突破する。

| ケース | 数式 | 意味 |
|---|---|---|
| `me.u = 0` (静止 LH / 死亡静止) | `γ=1, u_x=u_y=0` → `B = Δt`, `C = Δt² - |Δxy|²`、 `λ_exit = Δt - |Δxy|`、 `me.t_new = max_P(P.t - |P.xy - me.xy|)` | 全 peer の最大「P.t − P からの距離」 surface へ catch up |
| `me.u` が `other` から **離れる** 方向 (= u·Δxy < 0) | B **大** (= γΔt - 負値 = γΔt + |u·Δxy|)、 C 不変 → λ_exit **小** | 空間方向に逃げ切れるので cone 脱出すぐ |
| `me.u` が `other` に **向かう** 方向 (= u·Δxy > 0) | B **小** (= γΔt - 正値)、 C 不変 → λ_exit **大** | peer の time-axis を追走する形で cone 脱出に時間 (= 直感とは逆) |
| `C ≤ 0` (spacelike already) | skip | Rule B 対象外 |
| `Δt ≤ 0` (other は me の過去) | skip | Rule B は「自分が past cone に入った」 用、 反対の Rule A 領域 |
| `disc < 0` (理論上 timelike past で起きないはず、 数値誤差ガード) | skip | 防御コード |

> **plan v1 → v2 (2026-05-02 同日) で table 修正**: 初版は「向かう → B 大、 λ_exit 小」「離れる
> → B 小、 λ_exit 大」 と書いていたが両方逆 (= 著者の直感誤り) + 「C 大/同」 も誤り (C は u に
> 依存せず常に固定)。 公式 `λ_exit = B - √(B² - C)` 自体は signature-agnostic に正しく、
> Stage 2 実装の `causalityRules.test.ts` が両方向の数値検証を内蔵して固定化を防ぐ。

---

## 4. 死者の二本世界線モデル

### 4.1 動機

死者の位置は他者の causality 計算 (Rule A/B、 spawn time) で必要だが、 broadcast されない。 **inertial 直線で延長すれば全 peer が決定論的に同じ位置を計算できる**。

加えて、 死者本人は ghost camera で自由に動き回る。 これは他者から見えない別世界線。

### 4.2 二本

|世界線|用途|内容|可視性|
|---|---|---|---|
|**(1) 仮想世界線** (= virtual worldline) | 他者の Rule A / B、 spawn 計算| `pos(τ) = x_D + u_D · τ`、 `τ = (now_wall - kill.wallTime) / 1000`、 inertial 直線| 全 peer 共通計算 (= 純関数、 broadcast 不要)|
|**(2) 幽霊世界線** (= ghost worldline) | 死者本人のカメラ / 観測者位置 | `myDeathEvent.ghostPhaseSpace`、 自由 thrust 入力可、 動的 update | 本人のみ|

### 4.3 broadcast / protocol への影響

**ゼロ**。 全データは既存:
- `players[victimId].phaseSpace.pos` = `x_D` (`applyKill` が残してる、 `killRespawn.ts:14`)
- `players[victimId].phaseSpace.u` = `u_D` (同上)
- `kill.wallTime` = `killLog[N].wallTime` (`game-store.ts:443`)

新 protocol field 不要、 後方互換性問題なし。

### 4.4 alive / stale との統一

実は **alive / stale も同じ式**で表せる:

```ts
function virtualPos(player, lastSync, now): Vector4 {
  const tau = (now - lastSync) / 1000;
  const ps = player.phaseSpace;
  const gamma = Math.sqrt(1 + ps.u.x ** 2 + ps.u.y ** 2);
  return {
    t: ps.pos.t + gamma * tau,
    x: ps.pos.x + ps.u.x * tau,
    y: ps.pos.y + ps.u.y * tau,
    z: 0,
  };
}

// caller provides lastSync:
//   alive other:  lastUpdateTimes.get(id) ?? now    (= 最後 broadcast wall_time)
//   alive self:   now (= 自機は live、 tau = 0)
//   stale other:  lastUpdateTimes.get(id) (= 最後 broadcast 時、 stale でも同じ)
//   dead any:     latestKillFor(id, killLog).wallTime
```

3 状態 (alive / stale / dead) すべて「最後信じた状態から `pos + u · τ_wall` で延長」 で統一。 美しい。

### 4.5 ghost worldline の独立性 (= Q4 確認済)

self が ghost で動き回っていても、 他者は self を「死亡 u_D の inertial 線」 として観測。 self 自身の camera は自由位置。 物理的に自然 (= ghost は「本来観測されない別 entity」、 視界用の便利機構)。

設計思想として「**ghost は自分専用の遊び**」 と明示銘記。 合意済 2026-05-02。

---

## 5. 既存機構との関係

### 5.1 Q1 決定: ballistic catchup の thrust 継続シミュレートは撤廃 (= 純 inertial 統一)

合意済 2026-05-02。 `ballisticCatchupPhaseSpace` (`gameLoop.ts:263+`) は `8c02c0f` (2026-04-28) で「最後 thrust 入力継続 sub-step 再生」 になっていたが、 Stage 6 で削除。 hidden 復帰 / 大 dτ 経路は **Rule B + 純 inertial 延長で統一**。

意味: hidden 中 = thrust 入力なしで慣性運動、 復帰時は Rule B が convoy に合流。 thrust 操作は復帰後に再開。

### 5.2 Q2 決定: 毎 tick 微小 correction、 dead zone なし

Rule B は毎 tick 評価、 `λ > 0` なら無条件 apply。

理由: λ は self-stabilizing (= surface に近づくほど λ → 0)、 dead zone 不要。 normal play (= γ 差小) では λ=0 が頻発で apply 不発、 異常 scenario (= hidden 復帰 / 新 join) でのみ大 λ 発火。

合意済 2026-05-02。

### 5.3 Q3 決定: dead.u の broadcast 不要、 既存 data で純関数化可能

合意済 2026-05-02、 §4.3 参照。 protocol 拡張ゼロ、 backward compat 完璧。

### 5.4 Q5 決定: alive 自機の pos.t 表示が `γ·dτ + λ·γ` で raw γ より速くなる体験は許容

合意済 2026-05-02。 「他者から離れすぎないよう convoy にとどまる」 という説明で了承。 Speedometer の `γ` 表示と移動速度がわずかに不一致するが、 convoy bound 状態 (= 過去側にいる) のときだけ顕在化。 通常 play では λ=0 で raw γ そのまま。

### 5.5 Q6 決定: 既存 worldLine 凍結機構を Rule B 大ジャンプにも適用

詳細 §6 Stage 4。 `WORLDLINE_GAP_THRESHOLD_MS = 500` (`messageHandler.ts:159`、 受信側) と同概念で、 Rule B 自身が λ > LARGE_JUMP_THRESHOLD で凍結トリガを発火。 既存 frozenWorldLines 経路に流す。

### 5.6 visual 「kill されたら灰色」 は実は灰色じゃない

実装確認済: `frozenWorldLines.push({ ..., color: victim.color })` で **player 色を保持**、 灰色ではない。 ship 本体は `DeadShipRenderer` で player 色 + opacity fade `(τ_max − τ_0) / τ_max`。

仮想世界線をビジュアル化するか? は別議論として保留。 現状 (= xD 固定 + fade) は「死んだ感」 のメタファとして自然、 変更不要 (= 合意済 2026-05-02)。

---

## 6. 実装計画 (Stage 分割)

各 Stage は独立に commit + test。 typecheck + 既存 198 test pass を維持。 中盤 (Stage 5 終了) で deploy 候補、 全 stage 完了で再 deploy。

### Stage 1: virtualPos 純関数

**目標**: alive / stale / dead 統一インターフェースの virtualPos 計算。

**追加 file**: `src/components/game/virtualWorldLine.ts` (新規)

```ts
// virtualWorldLine.ts
import { gamma, type Vector4 } from "../../physics";
import type { RelativisticPlayer } from "./types";
import type { KillEventRecord } from "./types";

/**
 * player の virtual pos を計算 (= 最後信じた phaseSpace + u·τ で inertial 延長)。
 *
 * - alive: lastSync = 最後 broadcast を受信した wall_time (自機は now で τ=0)
 * - stale: 同 above (= broadcast 停止前の最後値から延長)
 * - dead:  lastSync = killLog.wallTime、 player.phaseSpace は applyKill が残した死亡時値
 *
 * 全状態で同じ式: pos.t += γ·τ、 pos.xy += u·τ
 */
export const virtualPos = (
  player: RelativisticPlayer,
  lastSyncWall: number,
  nowWall: number,
): Vector4 => {
  const tau = (nowWall - lastSyncWall) / 1000;
  const ps = player.phaseSpace;
  const g = gamma(ps.u);
  return {
    t: ps.pos.t + g * tau,
    x: ps.pos.x + ps.u.x * tau,
    y: ps.pos.y + ps.u.y * tau,
    z: 0,
  };
};

/**
 * dead player の lastSync wall_time を killLog から取得。
 * 同 victim の最新 kill (= latestKillFor) の wallTime を返す。
 */
export const lastSyncForDead = (
  playerId: string,
  killLog: readonly KillEventRecord[],
): number | undefined => {
  let latest: number | undefined;
  for (const e of killLog) {
    if (e.victimId !== playerId) continue;
    if (latest === undefined || e.wallTime > latest) latest = e.wallTime;
  }
  return latest;
};
```

**test**: `src/components/game/virtualWorldLine.test.ts` (新規)
- 静止 alive (= u=0): `virtualPos(player, now, now+1) = pos + (1, 0, 0, 0)`
- 動き alive (= u=(0.6,0,0), γ=1.166): tau=1 で `pos.t += 1.166`, `pos.x += 0.6`
- dead 静止 (= u=0): `virtualPos(deadPlayer, killWall, now)` で τ 経過分だけ前進
- dead 動き (= u=(0.6,0,0)): inertial 直線継続
- self alive (= lastSync = now): tau = 0、 `virtualPos = phaseSpace.pos`

**typecheck + lint clean**。 既存 test 全 pass。

**dependency**: なし。

### Stage 2: causalityJumpLambda 純関数 (Rule B 計算)

**目標**: 全 peer に対する λ_exit max 計算。

**追加 file**: `src/components/game/causalityRules.ts` (新規)

```ts
// causalityRules.ts
import { gamma, type Vector3, type Vector4 } from "../../physics";

/**
 * 1 peer に対する λ_exit。 me が peer の過去光円錐内 timelike にいるとき、
 * me + λ·u^μ で peer の過去 null cone 表面に到達する λ。
 *
 * 戻り値:
 *  - λ > 0: forward exit が必要
 *  - 0 / null: 既に外 (spacelike / future / spawn 直後等)
 */
export const causalityJumpLambdaSingle = (
  meT: number,
  meX: number,
  meY: number,
  meU: Vector3,
  peerT: number,
  peerX: number,
  peerY: number,
): number => {
  const dt = peerT - meT;
  if (dt <= 0) return 0; // peer が me の過去 → Rule B 対象外 (Rule A 領域)
  const dx = peerX - meX;
  const dy = peerY - meY;
  const C = dt * dt - dx * dx - dy * dy;
  if (C <= 0) return 0; // spacelike already
  const g = gamma(meU);
  const B = g * dt - meU.x * dx - meU.y * dy;
  const disc = B * B - C;
  if (disc < 0) return 0; // 数値ガード (理論上 timelike past で disc ≥ 0)
  const lambdaExit = B - Math.sqrt(disc);
  return Math.max(0, lambdaExit);
};

/**
 * 全 peer に対する λ_exit の max。 me が複数 peer の過去 cone 内にいるとき、
 * 全部脱出するための最小 forward distance。
 */
export const causalityJumpLambda = (
  me: Vector4,
  meU: Vector3,
  peers: ReadonlyArray<{ pos: Vector4 }>,
): number => {
  let maxLambda = 0;
  for (const p of peers) {
    const l = causalityJumpLambdaSingle(
      me.t, me.x, me.y, meU,
      p.pos.t, p.pos.x, p.pos.y,
    );
    if (l > maxLambda) maxLambda = l;
  }
  return maxLambda;
};
```

**test**: `src/components/game/causalityRules.test.ts` (新規)
- solo (= peers 空): λ = 0
- spacelike already: λ = 0
- 静止 me (u=0)、 peer 1 人 future timelike: `λ = peer.t - me.t - |spatial|`
- 動き me が peer の方向に **向かう** (u·Δxy > 0): B 小、 λ_exit **大** (= cone 脱出が遅い、 §3.6)
- 動き me が peer から **離れる** (u·Δxy < 0): B 大、 λ_exit **小** (= 空間方向に逃げ切れる)
- 多 peer: 全 max が選ばれる
- 数値誤差ガード: `C` が極小負値 (1e-12) → 0 return
- 適用後 `me_new` が cone 表面上 (= `Δt² - |Δxy|²` → 0)

**dependency**: なし。

### Stage 3: WorldLine 大ジャンプ凍結トリガ

**目標**: Rule B が `λ > LARGE_JUMP_THRESHOLD` で旧 worldLine を frozenWorldLines に push + 1 点 reset の helper を提供。

**追加 file**: `src/components/game/worldLineGap.ts` (新規) もしくは `useGameLoop.ts` に inline helper

**定数追加**: `constants.ts` に
```ts
/**
 * Rule B が 1 tick で λ > これ の jump を出したとき、 旧 worldLine を frozen に押して
 * 新セグメントを 1 点から開始する閾値。 視覚的に CatmullRomCurve3 が「滑らかな嘘」 で
 * 補間する distance に到達する手前で切る。 0.5 ls = WORLDLINE_GAP_THRESHOLD_MS (500ms) と
 * 同 order、 概念は別 (= こちらは coord time、 あちらは wall time)。
 */
export const LARGE_JUMP_THRESHOLD_LS = 0.5;
```

**helper sketch** (= Stage 5 で使う):
```ts
// 自機 Rule B jump apply、 λ > 閾値なら旧 worldLine 凍結 + 新セグメント開始。
export const applyRuleBToSelf = (
  store: GameStore,
  myId: string,
  prevPs: PhaseSpace,
  newPs: PhaseSpace,
  lambda: number,
): void => {
  if (lambda < LARGE_JUMP_THRESHOLD_LS) {
    // 微小 correction → 通常 worldLine append
    store.setPlayers(prev => {
      const cur = prev.get(myId);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(myId, { ...cur, phaseSpace: newPs, worldLine: appendWorldLine(cur.worldLine, newPs) });
      return next;
    });
  } else {
    // 大ジャンプ → 旧 worldLine 凍結 + 新セグメント
    store.setFrozenWorldLines(prev => [
      ...prev,
      { playerId: myId, worldLine: store.players.get(myId).worldLine, color: ... },
    ].slice(-MAX_FROZEN_WORLDLINES));
    store.setPlayers(prev => {
      const cur = prev.get(myId);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(myId, {
        ...cur,
        phaseSpace: newPs,
        worldLine: { ...cur.worldLine, history: [newPs] },
      });
      return next;
    });
  }
};
```

**test**: 純関数部分 (= LARGE_JUMP_THRESHOLD_LS 比較ロジック) を unit test。

**dependency**: Stage 1 + 2。

### Stage 4: LH 因果律ジャンプを Rule B に置換

**目標**: `processLighthouseAI` (`gameLoop.ts:332+`) の minPlayerT jump (line 347-367) を Rule B に置換。

**変更 file**: `src/components/game/gameLoop.ts`

```ts
// before (line 347-367):
let needsJump = false;
let minPlayerT = Number.POSITIVE_INFINITY;
for (const [pId, player] of players) {
  if (isLighthouse(pId)) continue;
  if (player.isDead) continue;
  minPlayerT = Math.min(minPlayerT, player.phaseSpace.pos.t);
  if (player.phaseSpace.pos.t <= lhNewPs.pos.t) continue;
  const diff = subVector4Torus(lhNewPs.pos, player.phaseSpace.pos, torusHalfWidth);
  const l = lorentzDotVector4(diff, diff);
  if (l < 0) needsJump = true;
}
if (needsJump && minPlayerT > lhNewPs.pos.t) {
  lhNewPs = createPhaseSpace(
    createVector4(minPlayerT, lhNewPs.pos.x, lhNewPs.pos.y, 0),
    vector3Zero(),
  );
}

// after:
const peerVirtualPositions: { pos: Vector4 }[] = [];
for (const [pId, player] of players) {
  if (isLighthouse(pId)) continue;
  if (pId === lhId) continue;
  // alive / stale / dead 統一: virtualPos で取得
  const lastSync = player.isDead
    ? lastSyncForDead(pId, killLog) ?? currentTime
    : (lastUpdateTimes.get(pId) ?? currentTime);
  peerVirtualPositions.push({ pos: virtualPos(player, lastSync, currentTime) });
}
const lambda = causalityJumpLambda(lhNewPs.pos, lhNewPs.u, peerVirtualPositions);
if (lambda > 0) {
  // LH の u=0 なので γ=1、 jump は時間軸沿いのみ
  lhNewPs = createPhaseSpace(
    createVector4(lhNewPs.pos.t + lambda, lhNewPs.pos.x, lhNewPs.pos.y, 0),
    vector3Zero(),
  );
}
```

**signature 変更**: `processLighthouseAI` に `killLog` + `lastUpdateTimes` 引数追加。

**caller**: `useGameLoop.ts:639` の `processLighthouseAI` 呼び出しに引数追加。

**test**: `gameLoop.test.ts` (or 新規 `lighthouseRuleB.test.ts`) に scenario:
- 1 peer (host) 静止: λ = 0、 LH 通常 advance
- 1 peer 高速移動: peer.t > lh.t、 λ > 0、 LH catch up
- 多 peer 混在: max が選ばれる
- 全 peer 死亡: peers 配列に dead.virtualPos 含む、 λ 計算は同様

**dependency**: Stage 1 + 2。

**deploy 候補ポイント** (= ここで一度 localhost test して LH 挙動 OK なら deploy 可能、 残り Stage は次セッションでも可)。

### Stage 5: 一般 alive 自機への Rule B 毎 tick 適用

**目標**: `processPlayerPhysics` 末尾、 `evolvePhaseSpace` 後に Rule B 評価し、 `λ > 0` なら apply。

**変更 file**: `src/hooks/useGameLoop.ts` の alive 分岐 (line 539-580)

**変更内容**:
```ts
} else if (freshMe) {
  const frozen = checkCausalFreeze(...);
  ...
  if (!frozen) {
    const physics = processPlayerPhysics(...);
    let newPs = { ...physics.newPhaseSpace, heading: yawToQuat(headingYawRef.current) };

    // *** NEW: Rule B 評価 ***
    const peerVirtualPositions = [];
    for (const [pId, p] of fresh.players) {
      if (pId === myId) continue;
      const lastSync = p.isDead
        ? lastSyncForDead(pId, fresh.killLog) ?? currentTime
        : (lastUpdateTimeRef.current.get(pId) ?? currentTime);
      peerVirtualPositions.push({ pos: virtualPos(p, lastSync, currentTime) });
    }
    const lambda = causalityJumpLambda(newPs.pos, newPs.u, peerVirtualPositions);
    if (lambda > 0) {
      // u^μ 方向に λ advance
      const g = gamma(newPs.u);
      newPs = {
        ...newPs,
        pos: {
          t: newPs.pos.t + lambda * g,
          x: newPs.pos.x + lambda * newPs.u.x,
          y: newPs.pos.y + lambda * newPs.u.y,
          z: 0,
        },
      };
    }

    // *** Stage 3 helper applyRuleBToSelf を使って worldLine append または freeze ***
    if (lambda < LARGE_JUMP_THRESHOLD_LS) {
      // 通常 append
      fresh.setPlayers(prev => { ... });
    } else {
      // 旧 worldLine frozen + 新セグメント
      fresh.setFrozenWorldLines(prev => [...prev, ...]);
      fresh.setPlayers(prev => { ... });
    }
  }
}
```

**test**:
- normal play (= λ = 0): 既存 alive 物理と同等動作、 既存 test pass
- hidden 復帰 scenario: dτ = 1800 で alive 復帰、 大 λ jump、 worldLine 凍結
- 2-peer convoy: 高 γ peer がいるとき λ で追従

**dependency**: Stage 1 + 2 + 3 (helper)。

### Stage 6: ballisticCatchupPhaseSpace 撤廃

**目標**: `if (dτ > 0.2)` 早期 return 経路で「alive 自機の sub-step thrust 再生」 を削除。 純 inertial で statement。

**変更 file**:
- `useGameLoop.ts` (line 171-235): ballistic catchup branch を削除、 通常 tick path に流す
- `gameLoop.ts` (line 263+): `ballisticCatchupPhaseSpace` 関数削除
- `ballisticCatchup.test.ts` 削除 (or 後継として "rule-b-recovery.test.ts" に置換)
- `if (document.hidden) return` (line 161) → `if (document.hidden) { lastTimeRef.current = Date.now(); return; }` (= `design/state-ui.md:156` doc 通り、 復帰時の dτ 大化を防ぐ)

**意味の変化**:
- hidden 中: gameLoop 早期 return、 lastTimeRef は毎 throttle tick で current 更新 → 復帰時 dτ は最後の throttle tick 以降の小値
- 大 dτ (= 古 lastTimeRef からの巨大値) 経路は消滅、 通常 tick が走る
- 通常 tick で Rule B が convoy に合流 (= 最初の tick で大 λ jump)

`design/state-ui.md:156` の「lastTimeRef 更新で復帰時のジャンプも防止」 を完全実装する形になる。 doc 通り。

**test**: hidden simulate (= document.hidden mock or jsdom の visibilityState)、 復帰後の dτ が小、 Rule B が convoy 合流。

**dependency**: Stage 5 (= Rule B alive 自機実装)。

### Stage 7: spawn / freeze 計算の dead/stale 除外を撤廃

**目標**: `computeSpawnCoordTime` (`respawnTime.ts:44`) と `checkCausalFreeze` (`gameLoop.ts:574`) で virtualPos を使い、 dead / stale 除外ロジックを撤廃。

**変更 file**:
- `respawnTime.ts`: `computeSpawnCoordTime` の引数から `staleFrozenIds` 削除、 `players` を `Map<string, RelativisticPlayer>` から `Map<string, { virtualT: number, isExcluded: boolean }>` 風に渡し方変更 (or 内部で virtualPos 計算用の lastSync map を渡す)
- `gameLoop.ts:574` `checkCausalFreeze`: virtualPos で peer の pos を取得、 stale/dead 除外撤廃

**新 signature 案**:
```ts
export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: Map<string, number>,
  nowWall: number,
  excludeId?: string | null,
): number => {
  const ts: number[] = [];
  for (const [id, p] of players) {
    if (excludeId != null && id === excludeId) continue;
    const lastSync = p.isDead
      ? lastSyncForDead(id, killLog) ?? nowWall
      : (lastUpdateTimes.get(id) ?? nowWall);
    const vp = virtualPos(p, lastSync, nowWall);
    ts.push(vp.t);
  }
  if (ts.length === 0) return 0;
  // Stage 8 で formula 確定、 ここでは中間値 placeholder
  return (Math.min(...ts) + Math.max(...ts)) / 2;
};
```

**checkCausalFreeze** も同様に virtualPos を使い、 stale 除外を消す。 **ただし**:
- 1.5s grace (= `FREEZE_RECENT_UPDATE_MS = 1500`) は維持。 broadcast 直後の peer に対する寛容は別概念で、 virtualPos 化と直交
- 現在の「`player.isDead` continue」 は撤廃し、 dead も virtualPos で評価対象に

**test**: 既存 freeze test を virtualPos 経由でも pass、 dead / stale 含み scenario で正しい min/max。

**dependency**: Stage 1。

### Stage 8: spawn 時刻仕様の最終確定 (= Bug 9 自然解消)

**目標**: spawn 時刻決定アルゴリズムを再検討、 Rule B 環境下で自然な選択にする。

**候補仕様** (= 議論材料):

| 案 | spawn.t | post-spawn 挙動 |
|---|---|---|
| **(α)** `now wall_clock` 自分基準 (= self.lastSync = now) | 自分の wall time 直近値 | Rule B が他 peer に合流 |
| **(β)** `max(virtualPos(all))` | 全 peer の最先端時刻 | 全 peer から見て自分が future、 Rule A 凍結待ち |
| **(γ)** `(min + max) / 2` virtualPos 込み (= 既存延長) | 中間 | Rule A/B どちらも軽微発火 |
| **(δ)** `min(virtualPos(all))` | 最遅時刻 | 全 peer から見て自分が past、 Rule B 即発火 (= 自分が catch up) |

**推奨**: (α) `now wall_clock` 自分基準、 spatial は既存 random `[-5, +5)²`。 spawn 直後に Rule B が動いて convoy に合流。 シンプル + Bug 9 解消 (= 既存 host の checkCausalFreeze は virtualPos で計算、 stale/dead 除外撤廃により dead も含む min/max 内で安定)。

**test**: 多 peer + 高 γ + 死亡含む scenario で spawn 後 1 秒以内に convoy 合流。

**dependency**: Stage 7。

---

## 7. Edge cases / open questions

### 7.1 worldLine continuity の細部

毎 tick 微小 λ で worldLine 微小 kink が連続。 CatmullRomCurve3 が滑らかに interpolate するので視覚 OK。 ただし数値 (`worldLine.history` 上の隣接点間の `dt` ばらつき) が極端に大きくならないか、 hidden 復帰直後 1 tick の λ jump が `LARGE_JUMP_THRESHOLD_LS` を超える頻度はどの程度か、 をテスト要。

### 7.2 Rule B が apply された後の broadcast 内容

通常 broadcast: `{ type: "phaseSpace", senderId, position, velocity, heading, alpha }`。 Rule B jump 後の `position` をそのまま broadcast。 受信側は通常通り更新 + `WORLDLINE_GAP_THRESHOLD_MS` で gap 検知 (= 大 λ なら自動凍結)。 protocol 拡張不要。

### 7.3 Rule B の cost (= 計算量)

毎 tick `O(N) virtualPos + O(N) λ_exit_single`。 N = peer 数 (≤ 10 想定)。 **ホットパスではない** (= 1 tick あたり数十 floating ops)。 perf 影響無視可。

### 7.4 Rule A と Rule B 同時 trigger の挙動

§2.3 で「Rule B 優先」 と決めた。 実装では:
1. processPlayerPhysics の前段で Rule A (`checkCausalFreeze`) 評価、 frozen なら physics skip
2. **でも Rule B は frozen でも動かす** (= jump して frozen 状態から脱出するため)

Stage 5 実装時に注意:
```ts
const frozen = checkCausalFreeze(...);
let newPs = me.phaseSpace;
if (!frozen) {
  // 通常物理
  const physics = processPlayerPhysics(...);
  newPs = physics.newPhaseSpace;
}
// Rule B は frozen / not frozen 関わらず apply
const lambda = causalityJumpLambda(newPs.pos, newPs.u, peerVirtualPositions);
if (lambda > 0) { newPs = applyJump(newPs, lambda); }
// commit
```

### 7.5 ghost (= 死者本人) と Rule B

ghost は `myDeathEvent.ghostPhaseSpace` で動的、 他者から見えない。 Rule B 適用?

**案 1**: ghost にも Rule B 適用 (= ghost が convoy に合流)。 でも ghost は他者と関係ないので意味薄。

**案 2**: ghost は Rule A/B 両方除外。 自由に飛ぶ。 他者は dead.virtualPos (= 死亡 u_D inertial) で見るので、 ghost と乖離しても問題なし。

**推奨**: 案 2。 ghost 物理は self camera 用、 causality 違反は他者の視界に反映されない。 シンプル。

### 7.6 LH を peer set に含めるか (= LH 同士の Rule B)

複数 LH があるとき、 LH 同士の Rule B は? 現状 LH は host 1 owner で 1 機のみ (`la-default-0`)。 将来的に複数 LH 設置すると LH 間 Rule B が必要。

**現時点**: LH 1 機前提、 peers 配列で LH を skip (= 既存仕様維持)。 将来 multi-LH 検討時に再考。

### 7.7 dead peer の virtualPos が表示用に意味を持つか

§5.6 で「現状の DeadShipRenderer (= xD 固定 + fade) のままで OK」 と決めた。 仮想線は数学概念のみ、 ビジュアル化は将来別議論。

### 7.8 stale 復帰時の broadcast race

stale player が return broadcast したとき、 受信側は `staleFrozenRef.delete(id)` で stale 除外解除。 ただし受信前の数 tick は `lastUpdateTimes.get(id)` が古いまま → virtualPos が大きく前進 (= 1800s 等)。 これが受信側の Rule A trigger に使われると freeze 誤発火?

**解析**: virtualPos(stale_id) で予測される pos.t = `last_pos.t + γ·(now - last_wall)` = stale player の予想現在地。 受信側はこれを「stale player は inertial で動いてる」 と仮定して checkCausalFreeze に投入。 もしその予想 pos が我々の future cone 内 (= 我々が freeze しなければならない領域) なら freeze。

これは正しい? 物理的には、 stale player が実際に inertial で動いていたら正しい予測。 もし stale player が hidden 中で動いてなかったら、 復帰 broadcast でずれる → 受信側の予測が外れる。

mitigation: stale player は hidden 中も Rule B + 純 inertial で extrapolate するから、 復帰 broadcast の pos は inertial 予測と一致する (= Q1 (a) の純 inertial 統一)。 ただし Rule B によるジャンプ補正 → broadcast pos は予測と異なる可能性。

**結論**: stale 復帰 broadcast 受信時、 既存 `WORLDLINE_GAP_THRESHOLD_MS` で worldLine 凍結 + 1 点 reset するので、 予測と現実の不一致は受信側で吸収される。 freeze 誤発火は 1 tick で解消、 大問題にならない。

### 7.9 spawn 直後の Rule B / A 連鎖

(α) spawn = self の wall_clock 直近値 で spawn 後、 既存 host が move していれば self.t は host.t より大幅に過去 → Rule B 即発火 → self が host の cone surface へジャンプ。 次 tick で spacelike → 安定。

逆に既存 host が静止で self が high γ で参加 (= 多分有り得ない)、 self.t が host.t より未来 → Rule A 凍結 → self は wall_dt で advance せず host が catch up 待ち。

両方 OK。

### 7.10 複数 dead が混在する場面

複数死亡者が peers に含まれるとき、 各 dead は自身の `xD + uD·τ` で virtual pos を独立計算。 互いに干渉しない。 alive peers は dead virtualPos も含めて Rule B 計算。 OK。

### 7.11 dead → respawn 直後の transition

respawn 時 `myDeathEvent: null` (`game-store.ts:544`)、 alive worldLine を新規開始。 受信側は新 phaseSpace broadcast を受信、 既存 worldLine (= dead 時の凍結 worldLine) は frozenWorldLines に残る、 新 worldLine が新色 (= 同 player) で alive 描画。

dead 中の virtualPos を使ってた他 peer は、 respawn 検知 (= killLog vs respawnLog の latest 比較で `selectIsDead` が false に転じる) と同時に alive virtualPos に切替。 lastSync は新 phaseSpace 受信 wall_time。 連続性 OK。

---

## 8. テスト戦略

### 8.1 純関数 unit test (= Stage 1, 2, 3 helper)

各 stage で新規 .test.ts。 数式の境界ケース網羅。 既存 198 test に追加。

### 8.2 統合 test (= Stage 4, 5, 7, 8)

`describe("Rule B integration", ...)` 風で:
- 2-peer convoy: A.γ=2 で 30s 走る、 B 静止、 LH を含む 3 entity の pos.t gap が bound 内に収束
- hidden 復帰: dτ = 1800 で alive self を tick、 1 tick 目で convoy 合流、 worldLine frozen
- 新 join: spawn pos = (now wall_clock, random xy)、 既存 host が high γ なら 1 tick 目で host cone surface へ

### 8.3 既存 test の更新範囲

- `ballisticCatchup.test.ts`: Stage 6 で削除 or rule-b-recovery.test.ts に置換
- `respawnTime.test.ts`: Stage 7 で signature 変更追従
- `checkCausalFreeze.test.ts`: Stage 7 で virtualPos 化追従

### 8.4 localhost 動作確認

各 Stage 後に `pnpm dev` で localhost 起動、 single-tab で目視確認:
- Stage 4: LH の挙動が host 静止 / 動き scenario で自然か
- Stage 5: alive 自機が convoy に追従するか
- Stage 6: hidden 復帰後の挙動
- Stage 8: 新 join (= 別 tab 開く) で freeze 起きないか

multi-tab は preview 制約あり (= PeerJS sticky)、 odakin の実機 / 別 browser で確認。

---

## 9. Migration / Compat

### 9.1 Protocol 互換性

**完璧**: 既存 message schema 変更なし、 既存 client と新 client が同 room で混在可。

新 client は Rule B 適用、 旧 client は適用なし。 旧 client は Rule B のジャンプを受信して通常 phaseSpace として処理 (= worldLine 凍結 / append)。 視覚的な不一致は最小、 旧 client が長時間使われない前提で許容。

### 9.2 deploy 戦略

- Stage 4 完了で **mid-deploy**: LH 単独の挙動変更を実機検証 (= Bug 5/8 改善確認)
- Stage 5-6 完了で **末-deploy**: alive 自機 Rule B + ballistic catchup 撤廃を実機検証
- Stage 7-8 完了で **最終 deploy**: spawn / freeze の virtualPos 化、 Bug 9 解消確認

### 9.3 ロールバック計画

各 Stage は独立 commit、 reverse 簡単 (= `git revert <stage commit>`)。 ただし Stage 6 ballistic catchup 撤廃 revert は ballistic catchup test 復活も必要 (= test も revert)。

---

## 10. 「やらないこと」 (= 過去議論で却下された alternatives)

将来の自分が再提案しないよう明示。

### 10.1 ✗ pos.t = wall_clock 同期 (= lab frame 解釈)

`design/physics.md:141-151` で「Claude が複数回再発した誤った fix 提案」 として銘記済。 game design は per-player coord time、 wall_clock 同期は別 game の解釈。

### 10.2 ✗ `dτ = wall_dt / γ` (= proper SR の time dilation)

同 `design/physics.md:146`。 動いた人ほど時間が遅くなる体験は本ゲームの design に反する。

### 10.3 ✗ pos.t gap を leader cap で制限 (= option α)

「max(pos.t) - min(pos.t) ≤ LCH」 invariant を leader 抑制で実現する案。 P1 の部分緩和になるが、 因果律ベースの Rule A/B のほうが物理的にも実装的にも clean。 却下。

### 10.4 ✗ LH を wall_clock anchor (= option β)

LH のみ `pos.t = Date.now() / 1000 - OFFSET` で anchor する案。 P1 から LH を外す形。 Rule B でも LH の挙動は同等に得られる (= LH の u=0 なので λ_exit が「max_P (P.t - dist)」 になり、 結果的に leader peer の past cone surface = wall_clock-ish 値) なので、 LH 特別扱い不要。 却下。

### 10.5 ✗ 仮想世界線の broadcast (= 過去案)

dead.u を kill message に乗せる必要があるかと思ったが、 Q3 で「`applyKill` が `players[victimId].phaseSpace.u` を残してる」 ことに気付き、 既存 data で純関数化可能と判明。 protocol 拡張不要。

### 10.6 ✗ Rule B に dead zone threshold (= 過去案)

Q2 で「毎 tick 微小 correction で λ は self-stabilizing」 と気付き、 dead zone なしで OK。 dead zone は無駄な discrete jump を生むだけ。

### 10.7 ✗ kill 時の worldLine を灰色化 (= 誤認案)

実装確認済、 player 色のまま opacity fade。 灰色化は していない、 必要 もない。

---

## 11. 次セッション開始時のチェックリスト

cold-start から再開する際、 以下を順に確認:

1. ✅ `design/physics.md` §pos.t の物理的意味 を読み直し、 P1 を内面化
2. ✅ `SESSION.md` Bug ledger の Bug 5 / 8 / 9 を確認、 motivation 共有
3. ✅ 本 plan の §2 (Rule A + B 概念)、 §3 (数学)、 §4 (二本世界線) を読む
4. ✅ §6 Stage 1 から実装着手、 各 stage で commit + test
5. ⚠️ Stage 4 完了時 deploy 候補、 odakin に確認
6. ⚠️ Stage 6 で ballisticCatchupPhaseSpace 削除 = 既存 test 1 件削除、 影響範囲確認
7. ⚠️ Stage 8 で spawn 時刻仕様確定、 (α) 推奨だが (β)(γ)(δ) も比較材料、 odakin と再協議

### 重要 file pointer (= 実装中 cold-look-up 用)

| 役割 | path |
|---|---|
| 設計柱の正本 | `design/physics.md` |
| stale 処理思想 | `design/state-ui.md:85-110` |
| 既存 LH AI | `src/components/game/gameLoop.ts:332-470` |
| 既存 ballistic catchup | `src/components/game/gameLoop.ts:263+` |
| 既存 checkCausalFreeze | `src/components/game/gameLoop.ts:574+` |
| 既存 spawn time | `src/components/game/respawnTime.ts:44` |
| 既存 hidden 早期 return | `src/hooks/useGameLoop.ts:161` |
| handleKill / 死亡時 phaseSpace 保持 | `src/stores/game-store.ts:410-470` |
| messageHandler phaseSpace 経路 | `src/components/game/messageHandler.ts:126-223` |
| 既存 worldLine gap 凍結 | `src/components/game/messageHandler.ts:155-180` |
| 既存 selfballistic catchup 凍結 | `src/hooks/useGameLoop.ts:171-235` |
| Bug ledger | `SESSION.md` 「現在の課題」 §Bug ledger |

### 既存 commit pointer (= 履歴経緯)

| commit | 内容 |
|---|---|
| `cb9fa10` | causality freeze の 1.5s grace + (0,0) wrap pattern (= 4/28 PBC fix sweep) |
| `8c02c0f` | ballistic catchup を thrust + friction sub-step 再生に拡張 (Stage 6 で revert) |
| `3ba639a` | spawn 時刻を `(min+max)/2` に変更 (Stage 8 で再検討) |
| `e645aef` | PLC スライス mode (= PR #2) |
| `c7f7960` | 5/2 Bug 7 fix (past-cone marker isDead filter 撤廃)、 本 plan の direction を裏付け |

---

## 12. 未決問題 (= odakin 再協議要)

1. **Stage 8 spawn 時刻仕様**: 2026-05-02 実装で **(γ) `(min + max) / 2` を確定仕様** とした
   (詳細: `respawnTime.ts` の `computeSpawnCoordTime` docstring)。 plan 当初推奨 (α) は
   実機検証 + odakin 同意後に別 commit で switch する余地を残す。 Bug 9 解消は Stage 5
   Rule B convergence が担うため spawn formula 単体に強く依存しない
2. **Stage 4 後の mid-deploy するか**: 2026-05-02 セッションで Stage 1-8 一括実装 + 末-deploy
   候補に到達。 LH 単独 mid-deploy は skip した
3. **multi-LH 将来計画**: 1 LH 前提を維持するか、 multi-LH を見据えた Rule B 拡張するか (= 現時点では 1 LH 前提で実装、 後で必要時に拡張)
4. **ghost に Rule B 適用するか**: §7.5 で案 2 (= 適用しない、 自由 fly) を推奨。 odakin 同意要

---

## 13. References

- `design/physics.md` §pos.t の物理的意味 と「再発防止メモ」
- `design/state-ui.md` §Stale プレイヤー処理
- `design/network.md` §migration 堅牢化
- `design/meta-principles.md` M4-M5 (zustand stale state)
- `EXPLORING.md` §「遠くに行って戻れない」 問題 (= 関連、 onboarding 文脈)
- `SESSION.md` Bug ledger (= 動機)
- `plans/2026-04-14-authority-dissolution.md` (= P2 完了経緯)
- `plans/2026-04-27-pbc-torus.md` (= 関連、 universal cover refactor)

以上。
