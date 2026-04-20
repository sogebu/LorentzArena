# design/network.md — LorentzArena 2+1 ネットワーク + 通信セキュリティ

DESIGN.md から分離。WebRTC / PeerJS / ビーコン pattern / ICE / 通信検証など。

## § ネットワーク

### WebRTC (PeerJS) + WS Relay フォールバック

P2P 通信を基本とし、制限的なネットワーク環境では WebSocket Relay にフォールバック。レイテンシ最小化 (P2P) と到達性 (Relay) の両立。

### 自動接続: PeerJS の unavailable-id を発見メカニズム

ページを開くと自動でルーム ID (`la-{roomName}`) でホスト登録を試行。ID が既に使われていれば (unavailable-id エラー) クライアントとして接続。ID の手動共有が不要 (URL を開くだけ)。

注: `la-{roomName}` は Authority 解体前はゲーム PM の ID として使っていたが、現在はビーコン (発見専用) のみに使用 (下記「ビーコン専用化」参照)。

### ビーコン専用化: `la-{roomName}` をビーコン ID に固定

ホストが `la-{roomName}` をゲーム PM の PeerJS ID として使う設計を廃止。全ピア (ホスト含む) がランダム ID でゲーム接続し、`la-{roomName}` はビーコン (発見専用) のみに使用。

旧設計では、ホストの tab-hidden 復帰時に ID が `la-{roomName}` → ランダム ID に変わり、joinRegistry index が変化して色が変わっていた。ad-hoc パッチ (`previousId` in intro, joinRegistry 置換 hack) は複雑すぎたため revert し、根本解決として Phase 1 を 2 段階に分割:

1. `la-{roomName}` で一時 PM を作成 (ビーコンプローブ)。成功 → `beaconRef.current` に格納
2. `localIdRef.current` (ランダム ID) でゲーム PM を作成。open → `setAsHost()`, 標準ハンドラ登録
- ビーコンの redirect ハンドラはゲーム PM open 後に登録 (`hostId` 確定後)
- プローブ中に来たクライアントには `getConnectedPeerIds()` で遡って redirect 送信

構造的効果: 初期ホスト・マイグレーション後ホスト・tab-hidden 復帰ホストがすべて同じパターン (ランダム ID + ビーコン) に統一。Phase 2 の joinRegistry 色修正 hack は不要になり削除。

レースコンディション: ビーコンプローブ成功 → ゲーム PM open の間に別ピアが来ても、ビーコン PM が `la-{roomName}` を占有中なので競合しない。

ゲーム PM エラー時のビーコン解放: Phase 1 でビーコン取得後にゲーム PM が PeerServer エラーで失敗した場合、ビーコンだけが生き残って `la-{roomName}` を永続占有するバグを防ぐため、ゲーム PM の `onPeerStatusChange` error 分岐で `beaconRef.current.destroy()` を実行。

トレードオフ: クライアント接続レイテンシ ~100-200ms 追加 (常にビーコン経由 redirect)。ロビーの初回接続時のみ許容。

### peerOrderRef の同期 (ping piggyback、2026-04-19)

election 候補 (`peerOrderRef.current`) が client 間で drift すると migration 直後に異なる candidates[0] を選んで split → 2 ノードが同時ホスト化する。旧設計は `peerList` broadcast (host の connection-change 駆動) のみで同期していたため stale が許容されていた。

修正: ping (1s 周期) に host 視点の `peerOrder` (= 非自分 connected peers、insert 順) を毎回相乗り。client は ping 受信時に `peerOrderRef.current = [...msg.peerOrder]` で adopt。これで全 client が ≤1s 精度で同一 election base を持ち、host 死亡直後の election が一斉に同じ candidates[0] を導く。filter `id !== oldHostId` で旧 host を除外、新 host になった client は assumeHostRole 内で `id !== newHostId` で自分も除外することで「host の peerOrder = 非自分 peers」の不変条件を維持。

