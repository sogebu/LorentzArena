# Plan: Network split + Fix B cap で両側 Rule B 一時暴走 (cascade chaos) RCA

**起草**: 2026-05-05 (= 当初 plan-only)
**Update**: 2026-05-05 PM、 odakin 観察 sleep-wake → 両 tab がホスト化 + 互いが見えない で **reliable repro 確立**、 仮説 H3 追加。
**v2 refresh**: 2026-05-05 evening、 implementation phase 着手前の audit で発見した懸念 (B1-B4) を反映、 思想は別 doc [`design/network-recovery.md`](../design/network-recovery.md) で 6 軸整理して anchor 化。 推奨順 (e) → (a) → (d) で連続実装 (= 3 軸が直交、 互いに干渉ゼロ)。
**Status**: 🟢 **implementation phase 着手 (= 5/5 evening、 (e)/(a)/(d) 連続実装方針)**。

---

## §1 観察 facts (= 5/5 verify session)

5/5 verify session で multi-tab で host migration を試した時に出た transient 症状群:

| Phase | tab 構成 | 観察 symptom |
|---|---|---|
| **Phase 2** (= 70-233s) | Tab 1 (旧 host) → Tab 2 (新 host) host migration 1 回経由 | 両 client (= Tab 1 client 化 + Tab 2 host 化) で **因果律跳躍 overlay 同時 fire** / **LH worldline cyan 列に縞 stack** / setInterval Violation 9 件 |
| **Phase 3** (= multi-tab cascade) | 4+ peer (= g259b6wzf / 5bsa4twed / xr1n7nims / 90v3hvtqu) が beacon ownership を 5+ 回 flip | `GL_INVALID_OPERATION: invalid mailbox name` / `texture is not a shared image` × 3 / 一人の client から peer 全員が不可視 / `[PeerProvider] Host split detected — real BH: xxx — demoting self` |
| **Phase 4** (= 安定 2-tab) | 単純 host + 1 client | **持続状態 再現せず** — 因果律跳躍 持続 fire / LH worldline 縞 / Context Lost (= Phase 1 1 tab で発生していた DebrisRenderer GC 起因の Context Lost は 5/5 `7a7df95` deploy 後に頻度低下見込み) |

Phase 4 の「再現せず」 が **transient nature の決定打**: bug は **multi-tab beacon migration cascade phase 限定** で発生、 stable 2-peer では surface しない。

---

## §2 仮説 (= 一次 RCA)

### 仮説 H1 (= 主仮説、 信頼度 高): Fix B 2-sec cap × network split

`useGameLoop.ts` の Rule B 評価で各 peer の virtualPos を計算する時:
```ts
const lastSync = stale.lastUpdateTimeRef.current.get(pId) ?? currentTime;
const vPos = virtualPos(p, lastSync, currentTime);
```
`virtualPos` は `tau = currentTime - lastSync` で peer 位置を extrapolate。 `Fix B` (= `c8ef4b3`、 5/4) で `tau` に upper bound `MAX_VIRTUAL_TAU_SEC = 2` sec を導入。

通常 (= 接続 OK): peer から phaseSpace message が連続的に届く → `lastSync` が currentTime に追従 → tau ≪ 2 sec → cap 不発 → virtualPos が wall_clock に追従。

**Network split (= 一時的接続喪失) 中**:
1. peer から message が突然届かなくなる (= packet loss / heartbeat timeout / beacon migration handover の一瞬)
2. `lastSync` が止まる、 でも `currentTime` は wall_dt で進む
3. **2 秒経過すると Fix B cap 効いて virtualPos が wall_clock に対して frozen** (= 「peer の予測時間」 が止まる)
4. しかし currentTime は進み続ける = self.pos.t と peer.virtualPos.t の時間差が線形拡大
5. **自機からは「peer がどんどん過去に取り残されていく」** ように見える → 自機 Rule B fire = 跳躍
6. **同時に対岸でも同じことが起きる** (= peer 側でも自機の virtualPos が cap で frozen に見える) → 両側 Rule B 永続発火
7. 各側で Rule B 大ジャンプが頻発 → frozenWorldLines に push 累積 (= **LH worldline cyan 列の縞** = host 側で複数 frozen LH entry が同 spatial 軸に stack して描画) → mount storm 一歩手前 → GPU 圧 → Context Lost / GL_INVALID_OPERATION

