# SESSION.md — LorentzArena 2+1

## 現在のステータス

**本番最新 deploy**: 2026-05-05 build `09:35:38` ([`109ddf0`](https://github.com/sogebu/LorentzArena/commit/109ddf0))。

**5/5 PM verify session 観察** (= odakin 半日不在 → 復帰):
- ✅ **Bug 12 (LH↔自機 表示順序)**: 「よさそうだね」 確認、 ledger ✅ 格上げ
- 🟢 **Bug 10 (全世界凍結)**: Tab 2 = 世界時刻 805s (= 13.4 分 play) で score odakin=42/灯台=23 まで進んで Context Lost × 1 のみ (= invisibly recovered)、 主症状 fire せず → 強い positive signal、 5+ 分 plays 達成済の事実上 ✅
- 🆕 **Bug 11 (network state loss) reliable repro 確立 + γ defer**: sleep computer → wake で 2 tab 共にホスト化 + 互いが見えない state 発生。 Tab 1 は signaling server の WebSocket 切断後 `Cannot connect to new Peer` で stuck (= 信号サーバ再接続経路の robustness 不足)、 Tab 2 は solo host で動作継続。 = 仮説 H2 (host election race) + 新発見 H3 (PeerProvider 再接続 robustness 不足) の合成症状。 5/5 PM 判断: 当 session context 62% で fresh session の方が高品質、 plan §9 に file:line 付き実装手順 + verify 手順 + risk audit 完備して γ defer、 fresh session が exploration なしで着手可
- 副次: laser worldline が LH を遮らない (= `2e19da2` の真因 fix 効果) は通常 play で観察可、 camera yaw τ=0.12s 体感は無コメント (= 違和感無いと推測)

**5/5 work**:
- `109ddf0` **LH 全 mesh に polygonOffset 追加** — odakin 観察「画面で自分と灯台が重なった状態になると LH フリッカー」 (= 直前 `2e19da2` ALWAYS_ON_TOP 撤去後の表面化症状)。 数値解析で確認: 自機 hull z ∈ [0.55, 0.71] / LH body z ∈ [-0.08, 0.92]、 重なり領域で transparent (LH) と opaque (hull) の異種 pass + 同 depth で depthTest が float 精度内で flip → ON/OFF flicker。 旧 ALWAYS_ON_TOP の depthTest=false が副作用的に z-fight も回避していた (= 「絆創膏が抑えていた症状の第 5 の隠れ顔」)。 LH 全 12 material に polygonOffsetFactor=1 / units=1 を追加 → LH depth fragment に固定 bias 加算で deterministic 化、 通常 play (= self が LH の手前) では visual 不変、 重なり時のみ self hull が常に勝って LH 側面が hull の silhouette で消える (= gameplay 上自然な「自分が常に見える」 挙動)。 plan: [`plans/2026-05-05-lh-self-overlap-z-fight.md`](plans/2026-05-05-lh-self-overlap-z-fight.md) (= 「絆創膏を剥がす時にそこに何があったかを understand してから剥がす」 規律事例)。 typecheck + 247 test 全 pass。
- `2e19da2` **ALWAYS_ON_TOP pattern 撤去** (= 根本治療) — odakin 「絆創膏の上に絆創膏」 指摘への対応。 4 段の絆創膏スタック (`46f8755` LH renderOrder bump → `f15fce4` depthTest=false 拡張 → `9f711ca` trio module 化 → `e2608d1` BG/FG split) を真因 audit で剥がす。 真因: transparent な抽象可視化 material が `depthWrite` を default (= true) で放置していた 4 箇所 (= laser worldline / 参照リング / debris marker × 2)。 各 offender 側を `depthWrite={false}` に統一 → LH を depth bypass する必要が消失 → trio + BG/FG + module ごと撤去。 新原則は「opaque 物理 entity は depth 書く、 transparent 抽象可視化 / 半物理 entity は depth 書かないが respect」 の 1 文に集約 (詳細: [`plans/2026-05-05-depth-aware-cleanup.md`](plans/2026-05-05-depth-aware-cleanup.md))。 結果: LH ↔ Self ship hull が depth で前後決まる (= odakin 直感に整合)、 sort flicker は原理的に不発、 alwaysOnTopRender.ts module 削除で file 数 119 → 118。 影響 file: LaserBatchRenderer / SceneContent / threeCache + LighthouseRenderer / SelfShipRenderer / RocketShipRenderer + alwaysOnTopRender.ts 削除。 typecheck + 247 test 全 pass。
- `e2608d1` **ALWAYS_ON_TOP trio を BG/FG 2 layer に分離** — odakin 観察「灯台と自分の表示順序を取り合ってる」 への対応 (= Bug ledger #12)。 旧 1 layer (renderOrder=10) で LH 全 12 mesh と self / rocket exhaust が同 transparent group に混在 → sort tiebreaker が frame 間揺らぐ flicker。 BG (renderOrder=10、 LH = 世界 structure) / FG (renderOrder=11、 self/rocket exhaust = avatar feedback) に分離、 FG > BG で avatar 視認性優先。 Self hull / 砲塔 は trio を持たない (= 通常 opaque depth) は historic 不変、 LH に隠れる挙動も不変 (= 安定的に LH always-on-top)。 docstring drift (= 「適用先: 自機 hull / 砲塔」 と書いていたが実装は exhaust nozzle のみ) も同 commit で実態に sweep。 影響 file: alwaysOnTopRender.ts + LighthouseRenderer + SelfShipRenderer + RocketShipRenderer。 JellyfishShipRenderer は trio 不使用で影響無し。
- `7a7df95` **DebrisRenderer 毎 render allocation を ref reuse pattern に** — Bug 10 並列 root 撲滅。 5/5 verify session Phase 1 (= 単一 tab solo play 70 秒、 peer 不在 Rule B 不発) で Context Lost × 2 観察 → Bug 10 真因 chain (5/4 fix 済) と独立した別 root cause が存在することを確認 → SESSION 「defer 中」 既登録仮説 (= DebrisRenderer 毎 render `new Float32Array(maxInstances*3)` + `new InstancedBufferAttribute` で GPU buffer upload ~3.9 MB/sec) を un-defer。 `useRef` で Float32Array + InstancedBufferAttribute を component lifetime 中保持、 in-place update + `needsUpdate=true` で同 GPU buffer 再 upload。 plan: [`plans/2026-05-05-debrisrenderer-gc-fix.md`](plans/2026-05-05-debrisrenderer-gc-fix.md) (= M26/M27 application 学習記録含む、 「complex hypothesis 組む前に既登録 simpler defer の re-check」 教訓)。 typecheck + 247 test 全 pass、 wire format 影響無し。 user 実機 verify 待ち (= Context Lost 頻度 / setInterval Violation / LH flicker after hit が target 内に収まるか)。
- `d3ecadf` **camera yaw 追従 lag 追加** (chase camera 風) — `cameraYawRef.current` (= 論理 yaw、 物理 / Radar / CenterCompass / heading sync の source of truth) は無遅延、 3D camera 位置 / lookAt だけが [`displayedCameraYawRef`](src/components/game/SceneContent.tsx) (SceneContent.tsx の `useFrame` 内、 指数 lerp 時定数 `CAMERA_YAW_FOLLOW_TAU=0.12s`) で遅延追従。 角度 wrap は `Math.atan2(sin, cos)` で吸収、 初回 snap で起動時 swing 防止。 legacy_classic で「機体先行 + camera swing」 chase camera 感が出る、 modern (cameraYaw=0 固定) では no-op。

**直近 deploy 済 (5/4)** — 詳細は git log + 各 plan:
- `9f711ca` ALWAYS_ON_TOP render trio (renderOrder=10 + depthTest=false + depthWrite=false) を [`alwaysOnTopRender.ts`](src/components/game/alwaysOnTopRender.ts) module 化 (= M28 application、 後続 entity 追加時の踏み外し防止)
- `f15fce4` LH meshes に depthTest=false 追加 (= flicker 修正、 trio 完成)
- `46f8755` 光円錐 / 世界線 / LH の inner-hide 廃止 + LH renderOrder bump
- `99b927b` / `5471f6b` legacy_shooter を 2 軸独立 twin-stick refactor + mobile 1 軸縮退、 scheme label rename (機体追従 / ツインスティック / カメラ固定)
- `e635e83` / `8a0b881` / `6083144` / `f2887f5` スマホ横全画面 Phase 1 (useOrientation hook + 開始時 fullscreen + Lobby landscape paddingTop)
- `2cd8528` / `97ac479` / `e777e2e` Lobby landscape を 3-col layout (form | ship | hi-scores) + ship preview 拡大 (90vh/360 max + camera 0.75× 寄せ)
- `77cd209` 死亡時の煙を victim.color に戻す
- 5/4 前半 build `2026/05/04 18:19:35`: 跳躍 overlay continuous 化 (`151bd84` + `d277d0f` + `41374d7`) / HUD 「固有時間」 → 「世界時刻」 表記修正 (`4061adb`) / **Bug 10 真因 chain 全 fix** (Fix A `dcd7469` + Fix B `c8ef4b3` + Fix C `b002d50`、 plan: [`plans/2026-05-04-virtualpos-lastsync-rca.md`](plans/2026-05-04-virtualpos-lastsync-rca.md)) / LH/OtherShip flicker fallback (`68e4f67`、 [`pastConeFallback.ts`](src/components/game/pastConeFallback.ts)) / frozenWorldLines mount storm root fix (`18adb8b`、 stable id) / myDeathEvent 二重管理解消 (`096f513`、 [`plans/2026-05-04-mydeathevent-decomposition.md`](plans/2026-05-04-mydeathevent-decomposition.md)) / player.isDead 二重管理解消 (`fe070fa`、 [`plans/2026-05-04-isdead-decomposition.md`](plans/2026-05-04-isdead-decomposition.md)) / staleFrozenIds 三重二重管理解消 (`da705b7`)。 抽出原則は [`design/meta-principles.md`](design/meta-principles.md) §M25-28。

**5/2 セッション** ✅ deploy 済 — 因果律対称化 ([`plans/2026-05-02-causality-symmetric-jump.md`](plans/2026-05-02-causality-symmetric-jump.md)、 Stage 1-8 + dead-skip hotfix、 旧 LH `minPlayerT` jump → Rule B、 alive 自機にも Rule B 毎 tick、 ballistic catchup 撤廃) + 「全世界凍結」 root cause v1 (`453fca6`、 WorldLineRenderer の useMemo deps から `wl` 撤去で rebuild 60Hz → 7.5Hz、 Canvas auto-remount + watchdog) + onboarding fix (CenterCompass `08944d3` + radar 中心 marker `7a12ddf`) + Bug 7 因果律違反修復 (`c7f7960`)。 既存 198 → 237 test (+39) 全 pass。

**4/28 セッション** ✅ deploy 済 (`bbce03f` build `2026/04/28 21:50:37`) — 共変表現徹底 + 後 join client 永遠凍結 fix (`3ba639a` で spawn 時刻 (min+max)/2 中間化) + PBC torus 隠しオプション化 + open_cylinder default + ARENA_RADIUS 20 → 40 + PLC スライスモード merge (PR #2) + spawn / arena 中心を原点に統一。 詳細は git log。

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
| 11 | **Network state loss / cascade chaos / sleep-wake** (= 5/5 verify session Phase 2-3 で多 tab cascade で観察 + 5/5 PM の sleep-wake で**reliable repro 確立**: 「両 client が因果律跳躍 同時 fire」 / 「LH worldline 縞 stack」 / `GL_INVALID_OPERATION` / 「一人の client から peer 不可視」 / 「両 tab がホスト化 + 信号サーバ復帰失敗で stuck」) | 🟡 **plan + reliable repro 確立、 implementation phase 着手判断待ち** ([`plans/2026-05-05-network-split-rule-b-runaway.md`](plans/2026-05-05-network-split-rule-b-runaway.md)) | 5/5 PM の odakin 観察「sleep → wake で両 tab がホスト化 + 互いが見えない」 が reliable repro として確立 (= un-defer trigger 達成)。 同 PR 内仮説 H1 (Fix B 2-sec cap × network split で Rule B 暴走) + H2 (PeerProvider host election race) に加えて **新観察 H3: PeerProvider 再接続 robustness 不足** — server WebSocket 切断後に新 Peer 作成で `Cannot connect to new Peer after disconnecting from server` で stuck、 PeerJS の既知挙動 (= disconnect 後の同 instance 再接続困難) を escape する logic 不足。 候補修正 (= plan §3 indexing): (a) staleFrozenIds 拡張 (Rule B 暴走経路遮断) + (d) **PeerJS instance を destroy + 新規作成 で reset** (signaling 復帰経路新設) + (e) 「再接続失敗」 の reload prompt UX (escape hatch)。 推奨順 = (e) → (a) → (d) (= 安全度順、 plan §9 詳述)。 **5/5 PM 判断**: γ (= 別 session に defer) — 当 session は context 62% で fresh session の方が高品質と判断、 plan §9 に file:line 付き実装手順 + verify 手順 + risk audit 完備、 fresh session が exploration なしで着手可。 運用継続: sleep-wake stuck は手動 reload で復帰可 (= user mental model)、 multi-tab cascade は deliberate に避ける。 |
| 12 | **灯台と自機の表示順序を取り合っている疑い** (= odakin 5/5 観察) | ✅ **完全治療 deploy 済 + odakin 5/5 PM verify 「よさそうだね」 確認** | 治療の 3 段階: (1) `e2608d1` BG/FG layer 分離で sort tiebreaker flicker を消した (= 絆創膏)、 (2) odakin 「絆創膏の上に絆創膏」 指摘 → `2e19da2` で 4 段絆創膏スタック (ALWAYS_ON_TOP pattern) を真因 audit で全撤去、 真因は transparent 抽象可視化 material が `depthWrite` default で書いていた 4 offender (= laser / 参照リング / debris marker × 2)、 offender 側を `depthWrite={false}` に統一して `alwaysOnTopRender.ts` module ごと削除、 (3) `109ddf0` で「絆創膏が抑えていた症状の第 5 の隠れ顔」 = 自機 hull z ∈ [0.55, 0.71] と LH body z ∈ [-0.08, 0.92] の geometric 重なり領域での float 精度 z-fight を、 LH 全 mesh に polygonOffset で固定 depth bias 加算して deterministic 化。 結果: 通常 play で visual 不変、 重なり時に self hull が常に勝って LH 側面が hull silhouette で消える (= 自分が常に見える gameplay 自然挙動)、 sort flicker / z-fight 両方原理的に不発、 build 09:35:38。 詳細 plan: [`depth-aware-cleanup.md`](plans/2026-05-05-depth-aware-cleanup.md) + [`lh-self-overlap-z-fight.md`](plans/2026-05-05-lh-self-overlap-z-fight.md) (= M26/M29 application 学習記録 2 連) |
| 10 | **全世界が固まる + 背景の星屑も止まる** (= rAF / WebGL レンダリングそのもの停止、 5+ 分プレイで顕在化、 odakin「元からあるバグ」 と確認) | 🟢 **主症状 ✅ confirmed + 並列 root fix deploy 済**、 5/5 PM verify Tab 2 = 13.4 分 (世界時刻 805s) play で score odakin=42/灯台=23 まで進んで Context Lost × 1 (= invisibly recovered) のみ、 主症状 fire せず → 強い positive signal。 残: 5+ 分 plays + 死亡中 stardust の確認 verify 待ち | 真因は **5 layer chain (5/4 撃滅) + 並列 root (5/5 撃滅)** の複合。 (1)-(5) chain (5/4): **virtualPos lastSync semantic 矛盾** (Fix A `dcd7469` + B `c8ef4b3`) / **LH Stage 4 implementation gap** (Fix C `b002d50`) / **frozenWorldLines mount storm** (`18adb8b` stable id) / **1 点 worldLine flicker** (`68e4f67`) / **myDeathEvent 二重管理** (`096f513`)。 (6) 並列 root (5/5、 `7a7df95`): **DebrisRenderer 毎 render allocation の GPU buffer upload 圧** が単独で Context Lost を生む経路 (Phase 1 単一 tab solo play 70 秒で Context Lost × 2 観察、 peer 不在 Rule B 不発で chain と独立)。 5/5 verify で主症状 (= 世界時刻 暴走 / 全世界凍結 / 死亡中 stardust 凍結) は user 「取れてるっぽい」 確認、 5/5 PM の Tab 2 13.4 分 play で再 confirm。 5/2 fix (= renderer wlRef + Canvas auto-remount + watchdog) は二次防衛として温存。 |

### 中期 plan (= 完了済、 実機検証待ち)

**[`plans/2026-05-02-causality-symmetric-jump.md`](plans/2026-05-02-causality-symmetric-jump.md)** ✅ **Stage 1-8 全完了 + dead-skip hotfix (2026-05-02)** — Bug 5 / 8 / 9 を共通根因 (per-player coord time gap 蓄積) で同時解消する大型 refactor。 思想は「Rule A 凍結 (= 既存) + Rule B 因果律ジャンプ (= 新設) の対称化」 + 「alive / stale を統一 virtualPos モデルで扱う、 dead は spawn time 計算のみで含める asymmetric」 (= dead-skip hotfix で実機検証撤回、 plan §6 Stage 7 / §7.10 から逸脱)。 10 commits (`abfbceb..99f86b9`)、 既存 198 → 237 test (+39) 全 pass。 deploy 候補。 plan v2 で signature 表記 + §3.6 intuition table + §3.3 disc ≥ 0 を修正済 (`10c802a`)。

**WebGL context loss 根本対策** 🟡 **真因再特定 (2026-05-04) — Bug 10 ledger に統合**: 5/2 (`63bf3f0` / `c14e1d5` / `453fca6`) の WorldLineRenderer wlRef pattern + Canvas auto-remount + watchdog escape hatch は **真因の修正ではなく二次症状の patch + 防衛策** だったと 5/4 RCA で確定。 真因は virtualPos lastSync 管理 bug で Rule B 暴走 → frozenWorldLines cycling → mount storm という連鎖 (= Bug 10 真因 chain layer 1-3、 詳細 M27 の 5 layer 表)。 修正は Bug 10 ledger 行を参照 (Fix A `dcd7469` + Fix B `c8ef4b3`、 plan: [`plans/2026-05-04-virtualpos-lastsync-rca.md`](plans/2026-05-04-virtualpos-lastsync-rca.md))。 5/2 の対症療法 (= renderer wlRef + auto-remount + watchdog) は revert せず温存、 別 path で同種 storm が起きる場合の二次防衛として価値あり。 設計思想「loss を起こさない」 → 「起きても気付かない」 は維持。

**listener fire 信頼性問題 + polling fix の revert 経緯 (2026-05-04)**: 5/4 デバッグ中、 console に `THREE.WebGLRenderer Context Lost` log は出るが私の listener log (`[WebGL] context lost`) が出ない事象を観察。 candidate 仮説: (A) `addEventListener` attach 隙間 (= polling 200ms 内に context lost) / (B) Brave / browser-specific event 不発火 / (C) HMR remount race 等 (= 環境依存で verify 困難)。 一度 `gl.isContextLost()` 直 polling check を「正規 resilience」 として実装 → user「絆創膏」 指摘で立ち止まり → revert (= mount storm fix で真因解消すれば listener fire failure も実害なくなるとの判断)。 結果: stable id fix + myDeathEvent decomposition で真因 chain 完結、 listener fire failure は **真因解消で観察消失** (= polling 不要)。 **教訓** (= M26 application): listener fire failure を「外部要因への正規 resilience」 と framing したが、 実は真因 (= mount storm) の二次症状を別 path で吸収しようとした絆創膏だった。 真因解消で消える症状は「真因の二次症状」 で、 polling fix は不要。 但し将来 真の OS/driver context reclaim が起きた場合の resilience として、 5/2 fix (= listener + auto-remount + watchdog) は二次防衛として温存。 polling 直 check は本当に listener が fire しない environment で context loss が頻発するなら別 task で再検討。

**[`plans/2026-05-04-virtualpos-lastsync-rca.md`](plans/2026-05-04-virtualpos-lastsync-rca.md)** ✅ **Fix A + B + C 実装完了 + deploy 済 (2026-05-04)** — Bug 10 真因 = virtualPos lastSync semantic 矛盾 + LH Stage 4 implementation gap。 4 commits、 build `2026/05/04 18:19:35 JST` で deploy 済。

**[`plans/2026-05-04-mydeathevent-decomposition.md`](plans/2026-05-04-mydeathevent-decomposition.md)** ✅ **完了 + deploy 済 (2026-05-04)** — 自機死亡 state の二重管理 (= isDead derive と myDeathEvent explicit の混在、 snapshot 経路で set 漏れ) を構造的に分解。 静的 meta (= pos/u/heading) は player.phaseSpace から derive、 動的 ghost のみ explicit field + useGameLoop dead branch lazy init で「set 漏れ」 が原理的に発生不可。 plan + atomic refactor 2 commits、 11 file 影響、 248 test 全 pass。 抽出された一般原則は meta-principles M25 として永続化。

**[`plans/2026-05-04-isdead-decomposition.md`](plans/2026-05-04-isdead-decomposition.md)** ✅ **v2 完了 + atomic refactor 完了 (2026-05-04)** — myDeathEvent decomposition の audit で発見した同 class issue を、 staleFrozenIds 解消の momentum を活用して同 session 内で完了。 plan v1 (= 「reach 大で別 task」) を v2 (= staleFrozenIds methodology link + 性能 (a) / wire (C) 確定 + Stage atomic refactor) に refresh、 1 セッションで全 32 read site + 7 write site + field 削除 + 強制同期 patch 撤去 + applyKill 撤去 + killRespawn.ts 撤去を完了。 247 test 全 pass、 typecheck clean、 wire format 後方互換 (= snapshot.players[].isDead は selectIsDead derive 経由で送信維持)。

### defer 中 (= 既存)
- ~~**旧シューター操作系で WASD 入力時に射撃の向きを変えない**~~ — ✅ 2026-05-04 完了 (= 未 deploy)。 legacy_shooter を 2 軸独立 twin-stick に refactor: WASD = camera basis thrust (heading 不変)、 矢印 ←/→ = `headingYawRef` 旋回 (= 砲身/aim、 機体本体)、 **Shift+矢印 ←/→** = `cameraYawRef` 旋回 (= camera 機体周り旋回 free-look)、 mobile touch swipe = cameraYaw (= Shift 等価)。 旧仕様の WASD `newYaw = effectiveYaw` snap 撤廃 + `PhysicsResult.newYaw` field 撤去 (= dead code、 全 controlScheme で input yaw と同値だった)。 副次: HUD 操作説明を controlScheme 別に出し分け (= `hud.controls.{legacy_classic,legacy_shooter,modern}.{move,heading}` + `legacy_shooter.cameraRotate` 新設)、 dropdown label を機能反映に rename (= 旧クラシック → 機体追従 / 旧シューター → ツインスティック / モダン → カメラ固定、 内部 ID は LS / URL hash 後方互換のため不変)。 影響 file: `gameLoop.ts` / `useGameLoop.ts` / `ControlPanel.tsx` / `SceneContent.tsx` / `game-store.ts` + i18n ja/en + CLAUDE.md。 247 test 全 pass、 typecheck clean。 `legacy_shooter` の wire / ID は不変なので旧 client 互換
- ~~**`player.isDead` の二重管理解消**~~ — ✅ 2026-05-04 同 session で完了 (= 上記 5/4 セッション log + plan v2 参照)、 defer から削除
- ~~**DebrisRenderer 毎 render allocation の GC pressure 仮説**~~ — ✅ 2026-05-05 完了 + deploy (`7a7df95`、 [`plans/2026-05-05-debrisrenderer-gc-fix.md`](plans/2026-05-05-debrisrenderer-gc-fix.md))。 ref reuse pattern で同 GPU buffer 再 upload、 Context Lost 並列 root として撃滅。
- **JellyfishShipRenderer の per-frame TubeGeometry rebuild** — 5/5 audit で発見、 未着手。 `useFrame` 毎に 5 触手分の `new THREE.CatmullRomCurve3` + `new THREE.TubeGeometry` を生成 + 旧 geometry dispose。 触手 1 つあたり tubularSegs=28-32 / radialSegs=6-8 で GPU mesh churn。 default ship は classic で Jellyfish opt-in (`#ship=jellyfish`) のため classic player には影響なし。 un-defer trigger: Jellyfish 利用者で GPU 圧 / Context Lost / setInterval Violation 累積。 修正方針: TubeGeometry attribute (= position / normal / uv) を pre-allocate Float32Array で展開 → in-place 更新 + `needsUpdate=true` で dispose 不要化 (= three.js TubeGeometry に in-place API 無いので手動 attribute 更新)。 工数中 (= 1-2h)。
- **全 renderer の useMemo deps + 毎 render allocation audit** — 5/5 audit (Explore agent) **完了**。 critical: Jellyfish (上記)、 LOW: SelfShipRenderer ringPositions useMemo (固定 deps、 amortized) / OtherShipRenderer image cell loop の Vector4 spread (~600 bytes/sec) / SpawnRenderer Array.from object creation (1.5KB/spawn lifetime)。 LOW 群は実害ないので touch せず、 trigger は「long plays で main thread saturation 系 symptom 再発」 で集中 audit。 副 candidate: DebrisRenderer の `explosionSegments` / `hitSegments` 配列毎 render 再生成 (~80 KB/render の CPU GC、 `7a7df95` GPU fix の scope 外で残存、 同様の pre-allocate ref pattern で fix 可能だが優先度低)。
- DESIGN.md 残存する設計臭 #2 (PeerProvider Phase 1 effect コールバックネスト)
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- **スマホ横画面 (fullscreen 表示) 対応** — Phase 1 完了 (= 縦横両対応 + 開始ボタン fullscreen 試行 + Lobby paddingTop orientation-aware): `useOrientation` hook + Lobby `paddingTop` を landscape で 5vh / portrait で 40vh、 開始ボタン押下時に `requestFullscreen()` 試行 (silent failure、 orientation lock せず両向き許容)。 iOS 16.4+ / Android Chrome で fullscreen 動作、 古い iOS は通常 browser 表示で fall back。 残: in-game HUD の landscape layout 最適化 (Phase 2、 = Speedometer 縦長 / ControlPanel↓Radar overlap 等)
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

### 実機検証待ち (= odakin verify、 復帰時 priority)

**5/5 deploy 群 (= build 09:35:38 まで反映)**:
- (a) **camera yaw 追従 lag** (`d3ecadf`): legacy_classic で「機体先行 → camera が swing で追いかける」 chase camera 感が出るか、 操作感に違和感ないか (= τ=0.12s 体感調整 余地)
- (b) **Bug 10 主症状** (`7a7df95` で並列 root の DebrisRenderer GC fix 後): 5+ 分 plays + LH 撃破連打で Context Lost 0-1 件 / setInterval Violation 0-3 件 / LH flicker after hit 消失 / 世界時刻 advance ≈ wall_clock / 死亡中 stardust 流れる
- (c) **Bug 12 LH↔自機 表示順序** (`109ddf0` polygonOffset 後): 自機が LH に近接 + LH 内部に侵入する場面で LH の flicker が消失、 通常 play で visual 不変 (= LH 見え方が変わってない)
- (d) **副次**: `2e19da2` で laser worldline depthWrite=false にしたことで laser が LH を遮らない (= 元 5/4 fix の本来の狙いが真に達成)、 laser worldline の見た目が変わってないか

**4/28 fix の 3+ tab multi-player verify** (= 古い項目、 引き続き):
- 後 join client 永遠凍結 が `3ba639a` の spawn 時刻 (min+max)/2 中間化で治癒したか
- 逆 bug 疑い: 高 γ host から見て新 joiner が close-spatial に着地して **host が freeze** する race (SESSION 「defer 中」 参照)
- spawn ring / 撃破 / 燃料消費 / Causal Freeze overlay / debris 等の通常 multiplay flow
- **`bbce03f` 後の spawn 位置 / 枠位置**: 原点中心 spawn `[-5, +5)²`、 正方形枠 `[-40, +40]²` で挙動確認

**Bug 11 (cascade chaos) γ defer 中** — implementation 着手は fresh session で:
- reliable repro: PC sleep → wake (= 5/5 PM 確立済) または Chrome DevTools「Network: Offline」 5+ sec
- plan §9 に file:line 付き実装手順 + verify 手順 + risk audit 完備、 fresh session で exploration なしに着手可
- 推奨実装順: (e) reload prompt → (a) staleFrozenIds 拡張 → (d) PeerJS instance reset
- 運用継続: sleep-wake stuck は手動 reload で復帰可

### Phase 2 議論 (PBC torus 復活時に再着手)

PBC torus は隠しオプション化中。 復活時は universal cover refactor の他 phase (ship / worldLine / debris / laser renderer) も observer-centered minimum image folding pattern で統一するか議論。 詳細 [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md)。
