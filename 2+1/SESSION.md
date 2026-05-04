# SESSION.md — LorentzArena 2+1

## 現在のステータス

**本番最新 deploy**: `096f513` (build `2026/05/04 18:19:35 JST`、 https://sogebu.github.io/LorentzArena/)。 5/4 セッションで 跳躍 overlay + HUD「世界時刻」 表記修正 + Bug 10 真因 (= virtualPos lastSync) Fix A/B + LH Stage 4 implementation gap Fix C + LH/OtherShip flicker fallback + frozenWorldLines stable id + myDeathEvent 二重管理解消 までを本番反映。 main / origin sync 済。

**2026-05-04 セッション** (= 跳躍 overlay + 表記 fix + Bug 10 真因解明 + Fix A/B/C + flicker fallback + frozen stable id + myDeathEvent 二重管理解消、 計 ~15 commits):

- `151bd84` **因果律跳躍 overlay** — 凍結 (continuous) と対称な instantaneous event 通知を追加。 Rule B 大ジャンプ (`isLargeJump(lambda)` true) 発火時に counter increment、 Overlay が増分検知して 1.2s flash (= HitFlash と同 pattern、 凍結 palette 一貫、 z-index 221)。 文言: title「因果律跳躍」 + sub「他機の過去光円錐外へ」 (= 凍結「未来光円錐内」 と内 ↔ 外 / 未来 ↔ 過去 で対称)。 narrow viewport (≤ 280px 幅) 改行防止のため `whiteSpace: nowrap` 設定。
- `4061adb` **HUD「固有時間」 → 「世界時刻」 表記修正** — `Speedometer.tsx` の `phaseSpace.pos.t` 表示 label を「固有時間 / Proper time」 から「世界時刻 / Coord time」 に rename。 pos.t は DESIGN 通り **per-player coord time** であって proper time ではない。 user 観察「凄い勢いで固有時が増えていく」 (= 静止 + γ=1 で 100858s 表示) で表記と物理量の type 不一致が判明。 Rule B 自体が pos.t を強制 advance するため wall_clock 累積以外の path で増えるのは設計通り (= user 確認済) だが、 「固有時間」 label が user 原則「dτ = wall_dt」 に反する誤解を招くため修正。 i18n key も `hud.properTime` → `hud.coordTime` に rename、 関連 RCA docstring (constants.ts / design/rendering.md / design/meta-principles.md の「固有時間 ~170s」) も sweep。 真の proper time 文脈 (mechanics.ts dτ 積分 / debris.ts particle proper time / design/physics.md axiom 議論 / EXPLORING.md の意識的「固有 vs 世界」 区別) は無修正で温存。
- **Bug 10 真因解明 + Fix** (`af89434` plan + `dcd7469` Fix A + `c8ef4b3` Fix B) — user 指摘「一人だけで相手が居ない状態でなんで暴走できるの？正しく実装されてたら暴走のしようがない」 で本質に到達。 Rule B 公式は数学的に正しく fixed point に到達するはずで、 暴走できる唯一の経路は **`lastUpdateTimeRef` 管理 bug**。 grep で更新 path 4 箇所を全特定 (= messageHandler / snapshot のみ、 全て **remote peer broadcast 受信時**)、 host が `processLighthouseAI` で LH state を毎 tick 確定しているのに lastSync は更新されない semantic 矛盾を発見。 host migration 後 / 自機 host 中は LH の lastSync が古いまま `virtualPos(LH, ...)` の tau が wall_clock 比例で線形増加 → LH.virtualPos.pos.t が線形発散 → 自機 alive Rule B が huge λ で fire 連発 → self.pos.t 暴走 → frozenWorldLines cycling → SceneContent の WorldLineRenderer key 変化で毎 tick mount/unmount → 5/2 fix の wlRef throttle を bypass → main thread saturation → setInterval Violation × 8 → rAF starve → 星屑凍結 + Context Lost (= **Bug 10 の単一連鎖説明**)。 5/2 fix (= renderer 単体修復) は対症療法、 真因 (= lastSync semantic 矛盾) を残したため pattern matching の inflation で再発不可避だった。 **Fix A** (`dcd7469`、 主因): useGameLoop alive 自機 Rule B branch で `isBeaconHolder` 時 LH の lastSync を毎 tick currentTime に update → 自機 host 時の virtualPos 線形発散経路を遮断、 Rule B 公式が actual state で評価され fixed point 動作。 **Fix B** (`c8ef4b3`、 一般 safety net): virtualPos の tau に upper bound `MAX_VIRTUAL_TAU_SEC = 2 sec` を導入 → 万一 lastSync が他 path で壊れても線形発散を bounded、 N=2 sec は hidden tab 復帰要件 (= wall_dt 単位) と heartbeat (= 5 sec 半分) のバランス。 plan: [`plans/2026-05-04-virtualpos-lastsync-rca.md`](plans/2026-05-04-virtualpos-lastsync-rca.md)。 既存 237 → 239 (+2 件、 Fix B cap 動作 verify) test 全 pass、 typecheck pass。 user 実機検証待ち (= 5+ 分 plays + host migration trigger で世界時刻 advance rate が wall_clock の ±10% 以内 / setInterval Violation 累積無し / 星屑凍結無しを観察)。
- **Fix C** (`b002d50`) — user 指摘「A が B の未来側にいて A に因果律凍結がでるとき、 B は A の過去光円錐まで跳躍して B に因果律跳躍が起こらないとおかしくないか?」 で対称性違反 + 5/2 plan §5.5 implementation gap を発見。 物理的対称性: A's tab で凍結 fire なら B's tab で跳躍 fire が同時起きるべき (= 各 client の useGameLoop で別々に評価されるため player 間は動作)。 但し **LH 側は 5/2 Stage 4 で Rule B 置換実装時に Stage 3 (= 大ジャンプ閾値判定 + frozenWorldLines push) との接続を忘れていた** = 結果、 LH の Rule B fire 時に大 gap でも単純 `appendWorldLine` で履歴に積まれ visible discontinuity が生まれない、 user 視点で「LH の跳躍が見えない」 ように見える対称性違反。 修正: `processLighthouseAI` の return に optional `largeJumpFrozenLh?: RelativisticPlayer` を追加、 `isLargeJump(lambda)` true なら旧 LH player を返却、 caller (useGameLoop) で `setFrozenWorldLines((prev) => pushFrozenWorldLine(prev, oldLh))` を呼んで凍結 worldLine に push + 新セグメント開始 (= self alive Rule B branch と対称構造)。 LH overlay は LH に UI 持たないため不要 (= visible cue は凍結 worldLine が増えることで代替)。 既存 239 → 242 (+3 件、 大ジャンプ frozen 返却 / 小ジャンプ undefined / no-jump undefined) test 全 pass、 typecheck pass。
- **跳躍 overlay continuous 化** (`d277d0f` + `41374d7`) — user 指示で跳躍 overlay を凍結と完全対称な continuous boolean state に変更 (= 旧 counter+flash の instantaneous event 通知を撤廃)。 store の `causalityJumpCount: number` → `causalityJumping: boolean` に置換、 useGameLoop の Rule B branch で `lambda > 0` 中ずっと true、 凍結 `causalFrozenRef` と同 ref hot path + 状態変化 tick だけ store update pattern。 sub text 「他機の過去光円錐外へ」 維持 (= 「外へ」 の動的方向性は continuous indicator でも自然、 user 確認)。
- **LH/OtherShip flicker fix** (`68e4f67`) — Fix C 副作用: 大ジャンプ後の 1 点 worldLine では `pastLightConeIntersectionWorldLine` が null 返し → renderer 描画消失 → 1 frame 後 復活 = flicker。 共通 helper `pastConeIntersectionWithFrozenFallback` 新設、 current null なら同 player の最新 frozenWorldLine で fallback intersection。 物理的解釈: 観測者の過去光円錐がまだ jump 後 event の光速到達前なら旧軌跡上の event を観測している (= 光速遅延)。 LighthouseRenderer + OtherShipRenderer に適用。 +5 test。
- **frozenWorldLines mount storm の root fix** (`18adb8b`) — Bug 10 残存分の真因。 SceneContent renderer key が `frozen-${i}-${first.pos.t}` で配列 cycling (= MAX 容量 truncate) で「同 entry が配列上の位置を変える」 と key 変化 → React unmount/mount → WorldLineRenderer の TubeGeometry build 連発 → main thread saturation。 `FrozenWorldLine.id: string` 新設 (= monotonic counter) で stable identity、 key を `frozen-${entry.id}` に変更 → 同 entry 同 mount 維持、 O(1) churn per push。 polling 直 check fix (= 直前 commit) は revert (= 真因解消で workaround 不要)。
- **myDeathEvent 二重管理解消** (`2c34eb0` plan + `096f513` refactor) — 5/4 user 観察「死亡中 stardust 凍結 + 世界線伸びる」 + dev console で `myDeathEvent === undefined` 確認、 user 指示「絆創膏じゃなくて根本」。 真因: 自機死亡 state が `selectIsDead(myId)` (= killLog/respawnLog から derive、 全経路自動同期) と `myDeathEvent` (= handleKill で explicit set、 経路依存) の **二重管理** で、 snapshot 経路で先に killLog merge → selectIsDead true → 後続 handleKill が guard early return → myDeathEvent 永遠未 set → SceneContent fallback で死亡時刻凍結 phaseSpace を観測者 → displayMatrix freeze → stardust 凍結。 「世界線伸びる」 は他機 broadcast で history 増 → 固定 displayMatrix で transform → visible 長さ伸び、 という単一 chain で全 symptom 説明。 構造的解消: 旧 DeathEvent type (= 静的 meta + 動的 ghost 複合) を分解、 静的 meta (= pos, u, heading) は `players.get(myId).phaseSpace` から **derive** (= applyKill で死亡時刻凍結保持されるため流入経路非依存に自動同期)、 動的 ghost のみ `myGhostPhaseSpace: PhaseSpace \| null` 新 explicit field、 useGameLoop dead branch で `?? freshMe.phaseSpace` の **lazy init** で consumer 側補正を「設計の一部」 に取り込み。 「set 漏れ class の bug」 が原理的に発生不可。 plan: [`plans/2026-05-04-mydeathevent-decomposition.md`](plans/2026-05-04-mydeathevent-decomposition.md)、 影響 file 11 個 atomic refactor、 248 test 全 pass。
- **player.isDead 二重管理解消** (= 未 deploy、 plan v2 + atomic refactor) — staleFrozenIds 解消の momentum で同 session 3 件目の M25 application。 plan v2 で性能 (a) `selectDeadPlayerIds(state): Set<string>` per-tick pre-compute (= 既存 useGameLoop:776 の hit detection で確立済 pattern を流用) / wire format (C) 維持 (= 旧 client 互換 pass-through、 buildSnapshot で `selectIsDead(s, p.id)` derive 経由 send + applySnapshot で wire `sp.isDead` を ignore + log から再 derive) / Stage 細分 (= A read site 32 箇所 refactor、 B field 削除 + write site 7 箇所 + 強制同期 patch 撤去 + applyKill 関数 + killRespawn.ts 撤去) を確定。 read API 使い分けは hot path tick loop で `deadIds.has(id)` / 単発 check で `selectIsDead(state, id)` / React component で `useGameStore((s) => selectIsDead(s, id))` subscribe / iteration 多発 component (SceneContent / HUD) で killLog + respawnLog subscribe + useMemo で deadIds 1 derive。 副次成果: (1) `selectIsDead` / `selectDeadPlayerIds` の型を `LogState` (= killLog + respawnLog + hitLog) から narrow `DeathLogState` (= killLog + respawnLog のみ) に refactor (= React component で hitLog 非依存 subscribe + memoize 可能、 非致命 hit で SceneContent が re-render する coupling 回避)、 (2) `applyKill` / `killRespawn.ts` 撤去 (= 旧 isDead=true 強制 set のみだった no-op 関数)、 (3) `worldLineGap.pushFrozenWorldLine` の defensive `if (player.isDead) return prev` を caller-side gate に移行 (= 「dead は本関数の対象外」 contract を docstring に明示、 caller 全 alive 分岐内で呼ぶ)、 (4) `processLighthouseAI` / `checkCausalFreeze` / `useStaleDetection.checkStale` / `computeSpawnCoordTime` / `createRespawnPosition` の signature に `deadIds: ReadonlySet<string>` 追加 (= caller 責任で derive 一回)。 wire format 影響: snapshot wire の `players[].isDead` field は維持、 phaseSpace message には isDead 無し (= 元から)、 旧 client は変わらず動作。 11 file (うち 1 file 削除 = killRespawn.ts) atomic refactor、 247 test 全 pass、 typecheck clean。 plan: [`plans/2026-05-04-isdead-decomposition.md`](plans/2026-05-04-isdead-decomposition.md) v2。
- **staleFrozenIds 三重二重管理解消** (= 未 deploy、 plan + refactor は同 commit) — myDeathEvent decomposition の audit pass 中に発見、 当初「ref ↔ store mirror は M14 pattern で正当化済」 と defer 予定だったが user 指示で深掘り → **絆創膏 sign 2 箇所積層** が判明 (= isDead よりも構造的負債が高い、 isDead は 1 sign / 30 callsite に対し staleFrozenIds は 2 sign / 5 callsite)。 違反 1: `useStaleDetection.staleFrozenRef: Set<string>` ↔ `useGameStore.staleFrozenIds: ReadonlySet<string>` の二重保持、 5 ad-hoc delete callsite が mirror sync を skip → 毎 tick checkStale で drift detection patch ([`useStaleDetection.ts:106-121`](src/hooks/useStaleDetection.ts) 旧版) で self-heal という暗黙契約。 違反 2: 同 hook 内 `staleFrozenRef` (Set) ↔ `staleFrozenAtRef` (Map<id, frozenAt>) の内部 dual、 ad-hoc delete で Set だけ消されて Map が leak する事故を「drift prune ループ」 ([`useStaleDetection.ts:55-61`](src/hooks/useStaleDetection.ts) 旧版) で self-heal。 違反 3: ad-hoc delete 5 箇所散在 (= [`messageHandler.ts:148, 327, 351`](src/components/game/messageHandler.ts) + [`RelativisticGame.tsx:122`](src/components/RelativisticGame.tsx) + [`useGameLoop.ts:834`](src/hooks/useGameLoop.ts))、 各箇所で「ref のみ触る、 mirror + staleFrozenAt は self-heal 任せ」 という暗黙契約を 3 文書に分散。 構造的解消: (1) `staleFrozenAtRef: Map` 単独 (= キー = 「stale か」、 値 = 「いつ stale 化」)、 (2) 全 mutation 経路 (`recoverStale` / `cleanupPeer` / `checkStale`) で `syncStoreMirror()` 即呼び (= drift 不可避化)、 (3) `MessageHandlerDeps.staleFrozenRef` を `recoverStale: (id) => void` に置換、 5 callsite を全部 helper 経由に (= ad-hoc delete 撲滅)。 副次効果: 全経路で `lastCoordTimeRef` 整合 reset (= S-4 「即座再 stale 判定」 防止が堅牢化)。 6 file atomic refactor、 248 test 全 pass、 typecheck pass、 wire format 影響無し。 plan: [`plans/2026-05-04-stalefrozen-decomposition.md`](plans/2026-05-04-stalefrozen-decomposition.md)。 抽出された一般原則: 「絆創膏 sign 数 = severity」 (= reach が小さくても sign が複数積層なら優先度高、 設計負債の積み上がり sign)、 「ref ↔ store mirror の正当性は mutation 経路が散在すると弱い、 mutation を 1 関数に集約 + その関数で sync 呼び出し」 が単純解。
- **新 meta-principle M25-27** ([`design/meta-principles.md`](design/meta-principles.md)) — 5/4 セッションの方法論的知見を 3 原則として永続化:
  - **M25** (state の単一化原則): myDeathEvent decomposition + isDead audit から抽出。 「derive 可能な state は explicit field と並存させない、 二重管理は drift / set 漏れ bug の温床」、 decomposition 戦略 (= 静的 derive + 動的 explicit + lazy init)。
  - **M26** (絆創膏 vs 根本治療: 構造的 sign): 効果 sign 一覧 (= 強制同期 patch / effect ベース同期 / defensive set 多発 / 流入経路 logic duplicate / 症状検知 → 別 path で吸収)、 「自分の fix proposal を絆創膏 sign で self-audit」 / 「user 指摘で即立ち止まる」。
  - **M27** (多層 RCA: 症状の出る layer ≠ 真因の layer): Bug 10 の 5 layer chain (= 表層 rAF starve → main thread saturation → mount storm → frozenWorldLines cycling → 真因 virtualPos lastSync) を実例化、 「症状再発 = 表層 fix の sign、 1 層下の真因疑い」、 多層 fix 併用 (= 上層 fix を二次防衛として温存) の整理学。
  - 4 axis 直交関係: M24 (鏡像 rule) / M25 (state 単一性) / M26 (patch 構造) / M27 (layer chain) は独立 axis、 真因 audit で並行使用すると効率的。

**process 教訓 (= 5/4 セッション特有)**:
- **localhost link 規約 1 度違反**: dev server 動作中、 user 評価依頼ターンで URL 貼り忘れ (= [`claude-config/conventions/preview.md`](../claude-config/conventions/preview.md) 違反)、 user 直接指摘で発覚。 以後の評価依頼ターンで両 URL (= localhost + 本番) を毎回再掲。 規約 reinforcement: dev server が動いている間、 評価依頼を含む応答では URL 出力を構造的 default に。
- **「絆創膏 → 根本」 切り替え 2-3 回**: 5/4 セッションで「短期 fix を提案 → user 「絆創膏」 指摘 → 立ち止まり → 真因 RCA → 構造的解消」 の cycle を 2-3 回経験 (= polling fix revert / effect-based myDeathEvent init revert / 等)。 教訓: 短期 fix の提案前に M26 の絆創膏 sign を self-audit するのが prudent。 user の domain 直感 (= 「正しく実装されてたら起きないはず」) は深く効く検出器、 軽視せず多層 RCA で答える。

注意: player 間の overlay 閾値設計 (= `LARGE_JUMP_THRESHOLD_LS = 0.5 ls` 未満で跳躍 overlay 不発、 凍結 overlay は continuous 状態通知で非対称) は別議論として残存。

**因果律対称化実装** (= `plans/2026-05-02-causality-symmetric-jump.md`): Stage 1-8 + dead-skip hotfix を 2026-05-02 に実装。 旧 LH `minPlayerT` jump → Rule B (= 因果律対称ジャンプ)、 alive 自機にも Rule B 毎 tick 適用、 ballistic catchup 撤廃 + hidden 復帰の純 inertial 統一、 spawn 時刻 (γ) `(min+max)/2` 維持、 走行中の causality 判定 (Rule A / B) は dead skip + alive / stale を virtualPos で統一処理。 Bug 5 (= LH host 時刻 anchor) は構造的解消、 Bug 8 (= hidden 復帰 LH 巨大 jump) も Stage 4+6 で構造的解消、 Bug 9 (= 新 join 即凍結) は Stage 5/7 で structural mitigation。 既存 198 → 237 test (+39) 全 pass、 protocol 互換性維持 (= 旧 client 混在可、 plan §9.1)。

**「全世界凍結」 root cause 撃滅** (= odakin 観察「元からあるバグ」 の真相を 5/2 末で特定 + fundamental fix): `WorldLineRenderer.tsx` の `useMemo` deps に `wl` を含めていたため、 意図された `geoVersion` 8-tick throttle が事実上死んで TubeGeometry rebuild が **毎 tick 60Hz** で走り、 main thread saturation → setInterval Violation 連発 → rAF starve → 全世界 + 星屑凍結 → GPU 資源枯渇で WebGL Context Lost、 という連鎖が真因。 修正:
- (1) `wl` を ref 経由で latest 参照、 deps から撤去 → rebuild **60Hz → 7.5Hz (1/8)** に正規化、 main thread 負荷劇的削減 (`453fca6`)
- (2) Canvas auto-remount on context loss: `canvasGeneration` increment で `<Canvas key>` 変化 → React unmount + remount → R3F が新 WebGL context 作成 → scene tree 再構築。 zustand store (= physics / killLog / score) は preserve、 user は 1-2 frame の flash で済み page reload 不要 (= invisible recovery、 `453fca6`)
- (3) Watchdog: 1.5s 内 2 回目 loss は auto-remount でも復旧不能と判定し `webglContextLost: true` → `WebGLLostOverlay` で「再読込」 escape hatch (`453fca6`)
- 設計思想: 「context loss を起こさない」 は OS/driver/power management が外部要因のため不可能 → **「起きても気付かないシステム」** に倒した

**2026-05-02 セッション** (時系列 commit、 build 値 / 影響範囲付き):

1. `f573b20` **viewMode / controlScheme 2 段 dropdown 復活** — Lobby (START の下) + HUD ControlPanel (in-arena 左上) の 2 ヶ所、 e6c17cc で hidden オプション化していたものを CLAUDE.md 設計通り復活。 Lobby 背景の ShipPreview を `viewMode` 連動化 (= demo で「見た目」 を即時切替できる)。 i18n に `viewMode.label` / `viewMode.jellyfish` / `controlScheme.{label,legacy_classic,legacy_shooter,modern}` 追加。 URL hash + LS 永続化は併存。
2. `e27b9ea` **jellyfish 機体の 2 bug fix** — (a) Bug 3: `alpha4` 加速度矢印が出てなかった (props 宣言だけ destructure 無しの TODO 残存) → RocketShipRenderer 同等仕様で sibling mesh 配置。 (b) Bug 4: legacy_classic で触手の振れる方向が逆 (= dropdown 復活で combo 到達可能になり顕在化)、 `thrustAccelRef.current` を world frame と認識せず machine local 仮定していた → `group.rotation.z` で R(-θ) 適用、 全 controlScheme で正しく動く。
3. `054a595` **window.__game diagnostic helper** — Bug 1 (ghost freeze) 調査用、 dev console から `__game.getState().myDeathEvent.ghostPhaseSpace.{u,pos}` で観察可能。 prod でも有効、 secrets 無し、 perf 影響 0、 調査終了後削除予定。
4. `0e18fc9` **LASER_WORLDLINE_OPACITY 0.4 → 0.2** — odakin 指示、 demo 視認性。
5. `df98bb4` **ENERGY 消費 1/10** — `ENERGY_PER_SHOT` 1/30 → 1/300、 `THRUST_ENERGY_RATE` 1/9 → 1/90 (= 90 秒で枯渇)。 `ENERGY_RECOVERY_RATE` 据え置き (= 撃 / 推いずれもしてない時の 6 秒で 0 → 満タン)。
6. `75aaae8` **ballisticCatchup test 追従** — df98bb4 で THRUST_ENERGY_RATE 変更により dτ=30 では枯渇しないため dτ=100 に拡張 (= 90 秒 thrust + 10 秒 friction 単独)。
7. `c7f7960` **Bug 7 fix: past-cone marker の isDead filter 除去 (因果律違反修復)** — `worldLineMarkerEntries` useMemo で `if (player.isDead) continue;` が past-cone marker と future marker の両方を一気に skip していた。 past-cone marker は **観測者本人の過去光円錐 ∩ worldLine** で gate されるべき causal hint で death event が past cone 到達前なら表示継続が正解。 future marker (= world-now god view) のみ isDead で skip。 PLC slice mode の past-cone disc も同 useMemo を使うので同時修復。

**5/2 セッション後半 (= demo 終了後の autonomous 作業)**:

8. `099e072` / `25b5ded` SESSION.md を 5/2 セッションの全 commit + Bug ledger で正規化、 Bug 1 (ghost freeze) の最有力仮説を「DevTools console focus による WASD non-routing (= false alarm)」 に更新。
9. `bedae12` ShipViewer の `<a href="#">` を `href="./"` に置き換え (= biome useValidAnchor a11y error 解消)。 `#` は a11y anti-pattern + App.tsx に hashchange listener なし → reload 経由が動作的にも正解。
10. `7a12ddf` **Radar に arena 中心 (= 原点) past-cone marker 追加** (EXPLORING.md §1b)。 観測者の過去光円錐 ∩ {(t, 0, 0): t ∈ ℝ} の交点 = `(obs.t − |obs.xy|, 0, 0)` を projectEvent で投影、 半径 3 の白丸 + cross "+" で表示。 torus mode は subVector4Torus で最短画像 origin に折り畳み。 「上方向に行けば帰れる」 が一目で読める。
11. `08944d3` **HUD CenterCompass 追加** (EXPLORING.md §1a)。 画面上中央に SVG chevron + 距離 (m)、 自機 cameraYaw 基準で原点方向の screen-space angle を計算し CSS rotate に渡す。 modern (cameraYaw=0) / legacy (cameraYaw=heading) いずれも screen 「上」 = 自機の前方として動作。 死亡中は ghost phaseSpace で観測者位置取得。 1m 以内は arrow hide で「● 中心」 表示。 (1b) radar dot と相補的に onboarding fix を完成。
12. `19cf423` plan v1: **因果律対称化 + virtualPos 統一モデル の中期 plan を起こす** (= `plans/2026-05-02-causality-symmetric-jump.md`、 Stage 1-8 + 数学 + edge case + cold-start チェックリスト完備、 当初は odakin 自律実装 plan 想定)。
13. `ddfac53` `CenterCompass` の距離単位を「m」 → 「光秒 / ls」 に修正 (odakin 指示)。
14. `6f89907` Bug 8 + Bug 9 を ledger に追加 (5/2 user 報告)。
15. `a0f0bcc` `SESSION` から collaborator 実名除去 + meta-principles M24 追加 (= public repo prudence)。
16. `abfbceb` **Stage 1: virtualPos 純関数 + test** (= alive / stale / dead 統一 inertial 延長、 `virtualWorldLine.ts` 新設 + test 10 件)。
17. `f5ef0d4` **Stage 2: causalityJumpLambda (Rule B 計算) + test** (= `causalityRules.ts` 新設、 公式 `λ_exit = B − √(B²−C)` + test 14 件、 plan §3.6 intuition 表の誤りを test で固定化防止)。
18. `f943798` **Stage 3: LARGE_JUMP_THRESHOLD_LS + worldLineGap helper + test** (= 0.5 ls、 `pushFrozenWorldLine` / `isLargeJump` 純関数 + test 9 件)。
19. `10c802a` **plan v2** (= signature 表記 (+,-,-,-) → (+,+,+,-) / §3.6 intuition table 反転 / §3.3 disc ≥ 0 修正)。 公式自体は signature-agnostic に正しく実装影響なし、 ドキュメント側のみ。
20. `7ae1917` **Stage 4: LH 因果律ジャンプを Rule B に置換** (= `processLighthouseAI` の minPlayerT jump を `causalityJumpLambda` に置換、 dead / stale も含めた virtualPos で統一処理、 Bug 5 構造的解消、 lighthouseRuleB.test 8 件追加)。
21. `5c534af` **Stage 5: alive 自機への Rule B 毎 tick 適用** (= useGameLoop alive branch の物理後に Rule B 評価、 frozen 状態でも Rule B が走る対称化、 大 λ で worldLine 凍結 + 新セグメント。 「過去側 peer が自分の past null cone まで飛んでくる」 設計を実現)。
22. `dc38dba` **Stage 6: ballisticCatchupPhaseSpace 撤廃 + hidden lastTimeRef 更新** (= 旧 thrust 継続 sub-step 再生を削除、 hidden 復帰時は通常 tick + Rule B convergence で純 inertial 統一、 ballisticCatchup.test 削除で test 235 件)。
23. `b8c6c86` **Stage 7: spawn / freeze 計算を virtualPos に統一** (= `computeSpawnCoordTime` / `checkCausalFreeze` を virtualPos ベースに refactor、 旧 staleFrozenIds / isDead 除外を撤廃、 1.5s grace は維持、 buildSnapshot は stale pre-filter を caller-level safeguard で保持、 test 237 件)。
24. `7d8d71c` **Stage 8: spawn 時刻仕様を (γ) `(min + max) / 2` に確定** (= 4 案 (α/β/γ/δ) のうち 4/28 由来の中間値仕様を継続、 dead / stale も含めた virtualPos で安定性向上、 docstring + plan §12 で rationale 明文化)。
25. `615de4c` SESSION update — 因果律対称化 Stage 1-8 全完了 + Bug ledger 5/8 解消反映。
26. `99f86b9` **dead-skip hotfix**: odakin 実機検証で「dead-me の virtualPos が alive other を不当に freeze させる」 regression が判明、 `processLighthouseAI` Rule B + `useGameLoop` alive Rule B + `checkCausalFreeze` の 3 箇所で `if (p.isDead) continue` を復活。 plan §6 Stage 7 / §7.10 の「dead 包含」 案は実機検証で撤回、 spawn time 計算 (= `computeSpawnCoordTime`) では引き続き含めるが走行中の causality 判定では除外する asymmetric 採用。
27. `63bf3f0` **WebGL context loss recovery overlay (v1)**: `webglContextLost: boolean` state + i18n + 「再読込」 button overlay + Canvas `onCreated` handler。 後の検証で `onCreated` 経由は実機で fire しないと判明し v2 に reroute。
28. `c14e1d5` **WebGL listener を DOM polling pattern に切替**: `<Canvas onCreated>` / `useThree` 経由は preview + Brave で listener fire しないため、 `useEffect` + `setInterval(200ms)` で `document.querySelectorAll('canvas')` を走査し、 WebGL context を持つ canvas に listener を直 attach する pattern に倒した。
29. `453fca6` **「全世界凍結」 root cause 撃滅 + invisible recovery**: 真因は `WorldLineRenderer` の `useMemo` deps に `wl` を含めていたことで `geoVersion` 8-tick throttle が死に、 TubeGeometry rebuild が毎 tick 走って main thread saturation → setInterval Violation 連発 → rAF starve → 全世界 + 星屑凍結 → GPU 資源枯渇で context lost、 という連鎖が起こっていた。 (1) `wl` を ref 経由で latest 参照 + deps 撤去 → rebuild 60Hz → 7.5Hz (1/8)。 (2) Canvas auto-remount: `canvasGeneration` increment で `<Canvas key>` 変化 → React unmount + remount → 新 WebGL context → scene 再構築 (= invisible recovery、 zustand store preserve、 page reload 不要)。 (3) Watchdog: 1.5s 内連続 loss は overlay で「再読込」 escape hatch。 設計思想: 「loss を起こさない」 ではなく「起きても気付かない」 に倒す。

**2026-04-28 セッションの大物 fix 群** (`bbce03f` build `2026/04/28 21:50:37 JST`、 詳細 git log):
- causalEvents observer-centered wrap、 lighthouse γ² bug、 ballistic catchup self-authoritative、 共変表現徹底 (`cb9fa10` / `8c02c0f`)
- camera pitch default 60° (`3ba639a` までに 30 → 60 → 75 → 70 → 60 と微調整)
- 後 join client 永遠凍結 fix 段階1: stale player を snapshot から除外 (`d75c93a`)
- PBC torus を default から外して隠しオプション化、 open_cylinder default + 旧視覚円柱を `#shape=cylinder` に格下げ + 正四角柱を default 視覚に (= 旧円柱と光円錐がどちらも円形で「壁の裏」 感不足) (`1d120fa` + `e32cc6e`)
- ARENA_RADIUS 20 → 40、 ARENA_SQUARE 系 opacity 0.5/0.6/0.5 (= 旧円柱と整合) (`e32cc6e`)
- PR #2 merge: PLC スライスモード (時空図 ↔ PLC slice、 2D 全画面 radar / 3D 斜め俯瞰) (`e645aef`)
- 後 join client 永遠凍結 fix 段階2 (root cause): spawn 時刻を `max` から `(min+max)/2` 中間に + DESIGN に「pos.t は per-player coord time、 wall_clock 同期は誤り」 銘記 (`3ba639a`)
- spawn / arena 中心を原点に統一 (`bbce03f`、 「遠くに行って戻れない」 onboarding 問題対策の前準備、 後続 UX の target 座標を `(0,0)` 固定で扱える)

### 設計思想 (永続化)

- **共変表現の徹底**: 内部表現は共変量 (`phaseSpace.u: Vector3` = γv が正本)、 ut=γ は必要時のみ `sqrt(1+|u|²)` で給与。 詳細 [`DESIGN.md §「共変表現の徹底」`](DESIGN.md)
- **`pos.t` は per-player coord time**: `dτ = wall_dt` は意図的設計、 `pos.t = γ * wall_clock` で player 間 lag が累積するのは仕様。 「全 player wall_clock 同期」 は誤り (詳細 [`design/physics.md`](design/physics.md) §pos.t の物理的意味)
- **「実体は (0,0) cell に閉じる」**: PBC torus universe で全ての物理量は (0,0) cell 内、 universal cover の他 image cells は描画コピー
- **self-authoritative pattern**: state 計算 (= ballistic 復帰位置) は本人 client が行い broadcast、 host 側で再計算しない (= Authority 解体 architecture と整合)

## 既知の課題

### Bug ledger (2026-05-02 demo 中に発見、 順番は user 報告順)

| # | bug | 状態 | メモ |
|---|---|---|---|
| 1 | 死後 ghost が時間発展しない (= 「死後硬直」、 WASD 効かないが arrow keys は効く、 他機は普通に未来へ動く、 自機は時空間で固まる) | **大半は Bug 10 と統合解消の見込み** | 当初 SESSION では「自機のみ固まる」 と分類していたが、 5/2 末で odakin が「世界全体 + 星屑も止まる」 と詳細観察 → Bug 10 として再分類。 ghost camera の WASD non-routing 部分は依然 DevTools console focus 由来 false alarm 仮説 (canvas を 1 度 click で要再検証)。 大半の症状は Bug 10 root cause 撃滅 + auto-remount で解消する見込み |
| 2 | 相手機が見えたり見えなくなったり (flicker) | **あとで** | 4/28 sweep 以降に regression。 OtherShipRenderer / past-cone intersection / universal cover refactor 周辺の疑い。 Bug 10 と共通根因 (= rAF starve で frame drop) の可能性、 root cause 撃滅後に再評価 |
| 5 | 灯台の時刻ジャンプ — user 仮説 「クライアント含めたいちばん未来側 ではなく ホストだけの時刻に飛んでる」 | ✅ **構造的解消 (`7ae1917` Stage 4)** | 旧 `minPlayerT` jump (= 一番過去にいる alive peer に anchor) を Rule B 因果律対称ジャンプ (= `causalityJumpLambda`) に置換。 LH (u=0) は `max_P (P.t − \|P.xy − LH.xy\|)` まで forward exit、 lead client (= 最も未来側 peer) の past null cone surface に追従 → user 観察「host 時刻 anchor」 を解消。 dead / stale も統一処理、 PBC torus は `displayPos` で min-image 折り畳み。 lighthouseRuleB.test 8 件で挙動 verify (= 旧 host=100 + client=200 シナリオで新 LH=190 を assert) |
| 6 | PLC スライス 3D で こちらに飛んでくる弾がゆっくり見える (2D は正しい) | **あとで** | 3D 視点での visual artifact、 2D radar mode は正常。 因果律対称化 (Stage 1-8) の scope 外 |
| 7 | 相手が死んだ瞬間 (kill event が past cone に到達する前) に描画消える | ✅ **fix 済 (`c7f7960`)** | `SceneContent.tsx` `worldLineMarkerEntries` の `isDead` filter が past-cone marker (causal) と future marker (god view) を区別してなかった。 past-cone marker は OtherShipRenderer 本体描画と同じ causal gate のみ、 future marker のみ isDead で skip に refactor |
| 8 | 長時間 tab hidden 復帰後、 灯台が遥か未来に行ってて見えない (= 自機の現在 pos.t より大幅に LH.pos.t が進んでる) | ✅ **構造的解消 (`dc38dba` Stage 6 + `7ae1917` Stage 4)** | (1) Stage 6 で `lastTimeRef` を hidden 中も毎 throttle tick で current 更新するよう修正 → 復帰時 dτ は最後の throttle tick 以降の小値に抑制 (= 旧仕様の「巨大 dτ → ballistic catchup」 経路を完全撤廃)。 (2) Stage 4 LH Rule B が hidden 中 host 側で進行した場合の LH.t 巨大 jump も `max_P (P.t − dist)` で bounded catchup に抑える (= 旧 minPlayerT 経路の「自機より先まで飛ぶ」 を防止)。 実機検証は次 deploy 後 |
| 9 | 新規 tab で join した瞬間に「因果律凍結」 即発生 | **構造的 mitigation (Stage 5/7、 完全解消は実機検証待ち)** | (1) Stage 7 で `checkCausalFreeze` を virtualPos 化 + dead/stale 除外撤廃 → spawn 直後の prediction が安定 (= dead-skip hotfix `99f86b9` で dead は除外復活、 alive/stale のみ virtualPos)。 (2) Stage 5 alive 自機 Rule B が「自分が peer の past cone にいれば forward jump」 で convoy 合流 → freeze 永続を回避 (= 過去側 peer が自発的に飛んでくる対称設計)。 spawn 仕様は Stage 8 で (γ) `(min + max) / 2` に確定。 残る race は spawn 直後の random spatial 配置で初回 tick が依然 freeze 起動するケース、 実機検証で頻度 / 持続を確認 |
| 10 | **全世界が固まる + 背景の星屑も止まる** (= rAF / WebGL レンダリングそのもの停止、 5+ 分プレイで顕在化、 odakin「元からあるバグ」 と確認) | 🟢 **真因 chain 全 fix + deploy 済 (2026-05-04 build 18:19:35)、 user 実機 5+ 分 plays で final verify 待ち** | 真因 chain は 5/4 セッションで多層に分解 + 各層 root fix 済: (1) **virtualPos lastSync semantic 矛盾** (Fix A `dcd7469`、 host 自身 LH の lastSync を毎 tick update) + (Fix B `c8ef4b3`、 virtualPos tau upper bound 2 sec の一般 safety net)、 (2) **LH Stage 4 で Stage 3 機構 (= 大ジャンプ凍結) との接続漏れ** (Fix C `b002d50`、 `largeJumpFrozenLh` return + caller 凍結 push)、 (3) **frozenWorldLines mount storm** (`18adb8b`、 stable id で renderer mount 維持、 cycling で同 entry 同 mount = O(1) churn)、 (4) **LH/OtherShip flicker** (`68e4f67`、 1 点 worldLine の `pastConeIntersectionWithFrozenFallback` 共通 helper)、 (5) **myDeathEvent 二重管理 → 死亡中 stardust 凍結** (`096f513`、 静的 meta は player.phaseSpace から derive、 動的 ghost のみ explicit + useGameLoop lazy init)。 5/2 修正 (= WorldLineRenderer wlRef + Canvas auto-remount + watchdog) は対症療法だったが二次防衛として温存。 各 fix が異なる layer (= 物理 / 協調 / renderer identity / observer 同期 / state 単一化) に対する root cause attack で、 今後同 class symptom が出ても新 layer の RCA が必要 (= 既存 layer の patch 増殖は M25 違反)。 user 実機 5+ 分 plays + host migration trigger + 死亡 routing 含めて世界時刻 advance ≈ wall_clock / setInterval Violation 無し / 星屑凍結無し / 死亡中 stardust 流れる、 を全部 confirm 後に ✅ |

### 中期 plan (= 完了済、 実機検証待ち)

**[`plans/2026-05-02-causality-symmetric-jump.md`](plans/2026-05-02-causality-symmetric-jump.md)** ✅ **Stage 1-8 全完了 + dead-skip hotfix (2026-05-02)** — Bug 5 / 8 / 9 を共通根因 (per-player coord time gap 蓄積) で同時解消する大型 refactor。 思想は「Rule A 凍結 (= 既存) + Rule B 因果律ジャンプ (= 新設) の対称化」 + 「alive / stale を統一 virtualPos モデルで扱う、 dead は spawn time 計算のみで含める asymmetric」 (= dead-skip hotfix で実機検証撤回、 plan §6 Stage 7 / §7.10 から逸脱)。 10 commits (`abfbceb..99f86b9`)、 既存 198 → 237 test (+39) 全 pass。 deploy 候補。 plan v2 で signature 表記 + §3.6 intuition table + §3.3 disc ≥ 0 を修正済 (`10c802a`)。

**WebGL context loss 根本対策** 🟡 **真因再特定 (2026-05-04) — Bug 10 ledger に統合**: 5/2 (`63bf3f0` / `c14e1d5` / `453fca6`) の WorldLineRenderer wlRef pattern + Canvas auto-remount + watchdog escape hatch は **真因の修正ではなく二次症状の patch + 防衛策** だったと 5/4 RCA で確定。 真因は virtualPos lastSync 管理 bug で Rule B 暴走 → frozenWorldLines cycling → mount storm という連鎖 (= Bug 10 真因 chain layer 1-3、 詳細 M27 の 5 layer 表)。 修正は Bug 10 ledger 行を参照 (Fix A `dcd7469` + Fix B `c8ef4b3`、 plan: [`plans/2026-05-04-virtualpos-lastsync-rca.md`](plans/2026-05-04-virtualpos-lastsync-rca.md))。 5/2 の対症療法 (= renderer wlRef + auto-remount + watchdog) は revert せず温存、 別 path で同種 storm が起きる場合の二次防衛として価値あり。 設計思想「loss を起こさない」 → 「起きても気付かない」 は維持。

**listener fire 信頼性問題 + polling fix の revert 経緯 (2026-05-04)**: 5/4 デバッグ中、 console に `THREE.WebGLRenderer Context Lost` log は出るが私の listener log (`[WebGL] context lost`) が出ない事象を観察。 candidate 仮説: (A) `addEventListener` attach 隙間 (= polling 200ms 内に context lost) / (B) Brave / browser-specific event 不発火 / (C) HMR remount race 等 (= 環境依存で verify 困難)。 一度 `gl.isContextLost()` 直 polling check を「正規 resilience」 として実装 → user「絆創膏」 指摘で立ち止まり → revert (= mount storm fix で真因解消すれば listener fire failure も実害なくなるとの判断)。 結果: stable id fix + myDeathEvent decomposition で真因 chain 完結、 listener fire failure は **真因解消で観察消失** (= polling 不要)。 **教訓** (= M26 application): listener fire failure を「外部要因への正規 resilience」 と framing したが、 実は真因 (= mount storm) の二次症状を別 path で吸収しようとした絆創膏だった。 真因解消で消える症状は「真因の二次症状」 で、 polling fix は不要。 但し将来 真の OS/driver context reclaim が起きた場合の resilience として、 5/2 fix (= listener + auto-remount + watchdog) は二次防衛として温存。 polling 直 check は本当に listener が fire しない environment で context loss が頻発するなら別 task で再検討。

**[`plans/2026-05-04-virtualpos-lastsync-rca.md`](plans/2026-05-04-virtualpos-lastsync-rca.md)** ✅ **Fix A + B + C 実装完了 + deploy 済 (2026-05-04)** — Bug 10 真因 = virtualPos lastSync semantic 矛盾 + LH Stage 4 implementation gap。 4 commits、 build `2026/05/04 18:19:35 JST` で deploy 済。

**[`plans/2026-05-04-mydeathevent-decomposition.md`](plans/2026-05-04-mydeathevent-decomposition.md)** ✅ **完了 + deploy 済 (2026-05-04)** — 自機死亡 state の二重管理 (= isDead derive と myDeathEvent explicit の混在、 snapshot 経路で set 漏れ) を構造的に分解。 静的 meta (= pos/u/heading) は player.phaseSpace から derive、 動的 ghost のみ explicit field + useGameLoop dead branch lazy init で「set 漏れ」 が原理的に発生不可。 plan + atomic refactor 2 commits、 11 file 影響、 248 test 全 pass。 抽出された一般原則は meta-principles M25 として永続化。

**[`plans/2026-05-04-isdead-decomposition.md`](plans/2026-05-04-isdead-decomposition.md)** ✅ **v2 完了 + atomic refactor 完了 (2026-05-04)** — myDeathEvent decomposition の audit で発見した同 class issue を、 staleFrozenIds 解消の momentum を活用して同 session 内で完了。 plan v1 (= 「reach 大で別 task」) を v2 (= staleFrozenIds methodology link + 性能 (a) / wire (C) 確定 + Stage atomic refactor) に refresh、 1 セッションで全 32 read site + 7 write site + field 削除 + 強制同期 patch 撤去 + applyKill 撤去 + killRespawn.ts 撤去を完了。 247 test 全 pass、 typecheck clean、 wire format 後方互換 (= snapshot.players[].isDead は selectIsDead derive 経由で送信維持)。

### defer 中 (= 既存)
- **旧シューター操作系で WASD 入力時に射撃の向きを変えない** — 2026-05-04 user 指示。 現状: 旧シューター (= `controlScheme === "legacy_shooter"`) は WASD で「camera basis 進みたい方向 → heading 即時スナップ + thrust」 で機体本体の heading が WASD で動く (= 射撃方向 = heading 連動で動く)。 user 意図: 射撃の向き (= 砲身 / aim 線) は WASD では変えず、 矢印 ←/→ (= cameraYaw 旋回) でのみ heading が動くようにする (= modern controlScheme の挙動に近い)。 詳細 file: `gameLoop.ts processPlayerPhysics` の controlScheme 分岐 + `SelfShipRenderer` / `RocketShipRenderer` の本体 rotation pattern。 着手前に「旧シューター UX 設計意図 (= 71e5788^ 復元、 twin-stick like)」 と新仕様の整合性を確認
- ~~**`player.isDead` の二重管理解消**~~ — ✅ 2026-05-04 同 session で完了 (= 上記 5/4 セッション log + plan v2 参照)、 defer から削除
- **DebrisRenderer 毎 render allocation の GC pressure 仮説** — 2026-05-04 audit で発見、 未検証。 `DebrisRenderer.tsx:165, 209` で毎 render `new Float32Array(totalInstances * 3)` + `new THREE.InstancedBufferAttribute(colorAttr, 3)` を生成 (= maxInstances ≈ 5400、 60 FPS で 3.9 MB/sec の short-lived allocation)。 long plays で setInterval Violation 累積 (= 5/4 user 観察 × 14) の origin 候補。 修正方針: ref で colorAttr Float32Array を pre-allocate、 InstancedBufferAttribute も ref で 1 度作成、 in-place 更新 + needsUpdate=true。 Bug 10 真因 chain は 5/4 の root fix で解消したが、 setInterval Violation が依然累積する場合は本仮説を検証
- **全 renderer の useMemo deps + 毎 render allocation audit** — Bug 10 周辺で frozenWorldLines stable id + LH/OtherShip flicker fallback + StardustRenderer 確認は完了、 残部 (= LaserBatchRenderer / DebrisRenderer / その他) を体系的 audit。 各 renderer で「`useMemo` deps に毎 tick 変わる object 参照を直入れ」「毎 render `new Float32Array` 等 GC pressure」 の 2 pattern を grep + ref pattern 標準化。 trigger: long plays で main thread saturation 系 symptom (= setInterval Violation / rAF starve / 視覚 stutter) が再発したら集中 audit
- DESIGN.md 残存する設計臭 #2 (PeerProvider Phase 1 effect コールバックネスト)
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応
- **ballistic 軌跡 frozenWorldLines 描画** — 死から復帰までの世界線連続性、 odakin defer 判断 2026-04-28
- **spawn time が「ホストよりずっと未来」 になって既存 client が軒並み凍結する逆 bug 疑い** —
  Stage 5 (alive 自機 Rule B) で「過去側 peer が自分の past null cone に forward jump」 が
  実装されたため、 host 側でも自発的 catchup → freeze 永続を回避できるはず。 実機検証で
  確認後、 顕在化しなければ本項目を削除予定
- **Stage 8 spawn 時刻 (α) 案への switch 検討** — 現在 (γ) `(min+max)/2` を確定仕様、 plan
  推奨の (α) `now wall_clock 自分基準` への switch は実機検証 + odakin 同意後に別 commit。
  Bug 9 解消が Rule B convergence で十分なら (γ) 維持で問題なし

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)
詳細 [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### パフォーマンス
- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰

## 次にやること

### 「遠くに行って戻れない」 問題 (2026-04-28、 onboarding 課題)

実機テストプレイヤーが事故的に遠出 → 戻れず迷子化、 を頻出観察 (odakin 報告)。 競技的な「逃げ」 ではなく onboarding 問題。

詳細な subproblem 分解 / 選択肢空間 / un-defer トリガーは [`EXPLORING.md §「遠くに行って戻れない」 問題`](EXPLORING.md) を参照。

**着手済**: spawn / arena 中心を原点に統一 (`bbce03f`、 後続 UX の target 座標を `(0,0)` 固定で扱える前準備)。

**着手済**:
- spawn / arena 中心を原点に統一 (`bbce03f`、 後続 UX の target 座標を `(0,0)` 固定で扱える前準備)
- (1a) HUD 中心方向矢印 + 距離 (`08944d3`、 CenterCompass.tsx 新設)
- (1b) Radar 中心 past-cone marker (`7a12ddf`、 origin event を radar に projectEvent 投影 + cross "+")

**未着手 (推奨順、 効果 / 工数の見積りも EXPLORING.md)**:
1. (1a) + (1b) の実機評価。 帰れない事例が残れば次へ
2. 中心方向 thrust 燃料優遇 or soft pull (= EXPLORING.md §2)
3. 枠半幅 `ARENA_RADIUS = 40` の縮小 (40 → 15-20) は UX 改善後に効果評価して判断

### 実機検証待ち (2026-04-28 セッション全 fix)

3+ tab multi-player で:
- 後 join client 永遠凍結 が `3ba639a` の spawn 時刻 (min+max)/2 中間化で治癒したか
- 逆 bug 疑い: 高 γ host から見て新 joiner が close-spatial に着地して **host が freeze** する race (SESSION 「defer 中」 参照)
- spawn ring / 撃破 / 燃料消費 / Causal Freeze overlay / debris 等の通常 multiplay flow
- **`bbce03f` 後の spawn 位置 / 枠位置**: 原点中心 spawn `[-5, +5)²`、 正方形枠 `[-40, +40]²` で挙動確認

### Phase 2 議論 (PBC torus 復活時に再着手)

PBC torus は隠しオプション化中。 復活時は universal cover refactor の他 phase (ship / worldLine / debris / laser renderer) も observer-centered minimum image folding pattern で統一するか議論。 詳細 [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md)。
