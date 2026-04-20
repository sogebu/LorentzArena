# 2026-04-20: マルチプレイ state バグ 4 点 (A + B 修正済、C 未着手)

本番で実対戦中に複数の state 異常が同時に観測された。A (症状 3) と B (症状 2) は
2026-04-20 昼に修正完了 (commit `2be56b4` / `8ce595f`、localhost 検証済、未 deploy)。
C (症状 1 + 4) は reconnection 時の peerId 再払い出しが絡む設計レベルの変更が
必要で、別セッション。次セッションで着手する際はまず本書 + `plans/2026-04-19-host-migration-symmetry.md` を読む。

## 観測された症状 (本番デプロイ `a1554be` / build `2026/04/20 09:17:24 JST`、localhost `09:02:42` 側スクショ)

### 症状 1: ホスト表示の不整合 (host split 疑い)

- odakin 側 UI: 「ルーム "default" — ホスト」、自 ID `g4ilvwl6u`、接続中の相手 `1nwv67xi6 (接続中)`
- 撃破数リスト: `nslet7: 2` / `灯台: 2` / `1nwv67: 2` (3 エントリ、灯台以外は peer ID 風)
- odakin 報告: 「再接続の相手は別 ID でホストになっているのに、存在しないホストに繋いだ状態になっている」
- 仮説: odakin 切断 → nslet7 or 1nwv67 が takeover → odakin 再接続時に PeerJS が新 ID (`g4ilvwl6u`) を払い出し、**旧 host の beacon を自分が握ったまま**再接続 or 自動 host 昇格、両方が自分を host と認識している状態

### 症状 2: 相手がリスポーンすると見えなくなる

- 他プレイヤーが死亡 → respawn 後、こちら側の 3D シーンから ship が消える
- `handleSpawn` ([game-store.ts:265](../src/stores/game-store.ts:265)) は `existing` を保持して `phaseSpace / worldLine / isDead:false / energy` を更新するので players map からの eviction ではない
- 仮説: `OtherPlayerRenderer` / `computePastConeDisplayState` の past-cone visibility 判定で、respawn 直後の新しい `worldLine.history[0].pos.t` が spawnT として使われ、観測者との距離 ρ が大きいと `pastConeT = observer.t - ρ < spawnT` になって `visible = false` で return null

### 症状 3: 撃破数リストが名前ではなく peer ID prefix 表示

- `nslet7` / `1nwv67` は peer ID 前 6 文字 (`id.slice(0, 6)`)、displayName ではない
- `灯台` (LH) は正しく表示 — LH は `isLighthouse(id)` で `t("hud.lighthouse")` に強制マップするため別経路
- ソース: [ControlPanel.tsx:184-188](../src/components/game/hud/ControlPanel.tsx:184) の `players.get(id)?.displayName ?? id.slice(0, 6)` フォールバックが発火
- 仮説: intro メッセージが phaseSpace より先に来ると `messageHandler.ts:178-189` の intro handler が `players.has(senderId) === false` で early-return、`displayNames` map にだけ書いて players 側は touch しない。以降、phaseSpace で player が登録される際に `displayNames` を参照し直す経路が無く、player.displayName が永続 undefined

### 症状 5 (2026-04-20 昼 追加観測): host migration & タブ復帰した相手が見えなくなる

- odakin 報告: 「ホストマイグレーション＆タブ復帰した相手が見えなくなる症状も直ってないな。」
  (post-deploy `9a22fd9` / build `10:28:06` 再対戦時、screenshot 送付済)
- 症状: client (gv14dvbh6) 側で host (jg59i9ss5) の ship が 3D シーンから消える。
  接続設定 UI には「接続中の相手 jg59i9ss5」が表示されているので connection は生きている。
  撃破数には `自機: 1` (kill 記録あり) → 過去には対戦していた
- B fix (spawnT を respawnLog 経由) では解決しなかった = B' で記録した「LIVE branch は past-cone
  check が無い」の疑いを再掲、別原因の可能性
- 最有力仮説 3 候補:
  (i) host 側が tab hidden → visible 復帰後に自分の phaseSpace 再送が遅れている /
     止まっている (client 側 `lastCoordTimeRef` の gap > WORLDLINE_GAP_THRESHOLD_MS で
     gap-reset 発火、worldLine history.length=1 に)
  (ii) host migration 過程で一瞬 `connectedIds` に jg59i9ss5 が含まれない瞬間があり、
     RelativisticGame の切断 player 削除 (`setPlayers` idsToRemove 経路) で players map
     から蒸発、その後 connection は復帰するが phaseSpace 待ちで再登録されない
  (iii) host 側の visibilitychange hook が worldLine を reset するが、phaseSpace 送信が
     visibility 復帰の少し後になる (HMR + handler re-register 時間差)