**整合する観察**:
- 両側 因果律跳躍 同時 fire ✓ (= 数学的に互いの過去光円錐内に同時存在は不可能なので、 stale view の対称性破綻の症状)
- LH worldline 縞 ✓ (= frozenWorldLines に LH 多発 push)
- 一人 client から peer 不可視 ✓ (= peer state が stale freeze で past-cone intersection が成立しない)
- GL_INVALID_OPERATION × 3 ✓ (= cascade transient で context recovery 中の texture race)

### 仮説 H2 (= 副仮説): 「Host split detected」 の race

`PeerProvider` の host election logic で複数 tab が同時に `becoming solo host` 化する race:
- Tab A: heartbeat timeout → solo host に昇格
- 同時刻 Tab B: 同 timeout → solo host に昇格
- 両方が beacon を取り合い、 「Host split detected — real BH: xxx — demoting self」 で片方が降格
- 降格 tab の players map が transient cleanup を経て peer state が flush される

これは Bug 11 の「一人 client から peer 不可視」 の直接因の可能性。 H1 と独立に存在しうる別 layer。

### 仮説 H3 (= 5/5 PM 新観察): PeerProvider 再接続 robustness 不足

**5/5 PM の sleep-wake 観察** ([SESSION 5/5 PM verify session 観察 参照](../SESSION.md)):
- odakin: PC を sleep → wake → 2 tab を確認すると両方「ホスト」 表示で互いが見えない
- Tab 1 (36mpplykf) console: `[PeerManager] Peer error qz: Cannot connect to new Peer after disconnecting from server`、 「split detected — real BH: 1lnqafvxo — demoting self」 → split を検知して降格、 但し復帰先 (= 真の host) への接続も失敗、 HUD「シグナリング: エラー(disconnected)」 = 信号サーバ接続が完全に死亡
- Tab 2 (1lnqafvxo) console: `Lost connection to server` → 再接続成功、 solo host 化、 HUD「シグナリング: 接続OK」 で 800s 以上 play 継続

→ **PeerJS WebSocket 切断後の同 instance 再接続が構造的に失敗** する PeerJS 既知挙動。 sleep-wake で 2 tab の WebSocket が切れる → 両方が再接続を試みる → Tab 2 が成功して solo host、 Tab 1 は `Cannot connect to new Peer after disconnecting from server` で stuck。 Tab 1 が Tab 2 を見つけて split detected で降格はするが、 復帰先への新 peer connection も signaling 死亡で失敗 → mutual invisibility が persistent state 化。

これは H1 (Rule B 暴走) や H2 (host election race) と独立した **signaling layer の robustness 問題**、 但し同じ trigger (= 信号 WebSocket 切断) を共有するため Bug 11 plan に統合扱い。

#### sleep-wake が H1/H2 を増幅する経路
- sleep 中: 全 peer の lastSync が currentTime から大きく乖離 (= sleep の wall_dt 分)
- wake 直後: 全 peer の virtualPos が Fix B cap で frozen → H1 (両側 Rule B 一時 fire) が確実に発火
- 同時刻に各 tab が「peer 不在」 と判断して solo host 化 → H2 (host election race) も発火
- WebSocket が再接続できない tab は H3 (= signaling 復帰失敗) に陥る
- → H1 + H2 + H3 の compound symptom が観察される

---

## §3 候補修正

### §3.5 **3 秒 unprotected window の数学** (= H1 真因 quantification、 v2 で追加)

