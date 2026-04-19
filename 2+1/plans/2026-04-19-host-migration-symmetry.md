# 2026-04-19: Host migration 対称性整備 (post-mortem + plan)

## 動機 / 症状

odakin スマホ実機で **旧 host (例: `lghq75`) 離脱後にホストマイグレーションが破綻**する報告。具体症状 2 つ:

1. **Split election / dead candidate 待機**: beacon holder が誰にも移らない、または複数 client が同時に host 化
2. **LH 沈黙**: migration 後 Lighthouse の laser が止まる / 撃ってこない

Authority 解体 Stage A〜H 完了後 (2026-04-14) に target-authoritative + event-sourced + assumeHostRole 集約で migration 経路は概ね単純化されていたが、**1-tick 単位の race / state drift** がまだ残っていた。

## 設計の前提と用語

- **beacon holder = 現 host**: `la-{roomName}` PeerJS ID を保持する peer。relay hub + LH owner + snapshot 送信を兼任
- **peerOrderRef**: client side election 用の最古参順 peer list。host の `connections.filter(open).map(id)` を peerList / ping で broadcast、client が adopt
- **election**: heartbeat timeout (2.5s) で client が `peerOrderRef.current.filter(id => id !== oldHostId)[0] === peerManager.id()` で「自分が新 host」を判定
- **assumeHostRole**: 新 host になる際の atomic takeover 関数 ([PeerProvider.tsx:725](../src/contexts/PeerProvider.tsx:725))
- **snapshot**: beacon holder が新 joiner 1 人にのみ送る state 一式 (players / event logs / scores)。既存 peer は event log から self-maintained

## 分析: 5 点の根因 (Bug 1/2/3 + Drift A/B/C)

### Bug 1: Split election / dead candidate (高優先度、実害あり)

**原因**: client 間で `peerOrderRef.current` が drift。peerList broadcast は host の `connections` change 駆動 (rare) のため、connection 安定期に各 client の view が時間経過で発散する。migration 直後の election で異なる `candidates[0]` を選び、2 ノードが同時 host 化 (split) または死 candidate を待ち続ける。

**修正**: ping (1s 周期) に host 視点の `peerOrder` を毎回相乗り、client が adopt:

```ts
// Host 側 (PeerProvider.tsx:657)
peerManager.send({ type: "ping", peerOrder: peerOrderRef.current });

// Client 側 (PeerProvider.tsx:687)
peerManager.onMessage("heartbeat", (_senderId, msg) => {
  if (!isPingMessage(msg)) return;
  lastPingRef.current = Date.now();
  if (Array.isArray(msg.peerOrder)) {
    peerOrderRef.current = [...msg.peerOrder];
  }
});
```

**型変更**: `Message` の `ping` variant に `peerOrder?: string[]` 追加 ([message.ts:107](../src/types/message.ts:107))。

**効果**: 全 client が ≤1s 精度で同一 election base → `candidates[0]` 全 client 一致 → split 解消。

### Bug 3: snapshot LH ownerId stale (中優先度、defensive)

**原因**: `assumeHostRole` 内の `setPlayers` (LH ownerId rewrite) が snapshot 発行と 1-tick 競合した場合、新 joiner が古い (死んだ) host を LH owner と認識する split 可能性。migration と新 join が同時発生する稀なシナリオ。

**修正**: `buildSnapshot` で LH ownerId を caller (= 現 beacon holder) に常時 rewrite:

```ts
// snapshot.ts:54
const ownerId = isLighthouse(p.id) ? myId : p.ownerId;
```

**test 追加**: `snapshot.test.ts` に LH ownerId rewrite を検証する 1 件 (38 → 39 件 all green)。

### Bug 2: LH 沈黙窓 (検証 → 非バグ)

**仮説**: assumeHostRole の `setAsBeaconHolder` (imperative) と `setPlayers` (zustand) の間に async gap があり、useGameLoop が `lh.ownerId !== myId` の transient で LH AI を 1 tick skip。

**検証結果**: 非バグ。
- `setAsBeaconHolder` は `PeerManager` の同期フラグ更新 (microtask 即座反映)
- `setPlayers` は zustand sync ([game-store.ts:178](../src/stores/game-store.ts:178))
- useGameLoop は `useGameStore.getState()` を毎 RAF tick 直読 → 次 tick で整合状態を読む
- → transient ゼロ

