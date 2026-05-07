# Snapshot rejoin の真の根本治療: host push の対称的拡張

**Date**: 2026-05-06 (= deploy build `16:38:54` 後)
**Status**: ✅ **完了 (2026-05-07)** — Stage 1-6 全実装、 sibling violation 0 件、 全 280 test pass (= 274 baseline + 6 新規 = host push 4 case + edge case + default arg verify)
**Trigger**: [`plans/2026-05-06-bug14-global-active-time.md §6.5`](2026-05-06-bug14-global-active-time.md) で実装した snapshot rejoin trigger ([commit `3de5a78`](https://github.com/sogebu/LorentzArena/commit/3de5a78)) が **wake-from-suspend で実は機能しない** ことが post-deploy reflection で判明。 真の根本案を再検討。

**Supersedes**: 2026-05-06-bug14-global-active-time.md §6.5 (= self 側 trigger 案)。 本 plan で revert + replace。

---

## §1 何が起きていたか (= 私の V2 audit failure の RCA)

### §1.1 観察

私が 5/6 deploy 後に implement した snapshot rejoin trigger:

```typescript
// useGameLoop.ts gameLoop tick 冒頭:
if (rawDTau > LONG_GAP_RESYNC_THRESHOLD_SEC && !peerManager.getIsBeaconHolder()) {
  const hostId = peerManager.getBeaconHolderId();
  if (hostId) {
    peerManager.sendTo(hostId, { type: "snapshotRequest" as const });
  }
}
```

これは **wake-from-suspend で fire するが、 WebRTC connection が reconnect 完了する前** に fire するため snapshotRequest が drop される。 PeerJS は connection が open でない send を **buffer せず drop** する設計。

時間軸 trace:

```
T=0     suspend 開始 (= JS 停止、 WebRTC dead)
T=N     wake、 JS 復活
T=N+ε   queued setInterval 即発火 → gameLoop 1 回目
        rawDTau = N min > 10 sec → 私の trigger fire
        ★ WebRTC は reconnect 中、 send drop
T=N+1〜3 PeerProvider が WebRTC reconnect
        通常 phaseSpace 流入再開
        ★ でも私の trigger は wake tick で 1 回しか fire しない (= rawDTau 小に戻り次以降は不発)
        → snapshotRequest は再 fire されず、 missed event は recover されない
```

### §1.2 私の V2 audit 違反

[`debugging-discipline.md §1 V2`](../../../claude-config/conventions/debugging-discipline.md) は「既存 X が handle 済」 主張を **actual code を読んで scenario trace で coverage 確認** することを要求。 私は last summary で 「WebRTC connection 確立前に trigger fire の case は ε-rare として defer」 と書いた時点で、 「`useSnapshotRetry` の retry 経路を使う」 を漠然と仮定したが actual code 未読。

実際に [`useSnapshotRetry.ts`](../src/hooks/useSnapshotRetry.ts) を読むと:

```typescript
if (hasMyPlayer) return;  // ← wake-from-suspend では hasMyPlayer=true、 retry 経路発動しない
```

つまり既存 useSnapshotRetry は wake-from-suspend には無関係。 私の implementation は **retry 機構なしで 1 shot fire**、 WebRTC reconnect timing で確実に lost する設計欠陥。

### §1.3 「Option B (= self 側 retry)」 を再検討して却下した理由

V2 違反発見後、 自然な fix は self 側に retry state machine を追加 (= max 3 attempts × 2 sec interval) する Option B。 但し V1+V2+V3 audit を回すと **これも絆創膏** と判明:

- **V2 (mechanism classification)**: 新規 joiner case では **host が `peer.on('connection', ...)` で push-on-connection-event** が primary、 useSnapshotRetry は **secondary belt-and-suspenders** (= primary 失敗時の保険)。 wake-from-suspend で「self 側 trigger を primary」 にするのは新規 joiner pattern との **対称性逸脱** (= primary 役を入れ替えると 2 つの case で異なる responsibility 配置に)
- **V3 (algorithm enumeration、 ここでは mechanism enumeration)**: 既存 push (= host responsibility) と pull (= self belt) の 2 mechanism のうち、 wake-from-suspend の「missed event 通知」 は **host が WebRTC connection event を直接観測する push** が natural class fit。 self 側の polling は host event を間接的に推定する indirect 経路で、 timing 不確実性 + bandwidth 重複 + state machine 複雑化 を全て持ち込む

つまり Option B は L4 layer (= 責務分離) で誤った design choice。

---

## §2 真の根本案: host push の skip 条件を時間軸で拡張

### §2.1 現状の design 欠陥 (= V2 で発見)

[`RelativisticGame.tsx:216`](../src/components/RelativisticGame.tsx#L216):

```typescript
if (store.players.has(newId)) continue;  // 既存 peer は snapshot 受け取らない
peerManager.sendTo(newId, buildSnapshot(myId, true));
```

コメント:
> Stage F: 既存 peer (= store に entry がある) は event log から self-maintained。

この前提は **「WebRTC connection が連続的に保たれている」** こと。 long disconnect (= mobile suspend、 network drop 数分) では event log の self-maintain が成り立たない (= broadcast が届かない期間中の event は missed)。 つまり **skip 条件が時間軸を考慮していない設計欠陥**。

### §2.2 修正案: 「stale reconnect」 を skip 例外に追加

```typescript
for (const newId of newPeerIds) {
  const lastSeen = stale.lastUpdateTimeRef.current.get(newId) ?? 0;
  const isNewJoiner = !store.players.has(newId);
  const isStaleReconnect = !isNewJoiner && (Date.now() - lastSeen) > LONG_GAP_RESYNC_THRESHOLD_MS;

  if (!isNewJoiner && !isStaleReconnect) continue;  // 短期 reconnect のみ skip
  peerManager.sendTo(newId, buildSnapshot(myId, true));
}
```

これにより:

| Case | `players.has(newId)` | `lastSeen stale > threshold` | snapshot push |
|---|---|---|---|
| 新規 joiner | false | (irrelevant) | ✅ push |
| 短期 disconnect (< threshold、 例: network blip) | true | false | ⏭️ skip (= broadcast で event log self-maintained 成立、 spurious push 抑制) |
| **長期 disconnect (= mobile suspend、 wake-from-suspend)** | true | **true** | ✅ **push** |
| migration | (player entry が削除 + 再登録される設計、 通常 case 1 と同等) | — | ✅ push |

**新規 joiner case との対称性**: 
- 新規 joiner: host が新 connection event → push
- Wake-from-suspend: host が stale-reconnect event → push
- どちらも **host responsibility** で **WebRTC connection event を起点**、 同 mechanism。

### §2.3 self 側 trigger の完全撤回

[`useGameLoop.ts`](../src/hooks/useGameLoop.ts) の long-gap trigger + [`constants.ts`](../src/components/game/constants.ts) の `LONG_GAP_RESYNC_THRESHOLD_SEC` constant は **完全削除** (= revert)。

- self 側に retry state 不要
- self は受信を待つだけ、 host が responsibility 持つ
- 「self が host の責務を回避する」 self-pull pattern を排除

### §2.4 timing 信頼性

host 側の `peer.on('connection', ...)` event は WebRTC connection が **open になった瞬間** に fire (= PeerJS internal)、 snapshot push は connection open 状態で確実に届く。 buffering / drop の race なし。

self 側 trigger の polling-based timing 不確実性 (= WebRTC reconnect timing と gameLoop tick の race) を構造的に排除。

---

## §3 設計対称性の確認 (= V1 + V2 audit)

### V1: scenario trace

| # | scenario | 期待挙動 | 現実装 | 本案 |
|---|---|---|---|---|
| 1 | 新規 joiner connect | snapshot push | ✅ push | ✅ push (= 不変) |
| 2 | 短期 disconnect + reconnect (= network blip < 10 sec) | broadcast 流入で self-maintain、 spurious push 抑制 | ✅ skip (= 既存 logic 通り) | ✅ skip (= isStaleReconnect=false) |
| 3 | mobile suspend → wake (= long disconnect、 通常 minutes〜hours) | event 系 sync が必要 | ❌ skip (= 設計欠陥)、 self 側 trigger も WebRTC race で fail | ✅ push (= isStaleReconnect=true) |
| 4 | host migration (= player entry 削除 + 再登録) | snapshot push | ✅ push (= !players.has で case 1 と同等) | ✅ push (= 不変) |

case 1, 2, 4 で挙動不変、 case 3 で **設計欠陥 fix**。

### V2: code coverage

- `RelativisticGame.tsx:216` の skip 条件: 修正 1 line
- `peer.on('connection', ...)` event: PeerJS internal、 connection open 後 fire (= timing 確実)
- `applySnapshot.isMigrationPath`: wake-from-suspend で `players.has(myId)=true` で migration path に乗る、 既存 union merge logic で event 系 sync 自動完結 (= 5/6 deploy 時に確認済の対称性)
- `lastUpdateTimeRef`: 既に各 peer 受信時刻を記録 (= [`messageHandler.ts:185`](../src/components/game/messageHandler.ts#L185))、 stale 判定の信号として再利用可、 新 ref 不要

### V3 (mechanism classification)

- new mechanism 追加: **0 個**
- 既存 host push-on-connection-event の **skip 条件拡張のみ** (= 1 line + isStaleReconnect 計算 2-3 line)
- self 側 trigger 撤回で **net negative LOC** (= 削除分が新規分を上回る)

### Sibling audit (= [`debugging-discipline.md §4`](../../../claude-config/conventions/debugging-discipline.md))

「skip 条件が時間軸を考慮していない」 という設計欠陥 pattern が他にもないか sibling sweep:

- `cleanupPeer` / `markStale` / `recoverStale` 等の peer lifecycle handler で同種 pattern 無いか
- `useStaleDetection.ts` の stale 判定 (= 既に時間軸ベース、 OK)
- 他の `peer.on(...)` handler で skip 条件が peer state-only で時間軸不在 のもの

実装 session で grep + audit を実施し、 sibling violations あれば同 commit で sweep。

---

## §4 Stage 分割 (= 別 session で実装)

| Stage | 内容 | scope | Status |
|---|---|---|---|
| **Stage 1** | self 側 trigger 撤回 | `useGameLoop.ts` の long-gap trigger 削除 + import 削除 + `constants.ts` の `LONG_GAP_RESYNC_THRESHOLD_SEC` 削除 (= ms 版で再追加するため value 変更) | ✅ 完了 |
| **Stage 2** | host 側 skip 条件拡張 | `RelativisticGame.tsx:216` の if 条件を `shouldPushSnapshotOnConnection` pure helper 経由で isStaleReconnect 追加 + `constants.ts` に `LONG_GAP_RESYNC_THRESHOLD_MS = 10000` 追加 (= ms 単位、 既存 wallTime 比較と整合)、 helper は `snapshot.ts` で testable に外出し | ✅ 完了 |
| **Stage 3** | sibling audit | `has(...)` skip pattern 11 候補 site を grep + 全 audit、 「state-only skip 条件で時間軸不在」 violation **0 件** confirm (= 他は real-time set / event-driven / within-loop dedup で時間軸不要 patterns) | ✅ 完了 (= 0 sibling violations) |
| **Stage 4** | tests | `snapshot.test.ts` に `shouldPushSnapshotOnConnection` の 6 test 追加 (= 4 case verify + lastSeen=undefined edge + default arg) | ✅ 完了 (= 274 → 280 pass) |
| **Stage 5** | docs | 本 plan close + Bug 14 plan §6.5 を本 plan への redirect に縮約 + SESSION + meta-principles §M43 補足 (= 「新規 joiner と wake-from-suspend は host push primary で対称」) | ✅ 完了 |
| **Stage 6** | deploy + 4 軸 sweep | localhost verify (= multi-tab で hidden tab → 復帰時 snapshot 受信観察) + odakin overnight verify 再 schedule | ✅ build + commit + push |

工数実測: **~50 分** (= 見積もり 30-45 分の +10-20%、 helper 外出し refactor で test 書きやすさを優先、 docs Stage 5 が plan 構成 dense で fan-out 多めになった分の overhead)。

---

## §5 risks / 却下する代替案

### §5.1 ✗ Self 側 retry state machine (= Option B)

last summary で提案、 V1+V2+V3 で却下:
- L4 責務分離違反 (= primary 役を host から self に移す、 新規 joiner case と非対称)
- bandwidth 重複 (= max 3 attempts)
- timing 不確実 (= WebRTC reconnect を polling 推定)
- code 規模大 (= retry state + max attempts + backoff)

### §5.2 ✗ 完全 robust な ack 機構 (= snapshot 受信 → ack → host 再 push retry)

scope creep。 ε-rare な「snapshot push 自体が drop」 は accept、 robustness は別軸の plan で。 本 plan では minimum 侵襲を狙う。

### §5.3 ✗ Host 側に periodic broadcast resync (= 周期的 snapshot push)

scope creep。 帯域消費が常時、 wake-from-suspend という rare event のためには過剰。 event-driven push が efficient。

---

## §6 関連メタ規律

本 plan の RCA 経緯は以下の universal 規律の application 例:

- [`claude-config/conventions/debugging-discipline.md §1`](../../../claude-config/conventions/debugging-discipline.md) **V2 audit failure からの recovery**: 「`useSnapshotRetry` の retry 経路を使う」 という pattern match 仮定が actual code で false (= `hasMyPlayer` 条件で wake-from-suspend に発動しない) と判明、 V2 規律遵守の reflex 不足を反省
- [`claude-config/conventions/debugging-discipline.md §1`](../../../claude-config/conventions/debugging-discipline.md) **V3 (mechanism classification)**: Option B (= self retry) が「self が host の責務を回避する」 mechanism overload signal、 別 mechanism Z (= host event-driven push) の natural class fit を再 audit
- [`claude-config/conventions/debugging-discipline.md §2`](../../../claude-config/conventions/debugging-discipline.md) **Audit verdict 「正当化済」 の user 質問再評価**: user 「前は出てなかったような」 の epistemic skepticism 質問で、 last summary の「ε-rare 扱い」 verdict を撤回 → V1+V2+V3 再 audit → 本 plan の Root-1 (= host push 対称的拡張) に到達
- [`claude-config/conventions/debugging-discipline.md §4`](../../../claude-config/conventions/debugging-discipline.md) **Rule violation 1 件発見 → sibling audit**: skip 条件 1 件の時間軸不在 violation で他 peer lifecycle handler を sweep (= Stage 3)

---

## §7 設計哲学 (= 本 plan に至った deep think の核)

本 plan の RCA 経緯から、 個別の「skip 条件 1 line 拡張」 を超える **5 つの design philosophy** を抽出。 future debug 規律として記録。

### §7.1 対称設計を design choice の最優先軸に置く

design choice の二択で 「**新規 joiner case と wake-from-suspend case を同 mechanism で handle**」 vs 「**新規 joiner case と wake-from-suspend case を異なる mechanism (= self pull) で handle**」 があれば、 **対称を選ぶ**。

理由:
- future contributor の cognitive load が下がる (= 1 mechanism 理解で両 case 把握)
- 規模拡張時の特殊 case scaling が容易 (= 新 case が出ても同 mechanism の skip 条件追加で済む、 新 mechanism 追加せず)
- bug 表面化 pattern が同型化する (= 1 mechanism の bug fix で複数 case が改善)

本 plan 適用例: Option B (= self 側 retry) を「規模拡張時の自然な道」 と感じても、 既存 host push との **対称性逸脱** signal で却下。 既存 case 間で同 mechanism が成立しているなら、 新 case も同 mechanism で扱える方法を最優先で探す。

### §7.2 Event-driven > polling: 「真実の source に近い場所で trigger」

state 変化を polling で検知するのは 「変化を感知できなかった」 失敗が常に可能。 OS / runtime / library が event を直接発行する場合、 それを起点とする方が **timing 確実 + indirect 推定誤差排除 + bandwidth 効率** で strictly 優位。

本 plan 適用例:
- self 側 polling: WebRTC connection state を gameLoop tick で間接推定、 timing 不確実 + missed window 可能性
- host 側 event: `peer.on('connection', ...)` で WebRTC connection open event を直接受信、 timing 確実 + buffering / drop race 排除

一般則: 「**X の変化を検知したい**」 → 「**X を発生させる layer に最も近い event を listen**」。 階層を跨いで間接観測する polling は workaround、 event source layer での listen が root。

### §7.3 暗黙の時間軸前提は長期 case で必ず破れる

state-only な skip 条件 (= 「state X が条件を満たすなら skip」) は暗黙に **「state X が変化する間隔 < skip の有効期間」** という時間軸前提を持つ。 短期 case (= 通常運用) では成立、 長期 case (= 異常 / suspend / disconnect) で破れる。

本 plan 適用例: `if (store.players.has(newId)) continue` の skip 条件は **「player entry が連続的に最新 broadcast で self-maintained」** という time-implicit assumption を持つ。 短期 reconnect (= ms-sec) では成立、 long-disconnect (= mobile suspend、 minutes-hours) で event log の stale 化により破れる。

一般則: state-only な skip 条件を書くときは **「この skip は state X が時間軸でどれくらい trustable な前提か?」** を明示的に audit。 「変化する間隔の上限」 を超える case で破れるなら、 skip 条件に時間軸を加える (= `lastSeen > threshold` で破れた前提を補正)。

これは [`debugging-discipline.md §4`](../../../claude-config/conventions/debugging-discipline.md) sibling audit の前段: structural skip 条件全般で時間軸 audit を回す。

### §7.4 情報の所在地で責務配置: passive vs active recovery role division

「**情報を持っている側が active な役割**」、 「**情報を持っていない側は passive (= 受け待つ)**」 の役割配分が責務設計の natural class fit。

本 plan 適用例:
- WebRTC connection の **reconnect 完了 event** は **host 側が直接観測** (= peer.on('connection', ...) で fire)、 self 側は間接的にしか知れない
- → host が active 役割 (= snapshot push)、 self は passive 役割 (= snapshot 受信を待つ)
- self 側を active 化 (= self pull) すると **情報を持っていない側が情報を要求する** 形になり、 polling / 推定 / state 機械が必要

一般則: data flow の責務配置は 「**情報を持っている側に active 役割**」 を割り当てる。 当事者 (= self) と観測者 (= host) のうち、 重要 event の primary source を持つ側に active recovery を任せる。

### §7.5 Net negative LOC: 真の根本治療は逆説的に code を減らす

workaround は **新 mechanism を追加** する (= retry state machine、 cap、 listener 等で LOC 増)、 root fix は **既存 mechanism の責務拡張 / 用途整合化** で済む (= 1 line skip 条件拡張等で LOC 微増 or 減)。

LOC が増える fix は workaround sign の可能性、 LOC が減る fix は responsibility 純化 の可能性が高い。

本 plan 適用例:
- Option B (= self 側 retry): retry state ref + max attempts + backoff + state cleanup = 数十 LOC 増
- Root-1 (= host skip 拡張): 1 line skip 条件 + 計算 2-3 line + self 側 trigger 完全撤回 (= 数十 LOC 削除) = **net negative LOC**

一般則: fix proposal の最終形を見たら 「これは LOC を増やすか減らすか?」 を 1 つの heuristic として使う。 大きく増やす fix は 「**既存 mechanism の責務拡張で済まなかった理由**」 を明示できないと workaround の可能性。

### §7.6 Multi-round audit reflex: 「これで完璧」 verdict は直前の depth 仮定でしかない

「これで完璧 / 終わり / root」 verdict は audit が到達した **直前の depth** を信じた verdict、 user pushback で **次の depth** が露見することがある。 各 round で 1 verdict 出すのが norm、 「max round 数」 や 「これ以上は overengineer」 を事前設定するのは無意味、 **user epistemic skepticism signal を常に audit trigger として待つ姿勢**。

本 plan 適用例:
- Round 1 (= 5/6 deploy): substep + globalActive で「Bug 14 完全治療」 verdict
- Round 2 (= user 「絆創膏」): handshake / cumActive 検討、 cumActive V1 fail で snapshot rejoin trigger に到達 「これで真の root」 verdict
- Round 3 (= user 「もう一度深く」): V2 fail (= host snapshot push skip 設計) 発見、 snapshot rejoin trigger 必要と再 confirm 「これで確実に完了」 verdict
- Round 4 (= user 「原理的におかしくない?」): implicit Euler refactor (= V3 algorithm 網羅) で substep workaround を撤廃 「最終 root」 verdict
- Round 5 (= user 「前は出てなかった」): WebRTC reconnect timing で trigger drop 判明、 Option B 検討
- Round 6 (= 自己 reflection): Option B も L4 違反、 Root-1 (= host push 拡張) に到達

各 round で「これで完了」 と verdict したが、 user pushback / 自己 reflection で次の depth が露見。 [`debugging-discipline.md §2`](../../../claude-config/conventions/debugging-discipline.md) の audit verdict 「正当化済」 再評価 reflex を **連続 6 round 適用** した珍しい実例として価値。

一般則: 「これで完璧」 と書いた瞬間に **「次の round はあるか?」** を反射的に問う。 round が無限に続くわけではない (= 各 round で genuine な depth 進展がある場合のみ有効)、 但し round 数を事前に縛らず user signal で判定する。

### §7.7 Cross-philosophical synthesis: 設計の 6 視点 chained

§7.1-§7.6 は独立 principle ではなく **chain として作用**:

```
対称設計 (§7.1) を最優先
  ↓ どの mechanism が responsibility 持つか?
情報所在地 (§7.4) で責務配置
  ↓ active 側 (= 情報持つ側) でどう trigger?
Event-driven (§7.2) で trigger 信頼性
  ↓ skip 条件は state-only か?
時間軸 audit (§7.3) で skip robustness 確認
  ↓ fix の規模感 sanity check
Net LOC (§7.5) で workaround vs root 判定
  ↓ 各 round の verdict
Multi-round reflex (§7.6) で次 depth audit
```

任意の design choice / fix proposal で 6 視点を順に通すと、 workaround 候補が早期に signal される。

---

## §8 References

- [`plans/2026-05-06-bug14-global-active-time.md §6.5`](2026-05-06-bug14-global-active-time.md) — supersedes、 self 側 trigger 案 (= 本 plan で revert)
- [`src/components/RelativisticGame.tsx:216`](../src/components/RelativisticGame.tsx#L216) — Stage F skip 条件 (= Stage 2 で時間軸拡張)
- [`src/hooks/useGameLoop.ts`](../src/hooks/useGameLoop.ts) — long-gap trigger (= Stage 1 で削除)
- [`src/components/game/constants.ts`](../src/components/game/constants.ts) — `LONG_GAP_RESYNC_THRESHOLD_SEC` (= Stage 1 で削除)、 `LONG_GAP_RESYNC_THRESHOLD_MS` (= Stage 2 で追加)
- [`src/hooks/useSnapshotRetry.ts`](../src/hooks/useSnapshotRetry.ts) — 新規 joiner secondary belt、 wake-from-suspend には拡張しない (= primary host push に集約)
- [`claude-config/conventions/debugging-discipline.md`](../../../claude-config/conventions/debugging-discipline.md) — V1/V2/V3 + audit verdict re-eval + sibling audit、 本 plan の RCA 経緯で全 4 規律を application
- 設計対称性: `peer.on('connection', ...)` host push 経路は新規 joiner / wake-from-suspend で **同 mechanism**、 case の違いは event timing (= 新 connection vs reconnect) と skip 条件 (= !players.has vs !players.has || isStaleReconnect)