[`useGameLoop.ts`](../src/hooks/useGameLoop.ts) の `MAX_VIRTUAL_TAU_SEC = 2` (= Fix B cap) と [`useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) の `STALE_WALL_THRESHOLD = 5000ms` (= 5 秒) の間に **3 秒間の unprotected window** が存在する:

| 時刻 | virtualPos | staleFrozenIds | Rule B 評価 |
|---|---|---|---|
| T=0 | last sync 直後、 wall_clock に追従 | 空 | 正常 (peer 過去光円錐内) |
| T=2 | Fix B cap 発動、 wall_clock に対して frozen 開始 | 空 | **fire 開始** (peer が遅れて見える) |
| T=2..5 | frozen 持続、 currentTime は進む | 空 | **永続発火** (両側 Rule B 暴走) |
| T=5 | frozen 継続 | `staleFrozenAtRef.set()` | **除外開始** (Rule B 不発化) |

→ T=2..5 の 3 秒間が **Rule B 暴走窓**。 (a) markStale 拡張で disconnect 検出時 (= heartbeat timeout 2.5 sec / peer-unavailable error / connection close) に即時 stale 化すれば、 この窓を 0-100ms に圧縮可能。

これは Bug 10 真因 chain (= 5/4 5 layer fix) と類似する「**Layer 間 timing gap が rule 暴走窓を生む**」 構造。 Fix B (5/4) は cap 値 (= 2 sec) を導入することで暴走の上限を画したが、 stale threshold (5 sec) と組合せた窓は残った。 (a) は窓そのものを除去する真因対処 (M27 application)。

### (a) **disconnect 検出時に peer を staleFrozenIds に追加** (= 既存機構 reuse、 推奨)

既存の `staleFrozenIds` 機構 (= 一定時間 broadcast 受信なしで stale 認定、 Rule B / freeze 計算から除外) を拡張:
- heartbeat timeout / `peer-unavailable` error / connection close 時に peer を `staleFrozenIds` に即時追加
- 既存 `processLighthouseAI` / `useGameLoop` Rule B / `checkCausalFreeze` は dead/stale 除外済 → 自動的に Rule B fire 不発化 (= 暴走経路遮断)
- peer 復活時に `recoverStale` で除外解除 (= 既存 helper)

利点:
- 既存機構の use case 拡張、 新 mechanism 追加なし
- M25 (state 単一化) 違反なし、 staleFrozenIds は既に「peer が stale か」 の唯一 source
- Fix B cap (= safety net) は temporary disconnect (< 2 sec) には依然有効、 long disconnect は staleFrozenIds で吸収

**code paths (= 5/5 audit で確認)**:

| Item | File:Line | Detail |
|---|---|---|
| `useStaleDetection` 本体 | [`src/hooks/useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) | hook 全体 |
| `staleFrozenAtRef: Map` (= single source) | L31 | mutation 唯一の場所 |
| `syncStoreMirror()` (= zustand sync) | L48-52 | `setStaleFrozenIds(new Set(staleFrozenAtRef.keys()))` |
| `recoverStale(playerId)` 既存 (= 鏡像) | L124-128 | delete + syncStoreMirror |
| `cleanupPeer(playerId)` 既存 (= 全 ref purge) | L133-138 | より hard なお掃除 |
| API exports | L142-151 | hook return object |

**実装手順**:

1. `useStaleDetection.ts` に `markStale(playerId, currentTime)` 関数を追加 (= `recoverStale` と対称):
   ```ts
   const markStale = useCallback((playerId: string) => {
     if (!staleFrozenAtRef.current.has(playerId)) {
       staleFrozenAtRef.current.set(playerId, Date.now());
       syncStoreMirror();
     }
   }, []);
   ```
   API exports (L142-151) に `markStale` を追加。

2. `PeerProvider.tsx` の disconnect 経路で `markStale` 呼出:
   - **heartbeat timeout** (L682-690): `Date.now() - lastPingRef.current > HEARTBEAT_TIMEOUT` のところで、 migration ロジックに入る前に `markStale(deadHostId)`
   - **`peer-unavailable` error callback**: peerManager の error handler で `error.type === 'peer-unavailable'` を検知したら該当 peer を `markStale`
   - **conn.on('close')**: peer connection が閉じた時 (= peer-unavailable と異なる経路) も同様に `markStale`

   **B2 発見 (v2 で追記)**: 現 [`PeerManager.ts`](../src/services/PeerManager.ts) は `dc.on('close')` を内部処理のみ (L124)、 個別 peer disconnect の通知 API (= `onPeerDisconnected(cb)`) を露出していない。 `onConnectionChange(cb)` で全 connections の状態 array を expose しているので、 caller 側で **diff (= 削除された peerId 抽出)** で対応可能。 PeerManager API 拡張は不要、 PeerProvider 側で `prevConnectionIds` state を持って差分検出する pattern (= 既に [`RelativisticGame.tsx`](../src/components/RelativisticGame.tsx) `prevConnectionIdsRef` で類似 pattern が使われている、 再利用可)。