- 調査優先度: A 修正で症状 3 解決後、次に取り組む。症状 5 は OtherPlayerRenderer LIVE
  branch に past-cone check を**入れる**ことで「相手の phaseSpace が光速遅延内に届いて
  いなくても見える」ようにする方向性もあるが、それは「相手の現在 worldpos」が
  そもそも存在しない状況なので直接解決にはならない。最もありえるのは (ii)、次に (i)

### 症状 4 (追加観測): テストプレイヤーが Speedometer の energy bar を「全く見えなかった」

- odakin 推測: 「幽霊状態から戻れてなかった？」
- Speedometer の energy bar は [Overlays.tsx] で `{!player.isDead && (...)}` 完全 wrap (2026-04-20 朝の ghost 燃料制約撤去時)
- つまり `player.isDead === true` が張り付くと bar 永続非表示
- `selectIsDead` ([game-store.ts:459](../src/stores/game-store.ts:459)) は `latest kill wallTime > latest respawn wallTime` で導出
- self-respawn は [useGameLoop.ts:568-625](../src/hooks/useGameLoop.ts:568) の "Owner respawn poll" が driver、`handleSpawn` で `respawnLog` に append
- 仮説: reconnection で peerId が変わると、killLog の entry は旧 ID (`nslet7`) のまま、新 ID (`1nwv67`) で respawn しても対になる respawnLog entry が旧 ID の kill に対応せず、selectIsDead が該当 ID (どちら側で判定するか) で不整合。結果としてどちらか一方の ID で永続「死亡中」

## Agent 調査からの集約診断 (2026-04-20 実施)

全 4 症状に **共通根因**: **Message 受信 → state apply の order-of-arrival 依存**。intro / phaseSpace / respawn / snapshot が異なる順序で届いたときの一部 state の stale 化が直接原因。

subagent (Explore) が指摘した各症状の最有力仮説:

| 症状 | 最有力仮説 | 根拠コード |
|---|---|---|
| 1 host split | `assumeHostRole` で `peerManager.getIsBeaconHolder()` の imperative flag と React state の同期 gap。特に**再接続**では PeerJS から新 peerId が払い出されて local の `peerOrderRef.current` と `getBeaconHolderId()` が drift した状態で host election が走る | [PeerProvider.tsx:727-753](../src/contexts/PeerProvider.tsx:727) |
| 2 respawn 消失 | pastConeDisplay の spawnT 計算が `worldLine.history[0].pos.t` 依存 (history.length=1 の直後)、遠距離だと光が届くまで visible=false | [pastConeDisplay.ts:84-88](../src/components/game/pastConeDisplay.ts:84)、[OtherPlayerRenderer.tsx] |
| 3 peer ID 表示 | intro → phaseSpace 順序逆転時に intro handler が早期 return、displayName が players に入らない | [messageHandler.ts:178-189](../src/components/game/messageHandler.ts:178)、[snapshot.ts:91-92 で displayNames は非 reactive setState 外](../src/components/game/snapshot.ts:91) |
| 4 ghost 張り付き | reconnection 時の peerId reassignment で killLog / respawnLog / player entry の ID 同一性が崩れ、selectIsDead が stale | [game-store.ts:459](../src/stores/game-store.ts:459)、[useGameLoop.ts:568-625](../src/hooks/useGameLoop.ts:568) |

2026-04-19 の `plans/2026-04-19-host-migration-symmetry.md` で直した 5 点 (split election / LH ownerId rewrite / peerOrder self-filter / existing peer snapshot 再送 skip 等) は**正常な自然 migration** のケースはカバーするが、**reconnection (一度切断して繋ぎ直し)** は別経路で残存。

## 修正方針 (優先度順、案ベース)

### A. 症状 3 → 最小表面止血 (低リスク、即効) — **完了 `2be56b4` + 再発 fix `e9171c4`**

`2be56b4` の初版 fix:

ControlPanel の displayName lookup を多段 fallback に:

```typescript
// ControlPanel.tsx:184-188 の書き換え後 (実装)
players.get(id)?.displayName
  ?? displayNames.get(id)                           // reactive store 経由 intro
  ?? killLog.find(e => e.victimId === id)?.victimName  // 過去 victim 記録
  ?? id.slice(0, 6)
```

(当初 plan の `killLog.find(...)?.killerName` は `KillEventRecord` に `killerName` が
無いため不可、victimName のみに現実化。)

