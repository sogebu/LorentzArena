# SESSION.md — LorentzArena 2+1

最終更新: 2026-05-26 棚卸し (= 5/16 7-commit deploy + active verify queue + open bugs のみ保持、 完了 bug + 過去 plan narrative は git log / plans/ / DESIGN.md へ defer、 `claude-config/CONVENTIONS.md §3` 80 行目安に追従)

## 現在のステータス

**本番最新 deploy**: 2026-05-16 build `16:51:17 JST` **5/16 多 commit batch** — 1 セッション内で 7 commits を deploy、 F1 mutual-freeze 修復 + 当日小修正群 + visual polish。 chronological order:

| commit | build | 内容 | status |
|---|---|---|---|
| [`996ac44`](https://github.com/sogebu/LorentzArena/commit/996ac44) | 15:53:27 | **F1 mutual-freeze 防止 broadcast gate 撤廃** | ✅ odakin 実機 verify「大丈夫そう！」 = 両者凍結 flicker 消失確認 |
| [`742492f`](https://github.com/sogebu/LorentzArena/commit/742492f) | 16:13:31 | **DeadShipRenderer viewMode dispatch 追加** (= クラゲ等で死亡時 hull が classic ガンシップになる regression 修復) | ⏳ verify 待ち |
| [`dd9662e`](https://github.com/sogebu/LorentzArena/commit/dd9662e) | 16:20:14 | **RESPAWN_DELAY 10s→5s + PLC laser marker silver+killer 0.25 lerp tint** | ⏳ RESPAWN は verify 待ち |
| [`6ac7d60`](https://github.com/sogebu/LorentzArena/commit/6ac7d60) | 16:24:07 | **PLC tint 0.25 → 0.5** (= 0.25 は silver lightness + additive blending で wash out した観察を受けて 2x) | ✅ odakin「PLCスライスで見ると、 色がついて見える」 |
| [`ae6ccc6`](https://github.com/sogebu/LorentzArena/commit/ae6ccc6) | 16:28:00 | **時空図 laser marker も silver+killer 0.5 lerp tint に統一** | ⏳ verify 待ち |
| [`ab8f10a`](https://github.com/sogebu/LorentzArena/commit/ab8f10a) | 16:32:14 | **handleKill victimName cascade fallback** (= 「撃破エフェクトで njqn9au3k 等 ID 表示」 対応) | ⏳ verify 待ち。 ⚠️ 9-char ID は別表示経路の可能性、 cascade fix で改善されなければ追跡継続 |
| [`2ad7207`](https://github.com/sogebu/LorentzArena/commit/2ad7207) | 16:51:17 | **hit debris に killer 0.5 lerp tint 追加** + `mixColors` helper を [`threeCache.ts`](src/components/game/threeCache.ts) に新設 + handleDamage test 3 case を新挙動に update | ⏳ verify 待ち |

**deploy 直後 transient (= F1 無関係)**: 5/16 16 時台に「繋がっては切れ + 両者ホスト」 を odakin 観察、 **共著者 (= 安田くん) 側 NordVPN 経由の NAT path 不整合** が原因と切り分け済 (= VPN 除去で復旧)。 設計議論は [`design/network-recovery.md §軸 9`](design/network-recovery.md) + 実装 plan は [`plans/2026-05-16-vpn-multi-tier-fallback.md`](plans/2026-05-16-vpn-multi-tier-fallback.md)。

## 次セッション持ち越し (= 未 verify / 検討中 / 未解決)

1. **実機 visual verify** (= odakin、 7 commit 中 5 件分): クラゲ死亡時 hull / RESPAWN 5sec 体感 / 時空図 marker tint / 撃破エフェクト名前 / hit debris killer tint
2. **「njqn9au3k」 9-char ID 表示の真因特定** (= cascade fix で改善されなければ別表示経路を追跡、 ControlPanel.resolveName / Overlays.tsx 周辺の grep)
3. **Jellyfish hull dead state での触手挙動** (= dead = thrust 0 / alpha4 未渡しで Verlet rope tentacles が「だらりと垂れる」 想定だが未検証)
4. **F1 残 flicker (= role swap) の長時間 verify**: F1 で mutual freeze は構造的解消、 hysteresis 2.0 で role swap も多くは吸収、 close-quarter 境界で残り flicker があるか long session test 必要
5. **VPN 経由接続の multi-tier fallback 実装** (= [`plans/2026-05-16-vpn-multi-tier-fallback.md`](plans/2026-05-16-vpn-multi-tier-fallback.md))。 安田くん次回 play で fix 確認したい優先度
6. **lerp 比率の微調整余地** (= PLC + spacetime marker 0.5 / hit debris 0.5)、 過剰なら 0.35-0.4 へ。 odakin 体感次第

### 5/16 batch §10 4 軸 sweep + confidence 境界

- **整合性**: 全 commit の docstring + SESSION.md + design docs 同期完了 ✓
- **無矛盾性**: F1 + 既存 Bug 14 (globalActive、 2026-05-06) は complementary 設計、 hit debris tint と 2026-04-21 universal silver design は段階的撤回 ✓
- **効率性**: 7 commit 全て typecheck + 285 test pass + build pass、 bundle GameSession +0.3 KB ✓
- **安全性**: dynamic visual verify は全件 odakin 実機依頼 (= [Claude Preview 不可](CLAUDE.md)) ✓
- **Confidence**: High = code-level correctness、 F1 user verified / Medium = 残 6 commit visual / Low = 9-char anomaly 真因 / Unknown = VPN multi-tier fallback 効果

## 直近 plan + deploy 系譜 (= 全 deploy 済、 詳細は git log + plans/)

- **2026-05-16** F1 mutual-freeze + viz polish 7 commits (= 上 table)
- **2026-05-07** PLC スライス全面リッチ化 + viewMode broadcast ([`2ffdfbc`](https://github.com/sogebu/LorentzArena/commit/2ffdfbc), build `13:24:38`): PLC slice mode で flatten 済 3D ship model 群表示、 PLC 2D = 3D scene の真上 ortho、 viewMode broadcast 拡張、 i18n 全面整理、 副次 = claude-config [`conventions/ui-toggle-convention.md`](../claude-config/conventions/ui-toggle-convention.md) 新設 + work-discipline §同一語の意味取り違え防止 + [`design/meta-principles.md M44-M47`](design/meta-principles.md) + [`design/rendering.md §PLC slice flattenT 折り畳み`](design/rendering.md)
- **2026-05-07** snapshot rejoin host push refactor ([`plans/2026-05-06-snapshot-rejoin-host-push.md`](plans/2026-05-06-snapshot-rejoin-host-push.md), build `10:16:59`): self trigger 撤回 + `shouldPushSnapshotOnConnection` pure helper 時間軸拡張、 280 test pass
- **2026-05-06** Bug 14 完全治療 + implicit Euler refactor ([`plans/2026-05-06-bug14-global-active-time.md`](plans/2026-05-06-bug14-global-active-time.md), build `15:52:19`): globalActive clock semantic + semi-implicit Euler closed-form 1 step + selfActive broadcast schema、 274 test pass
- **2026-05-06** NPC 非対称 causality + spawn formula 整備 ([`plans/2026-05-06-npc-asymmetric-causality.md`](plans/2026-05-06-npc-asymmetric-causality.md)): `isNpc(p)` skip 統一 + `(min+max)/2` → `sum/N` mean formula + `RelativisticPlayer.kind` type field、 263 test pass
- **2026-05-05** Bug 11 fully decommissioned + Rule B exit margin (`ad52130`): 4 軸対称性 architecture 完璧、 sleep-wake production verify ✅
- **2026-05-04** Bug 10 5 layer chain 真因 fix: virtualPos lastSync + mount storm + pastConeFallback + myDeathEvent decomposition、 meta-principles M25-28 抽出
- **2026-05-02** 因果律対称化 Stage 1-8 ([`plans/2026-05-02-causality-symmetric-jump.md`](plans/2026-05-02-causality-symmetric-jump.md)): 旧 `minPlayerT` LH jump → Rule B、 alive 自機にも Rule B 毎 tick
- **2026-04-28** 共変表現徹底 + 後 join 永遠凍結 fix (`3ba639a` spawn `(min+max)/2`) + PBC torus 隠し化 + ARENA_RADIUS 20→40

完了 plan 一覧:
- [`2026-05-02-causality-symmetric-jump`](plans/2026-05-02-causality-symmetric-jump.md), [`2026-05-04-virtualpos-lastsync-rca`](plans/2026-05-04-virtualpos-lastsync-rca.md), [`2026-05-04-mydeathevent-decomposition`](plans/2026-05-04-mydeathevent-decomposition.md), [`2026-05-04-isdead-decomposition`](plans/2026-05-04-isdead-decomposition.md), [`2026-05-05-debrisrenderer-gc-fix`](plans/2026-05-05-debrisrenderer-gc-fix.md), [`2026-05-05-depth-aware-cleanup`](plans/2026-05-05-depth-aware-cleanup.md), [`2026-05-05-lh-self-overlap-z-fight`](plans/2026-05-05-lh-self-overlap-z-fight.md), [`2026-05-06-bug14-global-active-time`](plans/2026-05-06-bug14-global-active-time.md), [`2026-05-06-snapshot-rejoin-host-push`](plans/2026-05-06-snapshot-rejoin-host-push.md), [`2026-05-06-npc-asymmetric-causality`](plans/2026-05-06-npc-asymmetric-causality.md)

## Bug ledger (= 残存 open のみ、 完了 ✅ は git log + DESIGN.md へ)

| # | bug | 状態 | メモ |
|---|---|---|---|
| 1 | 死後 ghost 時間発展せず | あとで | Bug 10 と統合解消見込み、 ghost camera WASD non-routing は DevTools console focus 由来 false alarm 仮説、 canvas click で要再検証 |
| 2 | OtherShip flicker | あとで | Bug 10 共通根因 (rAF starve) 疑、 root 撃滅後再評価 |
| 9 | 新規 join 即凍結 | 構造的 mitigation (実機検証待ち) | Rule B convergence で freeze 永続回避、 残 race は spawn 直後 spatial 配置依存 |
| 10 | 全世界凍結 + 星屑停止 | 🟢 主症状 ✅ confirmed | 5 layer chain (5/4) + DebrisRenderer GC (5/5) で撃滅、 残: 5+ 分 plays + 死亡中 stardust 最終確認 |
| 14 | Background tab で physics runaway | ✅ 完全治療 + odakin localhost verify 済 | mobile overnight 実機 verify (= live capture 経路 再現 test) 残 |

完了済 Bug 5/6/7/8/11/12/13 は [DESIGN.md](DESIGN.md) + git log。 詳細 RCA / treatment は各 plan 参照。

## 設計思想 (永続化)

- **共変表現の徹底**: 内部表現は共変量 (`phaseSpace.u: Vector3` = γv が正本)、 ut=γ は必要時のみ `sqrt(1+|u|²)` で給与
- **`pos.t` は per-player coord time**: `dτ = wall_dt` は意図的設計、 `pos.t = γ * wall_clock` で player 間 lag が累積するのは仕様 ([`design/physics.md`](design/physics.md))
- **「実体は (0,0) cell に閉じる」**: PBC torus universe で全ての物理量は (0,0) cell 内、 universal cover の他 image cells は描画コピー
- **self-authoritative pattern**: state 計算 (= ballistic 復帰位置) は本人 client が行い broadcast、 host 側で再計算しない
- **Rule A / Rule B 対称設計**: Rule A (= 凍結) + Rule B (= 因果律ジャンプ) は mirror image、 各々 boundary 振動防止の hysteresis (= A) / exit margin (= B) を持つ ([DESIGN.md §因果律対称化](DESIGN.md))

## 次にやること

### 「遠くに行って戻れない」 問題 (4/28〜、 onboarding 課題)

実機テストプレイヤーが事故的に遠出 → 戻れず迷子化を頻出観察。 詳細 subproblem / 選択肢 / un-defer trigger は [`EXPLORING.md §「遠くに行って戻れない」 問題`](EXPLORING.md)。

**着手済**: spawn / arena 中心原点統一 (`bbce03f`) + (1a) HUD CenterCompass 中心方向矢印 + 距離 (`08944d3`) + (1b) Radar 中心 past-cone marker (`7a12ddf`)

**未着手**: 1. (1a)+(1b) の実機評価 → 帰れない事例残存なら次へ / 2. 中心方向 thrust 燃料優遇 or soft pull (EXPLORING.md §2) / 3. ARENA_RADIUS 縮小 (40→15-20) は UX 改善後評価

### defer 中

- **JellyfishShipRenderer per-frame TubeGeometry rebuild**: 未着手、 trigger = Jellyfish 利用者で GPU 圧 / Context Lost 累積、 修正方針 = TubeGeometry attribute pre-allocate + in-place 更新 (1-2h)
- **DebrisRenderer の `explosionSegments` / `hitSegments` CPU 配列毎 render 再生成**: 同 pre-allocate ref pattern で fix 可能、 優先度低
- **DESIGN.md 残存設計臭 #2**: PeerProvider Phase 1 effect コールバックネスト
- **snapshot に `frozenWorldLines` / `debrisRecords` 同梱**: un-defer trigger = リスポーン世界線連続観測時
- **host migration の LH 時刻 anchor 見直し**
- **色調をポップで明るく** (方向性未定)
- **スマホ横画面 Phase 2**: in-game HUD landscape 最適化 (Speedometer 縦長 / ControlPanel↓Radar overlap 等)。 Phase 1 (orientation 両対応 + fullscreen 試行) は 5/4 deploy 済
- **ballistic 軌跡 frozenWorldLines 描画**: 死から復帰までの世界線連続性、 odakin defer 判断 4/28
- **逆 bug 疑い**: 高 γ host から見て新 joiner が close-spatial に着地して **host が freeze** する race
- **Phase 2 PBC torus 復活時**: universal cover refactor の他 phase (ship / worldLine / debris / laser renderer) も observer-centered minimum image folding pattern で統一するか議論 ([`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md))

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)

詳細 [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### パフォーマンス

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰
