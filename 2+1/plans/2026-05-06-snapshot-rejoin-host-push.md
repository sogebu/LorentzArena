# Snapshot rejoin の真の根本治療: host push の対称的拡張

**Date**: 2026-05-06 (= deploy build `16:38:54` 後)
**Status**: 未着手 (= plan only、 別 session で実装)
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

| Stage | 内容 | scope |
|---|---|---|
| **Stage 1** | self 側 trigger 撤回 | `useGameLoop.ts` の long-gap trigger 削除 + `constants.ts` の `LONG_GAP_RESYNC_THRESHOLD_SEC` 削除 (= ms 版で再追加するため value 変更) |
| **Stage 2** | host 側 skip 条件拡張 | `RelativisticGame.tsx:216` の if 条件に isStaleReconnect 追加 + `constants.ts` に `LONG_GAP_RESYNC_THRESHOLD_MS = 10000` 追加 (= ms 単位、 既存 wallTime 比較と整合) |
| **Stage 3** | sibling audit | `peer.on(...)` / peer lifecycle handler 全 grep、 同種 「時間軸不在 skip」 違反があれば sweep |
| **Stage 4** | tests | `RelativisticGame.test.ts` 等で host snapshot push の 4 case verify (= 新規 joiner / 短期 / 長期 / migration)、 必要なら新規 test ファイル |
| **Stage 5** | docs | 本 plan close + Bug 14 plan §6.5 を本 plan への redirect に縮約 + SESSION + meta-principles §M43 補足 (= 「新規 joiner と wake-from-suspend は host push primary で対称」) |
| **Stage 6** | deploy + 4 軸 sweep | localhost verify (= multi-tab で hidden tab → 復帰時 snapshot 受信観察) + odakin overnight verify 再 schedule |

工数見積もり: **~30-45 分** (= Stage 1-2 が ~10 分、 Stage 3 audit が ~10-15 分、 Stage 4-6 が ~15-20 分)。

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

## §7 References

- [`plans/2026-05-06-bug14-global-active-time.md §6.5`](2026-05-06-bug14-global-active-time.md) — supersedes、 self 側 trigger 案 (= 本 plan で revert)
- [`src/components/RelativisticGame.tsx:216`](../src/components/RelativisticGame.tsx#L216) — Stage F skip 条件 (= Stage 2 で時間軸拡張)
- [`src/hooks/useGameLoop.ts`](../src/hooks/useGameLoop.ts) — long-gap trigger (= Stage 1 で削除)
- [`src/components/game/constants.ts`](../src/components/game/constants.ts) — `LONG_GAP_RESYNC_THRESHOLD_SEC` (= Stage 1 で削除)、 `LONG_GAP_RESYNC_THRESHOLD_MS` (= Stage 2 で追加)
- [`src/hooks/useSnapshotRetry.ts`](../src/hooks/useSnapshotRetry.ts) — 新規 joiner secondary belt、 wake-from-suspend には拡張しない (= primary host push に集約)
- [`claude-config/conventions/debugging-discipline.md`](../../../claude-config/conventions/debugging-discipline.md) — V1/V2/V3 + audit verdict re-eval + sibling audit、 本 plan の RCA 経緯で全 4 規律を application
- 設計対称性: `peer.on('connection', ...)` host push 経路は新規 joiner / wake-from-suspend で **同 mechanism**、 case の違いは event timing (= 新 connection vs reconnect) と skip 条件 (= !players.has vs !players.has || isStaleReconnect)
