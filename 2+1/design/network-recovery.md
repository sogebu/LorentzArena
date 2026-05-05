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

### per-peer view 軸の layer 対称性 (= 5/5 evening 4 軸 sweep deeper analysis で確立)

per-peer view 軸 (= staleFrozenIds 拡張) の中でも、 peer disconnect 検出は **3 つの独立 layer から signal を受ける** べきという layer 対称性が要請される。 各 layer の独立性:

| layer | signal | 他 layer から見えるか |
|---|---|---|
| **WebRTC DataChannel** | `dc.on('close')` 経由の TCP/SCTP / ICE close event | 他 layer からは見えない (= TCP-level) |
| **アプリ層 keepalive** | heartbeat ping 不到来の app-level 検知 | アプリ層独自、 silent failure を補う |
| **PeerJS signaling** | `peer-unavailable` error (= signaling server 経由の peer 不在通知) | signaling-only signal、 P2P 確立前/失敗で発火 |

**timing 帰結**:
- normal disconnect: WebRTC layer が 1 frame 内 (~16ms) で markStale triggered
- sleep-wake silent failure: signaling layer (即時) > heartbeat timeout (2.5sec via disconnectPeer chain) > WebRTC layer (driver dependent、 数秒〜数十秒)
- migration race: signaling layer (= 新 host 接続失敗での peer-unavailable) で最早期捕捉

→ 全 layer から signal を取って markStale 経路に集約することで H1 (= 3 秒 unprotected window) を実用上不発化、 layer 対称な fail-fast 検出が Bug 11 plan §3 (a) の真の要件 (= [Bug 11 plan §3 (a) Step 2 5/5 evening scope](../plans/2026-05-05-network-split-rule-b-runaway.md))。

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

→ migration / post-split の transient burst で **mesh-ish 通信を許容**、 normal play の star efficiency は不変。 「N² でも良し」 想起 (5/5 odakin) は既存 architecture の自然な拡張、 帯域思想の変更ではない。 implementation は別 plan に defer (= まず PeerJS signaling self-recovery 経路 (= (d)) で sleep-wake stuck が解消するか実機 verify、 不十分なら mesh-ish recovery (= room beacon ID + 既知 peer ID 試行) を追加実装)。

## 軸 5: 治療優先順 (= 思想からの含意)

1. **escape hatch (architecture neutral、 risk 0、 全 mode 対称)** — sleep-wake stuck の即時 user 救済、 (a)/(d) deploy までの安全網
2. **per-peer 軸** で Rule B 暴走の真因 layer 治療 — 3 秒 window を ms 化
3. **system topology 軸** で post-split の design 盲点を埋める — signaling self-recovery 経路新設

risk 順では (e) → (a) → (d) (= 既存機構拡張 vs 新機構)、 architectural value 順では (e) → (d) → (a) (= 盲点を埋める vs 既存窓圧縮)。 5/5 では **risk 順を採用、 (e) → (a) → (d) で連続実装**。 各 fix は直交軸なので互いに干渉ゼロ、 同 session で 3 つ deploy 可能。

## 軸 6: 既存メタ原則との対応

- **M25 (state 単一化)**: staleFrozenIds は「peer が stale か」 の唯一 source (= [`useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) `staleFrozenAtRef` Map)、 `markStale` 追加は use case 拡張で違反なし
- **M26 (絆創膏 vs 治療)**: peer disconnect 検出を真因 layer で対処 (= staleFrozenIds 拡張)、 Fix B cap soft fall-off (= [Bug 11 plan](../plans/2026-05-05-network-split-rule-b-runaway.md) 候補 (b)) は絆創膏として却下
- **M27 (多層 RCA)**: 表層 (cascade chaos) → 中層 (Fix B cap × split) → 真因 (signaling self-recovery 不足 + per-peer 検出弱い) の 3 層、 推奨 (a)+(d) は真因 layer での surgical fix

## 関連 plan / doc

- 設計記録: [`network.md`](network.md)、 [`authority-d-pattern.md`](authority-d-pattern.md)、 [`plans/2026-04-19-host-migration-symmetry.md`](../plans/2026-04-19-host-migration-symmetry.md)
- 実装 plan: [`plans/2026-05-05-network-split-rule-b-runaway.md`](../plans/2026-05-05-network-split-rule-b-runaway.md)
- メタ原則: [`design/meta-principles.md`](meta-principles.md) §M25/M26/M27