**教訓**: imperative + zustand sync の組み合わせは「同一 microtask で整合」を保証する。React state 経由の場合 ([roleVersion bump](../src/contexts/PeerProvider.tsx:744)) と区別する。

### Drift A: LH ownerId rewrite の二重実装 (cleanness)

**問題**: `assumeHostRole` ([PeerProvider.tsx:730-743](../src/contexts/PeerProvider.tsx:730)) と `RelativisticGame init effect` ([RelativisticGame.tsx:108-117](../src/components/RelativisticGame.tsx:108)) の両方が LH ownerId rewrite を実装していた。

**動作上**: assumeHostRole が先に rewrite → setRoleVersion bump → React re-render → init effect が走るが既に `existingLh.ownerId === myId` true → no-op。**RelativisticGame 側は dead code**。

**修正**: init effect から LH rewrite ブロック削除、`if (!existingLh) handleSpawn(...)` のフラットな分岐のみに:

```ts
// RelativisticGame.tsx:103-119 (修正後)
const lighthouseId = `${LIGHTHOUSE_ID_PREFIX}0`;
const existingLh = store.players.get(lighthouseId);
stale.staleFrozenRef.current.delete(lighthouseId);

if (!existingLh) {
  const t = Date.now() / 1000 - OFFSET;
  store.handleSpawn(lighthouseId, {...}, myId, LIGHTHOUSE_COLOR, { ownerId: myId });
}
```

**single source of truth**: `assumeHostRole` のみが LH ownership takeover を担当。同期 setPlayers で次 RAF tick の useGameLoop が `lh.ownerId === myId` 即読 → LH 沈黙窓ゼロ。

### Drift B: 新 host の peerOrder に自分 ID 混入 (cleanness)

**問題**: assumeHostRole 直後、`peerOrderRef.current` は migration 直前に旧 host から受信した最後の値 (= 自分含む)。`connections` useEffect が次 React tick で正しい値に置換するまで、最初の ping payload は「host 自身を含む」異常な peerOrder を broadcast。election filter `id !== oldHostId` で吸収されるが、設計的には host の peerOrder = 非自分 peers の不変条件を破る。

**修正**: assumeHostRole 内で eager filter:

```ts
// PeerProvider.tsx:737
peerOrderRef.current = peerOrderRef.current.filter((id) => id !== newHostId);
```

### Drift C: 既存 peer への snapshot 再送 (design coherence)

**問題**: migration 後、新 host は元 client (= 既存 peer) と新規接続を確立する。`prevConnectionIdsRef` の diff だけでは「真の new joiner」と「migration で再接続した既存 peer」を区別できず、後者にも snapshot を送信。受信側 `applySnapshot` の migration path 防御 merge で吸収されていたが、`snapshot.ts` の設計コメント「既存 peer は受け取らない」と矛盾。

**修正**: `store.players.has(conn.id)` で既存 peer を識別して skip:

```ts
// RelativisticGame.tsx:152-164
if (peerManager?.getIsBeaconHolder()) {
  const myPlayer = store.players.get(myId);
  if (myPlayer) {
    for (const conn of connections) {
      if (!conn.open) continue;
      if (prevConnectionIdsRef.current.has(conn.id)) continue;
      if (store.players.has(conn.id)) continue; // 既存 peer は self-maintained
      peerManager.sendTo(conn.id, buildSnapshot(myId));
    }
  }
}
```

## assumeHostRole の責任 (post-refactor の single source of truth)

**6 操作のバンドル** ([PeerProvider.tsx:725-754](../src/contexts/PeerProvider.tsx:725)):

1. `clearBeaconHolder` + `setAsBeaconHolder` — PeerManager imperative flag
2. `registerStandardHandlers` — relay + peerOrder listener
3. **LH ownerId rewrite** — sync setPlayers で newHostId 化、LH 沈黙窓ゼロ (Drift A 集約)
4. **peerOrderRef self-filter** — host の peerOrder = 非自分 peers の不変条件 eager 維持 (Drift B)
5. `setRoleVersion` bump — heartbeat / peerList broadcast 等の role-dependent effects 再評価

不変条件: 「`setAsBeaconHolder` には必ず `setRoleVersion` + LH ownership takeover + peerOrder 正規化が伴う」。

## 削除した冗長性の安全性検証

