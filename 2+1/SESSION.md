# SESSION.md — LorentzArena 2+1

## 現在のステータス

**本番最新 deploy**: 2026-05-05 build `21:50:57` ([`ad52130`](https://github.com/sogebu/LorentzArena/commit/ad52130)) Rule B exit margin LH flicker 治療。 odakin localhost verify 「よさそう」 → production deploy 済。 後続の docs-only commits は次回コード変更 deploy 時に同梱される。

### 最近の作業要約 (詳細 = git log + 各 plan)

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
| 6 | PLC スライス 3D 弾速 | あとで | 3D 視点 visual artifact、 2D radar は正常、 因果律対称化 scope 外 |
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
