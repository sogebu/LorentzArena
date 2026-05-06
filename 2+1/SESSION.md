# SESSION.md — LorentzArena 2+1

## 現在のステータス

**本番最新 deploy**: 2026-05-06 build `08:48:05` ([`ca7698c`](https://github.com/sogebu/LorentzArena/commit/ca7698c)) Bug 6 + Bug 13 両方治療。 odakin localhost verify 「直ってる」 「なおってる」 確認済 → production deploy 済。

直近 2 commits:
- [`ca7698c`](https://github.com/sogebu/LorentzArena/commit/ca7698c) **Bug 6 fix**: PLC 3D laser を `pastLightConeIntersectionLaser` (= lab-frame past-cone ∩ worldline) + `transformEventForDisplay` (= rest frame xy 統一) で描画、 approaching laser に「速く / 瞬時に」 効果が出る (= 旧 lambda 直は光伝達時間を無視して laser 物理現在位置を出していた誤り)
- [`fb1288b`](https://github.com/sogebu/LorentzArena/commit/fb1288b) **Bug 13 根本治療**: 旧 3 系統 conditional Canvas (= persp/ortho/plc3d) を単一 Canvas + 内部 `<CameraController>` で camera 動的切替に refactor、 toggle で Canvas remount しなくなり user GPU の WebGL context 生成失敗 chronic loop が消滅

### 最近の作業要約 (詳細 = git log + 各 plan)

- **5/6 12:47 JST** **Bug 14 live state capture** (= [`repro/2026-05-06-bug14-state/`](repro/2026-05-06-bug14-state/), commit `4abdf26`)。 スマホ Pixel 7a (Android 16) Brave で 5/5 21:01 JST に開いたタブが 15.77h 後も runaway 状態で生存中、 reload せず Mac から WiFi ADB + CDP `Runtime.evaluate` 経由で state 完全 dump (= 732 KB JSON、 worldLine.history 2000+1000 entry / 全 log / 全 phaseSpace / localStorage)。 **重要 finding**: (1) `performance.now() = 3.25h` vs `Date.now() - timeOrigin = 15.77h` の diff で **12.5h が background suspend 状態** だったと逆算 confirm (= L0 dTau cap 仮説の必須前提の実機証拠)、 (2) self.pos.t = 20.37M で `β = √(x²+y²)/t = 0.998c equivalent` → γ_required = 15.8 必要、 friction γ_max=1.89 を遥かに超えるため **通常 physics 経路では発生不能**、 (3) **LH は終始 normal** (= pos.t = 57005 sec で page age 整合)、 旧 Bug 14 仮説 (b)「LH ratchet で human を引きずる」 は live data で **完全否定**、 alive human 単独 runaway が真因経路、 (4) frozenWorldLines / killLog / 巨大 jump 痕跡は全 GC 済で復元不能、 真因 event の直接観測は live repro が必要。 副次成果: claude-config に `conventions/android-chromium-remote-debug.md` (= universal procedure) 外出し (= commit `1c7b271`)、 odakin-prefs work-discipline §+2、 meta-principles §M41 (= β/γ diagnostic)、 §M42 (= ring buffer GC + live capture mandatory)、 §M35 update (= LH ratchet 否定の live confirm)
- **5/6 朝〜昼** **NPC 非対称 causality + spawn formula 整備 + type-level kind 化** plan 実装 (= [plan](plans/2026-05-06-npc-asymmetric-causality.md))。 3 軸 independent な structural 整備:
  - **(I) NPC 非対称** [class 軸]: causality calc 全 4 site で `isNpc(p)` skip 統一、 既存 `checkCausalFreeze` の片肺 LH skip を Rule B + spawn 計算にも完成。 「NPC = subordinate、 human を causally 制約しない」 を全 human 経路で uniform 化
  - **(II''') mean formula + excludeId 撤去 + self 包含** [集約形式]: `computeSpawnCoordTime` を `(min+max)/2` (midpoint) → `sum/N` (mean) に変更、 self も virtualPos で寄与する設計に統一。 outlier robustness 獲得 + signature 簡素化 + solo respawn corner case 構造的消滅
  - **(III) type-level kind field** [表現軸]: `RelativisticPlayer.kind: 'human' \| 'npc'` field + `isNpc(player)` typed predicate、 ID prefix runtime check の fragility 解消、 wire format 不変で backward compat 完璧
  - **副次効果**: Bug 14 propagation race の **LH 経路を構造的に断つ** + alive human runaway peer に対する mean formula の partial defense
  - **5/2 plan §10.4 との直交性**: §10.4 = LH 自身の advance ロジック、 本変更 = LH state が他者 causality 入力に入るか、 完全直交。 §10.4 結論は LH 自身の挙動について依然 valid
  - **5/2 plan §4 「死者の二本世界線モデル」 を causality calc layer で温存** (= 過去議論で出た「dead = 死亡時点固定」 案 (II'') は撤回、 dead を除外すると時刻 split が広がるため virtualPos 寄与で cluster 同期維持)
  - **(α) wall_clock anchor 案を永続却下**: P1 設計柱と矛盾、 5/2 plan §10.1 同型却下対象として記録
  - 263 test pass、 typecheck clean、 wire format 不変、 5 commits (= Stage 1-4 + plan)
- **5/5 night** Rule B exit margin (`ad52130` + docstring `61ddb08`): `causalityJumpLambdaSingle` に `CAUSALITY_JUMP_EXIT_MARGIN_LS = 0.001 ls` 加算で λ_exit を peer の過去 null cone surface ぴったりではなく ε spacelike 側に着地、 boundary chatter 構造的消滅。 Rule A `CAUSAL_FREEZE_HYSTERESIS = 2.0` と complementary 対称構造。 詳細: [DESIGN.md §Rule B exit margin](DESIGN.md) + [`constants.ts:CAUSALITY_JUMP_EXIT_MARGIN_LS`](src/components/game/constants.ts) docstring。 253 test pass。
- **5/5 evening** Bug 11 plan fully decommissioned (build `19:43:10`): Stage 8 4 軸対称性根本治療 (transport / direction / phase) + Stage 9 cosmetic root cause + Stage 11 `causalFrozenRef` boolean dual 撤廃 (`ffd81b3`)。 sleep-wake production verify ✅ confirmed。 思想 anchor: [`design/network-recovery.md`](design/network-recovery.md)
- **5/5 day** Bug 12 LH↔自機 z-fight 治療 (`109ddf0` polygonOffset + `2e19da2` ALWAYS_ON_TOP pattern 撤去) + Bug 10 並列 root (`7a7df95` DebrisRenderer GC fix) + camera yaw 追従 lag (`d3ecadf`) + 操作系 refactor (`99b927b` legacy_shooter twin-stick + scheme rename)
- **5/4** Bug 10 5 layer chain 真因 fix: `dcd7469` + `c8ef4b3` + `b002d50` (virtualPos lastSync) + `18adb8b` (mount storm stable id) + `68e4f67` (pastConeFallback) + `096f513` (myDeathEvent decomposition) + `fe070fa` (isDead decomposition) + `da705b7` (staleFrozenIds 解消)。 抽出 meta-principles M25-28: [`design/meta-principles.md`](design/meta-principles.md)
- **5/2** 因果律対称化 Stage 1-8 + dead-skip hotfix: 旧 `minPlayerT` LH jump → Rule B、 alive 自機にも Rule B 毎 tick、 ballistic catchup 撤廃。 plan: [`causality-symmetric-jump`](plans/2026-05-02-causality-symmetric-jump.md)
- **4/28** 共変表現徹底 + 後 join 永遠凍結 fix (`3ba639a` spawn `(min+max)/2`) + PBC torus 隠し化 + ARENA_RADIUS 20→40 + spawn 原点中心統一 (`bbce03f`)

### 設計思想 (永続化)

- **共変表現の徹底**: 内部表現は共変量 (`phaseSpace.u: Vector3` = γv が正本)、 ut=γ は必要時のみ `sqrt(1+|u|²)` で給与。 詳細 [DESIGN.md](DESIGN.md)
- **`pos.t` は per-player coord time**: `dτ = wall_dt` は意図的設計、 `pos.t = γ * wall_clock` で player 間 lag が累積するのは仕様 (詳細 [`design/physics.md`](design/physics.md))
- **「実体は (0,0) cell に閉じる」**: PBC torus universe で全ての物理量は (0,0) cell 内、 universal cover の他 image cells は描画コピー
- **self-authoritative pattern**: state 計算 (= ballistic 復帰位置) は本人 client が行い broadcast、 host 側で再計算しない
- **Rule A / Rule B 対称設計**: Rule A (= 凍結) と Rule B (= 因果律ジャンプ) は mirror image。 各々 boundary 振動防止の hysteresis (= A) / exit margin (= B) を持ち、 因果律 state machine が boundary に張り付かない (詳細 [DESIGN.md §因果律対称化](DESIGN.md))

## 既知の課題

### Bug ledger (5/2 demo 中発見、 user 報告順)

| # | bug | 状態 | メモ |
|---|---|---|---|
| 1 | 死後 ghost 時間発展せず | Bug 10 と統合解消見込み | ghost camera WASD non-routing 部分は DevTools console focus 由来 false alarm 仮説、 canvas click で要再検証 |
| 2 | OtherShip flicker | あとで | Bug 10 共通根因 (rAF starve) 疑、 root 撃滅後再評価 |
| 5 | LH 時刻ジャンプ (host anchor) | ✅ 構造的解消 (`7ae1917` Stage 4) | Rule B 因果律対称ジャンプで lead client 追従、 旧 `minPlayerT` 撤廃 |
| 6 | PLC スライス 3D 弾速 (= approaching laser が遅く見える) | ✅ **完全治療 + odakin verify 「直ってる」 (5/6 朝)** | `ca7698c` で `pastLightConeIntersectionLaser` (= lab-frame past-cone ∩ worldline) + `transformEventForDisplay` (= rest frame xy 統一) で描画。 旧 `lambda·direction + emission` は **光伝達時間を無視** して laser 物理現在位置を出していた誤り、 正しくは `t_e + s + |r(s)|` で観測者着の photon 発射事象を出す → approaching laser で全 worldline 事象が同 observer 時刻に着く burst 効果が出て「速く / 瞬時に」 visible。 odakin 訂正で「lab-frame でも近づく laser はいくらでも速くなる、 boost / aberration とは別軸」 と framing 修正、 5/5 night の Phase 0 attempt は Bug 13 と取り違えて revert していたが Bug 13 根本治療後に再 apply で完了 |
| 13 | **正射影 mode + PLC 3D mode で WebGL chronic context loss** | ✅ **根本治療 deploy 済 (5/6 朝、 build `08:48:05`)** | `fb1288b` で 旧 3 系統 conditional Canvas (= `plc3d-gen` / `ortho-gen` / `persp-gen`) を**単一 Canvas + 内部 `<CameraController>` で camera 動的切替**に refactor。 真因は「toggle で React conditional が `<Canvas key>` を unmount → 新 Canvas mount → user GPU/driver で fresh WebGL context 生成失敗 → auto-remount → chronic loop」。 isolation 試行 #1〜#4 (= camera config / GameLights / ship 種別 / `<Canvas orthographic>` prop) 全て無効、 #4 (= Canvas merge) で chronic loss 完全消失 confirmed → 真因確定 + 構造的治療。 視覚は spacetime persp / spacetime ortho (真の orthographic) / PLC 3D の 3 view が CameraController の useEffect で正しく切替。 odakin verify 「問題なし、 直ってる」 (5/6 朝)。 5/5 night の near/far ±10000→±500 fix attempt (`5901db5`) は無効と判明後 revert (`2a0abc8`)、 isolation #1-#3 attempts (`755e924`/`03753b2`/`78450b1`) も真因絞り込みのために順次 deploy → 全て無効 confirmed の上で根本治療 (`fb1288b`)。 **教訓**: `sinceLast=1.77e12ms` (= listener attach 前 loss) console signature は「mount 直後 GPU 即 crash」 を意味する、 component config patches より前に Canvas remount 自体を疑うべきだった (= 試行 #4 で気づいた、 #1-#3 は後付けで見れば不要だった) |
| 14 | **Background tab で physics runaway (= 寝ている間に未来に超高速 drift)** | 🟡 **真因未特定、 LH 経路 propagation は構造的遮断済 (5/6 plan) + 5/6 12:47 live state capture で suspend 12.5h confirm + LH ratchet 仮説完全否定** | 2026-05-06 朝 user 報告: スマホ Brave で 8 時間 background 後、 世界時刻 `20340058.16s` (= 2034 万秒 = 235 日分、 wall_clock 8 時間で 700x speedup) / 位置 `(-19164502.22, 6810953.07)` = ±2000 万 ls 遠方 / 現速 0.3% c, γ=1.000 / 撃破数 odakin 28 / LH 3 で長 play 継続。 **5/6 12:47 JST live state capture confirm** (= [`repro/2026-05-06-bug14-state/`](repro/2026-05-06-bug14-state/)、 commit `4abdf26`): WiFi ADB + CDP で state 732 KB dump、 (1) `performance.now()` vs `Date.now()` diff で **12.5h background suspend** 確定 (= 仮説 (a) の必須前提が実機 confirm)、 (2) `β = 0.998c equivalent` で γ_required = 15.8 必要、 friction γ_max=1.89 を遥かに超え **通常 physics 経路で発生不能** (= 別経路の bug / corruption が必要)、 (3) **LH は終始 normal** (= pos.t=57005 で page age 整合)、 旧仮説 (b)「LH ↔ self ratchet」 は **live data で完全否定** (= LH も runaway していたという前提が嘘、 self だけ単独 runaway)、 (4) worldLine.history / frozenWorldLines / killLog 巨大 jump 痕跡は全 GC で復元不能。 **propagation race の防御進捗 (= 5/6 NPC 非対称 plan)**: (1) LH 経由の伝染 → **(I) NPC 非対称で構造的遮断完了** (但し本実機では LH 経路活性化せず defense-in-depth 扱い)、 (2) alive human runaway 経由の伝染 → **(II''') mean formula で partial defense** + 完全防御は L1 plausibility filter (別 plan) で対処、 (3) **(α) wall_clock anchor 案を永続却下** (= P1 設計柱矛盾)。 **残課題**: 真因 (= self 単独 runaway の発生機構) isolation、 live repro + L0 dTau cap + visibility listener 検討。 (= 自機 dTau cap 不在 + suspend 復帰の異常 1 tick で friction 外 advance、 が最有力仮説) |
| 7 | 相手死亡瞬間描画消失 | ✅ fix 済 (`c7f7960`) | past-cone marker と future marker の isDead filter 分離 |
| 8 | hidden 復帰 LH 未来跳躍 | ✅ Stage 6 + Stage 4 で解消 (`dc38dba` + `7ae1917`) | bounded catchup で「自機より先まで飛ぶ」 防止 |
| 9 | 新規 join 即凍結 | 構造的 mitigation (実機検証待ち) | Rule B convergence で freeze 永続回避、 残 race は spawn 直後 spatial 配置依存 |
| 10 | 全世界凍結 + 星屑停止 | 🟢 主症状 ✅ confirmed | 5 layer chain (5/4) + DebrisRenderer GC (5/5) で撃滅、 Tab 2 13.4 分 play で再 confirm。 残: 5+ 分 plays + 死亡中 stardust の最終確認 |
| 11 | Network state loss / sleep-wake | ✅ plan fully decommissioned (5/5 evening) | sleep-wake production verify ✅ confirmed、 4 軸対称性 architecture 完璧。 5/5 night Rule B exit margin で post-recovery 残響も消滅見込み |
| 12 | LH↔自機 表示順序 | ✅ 完全治療 + odakin verify | (1) BG/FG 分離 (2) ALWAYS_ON_TOP 撤去 + depthWrite 整合 (3) polygonOffset で z-fight deterministic 化 |

### 中期 plan / 設計記録 (= deploy 済、 詳細は git log + plans/ 参照)

主要 plan は全 deploy 済。 完了 plan 一覧:

- [`2026-05-02-causality-symmetric-jump`](plans/2026-05-02-causality-symmetric-jump.md): Bug 5/8/9 共通根因の対称ルール導入
- [`2026-05-04-virtualpos-lastsync-rca`](plans/2026-05-04-virtualpos-lastsync-rca.md): Bug 10 真因 chain (Fix A+B+C)
- [`2026-05-04-mydeathevent-decomposition`](plans/2026-05-04-mydeathevent-decomposition.md) + [`2026-05-04-isdead-decomposition`](plans/2026-05-04-isdead-decomposition.md): 二重管理解消 2 連
- [`2026-05-05-debrisrenderer-gc-fix`](plans/2026-05-05-debrisrenderer-gc-fix.md): Context Lost 並列 root
- [`2026-05-05-depth-aware-cleanup`](plans/2026-05-05-depth-aware-cleanup.md) + [`2026-05-05-lh-self-overlap-z-fight`](plans/2026-05-05-lh-self-overlap-z-fight.md): Bug 12 治療 2 連

**WebGL context loss**: 5/2 fix (renderer wlRef + Canvas auto-remount + watchdog) は二次防衛として温存、 真因は Bug 10 5 layer chain (5/4) + 並列 GPU root (5/5) で撃滅。 設計思想「loss を起こさない」 → 「起きても気付かない」 維持。

### defer 中

- **JellyfishShipRenderer per-frame TubeGeometry rebuild**: 未着手、 trigger = Jellyfish 利用者で GPU 圧 / Context Lost 累積。 修正方針 = TubeGeometry attribute pre-allocate + in-place 更新 (1-2h)
- **DebrisRenderer の `explosionSegments` / `hitSegments` CPU 配列毎 render 再生成**: `7a7df95` GPU fix の scope 外で残存、 同 pre-allocate ref pattern で fix 可能、 優先度低
- **DESIGN.md 残存設計臭 #2**: PeerProvider Phase 1 effect コールバックネスト
- **snapshot に `frozenWorldLines` / `debrisRecords` 同梱**: un-defer trigger = リスポーン世界線連続観測時
- **host migration の LH 時刻 anchor 見直し**
- **色調をポップで明るく** (方向性未定)
- **スマホ横画面 Phase 2**: in-game HUD landscape 最適化 (Speedometer 縦長 / ControlPanel↓Radar overlap 等)。 Phase 1 (orientation 両対応 + fullscreen 試行) は 5/4 deploy 済
- **ballistic 軌跡 frozenWorldLines 描画**: 死から復帰までの世界線連続性、 odakin defer 判断 4/28
- **逆 bug 疑い**: 高 γ host から見て新 joiner が close-spatial に着地して **host が freeze** する race。 Stage 5 alive 自機 Rule B で自発 catchup する設計のため顕在化しなければ削除予定
- **Stage 8 spawn 時刻 (α) 案への switch 検討**: 現在 (γ) `(min+max)/2` 確定、 (α) `now wall_clock 自分基準` への switch は実機検証 + odakin 同意後

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)

詳細 [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### パフォーマンス

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰

## 次にやること

### 「遠くに行って戻れない」 問題 (4/28〜、 onboarding 課題)

実機テストプレイヤーが事故的に遠出 → 戻れず迷子化を頻出観察。 詳細 subproblem / 選択肢 / un-defer trigger は [`EXPLORING.md §「遠くに行って戻れない」 問題`](EXPLORING.md)。

**着手済**: spawn / arena 中心原点統一 (`bbce03f`) + (1a) HUD CenterCompass 中心方向矢印 + 距離 (`08944d3`) + (1b) Radar 中心 past-cone marker (`7a12ddf`)

**未着手**: 1. (1a)+(1b) の実機評価 → 帰れない事例残存なら次へ / 2. 中心方向 thrust 燃料優遇 or soft pull (EXPLORING.md §2) / 3. ARENA_RADIUS 縮小 (40→15-20) は UX 改善後評価

### 実機検証待ち (= odakin verify、 復帰時 priority)

**5/6 朝 build `08:48:05`** (= 最新):
- ✅ Bug 6 (PLC 3D laser approaching speed)、 ✅ Bug 13 (正射影 / PLC 3D chronic loss): odakin localhost verify 完了 + production deploy 済 (`ca7698c` + `fb1288b`)。 verify 残: 高 γ 多 tab multi-player で laser「速く / 瞬時に当たる」 演出が正しく出るか + 各 view (時空図 persp / ortho / PLC 3D) を高速 toggle 連打しても context loss 不発

**🆕 Bug 14 (background tab で physics runaway) は未着手**: 5/6 朝 user 報告のスマホ overnight runaway の repro 条件 isolation。 関連: PC で同 production join 試行で「別ホスト」 化 (= signaling 死亡で偶然 isolation)、 同 room join に成功した場合 spawn 時刻 (min+max)/2 + Rule B convergence で **新 joiner も runaway peer の半分まで未来 spawn** される race の防衛策検討

**5/5 night** (build `21:50:57`):
- (e) **Rule B exit margin** (`ad52130`): localhost 「よさそう」 確認済 + production deploy 済。 multi-tab / 高 γ 混在 / sleep-wake 後 で flicker 完全消失か、 通常 play で visual / 因果律跳躍 overlay 発火頻度に体感差ないか確認

**5/5 day** (build 09:35:38 まで):
- (a) camera yaw 追従 lag (`d3ecadf`): chase camera 操作感 / τ=0.12s 体感
- (b) Bug 10 主症状 (`7a7df95`): 5+ 分 play で Context Lost 0-1 件 / setInterval Violation 0-3 件 / LH flicker after hit 消失 / 死亡中 stardust 流れる
- (c) Bug 12 LH↔自機 (`109ddf0`): 重なり時 flicker 消失 / 通常 play で visual 不変
- (d) laser worldline depthWrite=false 副次 (`2e19da2`): laser が LH を遮らない見え方

**4/28 fix の 3+ tab multi-player verify** (古い項目、 引き続き):
- 後 join client 永遠凍結が `3ba639a` で治癒したか
- 逆 bug (host freeze race) 顕在化チェック
- spawn ring / 撃破 / 燃料 / 因果律 overlay / debris 等の通常 multiplay flow

### Phase 2 議論 (PBC torus 復活時)

PBC torus は隠しオプション化中。 復活時は universal cover refactor の他 phase (ship / worldLine / debris / laser renderer) も observer-centered minimum image folding pattern で統一するか議論。 詳細 [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md)。