「init effect の LH rewrite を削除して production シナリオで救済漏れが無いか」を 6 シナリオで網羅:

| # | シナリオ | LH owner update 経路 | 削除影響 |
|---|---|---|---|
| 1 | 初回 boot で host | `handleSpawn` 新規作成 (existingLh 無し) | 無 |
| 2 | migration で host | `assumeHostRole` 同期 setPlayers | 無 (集約済) |
| 3 | becomeSoloHost | assumeHostRole 経由 | 無 |
| 4 | tab-hidden grace expire 復帰 | Phase 1 `setAsBeaconHolder` 直呼び (assumeHostRole 非経由) | **無**: `localIdRef = useRef(...)` で localId は component lifetime 維持 → 新 myId === 旧 myId → existingLh.ownerId === myId 既に true → 旧コードでも no-op だった |
| 5 | grace 中に B 化 → A 復帰で client | client なので init effect 自体走らず (`if (!isBeaconHolder) return`) | 無 |
| 6 | HMR re-mount (dev only) | `localIdRef` 再生成で myId 変化、zustand singleton 残存で LH.ownerId 旧 myId 固着 | **救済対象外**: production では起こらない、CLAUDE.md に caveat 追記 (Cmd+Shift+R で解消) |

## Defer / 既知の限界

- **HMR re-mount での LH ownerId 固着**: dev-only。CLAUDE.md ローカルプレビュー注意点に明記、Cmd+Shift+R で zustand リセット
- **`prevConnectionIdsRef` diff pattern (DESIGN.md 残存臭 #2)**: Drift C の guard で実害は塞いだが、根本は `dc.on('open')` のライフサイクルイベントを React state 経由で復元する遠回り。`onNewPeerOpen` callback API への refactor は依然 defer (`PeerManager` + `WsRelayManager` 同時改修要、ROI 未到達)
- **multi-tab 実機検証**: Claude Preview は single-tab で beacon migration 検証不可 (CLAUDE.md「single-tab preview でカバーできる範囲」)。odakin に localhost multi-tab 実機検証を依頼

## 実装 commits (2026-04-19)

| commit | 内容 |
|---|---|
| [d3cf29b](https://github.com/sogebu/LorentzArena/commit/d3cf29b) | fix: Bug 1 (ping peerOrder piggyback) + Bug 3 (snapshot LH ownerId rewrite) + test |
| [72ab008](https://github.com/sogebu/LorentzArena/commit/72ab008) | refactor: Drift A (LH rewrite 重複削除) + Drift B (peerOrder self-filter) |
| [6ca1705](https://github.com/sogebu/LorentzArena/commit/6ca1705) | refactor: Drift C (snapshot 真の new joiner only) |
| [4f811ae](https://github.com/sogebu/LorentzArena/commit/4f811ae) | docs: SESSION.md / docs/architecture.md / design/network.md / DESIGN.md / CLAUDE.md 反映 |
| [e2491d6](https://github.com/sogebu/LorentzArena/commit/e2491d6) | docs: HMR re-mount caveat 追記 |

## 検証

- vitest: 39 passed (snapshot.test.ts に LH ownerId rewrite 1 件追加)
- typecheck: clean
- build: clean
- production: build `2026/04/19 08:27:23` で deploy 済 (https://sogebu.github.io/LorentzArena/)
- multi-tab 実機検証: odakin 依頼中

## 教訓

1. **Imperative state + zustand sync の組み合わせは同一 microtask で整合**。React state 経由 (roleVersion bump) と区別。「LH 沈黙窓」のような async gap 仮説は根拠 (debugger / log) で確認してから対処すべき (Bug 2 の検証 → 非バグ判明)
2. **diff pattern (prevX vs currentX) は self-contained ではなく外部 state に依存**するので、「diff 結果」が文脈次第で意味を変える (Drift C: prev = client 期、now = host 期で「新規」の解釈が変わる)。今回は guard で塞いだが、根本は event subscription pattern への移行 (defer)
3. **対称性整備は「動いているが冗長」を整理する作業で、優先度を見誤りやすい** (DESIGN.md 残存臭 #2 の再評価教訓と同じ)。今回は Bug 1 (実害) を契機に近接箇所の Drift A/B/C を芋づる式に整理できたのは効率的だったが、Drift だけ単独で着手していたら「ROI で並べ直す」で defer 判定だった可能性