それでもなお race で 2 ノード同時ホスト化が発生し得る (ping ロス + 死亡タイミング偶然) ため、下記の dual-host 解消 (ビーコン降格) は依然として最終防衛線として機能する。

### ビーコンベースのホスト降格 (dual-host 解消)

peerOrderRef のずれで 2 ノードが同時にホスト化した場合、ビーコン PeerJS ID の一意性で解決する。ビーコン取得 3 回失敗したホストは別のホストが存在すると判断して降格:

1. `discoveryPm` でビーコンに接続
2. redirect で本物のホスト ID 取得
3. 自分のクライアントに `{ type: "redirect", hostId }` を broadcast
4. `clearHost()` + 本物のホストに接続
5. `setRoleVersion(v+1)` で全 effect 再評価

安全弁: discoveryPm がビーコンに 8 秒接続できない場合 (ビーコン保持者がクラッシュ済み)、降格を中止してビーコンリトライを再開。

### `roleVersion` による effect 再評価

`peerManager.setAsHost()` / `clearHost()` は PeerManager の内部フラグを変更するが React state 参照は変わらない。effect の deps が変わらないと cleanup + 再実行が起きず、(a) ビーコンが作成されない (b) heartbeat send/detect の切り替えが起きない (c) peerList broadcast が開始/停止しない。

`roleVersion` state を追加し、全ロール変更時 (ホスト昇格・ソロホスト化・降格) にインクリメント。`getIsHost()` をチェックする 4 つの effect の deps に含める。

`assumeHostRole()` ヘルパー: `clearHost + setAsHost + registerStandardHandlers + LH ownerId rewrite + peerOrderRef self-filter + setRoleVersion` の 6 操作をバンドル。「`setAsHost()` には必ず `setRoleVersion` + LH 所有権 takeover + peerOrder 正規化が伴う」という不変条件を構造的に保証。LH ownerId rewrite が `RelativisticGame` init effect と二重実装になっていた問題は 2026-04-19 に init effect 側を削除して解消、ここを single source of truth に。同期 `setPlayers` で次 RAF tick の useGameLoop が `lh.ownerId === myId` を即読む → LH 沈黙窓ゼロ。

教訓: `isMigrating` をビーコン effect の deps に入れてトリガー流用する方式は一度実装したが、ガードとトリガーの二重目的が混乱を招き即座にバグを再発させた。`roleVersion` のような単一目的のカウンターが正しい抽象化。

### ホストタブ hidden 時の PeerJS ID 解放

ホストのタブが 5 秒以上 hidden になったら PeerManager + ビーコンを destroy し、`la-{roomName}` PeerJS ID を解放。タブ復帰時は Phase 1 から再接続。

旧挙動: ホストのタブが hidden でも PeerJS シグナリング WebSocket は生きたまま。`la-{roomName}` が解放されず、新ホストのビーコン作成が永続的に失敗 → MAX_BEACON_RETRIES で誤った降格が発動していた。

`HOST_HIDDEN_GRACE = 5000` は `HEARTBEAT_TIMEOUT = 8000` より短い必要がある (クライアントがマイグレーション発動する前に ID を解放するため)。5 秒未満の alt-tab はキャンセルされ無害。

### ICE servers: 静的 env → 動的 credential fetch

`VITE_TURN_CREDENTIAL_URL` が設定されていれば、アプリ起動時に Cloudflare Worker から短命 TURN credential を fetch し、ICE servers に使う。未設定なら `VITE_WEBRTC_ICE_SERVERS` (静的 JSON)、さらに未設定なら PeerJS デフォルト (STUN のみ)。

学校ネットワーク (Symmetric NAT + FQDN blacklist) で WebRTC P2P が不可な環境のため。Open Relay (`openrelay.metered.ca`) は全ポート遮断、Cloudflare TURN (`turn.cloudflare.com`) は全ポート開通しており Cloudflare インフラは構造的にブロック不能。短命 credential は Worker で発行し API token を隔離。

Priority: dynamic (Worker fetch) > static (`VITE_WEBRTC_ICE_SERVERS`) > PeerJS defaults。Fetch 失敗は 5s timeout、失敗時は TURN なしで続行。学校ネットでは ICE 失敗 → 既存の auto fallback to WS Relay が効く。

### OFFSET 設計

`OFFSET = Date.now()/1000` (ページロード時刻)。全クライアントで値が異なるため snapshot メッセージで `hostTime` を送信して join 時に 1 回だけ補正。固定値 (`1735689600`) を試みたが Float32 精度の罠に落ちた (→ メタ原則 M10)。

---


## § Snapshot Reconciliation: 頻度で通信形態の semantics を分ける (Stage 1 + 1.5、2026-04-20〜21)

### 問題: transient event delivery 失敗 = 恒久 state divergence

Authority 解体後、`kill` / `respawn` / `intro` などのイベントは owner-authoritative に one-shot 送信される。delivery が 1 発落ちると (packet loss / migration race / tab flip)、受信側は永久にその event を知らないまま固定される。具体症状:

- **missed respawn → ghost 張り付き (B')**: 受信側に kill だけが届いて respawn が落ちると、`player.isDead=true` が固定され、その後 victim の phaseSpace はすべて `messageHandler.ts §151` の `if (existing?.isDead) return prev` で無視される。victim は復活しても受信者には永遠に消えたまま。
- **missed intro → 撃破数リストの peer ID prefix 表示**
- **missed kill → 観測者相対 score の恒久 drift**

単発の event delivery に全信頼を置く設計が構造的に脆弱。再送 / ack / ordering guarantee を入れる方向もあるが重い。

### 思想: 頻度で通信形態の semantics を分ける

**core idea**: データの性質ごとに通信形態を分ける。distributed systems の古典パターン (Raft/Paxos で強一貫性、Gossip で eventual 一貫性) の直接的適用。

- **高頻度 stream (~125Hz)**: `phaseSpace` / `laser` / `kill` / `respawn` → **star (BH relay)**、owner-authoritative、order/latency sensitive
- **低頻度 state sync (0.2Hz)**: `snapshot` → **peer 貢献型 reconciliation**、eventual consistency で十分、多ソース冗長性が効く

**相対論的 resonance**: 自分の局所観測 (phaseSpace) は owner-authoritative (frame-relative)、しかし reconciliation には "universal frame" がない — 全 peer が自分の view を送って union-merge する方が "局所観測の集合" として自然。ゲームテーマとの美学的整合。

### 段階設計: Stage 1 (BH 独り舞台) → Stage 1.5 (peer 貢献)

**Stage 1** (`4ef4fca` + `55401f4`): beacon holder だけが 5 秒ごとに `buildSnapshot` を broadcast。受信側は `applySnapshot` の `isMigrationPath` 分岐で **log union-merge + isDead 再導出 + scores 保持**。missed respawn 等は次 snapshot で自動救済。

- 既存の「新規 join 用 sendTo」経路を `setInterval(peerManager.send, 5000)` に拡張。isMigrationPath 分岐は既に `2be56b4` で導入済の防御的 merge を流用
- **scores は local 保持**: `firePendingKillEvents` が過去光円錐到達で各観測者独立に加算する観測者相対量。snapshot で上書きすると相対論的独立性が壊れる
- **isDead 再導出**: `player.isDead` field を直接 merge せず、merged killLog/respawnLog から `selectIsDead` と同じ論理で再計算。これが missed respawn 自動救済の中核
- **Bug A (local-only player)**: `nextPlayers` が `msg.players` からのみ構築されると local store の entry が捨てられる race。relay 遅延で new joiner が一瞬消える可能性あり `55401f4` で修正 (局所 entry preserve)

**Stage 1.5** (`c9503a4`): Stage 1 の限界 = **BH 自身の missed event は救済できない** (全 client が BH の視点を共有するだけ)。`getIsBeaconHolder()` guard を撤去して全 peer が snapshot を送信するよう反転。動作:

1. client A: `peerManager.send(buildSnapshot)` → A の conns = {BH} のみに届く (star topology)
2. BH: `applySnapshot` で A の log entry を union-merge → BH の state が enriched
3. BH の 5s interval: merge 済 state から snapshot build → 全 client に broadcast
4. 他 client: BH の enriched snapshot を union-merge

伝播最大 10s (A が BH fire 直後送信)、平均 5s。BH 帯域 O(N) 維持 (mesh の O(N²) にはならない)。

### 設計判断: full mesh ではなく pseudo-mesh (BH merger) を選んだ理由

5 軸で候補を比較:

| 軸 | Stage 1 (BH 独り舞台) | **Stage 1.5 (BH merger) ← 採用** | full mesh |
|---|---|---|---|
| 対称性 | BH 非対称 | 全員 snapshot 送信 ✓ | 完全対称 ✓✓ |
| 効率性 | BH O(N) | BH O(N) 維持 ✓ | 全員 O(N²) |
| クリーンさ | 単純 | 頻度で役割分離 ✓ | 完全分離 ✓ |
| シンプルさ | 現状 | **guard 1 行撤去** | mesh 接続管理 +100 LOC |
| 堅牢性 | BH 単独視点 | BH が全 peer 観測から merge ✓ | BH downtime でも継続 |

full mesh の追加 robustness (BH 停止中の reconciliation 継続) は現スケール (2-4 peer、BH tab-hidden は `HOST_HIDDEN_GRACE` で既に対応済) では ROI 低く defer。

**将来の full mesh 移行**: Stage 1.5 の messageHandler は既に "どの peer からの snapshot も受け付ける" semantics。mesh 接続を追加すれば自動的に mesh snapshot 化する (stepping stone として設計)。

### 意図的な設計反転: sender authority check を入れない

Stage 1 時点では「任意の peer が snapshot を送れる」は risk 扱い (Bug B) だった。Stage 1.5 では **peer 貢献を歓迎する方向**に反転。`senderId === beaconHolderId` の check は意図的に行わない。

- union-merge + dedup key `(id, wallTime)` が sender に依らず安全
- cooperative game 前提の cost/benefit。悪意 peer が偽 entry を入れるリスクは残るが現スコープ許容

### 高頻度通信 (125Hz) と mesh の関係: 帯域は下がらない

"snapshot は peer 貢献、phaseSpace も mesh でいけるのでは?" の検討結果:

- broadcast semantics (全員が全員の update を受ける) では総送信回数 N×(N-1) が下限。star でも mesh でも同じ
- mesh は **レイテンシ優位** (1 hop vs 2 hop)、125Hz では有意。ただし NAT 越えコスト (TURN 経由時の帯域) も考慮要
- 帯域を下げる技法は別軸: interest management (past-cone pruning) / delta encoding / gossip trees / Voronoi 距離 pruning
- このゲームの規模 (2-4 peer、全員互いの光円錐内) では mesh 化で 125Hz 帯域は下がらない

結論: 高頻度 stream は star 継続、低頻度 snapshot のみ peer 貢献化。

### `buildSnapshot(myId, isBeaconHolder)` 引数の意味論

Stage 1.5 実装直後の深掘り audit で発見した catastrophic bug の修正 (`76ba182`)。`buildSnapshot` は LH の ownerId を caller (myId) に強制 rewrite していた (migration 直後の 1-tick race 安全弁)。Stage 1 までは BH のみが呼んでいたので無害だったが、Stage 1.5 で全 peer が呼ぶようになった結果:

- client A が `buildSnapshot(A_id)` → 出力 snapshot の LH.ownerId = A_id
- BH が受信 → `applySnapshot §167-175` の「local-newer 優先」で snapshot が勝つケース (BH tab hidden / pos.t 拮抗) に BH の local LH.ownerId = A_id に汚染
- **BH の `lh.ownerId === myId` check が false → BH の LH AI 沈黙**

修正: `isBeaconHolder: boolean` 引数で caller の役割を明示。`true` のときのみ LH.ownerId を自分に rewrite、client は preserve。3 call sites (PeerProvider Stage 1.5 effect は `getIsBeaconHolder()` を動的に渡す / RelativisticGame 新 joiner 送信は true 固定 / messageHandler の snapshotRequest 応答は true 固定)。

**教訓**: "BH 専用" 機能を全 peer で使い回すとき、implicit な BH 前提 (権限主張系のロジック) を引数で明示化する必要がある。Stage 1 → 1.5 で抽出された暗黙 asymmetry の典型例。

---


## § 通信・セキュリティ

### メッセージバリデーション

`messageHandler.ts` で全メッセージタイプに `isFiniteNumber` / `isValidVector4` / `isValidVector3` / `isValidColor` / `isValidString` のランタイム検証を実施。laser range は `0 < range <= 100` (LASER_RANGE=10 の 10 倍をマージン)。

**意図**: `msg: any` で受け取ったネットワークメッセージの NaN/Infinity 注入防止、laser の color フィールドなど CSS 文字列で CSS インジェクション防止、文字列フィールドの型安全性確保、不正メッセージのリレー防止。

ホストリレー (PeerProvider) でも `isRelayable()` で構造を検証してからブロードキャスト。

**不採用**: body の sender 検証。body の `senderId` は送信者が自己申告する値で spoofing 防御にならない (→ § Authority 解体 B 参照)。

注: `playerColor` メッセージ型は 2026-04-06 に廃止済み (色は決定的算出)。

zod 等のスキーマライブラリは導入せず手書きで軽量に。

### グローバルリーダーボード: Cloudflare KV 単一キー設計

リーダーボード全エントリを KV の単一キー `"top"` に JSON 配列として格納。Worker 側でトップ 50 フィルタ (read → 比較 → 条件付き write)。

KV は値サイズ 25 MB まで。50 エントリ × ~100 bytes ≈ 5 KB で十分収まる。単一キーなら read 1 回 + write 最大 1 回。トップ 50 に入らないスコアは read only (無料枠 100K reads/日で十分)。write は条件付きなので無料枠 1K writes/日を大幅に節約。

トレードオフ: 同時書き込みの last-write-wins。物理デモゲームでは許容。

Worker ソースは `turn-worker/src/index.ts` (TURN credential proxy と同居)。クライアント側 URL は `.env.production` の `VITE_LEADERBOARD_URL`。

### グローバル送信: fetch keepalive (not sendBeacon)

`submitScore` は `fetch({ keepalive: true })` で送る。`pagehide` / `beforeunload` / `visibilitychange` (hidden) の各イベントで発火。

過去経緯:
- 初期 (〜2026-04-14): `sendBeacon` + `Blob("text/plain")` 構成 (→ 旧メタ原則 M9: sendBeacon は CORS preflight 不可、`application/json` だとブラウザが黙って捨てる)
- 2026-04-18: Brave Shields が `sendBeacon` の Request Type=ping を cross-origin tracker として block することが判明。production で HS が local には保存されるのに global には到達しない症状で発覚。`fetch({ keepalive: true })` は ping type ではなく fetch type として分類されるため content blocker を通過する (→ メタ原則 M19)

### Relay サーバーセキュリティ

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | WebSocket ping (サーバー→クライアント) |
| `HEARTBEAT_TIMEOUT_MS` | 10s | WebSocket pong タイムアウト |

注: 上記は relay server の WebSocket レベル heartbeat。ゲームクライアントの beacon holder 切断検知は別 (`PeerProvider` の `ping`、Stage G 以降 1s / 2.5s)。

---

