# Plan: Network split + Fix B cap で両側 Rule B 一時暴走 (cascade chaos) RCA

**起草**: 2026-05-05 (= 当初 plan-only)
**Update**: 2026-05-05 PM、 odakin 観察 sleep-wake → 両 tab がホスト化 + 互いが見えない で **reliable repro 確立**、 仮説 H3 追加。
**Status**: 🟡 **plan + reliable repro 確立、 implementation phase 着手判断待ち** — un-defer trigger 達成、 odakin 入力で着手 / 別 session 振り分け / 軽量 patch 先行のいずれか。

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

### (a) **disconnect 検出時に peer を staleFrozenIds に追加** (= 既存機構 reuse、 推奨)

既存の `staleFrozenIds` 機構 (= 一定時間 broadcast 受信なしで stale 認定、 Rule B / freeze 計算から除外) を拡張:
- heartbeat timeout / `peer-unavailable` error / connection close 時に peer を `staleFrozenIds` に即時追加
- 既存 `processLighthouseAI` / `useGameLoop` Rule B / `checkCausalFreeze` は dead/stale 除外済 → 自動的に Rule B fire 不発化 (= 暴走経路遮断)
- peer 復活時に `recoverStale` で除外解除 (= 既存 helper)

利点:
- 既存機構の use case 拡張、 新 mechanism 追加なし
- M25 (state 単一化) 違反なし、 staleFrozenIds は既に「peer が stale か」 の唯一 source
- Fix B cap (= safety net) は temporary disconnect (< 2 sec) には依然有効、 long disconnect は staleFrozenIds で吸収

実装:
- `PeerProvider` の disconnect 経路 (= heartbeat timeout / peer-unavailable callback / close handler) に `recoverStale` の対称呼び出し `markStale(peerId)` 追加
- `useStaleDetection` に `markStale` 関数を追加、 `staleFrozenAtRef.set(id, currentTime)` + `syncStoreMirror()`

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

**実装方向**:
- PeerProvider で `peer.disconnected` event listener を追加、 disconnect 検知で `peer.destroy()` → 新 PeerJS instance 作成 → 同 ID で再接続試行
- もしくは disconnect 後一定期間 (= 5 sec 等) reconnect を試行、 失敗したら `destroy + 新規作成` flow に escape
- 既存 ID を保持できれば player state continuity (= score / position) を維持、 ID 取得失敗なら新 ID で再 join (= host 側で旧 ID の cleanup を receive)

**依存**:
- `src/services/peerProvider.ts` (= 推定 path、 要確認) の peer instance lifecycle を understand
- PeerJS の `disconnected` / `error` event の正確な semantics (= 自動再接続有り無し)

### (e) **「再接続失敗」 reload prompt UX** (= escape hatch、 軽量先行案)

**動機**: H3 治療 (d) は構造的だが PeerProvider 周辺の coding を要する。 短期 patch として、 signaling 死亡が一定期間続いたら user に「再接続失敗、 reload してください」 prompt を出す escape hatch を新設、 reload で完全 fresh state 復帰。

**実装方向**:
- `useEffect` で `peer.disconnected === true` を監視、 一定期間 (= 10 sec 等) 続けば reload prompt を modal で表示
- 既存の `WebGLLostOverlay` と同 pattern (= context lost watchdog) で reuse 可、 文言だけ変える

**評価**: (e) だけでは構造治療にならない (= 毎回 reload は UX 後退) だが、 (d) 実装中の interim escape として価値あり。 (a) + (b) + (d) + (e) の併用が最も robust。

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

- [ ] reliable repro 確立 (= deliberate な「Network: Offline 5+ 秒」 で Phase 2-3 を再現)
- [ ] (a) staleFrozenIds 拡張 実装 (= disconnect callback に markStale 追加)
- [ ] PeerProvider の disconnect 検出経路を grep + 全 callback で markStale 呼び出し
- [ ] 既存 247 test pass + 新 test (= disconnect → staleFrozenIds に追加、 Rule B 不発化、 復活で recoverStale)
- [ ] (c) HUD 「接続中の相手」 表示の stale/disconnect 整合
- [ ] preview / 本番 deploy
- [ ] reliable repro で「両側 因果律跳躍 同時 fire しない」 + 「LH worldline 縞 出ない」 + 「peer 不可視 transient < 1 sec」 を verify