3. `useGameLoop.ts` の Rule B / freeze 計算は変更不要 (= 既に `staleFrozenIds.has(id)` で除外、 拡張された markStale 経由で自動的に除外対象になる)。

4. test (= TDD): `useStaleDetection.test.ts` (新規 or 既存) に `markStale` の挙動 test を追加 (= 「markStale で staleFrozenIds に追加される」 「同 peer 重複 markStale で sync 1 回のみ」 「recoverStale で逆操作可」)。

### (b) **Fix B cap を hard freeze → 線形 fall-off** (= semantic 変更、 慎重)

現在の Fix B: `tau = min(currentTime - lastSync, MAX_VIRTUAL_TAU_SEC)` (= 2 sec で hard cap)。

代替: `tau = (currentTime - lastSync) * exp(-(currentTime - lastSync - 2) / 5)` 等の soft fall-off (= 2 sec まで線形、 以降指数減衰)。 peer が完全に死んだ時に tau → 0 ではなく緩やかに減衰、 2 側 Rule B が convergent fixed point に到達。

利点: peer disconnect 検出 logic が弱い場合でも自動的に Rule B 暴走しない。
欠点: Fix B 本来の semantic (= 「lastSync 異常時の bounded 拡大」 safety net) を変更、 数学的検証必要。

(a) 採用すれば (b) 不要。

### (c) **HUD 「接続中の相手」 表示 を peer 実状と整合化** (= UI fix、 補助)

5/5 観察: Tab 1 の HUD「接続中の相手」 が y3uydc9ek (= 接続中) と表示しているが Tab 2 (= 真の y3uydc9ek) の console は「peer-unavailable」 エラー。 つまり Tab 1 は接続失敗を認識せず stale state で「接続中」 と表示。

これは UX 上の問題 (= user が disconnect に気付けない) で、 上記 H1 の真因とは独立。 但し (a) を実装すると同経路で UI も整合化できる (= staleFrozenIds に入れた時に接続表示を「stale / disconnect」 マークに変更)。

### (d) **PeerJS instance を destroy + 新規作成 で signaling 復帰経路新設** (= H3 への治療、 5/5 PM 追加)

**動機**: H3 (= PeerProvider 再接続 robustness 不足) で、 WebSocket 切断後の同 instance での再接続が PeerJS 既知挙動で困難。 sleep-wake / network split 等で signaling 死亡時に Tab 1 が stuck する症状を解消。

**code paths (= 5/5 audit で確認)**:

| Item | File:Line | Detail |
|---|---|---|
| PeerProvider 本体 | [`src/contexts/PeerProvider.tsx`](../src/contexts/PeerProvider.tsx) | 主 file |
| Beacon ID 計算 | L136 | `const roomPeerId = \`la-${roomName}\`;` |
| local peer ID 永続 | L126 | `localIdRef = useRef(Math.random()...)` (= 同 tab で stable) |
| PeerManager instance 生成 | L273-276 (beacon) / L285-288 (game) | `new PeerManager<Message>(...)` |
| heartbeat 送信 (host) | L533-553 | `setInterval(HEARTBEAT_INTERVAL=1000ms)` |
| heartbeat 受信 (client) | L570-581 | `peerManager.onMessage("heartbeat", ...)` |
| heartbeat timeout 検知 | L682-690 | 2500ms threshold で migration trigger |
| `becomeSoloHost()` | L628-632, L720-726 | no peers reachable で host 化 |
| `discoverBeaconHolder()` (Stage 2) | L1020-1095 | visibility→visible で probe、 split detect → demote |
| `demoteToClient()` | L859-981 | beacon contention での降格 |

**実装手順**:

1. **PeerJS の disconnect event を観察**:
   - `peer.on('disconnected', ...)` listener を attach (= `PeerManager` 抽象越しに or 直接 peer instance に)
   - PeerJS docs: `disconnected` = signaling server connection lost。 `peer.destroyed === false` だが peer connections 不可能。 `peer.reconnect()` で復旧試行できるが既知の問題で失敗多発。
   - **要確認**: `PeerManager` (= `src/services/peerManager.ts`? 要 grep) が `peer.on('disconnected')` を expose しているか、 してなければ wrapper 層で listener 追加。