加えて `displayNames` Map を zustand の **reactive state** に昇格
(`setDisplayName` / `applySnapshot` を setState 経由で immutable 更新)。snapshot の
`displayNames` は local + snapshot の merge (snapshot 側で上書き、local-only entry 保持)
にして reconnection で消えた旧 peerId → name が killLog 逆引きに残るようにする。

**再発観測 (2026-04-20 昼 post-deploy `9a22fd9`)**: fallback + reactive 化しても撃破数
リストに `id.slice(0, 6)` が出た (odakin screenshot `gv14dv:`)。**真の root cause**:
`RelativisticGame.tsx` の intro 送信は `[peerManager, myId]` deps の register effect で
1 回 broadcast のみ。**送信時点で開いている connection にしか届かない**ため、後から
接続してきた peer には永久に届かない (`PeerManager.send` は `c.open` の conn にだけ送る)。
fallback chain の下流は displayNames map に entry が入らない状態では何も拾えない。

**再発 fix `e9171c4`**: connection watcher (`prevConnectionIdsRef` diff) で検出した
新規接続 peer に対し、全 peer が自分の intro を unicast 再送信する。`connection` state が
`dc.on("open")` 後に update されるので、unicast は確実に open な conn に乗る。
beacon holder は受信 intro を `registerHostRelay` (`PeerProvider.tsx:196-211`) 経由で他
client に broadcast relay するので、A → B / B → A のどの順で繋いでも全員が全員の
displayName を知る状態に収束する。

### B. 症状 2 → pastConeDisplay の spawnT を respawnLog ベースに — **完了 `8ce595f`**

実装メモ:
- `respawnTime.ts` に `getLatestSpawnT(respawnLog, player)` helper を追加
- LighthouseRenderer / OtherPlayerRenderer (dead branch) の spawnT を差し替え
- 実際の根因は「gap-reset (host migration / tab 復帰で WORLDLINE_GAP_THRESHOLD_MS
  超過)」で worldLine が fresh に置換され history[0] が jump up すること。
  当初 plan の「respawn 直後 history.length=1」はこの現象の一ケースに過ぎない。
  fix は respawnLog を source of truth にすることで両ケース (respawn 直後 +
  gap-reset 後) を統一的に吸収
- **LH への影響**: LH も handleSpawn 経由で respawnLog entry を持つので、
  同一 helper で fallback なく吸収される (lighthouse.ts §createLighthouse は
  未使用関数、LH spawn 経路は RelativisticGame init effect の handleSpawn)

### 症状 5 → grace period 付き peer removal — **修正済 `0066399`**

`RelativisticGame.tsx` の切断 peer 削除を即時から `PEER_REMOVAL_GRACE_MS = 3000ms` の
`setTimeout` に変更 (`constants.ts` 追加、`useStaleDetection` に `cleanupPeer(id)` helper 追加)。

- 再接続が猶予内なら `clearTimeout` でキャンセル → players map に残留、phaseSpace 復帰で
  正常追従再開
- 真の disconnect なら猶予後に `setPlayers` で削除 + `stale.cleanupPeer(id)` で
  `staleFrozenRef` / `lastUpdateTimeRef` / `lastCoordTimeRef` 一括 purge
- 値 3000ms: heartbeat timeout 2500ms > grace、migration race 吸収
- unmount cleanup: `pendingRemovalTimeoutsRef` の全 timeout を解除する useEffect を追加
  (orphan setTimeout 防止)
- 症状 5 の 3 仮説 (i) phaseSpace 再送遅延 / (ii) 切断 GC race / (iii) visibilitychange のうち
  **(ii) を直撃して解消**。odakin localhost 2 tab 検証 OK。
- **副次効果**: grace period 中に復帰した peer が players map に残るおかげで、タブ hidden
  中に自 pos.t が止まっていた drift (== 他 peer から見て z 正方向に浮く) が可視化された。
  この drift 自体は pre-existing で、後続の `c49ce40` で ballistic catchup により独立に解消

### タブ hidden 復帰時の clock drift → ballistic catchup — **修正済 `c49ce40`**

症状 5 grace period fix で drift が可視化された後、useGameLoop.ts 局所修正で解消。

- 旧実装: `document.hidden` 中 `lastTimeRef.current = Date.now()` で fresh 化 → 自 pos.t が
  止まり他 peer と drift。
