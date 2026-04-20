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

## 2026-04-20 夜: C と B' 深掘り → 案の組み直し

subagent 調査 + 実コード追従 (messageHandler.ts §151 の isDead guard / PeerProvider
§727 assumeHostRole / useStaleDetection の freeze-only / applySnapshot のログ扱い)
の結果、前提の書き直しが必要になった:

- **B' の真因は「reconnection に依存しない missed respawn」**: messageHandler.ts §151
  が `if (existing?.isDead) return prev` で phaseSpace を無視するため、respawn message
  が 1 発でも落ちると受信側は恒久 ghost。任意のパケロス / host migration race /
  tab 切替で発生しうる。**peerId 変更は条件ではない**。
- **「player.isDead の field と selectIsDead (log derive) を一本化すれば直る」仮説は
  外れ**: handleKill / handleSpawn が同一 `set()` で両方更新するため 1 peer 内では
  常に一致する。divergence は peer 間 (log の内容が peer 間で違う) にしか存在しない。
  参照一本化は cleanup にしかならない (実コード再確認で確定)。
- **症状 1 (host split) の真因は beacon holder flag の無検証化**: imperative
  `isBeaconHolder=true` を立てたら自動 verify されない。`demoteToClient` (§950)
  は「beacon 獲得失敗時」にしか発火せず、「**自分が beacon holder と信じているが
  実際は他人が beacon を奪った**」状態は検出されない。タブ hidden 中に奪われて
  復帰時に host と信じ続ける → split。
- **症状 4 (ghost 張り付き) の真因はエントリ GC 不在**: `useStaleDetection` は
  stale 化した peer を freeze するだけで remove しない。silent partition
  (接続はオープンだがメッセージ絶える) では grace-period 削除が発火せず、
  isDead=true のまま永久残留。

**共通根因**: critical state transition (kill / respawn / host handoff) を
transient event として扱い、delivery 失敗 = state 恒久 divergence。reconciliation
(冗長な再同期) の機構が構造的に欠けている。

**改訂した段階設計** (playerName primary key 案は defer):

| 段階 | 実装 | LOC | 対象症状 |
|---|---|---|---|
| **Stage 1** | Periodic snapshot broadcast (beacon holder → all peers, 5s) | ~30 | B' / 症状 4 / 他 missed-event |
| **Stage 2** | Host self-verification (beacon probe で奪取検出) | ~40 | 症状 1 |
| **Stage 3** | Stale player GC (freeze 後さらに 15s 無通信 → removePlayer) | ~15 | 症状 4 残存分 |
| defer | playerName primary key | 30-45 箇所 | score continuity (UX) |

Stage 1-3 を入れても残るのは **score の reconnection 越え継続性** と **撃破数
リスト ID prefix 表示 (fallback で緩和済)** — state corruption ではなく UX 改善
なので、実対戦で残存が確認されてから playerName PK に踏み込むのが合理的。

## Stage 1 (周期 snapshot broadcast) 実装記録 — 2026-04-20 夜、未 deploy

**commit 対象**: 4 files +285/-16 (本プラン更新含まず)
- `constants.ts`: `SNAPSHOT_BROADCAST_INTERVAL_MS = 5000` 追加
- `snapshot.ts`: `applySnapshot` の isMigrationPath 分岐を union-merge 化
- `PeerProvider.tsx`: beacon holder で `setInterval` 5s ごとに
  `peerManager.send(buildSnapshot(myId))`
- `snapshot.test.ts`: 4 ケース新規 (union-merge / firedForUi 保持 / isDead 再導出 /
  scores 保持)

**設計の要点**:
- **既存 migration path (`isMigrationPath = store.players.has(myId)`) を流用**:
  new joiner 用の unconditional replace と、既存 state 持ち受信側の defensive merge を
  `applySnapshot` 一本で両立する分岐は既に `2be56b4` で入っていた。周期 snapshot の
  受信側は自動的に merge 分岐に入る。
- **log union-merge (local 優先 dedupe)**: key = `${id}@${wallTime}`。local に既出の
  entry は firedForUi 等の状態を保持、snapshot-only の新規 entry だけを追加
  (firedForUi=false で = local 観測者の past-cone 到達前なので未発火が正しい初期値)。