2. **disconnect 検知時の retry + escape**:
   ```ts
   const handleDisconnected = () => {
     console.log('[PeerProvider] Signaling disconnected, attempting reconnect...');
     setSignalingDeadAt(Date.now());  // ← (e) reload prompt の trigger 用 state
     try {
       peer.reconnect();  // PeerJS 自動再接続試行
     } catch {}
     // 5 sec 待って復活してなければ destroy + 新規作成
     setTimeout(() => {
       if (peer.disconnected) {
         peer.destroy();
         // 新 PeerManager 生成、 同 localIdRef.current を渡して同 ID で再 join
         const newPm = new PeerManager(localIdRef.current, ...);
         peerManagerRef.current = newPm;
         setSignalingDeadAt(null);  // 復旧 → reload prompt 不発
       }
     }, 5000);
   };
   ```
   - 既存 ID で再 join 成功すれば player state continuity 維持 (= score / position 保持)
   - ID 取得失敗 (= 旧 ID が server-side で active 残留) なら新 random ID で再 join (= host 側で旧 ID の `peer-unavailable` を受けて自動 cleanup)

3. **境界 case**:
   - `peer.destroyed === true` (= 完全に死んでる) なら新規作成しか選択肢なし
   - 同時刻に複数 tab が destroy + 新規作成すると beacon 取り合い race → H2 (host election race) 経路で sort out される (= 既存 logic で OK)

4. **依存 module 確認**:
   - `PeerManager` の constructor signature (= peer ID + options)
   - `peer.reconnect()` を直接呼べるか (= PeerManager 越し or peer instance を露出)
   - 既存の effect 中で `peer.destroy()` が安全に呼ばれて再 mount (= cleanup chain)

5. **B4 発見 (v2 で追記)**: 現 [`PeerManager.ts`](../src/services/PeerManager.ts) には `destroy()` のみ (L196-198)、 `reconnect()` method **無し**。 また `peer.on('disconnected')` listener は内部で attach 済 (L57-60、 status を `disconnected` に更新するだけ) で、 reconnect ロジックはゼロ。 (d) 実装には **PeerManager 拡張が必須**:
   - `reconnect()` method 追加 (= 内部で `this.peer.reconnect()` 試行 → 失敗で `this.peer.destroy()` + 新 `Peer` 作成、 同 localId / 同 options 維持)
   - `onPeerDisconnected` 等の signaling-disconnected callback expose (= 既存 `onPeerStatusChange` で `disconnected` status 通知済なので、 PeerProvider 側で status watch すれば追加 API 不要)
   - new instance 生成時の event listener 再 attach (= `peer.on('open' | 'disconnected' | 'error' | 'connection')` 4 個、 既存 constructor 内 logic を private method に extract して再利用)
   - 既存 conns Map は新 instance で空、 個別 peer への再 connect は呼出元 (= PeerProvider) が triggered する

### (e) **「再接続失敗」 reload prompt UX** (= escape hatch、 軽量先行案)

**動機**: H3 治療 (d) は構造的だが PeerProvider 周辺の coding を要する。 短期 patch として、 signaling 死亡が一定期間続いたら user に「再接続失敗、 reload してください」 prompt を出す escape hatch を新設、 reload で完全 fresh state 復帰。

**code paths (= 5/5 audit で確認)**:

| Item | File:Line | Detail |
|---|---|---|
| `WebGLLostOverlay` (reference pattern) | [`src/components/game/WebGLLostOverlay.tsx`](../src/components/game/WebGLLostOverlay.tsx) | modal pattern の reference |
| state source (= store boolean) | `useGameStore((s) => s.webglContextLost)` | RelativisticGame の DOM polling listener が set |
| i18n keys | `webglLost.title` / `webglLost.body` / `webglLost.reloadButton` | `src/i18n/translations/{ja,en}.ts` |
| Connect.tsx (= 既存「シグナリング: ...」 表示) | [`src/components/Connect.tsx`](../src/components/Connect.tsx) L35-48 | `peerStatus` from `usePeer()` context → text |
| signaling status state | `peerStatus` ('open' / 'connecting' / 'disconnected' / 'error') | PeerProvider の useState |

**実装手順**:

1. `useGameStore` に `signalingDead: boolean` 新設 (= `webglContextLost` と同型)。 setter `setSignalingDead(value)` も追加。

2. `PeerProvider.tsx` で `peerStatus === 'disconnected'` or `'error'` が **N 秒以上持続** したら `setSignalingDead(true)` 呼出:
   ```ts
   useEffect(() => {
     if (peerStatus.status === 'open' || peerStatus.status === 'connecting') {
       setSignalingDead(false);
       return;
     }
     // B3 発見 (v2): peer-unavailable は room discovery auto-connect flow で expected error
     // (PeerManager.ts L74 comment 参照)。 起動時 room 試行で transient に発生するので false trigger 除外。
     if (peerStatus.status === 'error' && peerStatus.type === 'unavailable-id') {
       return;
     }
     // disconnected / error 継続中
     const timeoutId = setTimeout(() => setSignalingDead(true), 10000);
     return () => clearTimeout(timeoutId);
   }, [peerStatus]);
   ```

3. `SignalingLostOverlay.tsx` 新設 (= `WebGLLostOverlay.tsx` を copy + 文言変更):
   - state source: `useGameStore((s) => s.signalingDead)`
   - i18n keys: `signalingLost.title` / `body` / `reloadButton` 新設、 文言例「ネットワーク接続が失われました」 / 「再接続を試みましたが失敗しました。 ページを再読込してください。」
   - reload button: `window.location.reload()`

4. `RelativisticGame.tsx` (= 既存 `WebGLLostOverlay` mount site) に `<SignalingLostOverlay />` 追加。

**評価**: (e) だけでは構造治療にならない (= reload する UX 後退) だが、 (d) 実装中の interim escape として価値あり。 また `peerStatus` polling は既存 React state 駆動なので副作用無し、 deploy risk 最小。 (a) + (d) + (e) 併用が最も robust。

---

## §4 reliable repro 手順 (= 5/5 PM **確立**)

**確立済 (= odakin 5/5 PM 観察)**:

**Repro 1: PC sleep → wake** (= 最も簡単 + reliable)
- 2 tab 開いて play → PC を sleep → 5 分以上経過 → wake
- 観察: 両 tab がホスト化 + 互いが見えない + Tab 1 のみ「シグナリング: エラー(disconnected)」 で stuck
- compound symptom 全部発火 (H1 + H2 + H3)
- repro 確実度 高

**Repro 候補 (= 未試行)**:

- **Repro 2: Chrome DevTools「Network: Offline」 で 5+ 秒切断 → 再接続**: sleep-wake と同等の WebSocket 切断 trigger、 sleep 不要で deliberate に試せる
- **Repro 3: PeerProvider `peer.disconnect()` を window.__peer.disconnect() で artificial 呼出**: dev-only test mode、 PeerProvider に diagnostic helper を 1 行追加要

Repro 2 は user の手で 1 分内で試せる、 implementation phase の verify loop で活用。

---

## §5 un-defer trigger

以下 1 つでも該当すれば本 plan を implementation phase に進める:
- (a) reliable repro 手順が確立された (= deliberate に Bug 11 を出せる) ✅ **5/5 PM 達成 (sleep-wake)**
- (b) stable 2-peer state でも再発した (= H1 が transient ではなく persistent)
- (c) cascade chaos が user game-play UX を著しく損なう頻度で出る (= multi-tab demo が frequent な運用)
- (d) GL_INVALID_OPERATION 系 WebGL error が単独で問題化する (= 別仮説で再 RCA)

**5/5 PM 状況: trigger (a) 達成 → implementation phase 着手判断待ち**。 odakin 入力で「(a)+(b) staleFrozenIds 拡張 + Fix B cap 改修」 / 「(d) PeerJS instance reset」 / 「(e) reload prompt 軽量先行」 の組合せを決定。

---

## §6 メタ原則 link

