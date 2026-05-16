# Network Recovery 思想 (2026-05-05 確立)

## 動機

5/5 verify session で観察された compound 症状群 (= [Bug 11 ledger](../SESSION.md))、 特に 5/5 PM の sleep-wake で reliable repro 確立した「両 tab がホスト化 + 互いが見えない + 一方が `Cannot connect to new Peer` で stuck」 は、 既存 [`network.md`](network.md) の「normal play は star、 migration は star 再生成」 軸では捉えきれない post-split phase の盲点に起因する。

本 doc は network recovery の思想を 6 軸で整理し、 plan + implementation の anchor として固定化する (= 5/5 セッションで形になった hard-won insights の永続化)。

## 軸 1: Phase 別の対称性

| Phase | 通信形態 | 対称性 |
|---|---|---|
| **normal play** | star (BH relay) | BH/非-BH の 2 役、 send/receive は対称 |
| **migration** | star 再生成 (election) | election base が ≤1s 精度で全 client 同期 (Bug 1 fix で達成、 詳細: [`plans/2026-04-19-host-migration-symmetry.md`](../plans/2026-04-19-host-migration-symmetry.md)) |
| **post-split** | broken (= 各 tab 独立 host 化、 互いの存在を知らない) | **崩壊** = 既存 design の盲点 |

normal play / migration はどちらも star を前提に回るが、 post-split (= sleep-wake で signaling layer 自体が死亡) は migration の star 再生成すら trigger できない。 各 tab が独立に「peers 不在」 と判断 → 全員 solo host 化 → mutual invisibility が persistent state 化する。

## 軸 2: Recovery の 3 直交軸

| 軸 | 治療対象 | 実装 ([Bug 11 plan](../plans/2026-05-05-network-split-rule-b-runaway.md) 候補番号) |
|---|---|---|
| **per-peer view 軸** | 自分から見て相手が消えた瞬間を即時反映 | staleFrozenIds 拡張 (= (a)) |
| **system topology 軸** | signaling layer self-recovery | PeerJS reset (= (d)) |
| **escape hatch 軸** | 全 mode 対称、 user reload で fresh start | reload prompt modal (= (e)) |

3 軸は完全に直交、 互いの implementation に干渉ゼロ、 補完関係。 1 軸の修正が他軸の問題を解消することはない (= H1 を fix しても H3 は残る、 逆も同様)。

### per-peer view 軸の layer 対称性 (= 5/5 evening 4 軸 sweep deeper analysis で確立、 Stage 8 で direction 対称まで完成)

per-peer view 軸 (= staleFrozenIds 拡張) の中でも、 peer disconnect 検出は **4 つの独立 layer から signal を受ける** べきという layer 対称性が要請される。 各 layer の独立性:

| layer | signal | direction (client/BH) | 他 layer から見えるか |
|---|---|---|---|
| **WebRTC DataChannel** | `dc.on('close')` 経由の TCP/SCTP / ICE close event | 両方向対称 ✓ | 他 layer からは見えない (= TCP-level) |
| **アプリ層 keepalive (heartbeat)** | host → client への ping 不到来検知 | client 側のみ (= host が ping 送信) | アプリ層独自、 silent failure を補う |
| **PeerJS signaling** | `peer-unavailable` error (= signaling server 経由の peer 不在通知) | client 側のみ (= 新 host 接続試行で発火) | signaling-only signal、 P2P 確立前/失敗で発火 |
| **アプリ層 phaseSpace timeout** ✨ | 1.5 sec 不到来で early markStale (= 125Hz 送信で 187 frame 連続 loss を異常認定) | **両方向対称 ✓** (= Stage 8-B、 BH 側 direction 対称性の根本治療) | アプリ層独自、 既存 lastUpdateTimeRef 経由 |

**direction 対称性** (= Stage 8-B、 commit `2a54a29`): heartbeat / signaling layer は client 側 specific で BH 側に対応する signal がない (= BH は ping を送る側、 client から ping は受けない)。 **BH 側 sleep-wake シナリオ** (= solo host / 2 tab demo / migration 後の host 切替で発生する typical scenario) で BH 側の disconnect 検知が WebRTC layer のみに依存して timing が遅れる問題を、 **phaseSpace 1.5 sec early threshold** で解消。 phaseSpace は 125Hz で双方向送信されるため、 不到来検知は両方向対称な早期 signal として機能する。