- **isDead を merged log から再導出**: 本機構の中核。missed respawn で local が
  isDead=true に貼り付いていても、snapshot 経由で respawnLog entry が流入すれば
  latestRespawn > latestKill となり isDead=false に自動復帰する (→ ghost stuck /
  B' の自動救済)。
- **scores は local 保持**: `firePendingKillEvents` が past-cone 到達で各観測者
  独立に加算する観測者相対量なので、snapshot の scores で上書きすると全 peer が
  beacon holder の観測時刻に同期して相対論的独立性が壊れる。
- **broadcast 条件**: `getIsBeaconHolder()` + `myId` + `connectionPhase === "connected"`
  + 実 peer (`roomPeerId` 以外の connection) が 1 人以上。roleVersion 依存で
  migration 後に自動で再起動。

**副次効果 (bonus)**:
- **Stage 3 (stale GC) の部分解消**: beacon holder が disconnected peer を
  `players` から落としたら、次 snapshot で全 peer が同期して追従 (周期 5s)。
- **症状 3 再発耐性**: displayNames も snapshot に同梱されるので、unicast intro
  が漏れても 5s で回復。

**未検証** (検証責任は odakin の localhost 実機):
- 2 peer で通常プレイに regression が出ないか (周期 snapshot 適用で座標が飛ばないか、
  worldLine が寸断されないか、エフェクトが二重発火しないか)
- beacon holder が死んで migration 発生時、新 host から周期 snapshot が開始されるか
  (roleVersion 依存で期待通り動くはず)
- 5s 間隔が reconciliation 窓として体感的に許容できるか (短すぎる / 長すぎる調整余地)

## Stage 1 深掘り bug audit — 2026-04-21 早朝 (`55401f4`)

Stage 1 実装後に深掘りで発見した bug を audit として記録:

**Bug A (修正済 `55401f4`)**: snapshot 適用で **local-only player が消失する race**。
`nextPlayers` は `msg.players` からのみ構築されるため、`store.players` にあるが
snapshot に含まれない entry は setState で捨てられる。star topology では beacon
holder の view が常に最新なので発生稀だが、以下の race で実害あり:
- peer X が beacon holder に join → phaseSpace broadcast → beacon holder が relay
  で他 peer Y に伝搬、の途中で snapshot build (X 未反映) → Y は relay 経由で X を
  保持 → snapshot 適用で X が 5 秒消える → 次 snapshot で復帰
- host migration 過渡期の view 不一致でも同様

修正: isMigrationPath 分岐で `nextPlayers` 構築後、`store.players` から nextPlayers
に無い entry を移植する 4 行。isDead 再導出は merged log ベースなので、preserved
local-only entry にも正しく作用する。test 1 件追加で regression guard。

**Bug B (defer)**: snapshot message の sender authority 未検証 (pre-existing)。
`messageHandler.ts` §190-205 の snapshot handler は `senderId === beaconHolderId` を
チェックしておらず、任意 peer が snapshot を送れる。Stage 1 で周期 5s 化により
影響拡大の可能性あり。Stage 2 (host self-verification) の一環でまとめて修正予定。

**Bug C (defer)**: `player.displayName` field と `displayNames` map の drift
(pre-existing、Stage 1 固有ではない)。applySnapshot で snapshot の player entry の
displayName が undefined なら `player.displayName = undefined` になる一方、
`mergedDisplayNames` map は local の名前を保持 → mismatch。`handleKill` §227 が
`victim.displayName ?? slice(0, 6)` にフォールバックし ID prefix 表示になる経路。
別 issue 化。

**Latent 疑念 (Stage 1 責務外)**: `RelativisticGame.tsx` §201-217 の peer removal
logic が 3+ client で機能不全の可能性。clients は star topology で直接 mesh を
張らないため client の `connectedIds = {self, host}`。3+ peer 時に他 client が
`store.players` にあるが `connectedIds` に無い → 3s grace 後に除去されるはず。
2 peer テストでは顕在化していない。周期 snapshot (5s) が追加/復帰の役目を果たす
ので Stage 1 で症状緩和の可能性あり、要実戦観察。Stage 2 着手時に併せて調査。

**確認済み non-bug**: self broadcast loopback (send は自分の conns に送らない) /
isDead 再導出の self への適用 (merged log で保険として望ましい動作) / roleVersion
伝搬 (Phase 1 / soloHost / assumeHostRole / demotion 全経路で effect 再実行) /
帯域 (killLog/respawnLog は MAX_* で cap、<10 peer 許容) / sort mutation (spread
で新規配列作ってから sort、store 不変) / tie-breaker (既存 selectIsDead と同じ
strict gt、整合)。

## 次セッションで最初にやること (改訂)

1. **odakin が localhost で Stage 1 + 1.5 を 2 タブ検証** → OK なら deploy (`4ef4fca` + `55401f4` + Stage 1.5)
2. deploy 後の本番実戦で B' / 症状 4 が自動解消されるか観測
3. **Stage 2 (host self-verification)** 着手 — 症状 1 の自動解消を狙う
4. Stage 3 (stale GC) は Stage 2 実装中の設計判断で進捗見極め
5. 3+ peer latent 疑念 (§Stage 1 深掘り bug audit) は Stage 2 調査時に検証

## Stage 1.5 — peer 貢献 snapshot (pseudo-mesh) — 2026-04-21

### 動機: Stage 1 は BH 独り舞台 → 対称性が低く、BH 自身の missed event は救済できない

Stage 1 設計 (BH が snapshot を broadcast、client は受け取るだけ) は、BH が受信
取りこぼし (例: client A の kill message が BH に届かず client B に届いた) した
場合、BH 発の snapshot には該当 entry が無いため全 client が BH の視点を共有して
missed のまま固定される。BH の観測が global truth になってしまう。

### 洞察: 頻度で通信形態の semantics を分けるのが自然

- **phaseSpace / kill / respawn (高頻度 ~125Hz / sparse events)**: order/latency
  sensitive → star 経由 (BH relay)、owner-authoritative
- **snapshot (低頻度 0.2Hz)**: eventual consistency で十分、多ソース冗長性が効く
  → peer 貢献型 reconciliation (pseudo-mesh)

これは distributed systems で standard な "leader-based strong consistency +
gossip eventual consistency" のハイブリッド。Raft + gossip の classic 構成。

相対論的にも味わい深い: 自分の局所観測 (phaseSpace) は owner-authoritative、
しかし reconciliation には "universal frame" がない — 全員が自分の view を
送って union-merge する方が "局所観測の集合" として自然。

### 設計比較 (5 軸)

| 軸 | Stage 1 (BH 独り舞台) | Stage 1.5 (BH merger) | full mesh |
|---|---|---|---|
| 対称性 | BH 非対称 | 全員送信 ✓ | 完全対称 ✓✓ |
| 効率性 | BH O(N) | BH O(N) 維持 ✓ | 全員 O(N²) |
| クリーンさ | 単純 | 頻度で役割分離 ✓ | 完全分離 ✓ |
| シンプルさ | 現状 | **guard 1 行撤去** | mesh 接続管理 +100 LOC |
| 堅牢性 | BH 単独視点 | BH が全 peer 観測から merge ✓ | BH downtime でも継続 |

Stage 1.5 は "guard 1 行撤去でほぼ完成" の甘い spot。full mesh の真の BH-downtime
resilience は現スケール (2-4 peer、BH tab-hidden は HOST_HIDDEN_GRACE で既に対応
済) では ROI 低く defer。

### 実装

**変更**: `PeerProvider.tsx` の snapshot broadcast effect から
`if (!peerManager.getIsBeaconHolder()) return;` を撤去。全 peer が 5s ごとに
snapshot を送信する。

**動作 (star topology 上の伝播)**:
1. client A: `peerManager.send(buildSnapshot(A_view))` → A の conns = {BH} のみに届く
2. BH: applySnapshot の isMigrationPath 分岐で A の log entry を union-merge
3. BH の 5s interval: merge 済 state から snapshot build → 全 client に broadcast
4. 他 client: BH の enriched snapshot を union-merge

伝播最大 10s (A が BH fire 直後に送信したケース)、平均 5s。

**BH 帯域**: O(N) 維持 (受信 +N-1/5s、送信 N-1/5s 不変)。client 側: +1 送信/5s。

**意図的な設計変更 (Bug B の扱い反転)**: 従来 Bug B (snapshot sender 未検証) は
リスク扱いだったが、Stage 1.5 では **peer 貢献を歓迎する方向**に反転。`senderId`
check は意図的に行わない。union-merge + dedup で sender に依らず安全。cooperative
game 前提の cost/benefit。悪意ある peer が偽 entry を入れるリスクは残るが、
現スコープでは許容。

### test

`snapshot.test.ts` に Stage 1.5 動作の end-to-end 的 test を 1 件追加:
- BH が client (alice) の snapshot を受信 → BH の missed kill が alice の観測から
  union-merge で流入 → BH 側 `killLog` に entry が追加、`victim.isDead` 再導出で
  true に遷移、scores は BH の局所値を保持 (観測者相対性)

57/57 pass。typecheck clean。

### Stage 1.5 → full mesh への将来移行可能性

Stage 1.5 の messageHandler は既に "どの peer からの snapshot も受け付ける"
semantics なので、将来 mesh 接続を追加すれば自動的に mesh snapshot 化する。
つまり **mesh への stepping stone として設計された**。現在は star 経由だが、
mesh 接続が確立されれば client→client も直接伝播できる。

### Stage 1.5 深掘り audit + critical bug fix (`76ba182`)

Stage 1.5 実装後の深い code audit で **LH ownerId 汚染** bug を発見・修正。

**bug 経路**: `buildSnapshot` §54 は LH の ownerId を caller (`myId`) に強制
rewrite していた (migration 直後の 1-tick race 安全弁)。Stage 1 までは BH だけが
呼んでいたので無害。Stage 1.5 で全 peer が呼ぶようになった結果:

1. client A が `buildSnapshot(A_id)` → 出力 snapshot の LH.ownerId = A_id
2. BH が受信 → applySnapshot §167-175 の「local-newer 優先」で snapshot が勝つ
   ケース (BH tab hidden / 初期化直後 / pos.t 拮抗) に BH の local LH.ownerId = A_id
3. BH の useGameLoop の `lh.ownerId === myId` check が false → **BH の LH AI 沈黙**

BH の次 broadcast は `buildSnapshot(BH_id, true)` で LH.ownerId = BH_id に再
rewrite して出すので他 client の表示は復元するが、**BH のローカル state は stuck**。

**修正**: `buildSnapshot` に `isBeaconHolder: boolean` 引数を追加:
- `isBeaconHolder=true` (BH が呼ぶ): LH.ownerId を自分に rewrite (migration 安全弁を維持)
- `isBeaconHolder=false` (client が Stage 1.5 で呼ぶ): LH.ownerId を preserve

3 call sites 更新:
- `PeerProvider.tsx` Stage 1.5 effect: `peerManager.getIsBeaconHolder()` を tick ごと
  に動的に渡す (role change に自動追従)
- `RelativisticGame.tsx` §181 (新 joiner 送信): true 固定 (BH-only path)
- `messageHandler.ts` §78 (snapshotRequest 応答): true 固定 (BH-only path)

regression test 1 件追加 (non-BH caller が LH owner を preserve することを verify)。
58/58 pass。

### 深掘り audit の他の発見 (minor / defer)

以下は audit で checkpoint したが bug には至らない / scope 外と判断した点:

- **frozenWorldLines / debrisRecords は snapshot 非同梱**: BH が merge で kill entry
  を後から取得しても、freeze の可視化が再生成されない (現 worldLine を freeze すると
  タイミングずれの誤り) → 可視化のみの軽微な不整合、データ破損ではない。defer。
- **displayName field vs map drift**: pre-existing Bug C。Stage 1.5 で悪化せず。
- **lastUpdateTimeRef 更新**: A の snapshot が B の entry を含むと BH の B.lastUpdate が
  refresh される → stale 検出が遅れる経路。2 peer では顕在化せず。defer。
- **3+ peer latent**: pre-existing (RelativisticGame §201-217)。Stage 1.5 の 5s 再補充で
  緩和される可能性あり、要実戦観察。
- **clock skew**: wallTime は source-stamped で dedup key なので skew 耐性あり。non-issue。
- **frozen/debris を snapshot に同梱** は SESSION.md の「defer 中」に既に記録済。

## Stage 2 設計 — 2026-04-21 (未実装、別セッション着手)

### 真因 (Stage 1 plan の仮説を実コードで確定)

- **beacon 獲得は set-and-forget**: `PeerProvider §989-1141` の beacon effect は
  `beaconRef.current` セット後に再試行ループを持たず、**一度獲得したら自動で再
  verify しない**。
- **Tab hidden → 再接続の race**: `HOST_HIDDEN_GRACE=1500ms` で beacon destroy、
  `HEARTBEAT_TIMEOUT=2500ms` で client migration trigger。この ~1 秒の窓で
  PeerServer が古い BH を release → 新 BH が `la-{roomName}` claim → 旧 BH が
  tab 復帰で Phase 1 から beacon を再取得成功 (PeerServer race で 2 者が claim) →
  **2 peer が自分を BH と認識** で split 確定。
- **既存 `demoteToClient` (§1006-1067) は passive**: beacon claim に失敗したとき
  しか発火しない。自分が claim 成功して「まだ BH」と信じている状態は検出されない。
  これが set-and-forget gap の具体帰結。

### 設計: visibility-triggered probe + low-rate periodic backup

**主トリガー** (症状 1 の race が起きる唯一のタイミング):
- `visibilitychange` → "visible" 遷移時、`getIsBeaconHolder()=true` なら probe 1 発

**副トリガー** (汎用安全網):
- 30 秒周期の setInterval (visibility 以外の経路 network blip 等もカバー)

**Probe の中身** (~5 ステップ):
1. 使い捨て `probePm` (ランダム ID、`probe-*` prefix 推奨) を作って `la-{roomName}`
   に接続
2. beacon からの `redirect` message を受信
3. `redirect.hostId === myId` → 自分が legit BH、destroy して終了
4. `redirect.hostId !== myId` → **split 検出** → demotion 末端処理を実行:
   `peerManager.broadcast({type:"redirect", hostId:realHostId})` → `clearBeaconHolder()`
   → `setBeaconHolderId(realHostId)` → `connect(realHostId)` → `setRoleVersion(v+1)`
5. probe タイムアウト (8s) → verification 不可、assume OK で打ち切り (conservative)

### 実装指針

- 既存 `demoteToClient` (§1006-1067) の末端 5 ステップ (§1053-1064) を
  `demoteKnowningRealHost(realHostId)` みたいな small helper に extract、probe と
  既存 beacon effect の両方で共有。`discoveryPm` 作って redirect 受けるの冒頭部分は
  既存 beacon effect で継続使用、probe 側は「既に realHostId 手元にある」前提で
  末端のみ呼ぶ。
- 新 useEffect 1 つ追加 (visibility listener + setInterval)。deps: `[peerManager,
  myId, activeTransport, roomPeerId, connectionPhase, dynamicIceServers, roleVersion]`。
- 定数 2 つ: `HOST_SELF_VERIFY_BACKUP_MS = 30000`, `HOST_SELF_VERIFY_TIMEOUT_MS = 8000`。
- 見積 LOC: 50-70。

### なぜ active probe、passive signal (beaconRef health) じゃないのか

`beaconRef` の WebSocket が alive でも PeerServer の registry が別 peer に移って
いる race がある (これがまさに症状 1 の原因)。確実に「現時点で誰が beacon holder
か」を知るには **別 connection 経由で redirect を受ける** 以外に方法がない。
PeerJS 層を上回る verification は不可避。

### 検討して採らなかった他案

- **Full sender authority check** (messageHandler で `senderId === beaconHolderId`
  強制): 表面症状を隠すだけで split 自体は残る。dedup で十分。
- **assumeHostRole の atomicity 強化** (Stage 1 plan の案 3): host role 決定の
  ordering だけ改善、set-and-forget gap は残る → 症状 1 直撃しない。
- **Periodic probe only (visibility なし)**: tab 復帰から probe までの window が
  最大 30s。split が一瞬で直るかもしれないが、検出速度劣る。
- **Probe interval 15s**: 30s より active split 救済が早いが、STUN/ICE 負荷が倍。
  症状 1 発生頻度を鑑みて 30s で十分。

### test 戦略

WebRTC 接続が絡むため unit test は困難。**test なしで実装 → odakin 実機検証**。
本番で split 症状が減るかで効果判定。将来 PeerManager を interface 化して mock
可能にすれば unit test を後付けできる。

### 付随作業 (同セッションで一緒に片付けると効率的)

- **Bug B 再確認**: Stage 1.5 で「sender 未検証は意図的許容」方針に反転済。Stage 2
  で何もしない。ただし Stage 2 実装中に悪意 peer 対策が必要なら改めて議論。
- **3+ peer latent 疑念** (`plans/2026-04-20-multiplayer-state-bugs.md §Stage 1 深掘り`
  参照): Stage 2 実装時に 3 peer で実機テストできると副次的に観察できる。

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
