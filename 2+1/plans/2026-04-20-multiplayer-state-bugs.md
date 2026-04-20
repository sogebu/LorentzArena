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

### A. 症状 3 → 最小表面止血 (低リスク、即効) — **完了 `2be56b4`**

ControlPanel の displayName lookup を多段 fallback に:

```typescript
// ControlPanel.tsx:184-188 の書き換え
players.get(id)?.displayName
  ?? store.displayNames.get(id)                  // NEW: intro 経由のみで来た name
  ?? killLog.find(e => e.killerId === id || e.victimId === id)?.killerName  // NEW: 過去 kill event
  ?? id.slice(0, 6)
```

加えて intro handler を `pendingIntros: Map<string, string>` にキャッシュして、phaseSpace 到着時に apply。snapshot の `displayNames` を reactive state (`setState` 対象) に昇格。

**副作用**: なし。見た目の fallback が増えるだけ。

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

### B' (未着手). OtherPlayerRenderer LIVE branch の視認性

OtherPlayerRenderer の LIVE branch は past-cone visibility check を**していない**
(computePastConeDisplayState は dead branch でのみ呼ばれる)。症状 2 の
「相手が respawn 後に ship が消える」の原因は別にある可能性あり — sphere の
描画位置 (world frame で dp.t = spawnT - observer.t) が camera frustum から
外れている、あるいは selectIsDead が stale で `player.isDead === true` が
張り付いている、等。C の調査で一緒に追う。

現在 `spawnT = player.worldLine.history[0]?.pos.t`。respawn 直後は history.length=1 で spawn 位置のみ。これを store の `respawnLog` の最新 entry から取る:

```typescript
const latestRespawn = [...respawnLog].reverse().find(e => e.playerId === player.id);
const spawnT = latestRespawn?.position.t ?? player.phaseSpace.pos.t;
```

**副作用**: LH の past-cone 表示 (`LighthouseRenderer` も `computePastConeDisplayState` を呼ぶ) が影響を受ける。LH の respawn ロジックと整合するか要確認。

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

1. 本書 + `plans/2026-04-19-host-migration-symmetry.md` を読む
2. ~~A (ControlPanel fallback + intro pending) を先に fix + localhost でテスト + deploy~~ → 完了 `2be56b4`
3. ~~B (spawnT を respawnLog ベース) を fix~~ → 完了 `8ce595f`。**deploy + 実戦テスト** (respawn が絡むので localhost 単独で検出困難、odakin が実機で B 症状の消失を確認する)
4. 残課題 B' (OtherPlayerRenderer LIVE 消失) を C 調査と合わせて再観測
5. C の再設計議論、plan 書き起こしから

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