**timing 帰結**:
- normal disconnect: WebRTC layer が 1 frame 内 (~16ms) で markStale triggered
- sleep-wake silent failure (client 側): signaling (即時) > heartbeat (2.5sec) > phaseSpace timeout (1.5sec) > WebRTC layer (driver dependent)
- sleep-wake silent failure (BH 側): **phaseSpace timeout (1.5sec)** > WebRTC layer (driver dependent) — Stage 8-B で BH 側に layer 4 が確立、 0-1 sec 圧縮実現
- migration race: signaling layer (= 新 host 接続失敗での peer-unavailable) で最早期捕捉

→ 全 layer から signal を取って markStale 経路に集約することで H1 (= 3 秒 unprotected window) を実用上不発化、 direction 対称な fail-fast 検出が Stage 8-B 完成で達成。

### system topology 軸の transport 対称性 (= Stage 8-A で確立)

system topology 軸 (= signaling layer self-recovery) の中でも、 PeerJS / WS Relay 両 transport で同じ recovery 経路を持つべきという transport 対称性が要請される。

| transport | reconnect API | 内部 logic |
|---|---|---|
| **PeerJS** | `PeerManager.reconnect()` (commit `26dc8d7`) | `peer.reconnect()` 試行 → 失敗で `peer.destroy()` + 新 Peer 作成 |
| **WS Relay** | `WsRelayManager.reconnect()` ✨ (commit `997c7a3`、 Stage 8-A) | WebSocket が CLOSED/null なら旧 ws close 後 `openSocket()` 再呼出 |

**NetworkManager union type** (= `PeerManager<Message> | WsRelayManager<Message>`) の全 member が `reconnect()` を実装する transport 抽象 contract により、 `PeerProvider` 側で `instanceof` check 不要で transport 抽象的に呼べる。 `peerStatus.status === "disconnected"` を 5 sec watch する useEffect は両 transport で同 path で動作。

→ transport 対称性 architecture 的に完璧、 PeerJS / WS Relay いずれの transport で運用していても sleep-wake 自動復帰が機能する。

### post-split phase の mesh-ish recovery (= Stage 8-C で確立、 軸 4 の実装具現化)

軸 4 で「N² でも良し」 思想を明文化したが、 implementation は別 plan defer されていた。 Stage 8-C で **既存 mesh-ready stepping stone** ([`network.md`](network.md) L142、 messageHandler は「どの peer からの snapshot も受け付ける」 semantics) を migration recovery で **初活用**、 post-split phase の最後の盲点を埋めた。

**実装** (commit `9b3f2ff`、 Stage 8-C):
- (d) reconnect 試行時に `reconnectTriggeredRef.current = true` set
- 復帰後の最初の `peerStatus = "open"` 遷移で `peerOrderRef.current.slice(-8)` (= 過去観察 peer ID list の最近 8 個) に対して `peerManager.connect(id)` 試行
- 既存 conns に居ない ID のみ試行 (= 重複防止)
- 失敗 (= dead peer ID) は peer-unavailable → signaling layer 経路で markStaleId → 自然 GC

**post-split race の救済**: beacon 経由 connection 失敗 (= 旧 BH dead) でも別 peer alive なら mesh-ish 試行で発見、 既存 star topology の盲点を埋める。 normal play の star efficiency は不変、 mesh burst は migration の transient phase 数秒のみ。

## 軸 3: Bug 11 真因 3 層 chain (H1+H2+H3 統合)

### H1 (per-peer): 3 秒 unprotected window で Rule B 永続発火