- 新実装: hidden 分岐を単純 `return` に、大 dTau (> 0.2s) tick は ballistic catchup
  (`ballisticCatchupPhaseSpace(ps, dTau)` helper を `gameLoop.ts` に追加、thrust=0 で
  friction のみ sub-step (STEP=0.1s))。worldLine は freeze + 1 点 reset で clean 切断、
  catchup 後の phaseSpace を network に通知し、他 peer 側も受信 handler の gap 検出で
  自動 freeze + 新セグメント開始。
- scope 外: LH AI の catchup (host hidden 中 LH 発射 pause、UX 受け入れ)、ghost/dead
  中の catchup (特殊経路)
- test: `ballisticCatchup.test.ts` 5 件、51/51 pass

### B' (未着手). OtherPlayerRenderer LIVE branch の視認性

OtherPlayerRenderer の LIVE branch は past-cone visibility check を**していない**
(computePastConeDisplayState は dead branch でのみ呼ばれる)。症状 2 の
「相手が respawn 後に ship が消える」の原因は別にある可能性あり — sphere の
描画位置 (world frame で dp.t = spawnT - observer.t) が camera frustum から
外れている、あるいは selectIsDead が stale で `player.isDead === true` が
張り付いている、等。症状 5 は `0066399` で直撃解消したが、B' (LIVE 消失) は別原因の
可能性を残して C 調査で追う。

### C. 症状 1 + 4 → reconnection 永続化 (高リスク、設計変更大)

2 系統の対策:

1. **localStorage に peerId 永続化**: `la-playerName` と同様に `la-peerId` を保存して再接続時に同じ peerId で PeerJS connect。PeerServer 側で重複 ID が許容されれば (probably not、PeerJS は per-server unique)、新規払い出し側で `la-{playerName}` 等のスコープ命名を導入
2. **playerName を primary key 化**: killLog / respawnLog / displayNames 全てを peerId ではなく playerName で keying。reconnect で peerId が変わっても playerName が同じなら state が引き継がれる
3. **migration の確実化**: `assumeHostRole` で `clearBeaconHolder()` の後に async で「本当に flag が切り替わったか」確認ループを入れる

案 2 が最も筋が良さそうだが変更範囲が広い。案 1 は実装簡単だが PeerJS の制約次第。案 3 は単体では解決しない (host split 一部のみ)。

### 依存関係

- **A** は他と独立、今すぐ fix 可能
- **B** も他と独立 (display のみ)
- **C** は設計レベル、A/B を先にやって表面症状を抑えた後、別セッションでじっくり

## 次セッションで最初にやること

A (`2be56b4` + 再発 fix `e9171c4`) / B (`8ce595f`) / 症状 5 (`0066399`) / hidden 復帰
clock drift (`c49ce40`) は 2026-04-20 昼〜夕方に修正 + deploy 済
(最新 deploy `c49ce40` / build `2026/04/20 18:36:03`)。

1. 本書 + `plans/2026-04-19-host-migration-symmetry.md` を読む
2. 本番で odakin に症状 2 / 3 / 5 の消失を確認してもらう。残存ならこの plan を reopen
3. **C (症状 1 host split + 症状 4 ghost 張り付き)** の設計議論から、3 案選定
   (localStorage に peerId 永続化 / playerName primary key 化 / migration 確実化)
4. B' (OtherPlayerRenderer LIVE 消失) 単独調査 — 症状 5 直撃で B' と合流と予想したが、
   別原因の可能性残る

## 再現手順 (現時点で把握している範囲)

- Claude Preview では `document.hidden=true` で useGameLoop が止まるため**再現不能**。localhost + 実機 (odakin iPhone 等) の組合せ必須
- 最低 2 peer (odakin PC + テストプレイヤー) で連続対戦、**片方を一度切断 → 再接続**、その後 ghost 状態継続 / kill 表示 / host 競合のいずれかが出る

## console log / dump 採取 points (次回実戦時)

次に odakin が実戦するときに録っておくと診断が早い:

- `window.__store = useGameStore` を DevTools console に仕込み、`__store.getState().players` / `killLog` / `respawnLog` / `displayNames` を症状発生時に dump
- `Object.keys(window).filter(k => k.startsWith('_peer'))` 等で PeerManager の内部フラグ (beacon holder id, peerOrder) も dump
- `[PeerProvider]` prefix の console log は migration / reconnection 経路で出るはず (もし出ない or noisy なら console.log 追加して判別性を上げる)

## 参考

- 過去の host migration 修正: `plans/2026-04-19-host-migration-symmetry.md`
- リスポーン世界線連結バグ (F-1 後に再発報告、別現象だが同系統の可能性): [SESSION.md §リスポーン時に世界線が繋がる](../SESSION.md)
- `docs/architecture.md` — beacon pattern / 全体アーキ