### M27 application
表層 (= cascade chaos transient symptom 群) → 中層 (= Fix B cap × network split) → 真因 (= peer disconnect 検出が弱い、 Fix B が disconnect を想定外として frozen) の 3 層 RCA。 Bug 10 真因 chain (5/4 5 layer fix) と類似構造、 上層 fix (= polling / monitor) と中層 fix (= Fix B 改修) と真因 fix (= staleFrozenIds 拡張) の 3 経路で対処可能。 推奨 (a) は真因 layer に対する surgical fix。

### M26 application (= 「絆創膏 vs 治療」)
- (a) staleFrozenIds 拡張: 既存機構の use case 拡張 = 治療
- (b) Fix B cap soft fall-off: cap 値変更 = 治療 (semantic 拡張)
- (c) HUD 整合化: UI symptom 直接化 = 補助治療

(a) を主、 (c) を併用が cleanest path。

---

## §7 依存関係

本 plan は以下の prior fix が deploy 済前提:
- 5/4 Bug 10 真因 chain (= virtualPos lastSync / LH Stage 4 gap / mount storm / 1 点 flicker / myDeathEvent 二重管理)
- 5/5 DebrisRenderer GC fix (= Context Lost 並列 root)
- 5/5 ALWAYS_ON_TOP 撤去 + polygonOffset (= LH↔self z-fight 治療)

これらが deploy 済なら、 cascade chaos 中の「見た目」 の二次副作用 (= Context Lost / GL_INVALID_OPERATION) は二次防衛 (= Canvas auto-remount + watchdog) で吸収される確率が上がる。 H1 真因対処 (= staleFrozenIds 拡張) は別 layer の根本治療として独立に有効。

---

## §8 完了基準 (= implementation phase 進行時)

- [ ] reliable repro 確立 (= sleep-wake / Network: Offline で deliberate に発火) ✅ **達成済**
- [ ] (a) staleFrozenIds 拡張 実装 (= disconnect callback に markStale 追加)
- [ ] PeerProvider の disconnect 検出経路を grep + 全 callback で markStale 呼び出し
- [ ] 既存 247 test pass + 新 test (= disconnect → staleFrozenIds に追加、 Rule B 不発化、 復活で recoverStale)
- [ ] (d) PeerJS instance reset 実装 (= peer.on('disconnected') → reconnect 試行 → destroy + 新規作成 escape)
- [ ] (e) reload prompt UX 実装 (= signalingDead 10 sec timeout で SignalingLostOverlay 表示)
- [ ] (c) HUD 「接続中の相手」 表示の stale/disconnect 整合 (= optional、 (a) 実装で staleFrozenIds に入った peer の表示を「stale」 マーク)
- [ ] preview / 本番 deploy
- [ ] reliable repro で「両側 因果律跳躍 同時 fire しない」 + 「LH worldline 縞 出ない」 + 「peer 不可視 transient < 1 sec」 + 「sleep-wake stuck から自動復帰 or reload prompt 表示」 を verify

---

## §9 implementation 推奨順 + verify 手順 (= 5/5 PM 追加、 v2 で連続実装方針反映)

### 推奨順序: (e) → (a) → (d) (= 同 session 連続実装)

**思想 doc**: [`design/network-recovery.md`](../design/network-recovery.md) §軸 5 で「3 軸は完全に直交、 互いに干渉ゼロ」 と整理。 各 fix は独立 commit + 連続 deploy 可能。

**理由**:
- **(e) reload prompt** が一番安全な escape hatch (= 既存 `WebGLLostOverlay` pattern reuse、 risk 最小)。 これだけ deploy しても sleep-wake stuck で「reload してください」 modal が出るので user UX 改善
- **(a) staleFrozenIds 拡張** は既存機構の use case 拡張で risk 中、 H1 (Rule B 暴走) 経路を構造的に遮断 (= §3.5 の 3 秒 unprotected window を ms 化)
- **(d) PeerJS instance reset** が一番 risk 高 (= PeerJS 内部 lifecycle、 race、 effect cleanup chain 衝突)。 PeerManager に `reconnect()` method 追加 + 新 instance 生成時の listener 再 attach が必要 (B4)。 (a)+(e) で大半の症状が緩和されてから着手するのが prudent

### 各 fix の verify 手順

#### (e) reload prompt verify
1. preview 起動、 2 tab 開いて play
2. tab 1 で Chrome DevTools「Network: Offline」 にする
3. 10 sec 待つ
4. **expected**: tab 1 に「ネットワーク接続が失われました、 再読込してください」 modal が表示される
5. reload button 押下で復帰
6. tab 2 は Online のまま継続 play 可

#### (a) staleFrozenIds 拡張 verify
1. preview 起動、 2 tab 開いて play (= peer 互いに認識)
2. tab 1 console で `window.__game.getState().staleFrozenIds` (= 空 Set 確認)
3. tab 1 で Chrome DevTools「Network: Offline」 にする
4. heartbeat timeout (= 2.5 sec) 経過
5. **expected**: tab 1 console で `staleFrozenIds` に tab 2 の peerId が入る (= markStale 経由)
6. tab 1 console で `__game.getState().causalityJumping` (= false 確認、 Rule B 不発)
7. Network Online に戻す
8. **expected**: peer 復活後 `staleFrozenIds` から tab 2 が消える (= recoverStale 経由)
9. 既存 test pass + 新 test (= `useStaleDetection.test.ts` の markStale テスト)

#### (d) PeerJS instance reset verify
1. preview 起動、 2 tab 開いて play (= 互いに認識)
2. tab 1 で Chrome DevTools「Network: Offline」 5+ sec 切断 → Online 復帰
3. **expected**: tab 1 console で `[PeerProvider] Signaling disconnected, attempting reconnect...` log → `peer.reconnect()` 試行 → 失敗で `peer.destroy()` + 新 PeerManager 生成 log → 復帰成功で「シグナリング: 接続OK」 復帰
4. **expected**: tab 1 と tab 2 が再び互いを認識 (= peer ID 同じなら state continuity 維持)
5. 死亡 / 撃破 / score 等の通常 game flow が継続可能

### 各 fix の risk audit

| Fix | Risk | 緩和策 |
|---|---|---|
| (e) reload prompt | `peerStatus` の遷移 timing で false positive (= 一瞬 disconnected → connecting 中に modal) | 10 sec timeout で sufficient buffering、 短期 flap は無視される |
| (a) staleFrozenIds 拡張 | `markStale` 重複 call で sync 過多 → 性能影響 | `if (!has(id))` guard で 1 度のみ sync (= 既存 `recoverStale` と対称) |
| (a) | disconnect 検知が誤判定 (= 短期 packet loss で peer を stale 化 → 即時 recoverStale 不発で UX 後退) | heartbeat timeout 2.5 sec の既存 buffer + recoverStale 経路 (= peer 復活で revert) で吸収 |
| (d) PeerJS reset | `peer.destroy()` 後の新 instance 生成 race (= 同 ID で server side conflict) | 既存 ID で再 join 失敗 → 新 random ID で再 join に fallback、 host 側で旧 ID の cleanup を receive |
| (d) | 同時刻に複数 tab が destroy + 新規作成 → beacon 取り合い race | 既存 H2 (host election race) logic で sort out、 H2 経路は既知の挙動 |
| (d) | `peerManagerRef.current` の更新が React lifecycle と衝突 (= effect cleanup chain 壊す) | 既存 useEffect cleanup pattern を踏襲、 PeerManager 内部の dispose lifecycle に合わせる |

### 着手前の確認事項 (= fresh session が最初に見るべき)

1. **PeerManager の signature 確認**: `src/services/peerManager.ts` (= 推定) を読んで constructor + event API を理解。 `disconnected` event を expose しているか? していなければ wrapper 拡張要
2. **既存 effect cleanup chain の理解**: PeerProvider の useEffect 群が destroy / unmount でどう連鎖するか (= 新 instance への置き換えが既存 cleanup と衝突しないこと)
3. **localIdRef の 永続性**: tab hide/show / sleep-wake で `localIdRef.current` (= L126) が変わるか? 変わらないなら再 join で同 ID 維持可。 変わるなら新 ID で fresh join

### 着手しない場合の運用継続 (= γ defer 中)

- sleep-wake で stuck したら **手動 reload** で復帰 (= user mental model)
- multi-tab cascade を避ける (= host migration を deliberate に triggered する situation を回避)
- Bug 11 ledger と本 plan で plan + repro 完備、 fresh session で着手判断時に基本情報は揃っている