Fix B cap (= [`useGameLoop.ts`](../src/hooks/useGameLoop.ts) `MAX_VIRTUAL_TAU_SEC = 2`) と stale wall threshold (= [`useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) `STALE_WALL_THRESHOLD = 5000ms`) の **3 秒 unprotected window** で Rule B 永続発火 → frozenWorldLines mount storm。

数学:
- T=0: peer から phaseSpace message 受信
- T=2: Fix B cap 発動 (= virtualPos が wall_clock に対して frozen 開始)
- T=2..5: 自機からは「peer がどんどん過去に取り残されていく」 ように見える → 自機 Rule B fire = 跳躍。 同時に対岸でも同じことが起きる (両側 Rule B 永続発火)
- T=5: stale wall threshold 超過 → `staleFrozenAtRef.set` → Rule B から除外、 暴走停止

→ T=2..5 の **3 秒間が Rule B 暴走窓**。 (a) markStale 拡張で disconnect 検出時に即時 stale 化すれば、 この窓を ms オーダーに圧縮できる (= H1 真因対処)。

### H2 (migration): host election race

複数 tab が同時 solo host 化する transient race。 console log 「[PeerProvider] Host split detected — real BH: xxx — demoting self」 で片方が降格する経路は既存だが、 sleep-wake で signaling layer 自体が死亡している場合は降格先 (= 真の host) への接続も失敗、 mutual invisibility が persistent 化。

### H3 (system): PeerJS WebSocket 切断後の再接続困難

PeerJS WebSocket 切断後の同 instance 再接続が PeerJS 既知挙動で困難 (= `Cannot connect to new Peer after disconnecting from server` で stuck)。 sleep-wake で全 peer の WebSocket が切れ、 各 tab が独立に再接続を試みる → 1 tab が成功して solo host、 他 tab は stuck。

### Compound trigger

sleep-wake は H1+H2+H3 を compound に発火する trigger:
- sleep 中: 全 peer の lastSync が currentTime から大きく乖離
- wake 直後: 全 peer の virtualPos が Fix B cap で frozen → H1 確実発火
- 同時刻に各 tab が「peer 不在」 と判断して solo host 化 → H2 発火
- WebSocket が再接続できない tab は H3 に陥る

## 軸 4: 通信トポロジーの帯域特性 (= 「N² でも良し」 の正規化)

normal play の star は **既に system total O(N²)** を BH 集中で運用。 これは [`network.md`](network.md) §「高頻度通信 (125Hz) と mesh の関係: 帯域は下がらない」 が認める通り、 **star も mesh も system total 帯域差はない**。 違いは distribution:

| 視点 | star | mesh |
|---|---|---|
| 1 broadcast event あたりの total messages | N-1 | N-1 |
| N peers 全員が並行 broadcast、 system total | **O(N²)** | **O(N²)** |
| per-peer 帯域 (sustained、 全員 broadcast 時) | client = O(1)、 BH = O(N²) 集中通過 | 各 peer 一律 O(N) |
| 遅延 | 2 hops via BH | 1 hop direct |

mesh full N² の defer 理由は **ROI** (= 接続管理 +100 LOC + NAT 越えコスト)、 帯域そのものではない。 messageHandler は既に **mesh-ready stepping stone** ([`network.md`](network.md) L142、 「どの peer からの snapshot も受け付ける」 semantics) として設計されている。

→ migration / post-split の transient burst で **mesh-ish 通信を許容**、 normal play の star efficiency は不変。 「N² でも良し」 想起 (5/5 odakin) は既存 architecture の自然な拡張、 帯域思想の変更ではない。 ✅ **5/5 evening Stage 8-C で実装具現化** (commit `9b3f2ff`、 詳細は本 doc 軸 2 末尾「post-split phase の mesh-ish recovery」 subsection)。 既存 stepping stone を migration recovery で初活用、 思想と実装の gap を解消した根本治療。

## 軸 5: 治療優先順 (= 思想からの含意)

1. **escape hatch (architecture neutral、 risk 0、 全 mode 対称)** — sleep-wake stuck の即時 user 救済、 (a)/(d) deploy までの安全網
2. **per-peer 軸** で Rule B 暴走の真因 layer 治療 — 3 秒 window を ms 化
3. **system topology 軸** で post-split の design 盲点を埋める — signaling self-recovery 経路新設

risk 順では (e) → (a) → (d) (= 既存機構拡張 vs 新機構)、 architectural value 順では (e) → (d) → (a) (= 盲点を埋める vs 既存窓圧縮)。 5/5 では **risk 順を採用、 (e) → (a) → (d) で連続実装**。 各 fix は直交軸なので互いに干渉ゼロ、 同 session で 3 つ deploy 可能。

## 軸 6: 既存メタ原則との対応

- **M25 (state 単一化)**: staleFrozenIds は「peer が stale か」 の唯一 source (= [`useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) `staleFrozenAtRef` Map)、 `markStale` 追加は use case 拡張で違反なし
- **M26 (絆創膏 vs 治療)**: peer disconnect 検出を真因 layer で対処 (= staleFrozenIds 拡張)、 Fix B cap soft fall-off (= [Bug 11 plan](../plans/2026-05-05-network-split-rule-b-runaway.md) 候補 (b)) は絆創膏として却下
- **M27 (多層 RCA)**: 表層 (cascade chaos) → 中層 (Fix B cap × split) → 真因 (signaling self-recovery 不足 + per-peer 検出弱い) の 3 層、 推奨 (a)+(d) は真因 layer での surgical fix

## 軸 7: WebRTC died 経路の Rule B catchup 明示 (2026-05-06、 Bug 14 plan)

`plans/2026-05-06-bug14-global-active-time.md` で導入された **globalActive 設計** (= `useGameLoop` の `if (!selfActive && !peerActive) return`) は mobile suspend 復帰時の経路を以下の 3 つに分類:

| 経路 | 状態 | 対処 |
|---|---|---|
| (1) WebRTC connection 生存 + queued message 復帰 | OS / browser が message を queue 蓄積、 wake で callback 発火 | `lastWitnessTimeRef` 更新 → `peerActive=true` → **直接 integrate** |
| (2) WebRTC connection 生存 + message drop | suspend throttle で message drop | `lastWitnessTimeRef` stale → `peerActive=false` → **skip** → 次 broadcast 受信で同期 |
| (3) WebRTC connection 死亡 | long suspend で peer reset | reconnect まで message 来ない → `peerActive=false` → **skip** → reconnect 後 fresh peer.pos.t で **既存 Rule B が catchup jump** |

**(3) は absorption ではなく structural 設計**: Rule B (= `causalityJumpLambda`) は state divergence recovery のための設計柱で、 既に `2026-05-02 causality-symmetric-jump` plan で 「post-recovery 振動防止」 の hysteresis (`CAUSAL_FREEZE_HYSTERESIS = 2.0`) + exit margin (`CAUSALITY_JUMP_EXIT_MARGIN_LS = 0.001`) と complementary に設計済。 Bug 14 plan の globalActive は **Rule B 発火頻度を削減** する効果があり (= mutual hidden + active hidden case で発火しなくなる)、 残る (3) は明示的 fallback として既存設計柱に乗る。

将来 plan: post-suspend handshake (= wake 時 reconnect で peer に「私の suspend 中、 あなた active だった?」 を問い合わせる broadcast schema 追加) で (3) も Rule B 不要化可能。 現 plan の scope 外、 backbone 不変なため後付け可能。 詳細: `plans/2026-05-06-bug14-global-active-time.md` §6.5。

## 軸 8: F1 mutual-freeze 防止 broadcast gate 撤廃 (2026-05-16)

### 問題

2 player 本番テストで「両者凍結 + 頻繁な flicker」 (odakin 5/16 報告)。 Rule A (= freeze) と Rule B (= jump) は `dt = peer.t - me.t` の符号で代数的に排他的 (= 片方が `dt < 0` で freeze 領域なら他方は `dt > 0` で jump 領域)、 両者 freeze は代数的不可能。 にもかかわらず実機で観察された。

### 真因

各 client は自分の local `me.pos.t` と **virtualPos 経由の peer.pos.t 推定値** を比較する。 旧仕様の broadcast gate ([useGameLoop.ts:710](../src/hooks/useGameLoop.ts) 旧 `if (didPhysics || lambda > 0)`) は凍結中 + Rule B 不発 (= `lambda=0`) で broadcast 完全沈黙。 peer 側の `lastUpdateTime` が更新されず、 [virtualPos](../src/components/game/virtualWorldLine.ts) の線形外挿が `MAX_VIRTUAL_TAU_SEC = 2 sec` cap まで drift。

この結果、 両 client の **局所 view が独立に「peer in past」 を観察可能** な状況が生まれる:

- A 凍結 → A 沈黙 → 2 sec 後 B の virtualPos(A) cap (= `T_A_freeze + 2γ_A`)
- B はその間に物理走行で B.local.pos.t > virtualPos(A) cap を経由 → B も Rule A 領域 → 両者凍結

代数的対称性は **virtualPos が真値と一致するとき** のみ保証され、 broadcast 停止経路で破れる。

### 修復 (F1)

broadcast gate を撤廃して **凍結中も毎 tick broadcast**:

- sender 側: `if (didPhysics || lambda > 0)` gate は **store update のみ** に残し (= 不要 update 防止)、 [`sendToNetwork`](../src/hooks/useGameLoop.ts) は無条件
- 受信側: [`messageHandler`](../src/components/game/messageHandler.ts) で `phaseSpaceEquals` dedup を入れ、 `existing.phaseSpace === new phaseSpace` なら setPlayers に `return prev` で no-op (= worldLine 重複 append 抑制 + zustand subscriber 無駄 notify 抑制)。 ただし **`lastUpdateTime` / `lastWitnessTime` は dedup 対象外** で必ず更新 (= F1 の核心: peer の virtualPos baseline を fresh に保つ)
- 受信側 dedup は **`shouldResetWorldLine` 時は skip**: gap epoch boundary (= host migration / long suspend 後の reconnect) では phaseSpace 不変でも正規再構築が必要

### 整合性

- frozen + lambda=0 で `newPs = freshMe.phaseSpace` (= 不変)、 store update を skip しても broadcast 値は wire と一致 (= 整合性軸 maintain)
- peer 側受信時 `tau ≈ 0` で virtualPos extrapolation 不要 → peer.t 推定が真値と bit-exact 一致 → 代数的対称性回復
- 既存の `CAUSAL_FREEZE_HYSTERESIS = 2.0` (= [`constants.ts`](../src/components/game/constants.ts)) と complementary: F1 は「両者凍結」 を構造的に不可能化し、 hysteresis は残る「片側の境界振動」 を吸収

### 残課題 (F1 単独で完治しない部分)

F1 後も「leader / follower 役割の swap」 による flicker は残り得る (= |dt| が時間とともに sign を変える case)。 hysteresis (= 2.0) で多くは吸収されるが、 完全消失は別軸の修復が必要 (= 凍結中も pos.t advance / role hysteresis / tie-breaker)。 5/16 セッション時点では F1 単独で実機 verify、 残 flicker があれば後続 plan で対処。

### 関連

- 修復 commit: [`996ac44`](https://github.com/sogebu/LorentzArena/commit/996ac44) (2026-05-16、 build `15:53:27`)、 odakin 実機 verify「大丈夫そう！」 で両者凍結 flicker 消失確認
- test: [`messageHandler.test.ts`](../src/components/game/messageHandler.test.ts) §F1 5 case 追加
- メタ原則: [`design/meta-principles.md`](meta-principles.md) §M43 (= globalActive と complementary) + §M27 (= 多層 RCA: 表層「両者凍結」 → 中層「virtualPos drift」 → 真因「broadcast gate」)

## 軸 9: VPN-aware multi-tier transport (= 検討中、 2026-05-16)

### 問題

2026-05-16 F1 deploy 直後、 2 player 本番テストで「繋がっては切れ + 両者ホスト化」 を odakin 観察。 切り分けた結果、 **共著者 (= 安田くん) 側 NordVPN 経由の NAT path 不整合** が原因 (= VPN 除去で復旧、 F1 とは無関係)。 設定確認 screenshot で安田くんは「**NordVPN P2P サーバ Japan-Tokyo #826**」 接続 = NAT 設定は WebRTC 向きの best 寄り。 これでも繋がらないとなると、 user 側設定変更で改善余地は限定的、 ゲーム側で multi-tier fallback を実装すべきと判断。

「繋がっては切れ」 は WebRTC `dc.close` repeat cycle、 「両者ホスト」 は signaling allocation race の二次症状 (= `la-{roomName}` beacon allocation が signaling timeout で release され、 reconnect 時に両者が claim する race)。

### 既存の多段経路 (= code 上)

| Tier | 経路 | 状態 |
|---|---|---|
| **1** | WebRTC direct (= host candidates + STUN srflx) | 現状 default、 LAN / 開放 NAT で動く |
| **2** | WebRTC via TURN (= Cloudflare TURN relay、 `VITE_TURN_CREDENTIAL_URL` 動的 credential) | 現状 default、 [`.env.production`](../.env.production) 設定済 |
| **3** | **WS Relay** (= [`relay-server/server.mjs`](../relay-server/server.mjs) + [`relay-deploy/`](../relay-deploy/) Caddy + Docker) | **code 既存、 production 未 deploy** (= `VITE_WS_RELAY_URL` 未設定) |

WS Relay は WebRTC を完全に bypass する application-level WebSocket relay。 corporate VPN / 厳しい firewall / TURN 全滅 でも WebSocket (= port 443) が通れば動く、 最終 fallback。 既存 transport mode 機構は [`src/config/peer.ts`](../src/config/peer.ts) で `"peerjs" | "wsrelay" | "auto"` 切替対応、 [`PeerProvider.tsx`](../src/contexts/PeerProvider.tsx) で活性化済。 ただし起動時の選択のみで **runtime fallback (= 接続失敗時の自動切替) は未実装**。

### Tier 3 enable + runtime fallback 設計

実装案 (= 詳細は [`plans/2026-05-16-vpn-multi-tier-fallback.md`](../plans/2026-05-16-vpn-multi-tier-fallback.md)):

**A 改 (= 全員 always-relay)**: `VITE_WEBRTC_ICE_TRANSPORT_POLICY=relay` を `.env.production` で hardcode。 数分で deploy 可能。 全員 +5-15ms latency (= Tokyo TURN endpoint で日本国内同士なら minor)、 Cloudflare TURN 単一依存 → TURN 障害時に **direct で動ける odakin 環境も巻き込まれる**、 credential expire リスク。

**C 案 (= runtime auto-fallback within WebRTC)**: 起動時 `iceTransportPolicy: 'all'` で direct + TURN 自動選択、 N sec 経過しても 'open' イベントが来なければ close + `iceTransportPolicy: 'relay'` で reconnect。 ~1-2 時間実装。 direct 可能 user は latency 増なし、 VPN user のみ N sec 待ち。 TURN 障害でも direct path 生存。

**Tier 3 enable (= C 案 + WS Relay 第 3 経路)**: WS Relay server を Fly.io / Render / 自宅サーバ等に Docker で deploy + TLS 証明書 + `.env.production` に URL 追加 (= 1-2 時間)。 PeerProvider に Tier 2 timeout → Tier 3 fallback ロジック追加 (= 1-2 時間)。 corporate VPN / 厳しい firewall まで対応可、 WebRTC 完全 bypass で TURN 不要。

### 切り分けの教訓

「F1 deploy 直後の新症状 → 真因は F1 ではなく client 環境 (= VPN)」 のパターン。 `~/Claude/odakin-prefs/work-discipline.md §「Fix 投入直後の新症状 → revert 前に pre-existing で再現するか必ず確認」` の事例。 deploy timing と client 環境変化が偶然同時のとき、 deploy を犯人と誤認しないために revert vs pre-existing check を先に。

production multi-machine test では client 環境 (= VPN / proxy / NAT type / browser flag) を **verify checklist** に加えるべき (= 同教訓は odakin-prefs work-discipline 側にも記録)。

### 関連

- 設計議論: 2026-05-16 odakin × Claude session の対話 (= SESSION.md 「5/16 多 commit batch」 +「次セッション持ち越し」)
- 共著者側 NordVPN 接続情報 (= 5/16 screenshot 共有): P2P server Japan-Tokyo (= NordVPN の P2P カテゴリ、 NAT は WebRTC 向き設定)、 server# / IP / upstream ISP の literal は本 public repo から除外 (= 個人層 / network-notes リポに記録)
- 実装 plan: [`plans/2026-05-16-vpn-multi-tier-fallback.md`](../plans/2026-05-16-vpn-multi-tier-fallback.md) (= 新設)

## 関連 plan / doc

- 設計記録: [`network.md`](network.md)、 [`authority-d-pattern.md`](authority-d-pattern.md)、 [`plans/2026-04-19-host-migration-symmetry.md`](../plans/2026-04-19-host-migration-symmetry.md)
- 実装 plan: [`plans/2026-05-05-network-split-rule-b-runaway.md`](../plans/2026-05-05-network-split-rule-b-runaway.md)、 [`plans/2026-05-06-bug14-global-active-time.md`](../plans/2026-05-06-bug14-global-active-time.md)
- メタ原則: [`design/meta-principles.md`](meta-principles.md) §M25/M26/M27/M43
