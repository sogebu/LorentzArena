# Bug 14 完全治療: global active time + integrator stability

**Date**: 2026-05-06
**Status**: 進行中
**Trigger**: Bug 14 live capture ([`repro/2026-05-06-bug14-state/`](../repro/2026-05-06-bug14-state/), commit `4abdf26`) で `self.pos.t = 20.37M sec` runaway を観測。 12.5h background suspend + LH ratchet 仮説完全否定 + alive human 単独 runaway が真因経路と確定。

**設計柱**: ユーザー 2 原則を 1 つの構造で表現:
- **P1**: 誰も active でない時間 → 全員 skip (= 数値肥大化防止)
- **P2**: 誰か active な時間 → 全員進める (= 因果律 split / Rule A 凍結 / Rule B 跳躍 防止)

両者を `globalActive ≡ selfActive ∨ ∃peer: peerActive` の存在量化命題で表現、 既存 `lastUpdateTimeRef` infrastructure で **完全 local 計算可能** (= 分散合意不要)。

---

## §1 RCA: 5 層分析の最深層

| 層 | 内容 |
|---|---|
| L1 (近因) | 物理が爆発 (= `self.pos.t = 20.37M sec`) |
| L2 (timing) | `dTau` が巨大化 (= 1 tick で 12.5h) |
| L3 (architecture) | `lastTimeRef` が loop fire に依存、 mobile 完全 suspend で reset 走らず |
| **L4 (clock semantic)** | 既存 `if (document.hidden) return` は **per-client active time** ≡ `performance.now()` 流の semantic で、 P2 (= 「peer active なら自機も進める」) と直接矛盾 |
| **L5 (mathematical)** | `evolvePhaseSpace` の **explicit** Euler + multiplicative friction は `dτ > 2/k = 4 sec` で **unconditionally 不安定** (`newU = u(1-kΔ)` の係数が ±1 を逸脱)。 注: 「explicit Euler」 が L5 root cause の正確な記述、 「semi-implicit」 表記は本 plan 後続の implicit Euler refactor 後の現行実装を指す。 |

L4 + L5 を同時に治す。

---

## §2 設計

### §2.1 Layer 5: integrator stability (= 初期 substep → 後続 implicit Euler refactor)

**現状実装** (= 2026-05-06 post-deploy implicit Euler refactor 後): `evolvePhaseSpace` の `frictionCoefficient` 引数経由で **semi-implicit Euler** `newU = (u + a × dτ) / (1 + γkΔ)` の closed-form 1 step solve、 任意 dτ で unconditionally 安定、 substep 不要。 詳細: [`physics/mechanics.ts`](../src/physics/mechanics.ts) docstring + [claude-config/conventions/scientific-computing.md §2](../../../claude-config/conventions/scientific-computing.md) で防止策の階層 ((A) implicit / (B) analytic / (C) substep) を universal 化。

**初期実装 (= 5/6 plan 確定時)** は下記 **substep workaround** だったが、 deploy 後 user 「原理的におかしくない?」 push back を契機に **implicit Euler が線形系で 1 step closed-form で解ける** ことに気付き refactor。 substep は (= explicit Euler を温存して dτ を分割する) 数値 workaround、 implicit Euler は friction の数値不安定性自体を消す L5 root level の fundamental fix。 詳細経緯: [`claude-config/conventions/debugging-discipline.md §1`](../../../claude-config/conventions/debugging-discipline.md) V1/V3 reflection。

#### ✗ 初期 substep workaround (= 後続 implicit Euler refactor で撤廃済、 設計史として保持)

**core idea (= 撤廃済)**: `processPlayerPhysics` / `processLighthouseAI` 内部で `dTau` を `MAX_STABLE_SUB_DTAU = 0.1 sec` 単位に **substep**、 各 substep で friction を current `u` から再計算。

**stability 数値解析**:
- 純 friction `du/dτ = -ku` の **explicit** Euler 安定境界: `|1 - kΔ| < 1` ⟺ `Δ < 2/k = 4 sec` (k=0.5)
- 高 γ 領域での Lorentz boost amplification: `k_eff ≈ γ × k`、 γ_max = 1.89 で `Δ < 2.11 sec`
- `MAX_STABLE_SUB_DTAU = 0.1` は最厳条件の **21x 余裕** + 通常境界の 40x 余裕

**実装方針 (= 撤廃済)**:
- thrust acceleration は tick 内 constant (= 既存設計、 input-driven、 substep 跨ぎ不変)
- friction は per-substep 再計算 (= u 依存のため必須)
- `worldLine` append は **outer 1 回のみ** (= 大 dTau での history flooding 防止、 intermediate state は transient)
- thrust energy consumption は full dTau で 1 回計算 (= 既存挙動と等価)

**execution time (= 撤廃済)**:
- 通常 (dTau=0.008): N=1, overhead 0
- mobile suspend 1h (dTau=3600): N=36000, ~2ms (1 frame drop なし)
- mobile suspend 24h (dTau=86400): N=864000, ~50ms (1 frame drop、 wake 時 1 回限り、 許容)
- N cap 不要 (= linear cost で素直に積分、 cap は scientific correctness を犠牲にする)

#### ✓ 現行 implicit Euler refactor (= 2026-05-06 post-deploy、 commit `c023e02`)

**core idea**: friction が線形項なので **closed-form solve 可**、 `(1 + γkΔ)` の分母で任意 dτ で `|newU| ≤ |u + a × dτ|` の有界性が保証、 sign flip / amplification 構造的に発生しない。

```typescript
// evolvePhaseSpace 内部 (= physics/mechanics.ts):
const explicitU = u + a_world × dτ;  // thrust + boost は explicit
if (frictionCoefficient > 0) {
  const γ = Math.sqrt(1 + |u|²);
  const denom = 1 + γ × frictionCoefficient × dτ;
  newU = explicitU / denom;  // friction の implicit step
} else {
  newU = explicitU;  // 旧 explicit Euler 等価 (= LH 等の caller 不変)
}
```

**stability 数値解析**:
- 連続時間: `du/dτ = a - ku` の解 `u(τ) = u_inf + (u₀ - u_inf) × exp(-kτ)` で常に安定
- 離散 implicit: `newU = (u + a × dτ) / (1 + γkΔ)`、 分母 ≥ 1 で発散不能、 `Δ → ∞` で `newU → 0` (no thrust) or `→ a/k` (terminal balance)、 物理正解と一致
- 半 implicit (= γ は current u から、 friction 部分のみ implicit): 線形系として closed-form solve 可、 完全 implicit (= γ も newU から) は不要

**execution time**:
- 通常 (dTau=0.008): O(1)、 overhead ≈ 0 (= 単純な除算 1 回追加)
- mobile suspend 24h (dTau=86400): O(1)、 substep の ~50ms は不要に
- 旧 substep の N=864000 loop が 1 closed-form solve に置換、 速度向上 + scientific correctness 向上

**選択基準** (= [scientific-computing.md §2](../../../claude-config/conventions/scientific-computing.md) で universal 化):
| 系の性質 | 推奨 algorithm |
|---|---|
| 線形 ODE (= friction、 spring 等) | **(A) implicit Euler** (= 本 plan の現行) |
| 解析解が elementary functions で書ける | (B) analytic |
| 強い非線形 / 多自由度 coupling で implicit が intractable | (C) substep + explicit |

### §2.2 Layer 4: globalActive ベース dTau

**core idea**: 既存 `if (document.hidden) return` を以下の早期 return に置換:

```typescript
const prevLastTime = lastTimeRef.current;
const currentTime = Date.now();
const rawDTau = (currentTime - prevLastTime) / 1000;
lastTimeRef.current = currentTime;

const selfActive = !document.hidden && rawDTau < LARGE_GAP_THRESHOLD_SEC;
const peerActive = anyPeerBroadcastedSince(prevLastTime);
const globalActive = selfActive || peerActive;

if (!globalActive) return;  // P1: skip when nobody active

const dTau = rawDTau;  // P2: integrate full active gap (substepped in physics)
```

**`selfActive` の論理**: `!document.hidden ∧ rawDTau < threshold` (両条件必須):
- `!document.hidden` だけだと lag spike (= main thread 詰まり) で誤って active 判定
- `rawDTau < threshold` だけだと desktop hidden 1Hz throttle で誤って active 判定
- 両 AND で 「**document visible かつ loop が普通に回っていた**」 を表現

**`peerActive` の論理**:
```typescript
const peerActive = Array.from(stale.lastUpdateTimeRef.current.entries())
  .some(([id, t]) => id !== myId && !isLighthouse(id) && t > prevLastTime);
```

`!isLighthouse` 除外理由: host が `processLighthouseAI` 内で毎 tick `lastUpdateTimeRef[lhId] = currentTime` を内部 update する設計 ([useGameLoop.ts:580](../src/hooks/useGameLoop.ts#L580))。 self-as-host のとき LH 経路で self-trigger を起こすため除外、 host 自身の player ID broadcast (= 通常 phaseSpace) が canonical witness。

**LARGE_GAP_THRESHOLD_SEC = 2 sec**: desktop hidden 1Hz throttle (= rawDTau ≤ 1 sec) の 2x 余裕。

### §2.3 mutual amplification 防止: `selfActive` flag in broadcast

**問題**: 両者 hidden 時に互いの broadcast を活動 witness と誤検出 → 自己強化的に integrate + broadcast を継続 → P1 違反 (= 全員 hidden なのに進む)。

**Fix**: `phaseSpace` / `respawn` message に `selfActive: boolean` field 追加、 receiver は `msg.selfActive === true` の場合のみ `lastUpdateTimeRef` 更新。

```typescript
// Sender (gameLoop broadcast site):
sendToNetwork({
  type: "phaseSpace" as const,
  senderId: myId,
  position: newPs.pos,
  velocity: newPs.u,
  heading: newPs.heading,
  alpha: newPs.alpha,
  selfActive,  // ← 追加
});

// Receiver (messageHandler.ts):
const isWitness = msg.selfActive ?? true;  // 旧 build fallback
if (isWitness) {
  lastUpdateTimeRef.current.set(playerId, now);
}
// lastCoordTimeRef は selfActive 不問で update (= gap 検知のため必要)
```

**両者 hidden の収束証明**:
- T=10 同時 hidden、 直前 broadcast は selfActive=true
- T=10 hidden tick: lastUpdate[other]=10 > prev=9.98 で `peerActive=true` → integrate + broadcast (selfActive=false)
- 受信側: selfActive=false → lastUpdate **更新せず** (= stale at T=10 のまま)
- T=11 hidden tick: lastUpdate[other]=10 > prev=10 = **false** → `peerActive=false` → `globalActive=false` → **skip** ✓
- 1-2 tick で収束

**hidden + active 場合の view 連続性**: hidden side も broadcast 継続 (selfActive=false で flag のみ off)、 active side は peer の view を fresh に保つ → un-hide 時の pos.t jump 無し ✓

### §2.4 既存 Rule B との関係

**WebRTC died 経路のみ false negative**:
- mobile long suspend で WebRTC connection 切断 → 自機側 lastUpdate 更新されず → peerActive=false で skip
- reconnect 後、 fresh broadcast で peer.pos.t が一気に進んでいるのが見える → **既存 Rule B が catchup** (= `design/network-recovery.md` の正常経路)

**これは絆創膏ではない**: Rule B は state divergence recovery のための設計柱、 本 plan は Rule B の発火頻度を **削減** する (= mutual hidden case で発火しなくなる、 active case で発火しなくなる)、 残る WebRTC died case のみ Rule B に明示的 fallback。

### §2.5 後方互換

旧 build から受信した broadcast は `selfActive` field 不在 → `msg.selfActive ?? true` の fallback で **active witness 扱い** (= 現行 unconditional 更新と等価)。 deploy 期間中の mixed build session で旧仕様の mutual amplification は旧 build 同士でのみ発生、 全員新 build に揃えば構造的消滅。

---

## §3 各シナリオ検証 (= §2 設計が 9 case 全 OK)

| シナリオ | document.hidden | rawDTau | selfActive | peerActive | dTau | 動作 |
|---|---|---|---|---|---|---|
| 通常 active play | false | 0.008 | true | (irr) | 0.008 | 進む ✓ |
| solo lag 0.5s | false | 0.5 | true | none | 0.5 | 進む ✓ |
| solo 5s 詰まり | false (now) | 5 | **false** | none | 0 | skip ✓ (P1) |
| solo 1h 放置 | false (now) | 3600 | false | none | 0 | skip ✓ (P1) |
| desktop hidden + peer active | true | 1 | false | true | 1 | 進む ✓ (P2) |
| desktop hidden + 全 peer hidden | true | 1 | false | false | 0 | skip (1-2 tick 収束) ✓ |
| mobile suspend + peer active (WebRTC alive) | false (now) | 3600 | false | true | 3600 | substep ~2ms ✓ (P2) |
| mobile suspend + peer active (WebRTC dead) | false (now) | 3600 | false | false | 0 | skip → reconnect で Rule B ✓ |
| mobile suspend + 全 peer 同時 suspend | false (now) | 3600 | false | false | 0 | skip ✓ (P1) |

---

## §4 既存システム互換性

| システム | 影響 | 検証 |
|---|---|---|
| Rule A (凍結) | 自然 advance で split が消える → 発火頻度↓ | 改善 ✓ |
| Rule B (跳躍) | active 経路で発火頻度↓、 WebRTC died case で明示的活用 | 既存設計柱と整合 ✓ |
| beacon migration | lastUpdateTimeRef は per-peer-id、 beacon role と独立 | 影響無し ✓ |
| snapshot apply | 全 peer の lastUpdate を recent 化 (= [snapshot.ts:244](../src/components/game/snapshot.ts#L244))、 transient false positive だが joiner の prev 進行で自然解消 | 影響無し ✓ |
| host migration | 旧 host の lastUpdate stale 化、 新 host broadcast で更新再開 | 影響無し ✓ |
| stale detection | lastUpdateTimeRef の意味は不変 (= broadcast 受信 timestamp)、 selfActive flag で「activity witness としてカウントするか」 のみ変更 | 影響無し ✓ |
| 既存 test | `messageHandler.test.ts` の phaseSpace migration 4 test は selfActive 未指定 → fallback `true` で pass、 selfActive=false 用 test 追加 | 影響軽微 ✓ |

---

## §5 Stage 分割

1. **Stage 1**: `LARGE_GAP_THRESHOLD_SEC = 2` + `MAX_STABLE_SUB_DTAU = 0.1` constants in [`constants.ts`](../src/components/game/constants.ts)
2. **Stage 2**: `processPlayerPhysics` 内部 substep + per-substep friction 再計算 ([`gameLoop.ts:97-233`](../src/components/game/gameLoop.ts))
3. **Stage 3**: `processLighthouseAI` の `evolvePhaseSpace(lh.phaseSpace, vector3Zero(), dTau)` を substep 化 ([`gameLoop.ts:293`](../src/components/game/gameLoop.ts))
4. **Stage 4**: `useGameLoop.ts:187-194` の `if (document.hidden) return` を `globalActive` 早期 return に置換、 `selfActive` 計算
5. **Stage 5**: `phaseSpace` / `respawn` message type に `selfActive?: boolean` 追加 ([`message.ts`](../src/types/message.ts))、 broadcast site で `selfActive` flag 送出 ([`useGameLoop.ts:688-695, 760-767`](../src/hooks/useGameLoop.ts))
6. **Stage 6**: `messageHandler.ts:185, 338` で `lastUpdateTimeRef` 更新を `msg.selfActive ?? true` で gate
7. **Stage 7**: tests
   - `mechanics.test.ts` 拡張: `evolvePhaseSpace` の dTau=45000 friction-only 安定性 (substep 経由)
   - `useGameLoop.activity.test.ts` 新規 (or 既存 hook test に追加): 9 シナリオ x selfActive flag
   - `messageHandler.test.ts`: selfActive=false 時 lastUpdate 不変 / undefined 時 fallback true
8. **Stage 8**: localhost 模擬 — `lastTimeRef -= 3600` 注入 + peer mock で 3 シナリオ動作確認、 odakin に localhost URL 提示
9. **Stage 9**: docs
   - `design/physics.md`: 「dτ = global active time delta」 を P1 設計柱の clarification として追記
   - `design/state-ui.md`: `if (document.hidden) return` 説明を新設計に更新
   - `design/network-recovery.md`: WebRTC died case の Rule B fallback を明示
   - `design/meta-principles.md` §M43: 「dτ semantic は global active time、 per-client active time も per-client wall clock も近似でしかない」
10. **Stage 10**: `SESSION.md` Bug 14 entry を 完全治療 mark + plan close

---

## §6 risks / 却下した代替案

### §6.1 ✗ `Date.now()` → `performance.now()` 切替

**主張案**: clock を mobile suspend で凍結する `performance.now()` に切替、 `if (document.hidden) return` 維持。

**却下根拠**: per-client active time semantic になり P2 違反 (= peer active でも自機 hidden で時間止まる、 因果 split で Rule B 跳躍頻発)。 ユーザー 2 原則 §「誰かアクティヴな時間分は進めないと時間が split する」 と矛盾。

### §6.2 ✗ broadcast 完全 suppress (hidden 中)

**主張案**: hidden 時 broadcast せず。

**却下根拠**: hidden + active peer case で peer の view が stale 化、 un-hide 時に pos.t jump → Rule B 発火。 §2.3 の `selfActive` flag は broadcast 継続しつつ witness のみ off に倒す superior design。

### §6.3 ✗ Substep に N cap

**主張案**: substep 数を `N_max = 1000` 等で cap、 残り dTau は discard。

**却下根拠**: cap した場合の substep size が安定境界を逸脱する場合あり、 substep の安定性保証が壊れる。 N 線形コスト ~50ms@24h で実用充分、 cap 不要。 真に大き過ぎる dTau は §2.4 Rule B fallback で対処。

### §6.4 ✗ 分散合意プロトコル (Paxos / vector clock)

**主張案**: 全 peer の active 状態を分散合意で取得。

**却下根拠**: 我々が答える質問は historical existential (= 過去区間内に誰か broadcast したか) で local message log の existence check で決定可能 (= §「local 計算可能性」 の verification)。 round-trip 不要、 schema 拡張も最小 (= `selfActive` 1 boolean)。

### §6.5 ✗ post-suspend handshake (永続却下) / ✅ snapshot rejoin trigger (= 2026-05-06 implement 済)

> **⚠️ Superseded by**: [`2026-05-06-snapshot-rejoin-host-push.md`](2026-05-06-snapshot-rejoin-host-push.md) (= 2026-05-07 push back で WebRTC reconnect timing race を発見、 wake tick の self trigger は drop されるため host push 対称的拡張に倒す)。 (b) snapshot rejoin trigger 実装 (commit `3de5a78`) は新 plan Stage 1 で revert 予定、 本 §6.5 narrative の 「✅ implement 済」 status は historical (= 一時実装済 → supersede による撤回予定) と read。

**初期 主張案**: wake 時 reconnect で peer に 「私の suspend 中、 あなた active だった?」 を問い合わせる handshake (= activeQuery + activeReport 2 message types + per-peer cumulative active time tracking)。

**5/6 plan 確定時の defer 判断**: 現 plan は local で検出可能な範囲を完全 optimal にカバー、 検出不能 case (= WebRTC died) は Rule B fallback で eventual consistency。 handshake は L4 設計の上に乗る増分機能、 backbone 不変なため後付け可能、 別 plan で対処、 と defer。

**2026-05-06 deploy 後 user push back からの再分析** (= [`claude-config/conventions/debugging-discipline.md §1`](../../../claude-config/conventions/debugging-discipline.md) を spiral で application):

1. **handshake 永続却下**: schema 増分 (= 2 新 message types) + state machine 複雑化、 mechanism overload (= activity tracking 専用 mechanism 追加)。 V2 (= mechanism classification) で過負荷 signal、 「activity tracking 専用 mechanism」 は既存 globalActive と冗長で structural overhead が高い。

2. **代替案 (a) cumActive piggyback も却下**: broadcast schema に `cumulativeActiveSeconds` field 追加で全 case unified を狙ったが V1 (= numeric trace) で:
   - **B-disconnect over-count**: A 視点で B 短期切断 + reconnect 時、 max(self_delta, peer_max_delta) で B の cumActive catchup が own active で integrate 済の期間を再 integrate
   - **case 4 under-count with min clamp**: post-reconnect tick で `min(rawDTau=8ms, peer_delta=3600)` clamp で peer_delta=3600 を取り損ね、 self.pos.t 8ms しか進まず Rule B 跳躍が依然必要
   - 5 種 refinement (= max → min → max with clamp → max(self, min(peer, rawDTau-self)) → min(rawDTau, self+peer)) で他 case 破壊、 closed-form root 不可と判定。

3. **代替案 (b) snapshot rejoin trigger** (= **un-defer 候補、 推奨 fix path**): long-gap detect (= `rawDTau > LONG_GAP_THRESHOLD = 10 sec`) で snapshotRequest を BH に送って既存 snapshot mechanism で event state (= killLog / scores / debris / 等) を sync。 V2 (= code coverage verify) で [`RelativisticGame.tsx:216`](../src/components/RelativisticGame.tsx#L216) の `if (store.players.has(newId)) continue;` (= "Stage F: 既存 peer は event log から self-maintained") を確認、 wake-from-suspend で **host は snapshot push を skip** する明示設計、 self は missed event recovery 経路が**無い**。 つまり 5/6 deploy のみで wake handle されるのは Rule B catchup による pos.t 同期だけで、 event 系 state は stale のまま (= missed kill で 「self alive 認識 vs peer 死亡扱い」 inconsistent state)。 snapshot rejoin trigger は genuine 必要。

**現状 5/6 build 15:52 deploy で覆われる範囲** (= V2 で確認した implement 前の状態):
- ✓ self.pos.t: Rule B catchup で同期 (= peer.pos.t 受信 → 自分が past cone 内 → λ jump で前進)
- ✗ event 系 (= killLog / scores / debris): host snapshot push skip + self snapshotRequest auto-trigger 不発で stale のまま、 missed kill で inconsistent state 発生可

**2026-05-06 deploy 後 implement 済 (= 本 plan §6.5 (b) を un-defer)**:

**実装** (= 設計対称性で minimum 侵襲、 commit `3de5a78`):

```typescript
// useGameLoop.ts gameLoop tick 冒頭、 globalActive check より前:
if (rawDTau > LONG_GAP_RESYNC_THRESHOLD_SEC && !peerManager.getIsBeaconHolder()) {
  const hostId = peerManager.getBeaconHolderId();
  if (hostId) {
    peerManager.sendTo(hostId, { type: "snapshotRequest" as const });
  }
}
```

**設計対称性の活用** (= applySnapshot 変更不要):
- existing isMigrationPath path (= host migration で使う) が wake-from-suspend に対称的に適用可能、 self.players.has(myId)=true の condition で自動的に merge logic 経路に乗る
- self.phaseSpace.pos.t local 優先 ✓ (= Rule B catchup と整合、 設計柱「sync = snapshot、 causal divergence = Rule B」 の責務分離)
- killLog / respawnLog union merge ✓ (= missed kill 流入 → selectIsDead 自動更新 → ghost mode → respawn poll 起動)
- scores 観測者相対で local 保持 ✓ (= firePendingKillEvents が past-cone 到達時 independently 加算)
- displayNames merge ✓

**閾値選択 `LONG_GAP_RESYNC_THRESHOLD_SEC = 10` 根拠**: 通常 lag spike (= GC pause / debugger break) は ~5 sec 以内、 LARGE_GAP_THRESHOLD_SEC = 2 sec の selfActive 判定との間に余白を持たせて誤発火を抑制。 mobile suspend は通常 数分以上で 10 sec 余裕で超過。

**globalActive check より前 trigger 配置の根拠**: WebRTC died case (= peer broadcast 届かず peerActive=false) でも長 gap 検知すれば snapshot を pull して event sync 可能、 globalActive=false skip path でも fire させて 5/6 deploy 後の残 case を覆う。

**self が BH のとき**: snapshotRequest 相手不在で skip (= solo or post-migration、 self 自身が canonical source)、 condition `!peerManager.getIsBeaconHolder()` で自動分岐。

**新 message type 追加 0 個**、 **新 schema field 追加 0 個**: 既存 `snapshotRequest` message + 既存 `applySnapshot.isMigrationPath` path の trigger 拡張のみ。 cumActive piggyback / handshake 案の structural cost と対照的に minimum 侵襲。

**関連メタ規律**: 本節分析は [`claude-config/conventions/debugging-discipline.md §1`](../../../claude-config/conventions/debugging-discipline.md) の universal application 例 (= V1 で cumActive 却下、 V2 で 「Rule B fallback で十分」 仮判断を撤回、 V3 で algorithm 網羅で implicit Euler refactor)。 implement の対称性検討は同 §4 の 「rule violation 1 件発見 → sibling audit」 の application (= layer 2 → 3 markdown link 1 件発見 → 12 件 sibling sweep + promote refactor の延長で本 trigger 実装、 同種思考 reflex)。

---

## §7 References

- [`SESSION.md`](../SESSION.md) Bug 14 entry — live capture finding + 仮説変遷
- [`repro/2026-05-06-bug14-state/`](../repro/2026-05-06-bug14-state/) — 12.5h suspend + alive human 単独 runaway の実機 evidence
- [`design/physics.md`](../design/physics.md) — dτ = wall_dt の P1 設計柱
- [`design/network-recovery.md`](../design/network-recovery.md) — Rule B catchup 経路
- [`design/meta-principles.md`](../design/meta-principles.md) — §M41 (β/γ diagnostic)、 §M42 (ring buffer GC)、 §M43 (= dτ semantic = global active time、 本 plan で導入)
- [`plans/2026-05-02-causality-symmetric-jump.md`](2026-05-02-causality-symmetric-jump.md) — Rule B 設計 + §11.6 λ cap 却下根拠 (= 本 plan の L0 dTau cap 却下と独立)
- [`plans/2026-05-06-npc-asymmetric-causality.md`](2026-05-06-npc-asymmetric-causality.md) — NPC 経路の伝染遮断、 本 plan の前提として完了
- [`src/hooks/useGameLoop.ts`](../src/hooks/useGameLoop.ts) — gameLoop fire site、 visibility check + broadcast
- [`src/components/game/gameLoop.ts`](../src/components/game/gameLoop.ts) — `processPlayerPhysics` + `processLighthouseAI`
- [`src/components/game/messageHandler.ts`](../src/components/game/messageHandler.ts) — `lastUpdateTimeRef` 更新 site
- [`src/types/message.ts`](../src/types/message.ts) — message schema
- [`src/components/game/constants.ts`](../src/components/game/constants.ts) — physics constants
