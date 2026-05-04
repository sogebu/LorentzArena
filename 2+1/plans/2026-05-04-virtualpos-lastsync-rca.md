# Plan: virtualPos lastSync 管理 bug の RCA + 修正 (Bug 10 真因)

**起草**: 2026-05-04
**Trigger**: 5/4 user plays で「凄い勢いで固有時 (= pos.t) が増えていく」 + 「また星屑が固まる」 (= Bug 10 再発) を観察。 一人 plays + host migration 直後の状況。

## §1 観察 fact + RCA

### 観察された symptom

- 自機が host 昇格 (= 旧 host `1l8ixidlw` heartbeat timeout → 自機 `whwpx8y4o` が beacon acquire)
- 速さ 0.0% c、 ガンマ因子 1.000、 位置 (-2.86, 2.43) で **静止**
- 「世界時刻 (= pos.t)」 が 100858 sec (= 約 28 hours、 plays 数分相当 wall_clock より大幅未来)
- 「凄い勢いで増えていく」 = continuous な高 rate advance
- console: `THREE.WebGLRenderer: Context Lost` + `[Violation] 'setInterval' handler took <N>ms` × 8 (= Bug 10 の前兆症状)
- 星屑 / 全世界が凍結 (= rAF starve)

### user の指摘 = RCA の核

> 「一人だけで相手が居ない状態でなんで暴走できるの？相手の過去光円錐まで伸ばす、というアルゴリズムが正しく実装されてたら暴走のしようがなくない？」

これは数学的に正。 Rule B 公式:
```
λ_exit = max_p ((peer.pos.t − self.pos.t) − |peer.xy − self.xy|)
```
- jump 後 self.pos.t = peer.pos.t − dist (= peer の past null cone surface 上)
- 次 tick で λ = 0 (= self は peer の cone 外、 boundary 上)
- **fixed point** に到達 → 通常 wall_dt 程度の rate でしか coord time は進まない

「凄い勢い」 になるためには **peer.pos.t が wall_dt 以上の rate で advance しているように見える** 必要がある。 一人 plays でも「peer」 として LH (lighthouse) が常に存在 → LH が wall_clock 比例で線形に未来へ「動いて見える」 経路があるか?

### code 経路精査 (= virtualPos / lastUpdateTimeRef)

`useGameLoop.ts:544` (alive 自機 Rule B):
```ts
for (const [pId, p] of fresh.players) {
  if (pId === myId) continue;
  if (p.isDead) continue;
  const lastSync =
    stale.lastUpdateTimeRef.current.get(pId) ?? currentTime;
  const vPos = virtualPos(p, lastSync, currentTime);
  // ...
}
```

`virtualPos.ts`:
```ts
const tau = (nowWall - lastSyncWall) / 1000;
return { ...p, pos: { t: ps.pos.t + g * tau, ... } }
```

`tau` が大きいほど `virtualPos.pos.t` が wall_clock 比例で advance。

**`lastUpdateTimeRef.set(...)` の更新 path 全 grep**:

| 場所 | 更新タイミング | 対象 |
|---|---|---|
| `messageHandler.ts:179` | phaseSpace message 受信時 | remote peer |
| `messageHandler.ts:326` | 別 message 受信時 | remote peer |
| `snapshot.ts:231` | snapshot apply 時 | remote peer |
| `useStaleDetection.ts:142` | peer remove 時 (= delete) | remote peer |

→ `lastUpdateTimeRef` は **remote peer broadcast 受信時にのみ set される**。

### bug 構造の確定

**自機が host のとき (= isBeaconHolder true)**:
1. 自機が `processLighthouseAI` で LH を毎 tick state update (= `lhNewPs = evolvePhaseSpace(...)` + 必要なら Rule B)
2. しかし LH の `lastUpdateTimeRef` は **remote broadcast 起点でしか update されない** → 自機 host が処理しても更新しない
3. `currentTime - lastSync` が wall_clock で線形増加
4. 自機 alive Rule B (line 544) で `peer = LH` を見る時、 `virtualPos(LH, oldLastSync, currentTime)` で LH.pos.t が **wall_clock 比例で線形 advance**
5. 自機 Rule B が「LH に追いつくため」 huge λ で fire を連発
6. self.pos.t が暴走

**host migration 直後の致命シナリオ**:
- 旧 host が LH を broadcast していた → 自機 lastUpdateTimeRef[LH] は旧 host 最後 broadcast 時刻 T_old
- 旧 host timeout (= 数秒) → 自機 host 昇格 → 但し lastUpdateTimeRef は T_old のまま
- migration 後 currentTime - T_old は秒単位 → virtualPos(LH).pos.t advance も秒単位
- Rule B fire λ も秒単位 → self.pos.t も秒単位 advance / tick → 「凄い勢い」 観察と一致

**`processLighthouseAI` 側 (= host が peer = 自機 を Rule B 評価)**:
- `gameLoop.ts:295`: `lastUpdateTimes.get(pId) ?? currentTime` で myId の lastSync を引く
- myId は remote peer ではないので messageHandler が set しない → 常に未設定 → `?? currentTime` fallback → tau = 0 → 健全
- → bug は **alive 自機 Rule B 側のみ**

### RCA 確定

**真の root cause**:
- `lastUpdateTimeRef` の semantic = 「peer の state が最後に確定した時刻」 (= virtualPos の inertial 延長基点として使う)
- 現実装の semantic = 「remote peer broadcast 受信時刻のみ」
- **host 自身が処理する peer (= 自機 host のときの LH)** は毎 tick state 確定しているのに lastSync は更新されない = semantic 矛盾
- 結果: virtualPos が線形発散 → Rule B が公式通りでも自機 pos.t が暴走

user 指摘「正しく実装されてたら暴走しない」 = 数学的には正、 暴走は **lastSync 管理 bug = 実装の semantic 矛盾**。

### Bug 10 (= 星屑凍結) との関係

self.pos.t 暴走 → Rule B `isLargeJump(lambda)` true 連発 → `frozenWorldLines.push(...)` 毎 tick → SceneContent の `frozenWorldLines.map((fw, i) => <WorldLineRenderer key={frozen-i-${fw.worldLine.history[0]?.pos.t}}>)` で **key が毎 tick 変化 → WorldLineRenderer が毎 tick mount/unmount** → 5/2 fix の wlRef throttle を **bypass** (= initial mount は必ず geometry build) → main thread saturation → setInterval Violation → rAF starve → 星屑凍結 + Context Lost。

→ **Bug 10 は二次症状、 真因は本 plan の lastSync bug**。 5/2 fix (= renderer 単体) は対症療法、 同 class bug の origin (= frozenWorldLines cycling) を絶てない構造だった。

## §2 設計上の bug 構造 (= semantic の整理)

### `lastUpdateTimeRef` の意図された semantic

「**peer の state が最後に確定 (= 信頼できる) した時刻**」。 virtualPos の `tau = currentTime - lastSync` で inertial 延長 = 「lastSync 以降は state を broadcast 経由で受け取っていない、 だから物理予測で延長」。

### 現実装の semantic

「remote peer から phaseSpace / snapshot message を受信した時刻」。 host 自身が処理する peer (= 自機が LH owner) は対象外。

### 矛盾の発生

host が LH を毎 tick 処理しているのに、 lastSync は update されない → host にとって LH の state は毎 tick 確定 (= 自分で計算している) なのに、 virtualPos は「lastSync 以降は不確定」 と扱う → 線形延長で発散。

### 真の semantic (= fix 後)

「peer の state が最後に確定した時刻 = max(remote broadcast 受信時刻, host 自身が処理した時刻)」。

## §3 Fix 設計

### Fix A (= 本命、 host-side LH lastSync 更新)

**位置**: `useGameLoop.ts` の alive 自機 Rule B branch、 peer loop 開始前

**実装**:
```ts
// Fix: host 自身が処理する LH の lastUpdateTimeRef を毎 tick currentTime に
// update する (= host が processLighthouseAI で LH state を毎 tick 更新している
// のに、 lastUpdateTimeRef は remote broadcast 経由でしか set されないため、
// host migration 後 / 自機 host 中は LH の lastSync が古いまま virtualPos が
// 線形発散して self の Rule B が暴走する bug の修正)。
// `processLighthouseAI` 側 (= host が peer = 自機 を Rule B 評価) は myId の
// lastUpdateTimeRef が未設定 → `?? currentTime` fallback で tau = 0 健全のため
// LH 側のみ修正で十分。
if (isBeaconHolder) {
  for (const [pId] of fresh.players) {
    if (isLighthouse(pId)) {
      stale.lastUpdateTimeRef.current.set(pId, currentTime);
    }
  }
}
```

**効果**: 自機 host 時 LH.lastSync = currentTime → tau = 0 → virtualPos(LH) = LH.actual pos → Rule B は LH の actual state で評価 → 公式通り fixed point 動作。

### Fix C (= LH 大ジャンプ凍結機構 — 5/2 plan §5.5 implementation gap)

**追加根拠** (2026-05-04 user 指摘): 「A が B の未来側にいて A に因果律凍結がでるとき、 B
は A の過去光円錐まで跳躍して B に因果律跳躍が起こらないとおかしくないか?」

物理的対称性: A.t > B.t + dist の状況で A's tab で Rule A fire (= 凍結) なら、 B's tab
で Rule B fire (= 跳躍) が同時起きるべき。 player 間ではそれぞれの useGameLoop で別々に
評価されるため設計上動いている (= 但し小 λ では overlay 閾値 `LARGE_JUMP_THRESHOLD_LS =
0.5 ls` 未満で visible cue 不発、 これは別議論)。 一方 **LH (lighthouse) 側は 5/2 Stage 4
で Rule B 実装したが、 Stage 3 (= 大ジャンプ閾値判定 + frozenWorldLines push + 新セグメント
開始) と接続漏れ**。 結果、 LH の Rule B fire 時に大 gap でも単純 `appendWorldLine` で履歴
に積まれ、 worldLine 上に visible discontinuity が生まれない → user 視点で「LH 跳躍が
起こってない」 ように見える。

これは plan §5.5「Q6 決定: 既存 worldLine 凍結機構を Rule B 大ジャンプにも適用」 の **意図
の implementation gap**。 Stage 4 で「LH の Rule B 置換」 を実装した時に Stage 3 機構との
接続を忘れていた。

**位置**: `gameLoop.ts processLighthouseAI` の Rule B branch (line 305-311)

**実装方針**: caller (= useGameLoop) で `setFrozenWorldLines` を呼ぶ side-effect-free
設計。 `processLighthouseAI` の return に optional `largeJumpFrozen?: FrozenWorldLine`
を追加 (= 大ジャンプの場合の旧 LH worldLine + 識別情報)、 caller が非 null なら push。

```ts
// processLighthouseAI 内、 Rule B branch 修正
if (lambda > 0) {
  const adjustedLhPs = createPhaseSpace(
    createVector4(lhNewPs.pos.t + lambda, lhNewPs.pos.x, lhNewPs.pos.y, 0),
    vector3Zero(),
  );
  if (isLargeJump(lambda)) {
    // 大ジャンプ: caller で旧 worldLine を frozenWorldLines に push、 新セグメント
    // 開始 (= self alive Rule B と対称、 plan §5.5 の意図)。
    const frozenSnapshot = pushFrozenWorldLine([], lh)[0]; // build FrozenWorldLine
    lhNewWl = appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), adjustedLhPs);
    return { newPs: adjustedLhPs, newWl: lhNewWl, laser: null, largeJumpFrozen: frozenSnapshot };
  }
  lhNewPs = adjustedLhPs;
}
const lhNewWl = appendWorldLine(lh.worldLine, lhNewPs);
return { newPs: lhNewPs, newWl: lhNewWl, laser: null };
```

**caller** (`useGameLoop.ts`):
```ts
const result = processLighthouseAI(...);
if (result.largeJumpFrozen) {
  fresh.setFrozenWorldLines((prev) => [...prev, result.largeJumpFrozen!]);
}
```

**LH overlay は不要**: LH は AI で UI 持たないため `incrementCausalityJump()` は呼ばない。
visible cue は LH の frozenWorldLines が増えることで代替 (= 既存 SceneContent renderer
で描画される LH 凍結 worldLine = 「LH ここまでの軌跡が凍結」 が user に見える)。

### Fix B (= 一般 safety net、 virtualPos の tau upper bound)

**位置**: `virtualWorldLine.ts` の `virtualPos` 関数内

**実装**:
```ts
const MAX_VIRTUAL_TAU_SEC = 2; // upper bound for inertial extrapolation
const realTau = (nowWall - lastSyncWall) / 1000;
const tau = Math.min(realTau, MAX_VIRTUAL_TAU_SEC);
return { ...p, pos: { t: ps.pos.t + g * tau, ... } }
```

**効果**: 万一 lastSync が壊れても virtualPos の advance が最大 N=2 sec に bounded → 自機 Rule B も最大 N 秒分しか追従しない (= 暴走しない、 1 度の jump で N 秒先に fixed point)。

**N=2 sec の理論的根拠**:
- 下限: hidden tab 復帰 (= Stage 6 で「lastTimeRef を hidden 中も毎 throttle tick で update」) の延長要件は wall_dt 単位 (= 16ms)、 N=1 sec も safe
- 上限: 「stale peer が remove される前の最大期待 broadcast 間隔」 = heartbeat ~5 sec の半分 ~2.5 sec
- → **N=2 sec** が良いバランス。 通常 plays では tau < 100ms なので cap が効くシナリオは bug / extreme 切断のみ

### Fix A vs Fix B の関係

- Fix A は **本 bug 専用 root fix** (= LH lastSync の semantic 修復)
- Fix B は **一般 safety net** (= 同 class bug が他 peer / 別 path で再発しても遮断)
- 両方適用が完全。 Fix A で bug 解消、 Fix B で防衛厚

## §4 Stage 分け

| Stage | 内容 | 工数 | risk |
|---|---|---|---|
| **1** | RCA reproduction test 追加 — host migration scenario の simulation で virtualPos.lastSync 古値 → Rule B 暴走を再現する unit test (現在の bug をテストで固定化、 fix 後に passing) | 30 分 | 低 |
| **2** | **Fix A 実装** — useGameLoop alive 自機 Rule B branch に host-side LH lastSync update | 15 分 | 低 (= 1 line 追加、 既存 path 無修正) |
| **3** | **Fix B 実装** — virtualPos に tau upper bound MAX_VIRTUAL_TAU_SEC=2 sec | 20 分 | 低 (= 1 line 修正、 既存 test で regression check) |
| **4** | integration test — 一人 plays + host migration scenario の simulation で Fix 後 self.pos.t が wall_dt 程度 rate で advance、 Rule B 暴走しないことを確認 | 30 分 | 低 |
| **5** | preview 検証 + commit + push + deploy | 15 分 | 低 |
| **6** | user 実機検証 — 実機 5+ 分 plays、 host migration trigger、 setInterval Violation 観察 | user 任せ | — |

総工数 ~2 時間。 各 stage 1 commit。

## §5 検証戦略

### automated 検証

- typecheck pass (= 1 line 追加 / 修正で型エラー無し)
- 既存 237 test 全 pass (= regression 無し)
- 新規 RCA reproduce test (Stage 1) が:
  - Fix 前: failing (= bug 再現)
  - Fix 後 (Stage 2 / 3): passing
- integration test (Stage 4) で host migration scenario simulation passing

### preview 検証

- preview server 起動、 in-arena に入る
- `window.__game.getState()` で `players` Map に LH があることを確認
- `incrementCanvasGeneration` 等で WebGL state を観測しつつ 1 分 plays
- self.pos.t (= 世界時刻) の advance rate が wall_clock + 程度であることを確認 (= 「凄い勢い」 にならない)

### user 実機検証 (= Stage 6)

- 5+ 分 plays (= Bug 10 顕在化閾値)
- 必要なら multi-tab で host migration trigger (= 別 tab を closes して自機を host 昇格させる)
- 観察項目:
  - 「世界時刻」 (HUD 右下) が wall_clock + 程度の rate で進む (= 暴走しない)
  - 「星屑が固まる」 / 全世界凍結が起きない
  - console に setInterval Violation が累積しない (= 5/2 と同 symptom 無し)
  - WebGL Context Lost が出ない (= 二次症状解消)

## §6 Rollback / abort 戦略

- Fix A (= Stage 2)、 Fix B (= Stage 3) は それぞれ独立 commit
- 万一 hidden tab 復帰 regression (= Fix B の N=2 sec が短すぎ) が出たら N を 5 sec 等に上方修正
- 万一 Fix A で別 path の問題 (= 自機 host 時に LH 以外の peer に伝播) が出たら Fix A を revert、 Fix B (= 一般 safety net) のみで運用
- 各 stage の commit 単位で `git revert` 可

## §7 RCA に含めなかった事項 (= 別 plan)

### Renderer 系 audit (= Bug 10 二次防衛)

5/2 fix は WorldLineRenderer 単体修復、 frozenWorldLines cycling 時の mount storm を完全には防げなかった。 本 plan の Layer 2 fix (= virtualPos lastSync) で **真因** が消えれば、 Renderer 系の audit は **同 class 防衛** として priority 低下。

但し別 path で `frozenWorldLines` が cycling する可能性 (= Rule B 以外の経路で worldLine 凍結が頻発するシナリオ) もあるため、 別 plan として:
- 全 renderer の `useMemo` deps audit
- `wlRef` pattern の標準化 + ガイドライン
- `frozenWorldLines` cycling 時の WorldLineRenderer 数固定 (= recycle pool) を検討

を後ほど起こす。

### Rule B 設計変更 (= 不要)

user 指摘 + 数学的検証で Rule B 公式は **正しい**。 設計変更不要。 真因は実装の semantic 矛盾 (= lastSync 管理) であって設計の発散性ではない。

「Rule B が monotonic max 演算で発散する」 という前 turn の議論は誤解であった。 **正しく lastSync が管理されていれば fixed point に到達**。 設計変更を伴う fix (= λ upper bound, friction, LH derive 化) は本 plan では採用しない。

### gameLoop.ts:520 の `processOtherPlayerPhysics` skip ロジック

docstring 「Skip 対象: 自機 / Lighthouse / 死亡 peer」 は別 path (= remote 他 player の物理 catchup)、 本 plan の bug とは独立。 修正対象外。

## §8 適用後の measure (= 「治った」 と判定する基準)

| Metric | 基準 |
|---|---|
| 一人 plays + host 単独で 5 分以上 plays | 世界時刻 advance rate が wall_clock の ±10% 以内 (= γ=1 想定で wall_clock + 程度) |
| host migration scenario | migration 直後 self.pos.t 飛び 1 sec 未満、 以降 wall_clock rate に収束 |
| Bug 10 (= 星屑凍結) 観察 | 5+ 分 plays で setInterval Violation 累積無し、 全世界凍結無し |
| WebGL Context Lost | 5+ 分 plays で 0 回 (= 二次症状解消) |

これらが達成されれば本 plan 完了。
