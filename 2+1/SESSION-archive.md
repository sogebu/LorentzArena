# SESSION-archive — LorentzArena 2+1

> 📦 SESSION.md から移した節 (grep 専用、 verbatim)。 現在地は SESSION.md。

## SESSION.md から verbatim MOVE (形の契約 = 案件ごとの現在地、 層1 claude-config/CONVENTIONS.md#session-no-durable-record)

### <a id="deploy-batch-table"></a>「現在のステータス」 の commit 表 (元の行 = 本番最新 deploy の直後)

元の行: **本番最新 deploy**: 2026-05-16 build `16:51:17 JST` **5/16 多 commit batch** — 1 セッション内で 7 commits を deploy、 F1 mutual-freeze 修復 + 当日小修正群 + visual polish。 chronological order:

| commit | build | 内容 | status |
|---|---|---|---|
| [`996ac44`](https://github.com/sogebu/LorentzArena/commit/996ac44) | 15:53:27 | **F1 mutual-freeze 防止 broadcast gate 撤廃** | ✅ odakin 実機 verify「大丈夫そう！」 = 両者凍結 flicker 消失確認 |
| [`742492f`](https://github.com/sogebu/LorentzArena/commit/742492f) | 16:13:31 | **DeadShipRenderer viewMode dispatch 追加** (= クラゲ等で死亡時 hull が classic ガンシップになる regression 修復) | ⏳ verify 待ち |
| [`dd9662e`](https://github.com/sogebu/LorentzArena/commit/dd9662e) | 16:20:14 | **RESPAWN_DELAY 10s→5s + PLC laser marker silver+killer 0.25 lerp tint** | ⏳ RESPAWN は verify 待ち |
| [`6ac7d60`](https://github.com/sogebu/LorentzArena/commit/6ac7d60) | 16:24:07 | **PLC tint 0.25 → 0.5** (= 0.25 は silver lightness + additive blending で wash out した観察を受けて 2x) | ✅ odakin「PLCスライスで見ると、 色がついて見える」 |
| [`ae6ccc6`](https://github.com/sogebu/LorentzArena/commit/ae6ccc6) | 16:28:00 | **時空図 laser marker も silver+killer 0.5 lerp tint に統一** | ⏳ verify 待ち |
| [`ab8f10a`](https://github.com/sogebu/LorentzArena/commit/ab8f10a) | 16:32:14 | **handleKill victimName cascade fallback** (= 「撃破エフェクトで njqn9au3k 等 ID 表示」 対応) | ⏳ verify 待ち。 ⚠️ 9-char ID は別表示経路の可能性、 cascade fix で改善されなければ追跡継続 |
| [`2ad7207`](https://github.com/sogebu/LorentzArena/commit/2ad7207) | 16:51:17 | **hit debris に killer 0.5 lerp tint 追加** + `mixColors` helper を [`threeCache.ts`](src/components/game/threeCache.ts) に新設 + handleDamage test 3 case を新挙動に update | ⏳ verify 待ち |

### 5/16 batch §10 4 軸 sweep + confidence 境界

- **整合性**: 全 commit の docstring + SESSION.md + design docs 同期完了 ✓
- **無矛盾性**: F1 + 既存 Bug 14 (globalActive、 2026-05-06) は complementary 設計、 hit debris tint と 2026-04-21 universal silver design は段階的撤回 ✓
- **効率性**: 7 commit 全て typecheck + 285 test pass + build pass、 bundle GameSession +0.3 KB ✓
- **安全性**: dynamic visual verify は全件 odakin 実機依頼 (= [Claude Preview 不可](CLAUDE.md)) ✓
- **Confidence**: High = code-level correctness、 F1 user verified / Medium = 残 6 commit visual / Low = 9-char anomaly 真因 / Unknown = VPN multi-tier fallback 効果

## 直近 plan + deploy 系譜 (= 全 deploy 済、 詳細は git log + plans/)

- **2026-05-16** F1 mutual-freeze + viz polish 7 commits (= 上 table)
- **2026-05-07** PLC スライス全面リッチ化 + viewMode broadcast ([`2ffdfbc`](https://github.com/sogebu/LorentzArena/commit/2ffdfbc), build `13:24:38`): PLC slice mode で flatten 済 3D ship model 群表示、 PLC 2D = 3D scene の真上 ortho、 viewMode broadcast 拡張、 i18n 全面整理、 副次 = claude-config [`conventions/ui-toggle-convention.md`](../../claude-config/conventions/ui-toggle-convention.md) 新設 + work-discipline §同一語の意味取り違え防止 + [`design/meta-principles.md M44-M47`](design/meta-principles.md) + [`design/rendering.md §PLC slice flattenT 折り畳み`](design/rendering.md)
- **2026-05-07** snapshot rejoin host push refactor ([`plans/2026-05-06-snapshot-rejoin-host-push.md`](plans/2026-05-06-snapshot-rejoin-host-push.md), build `10:16:59`): self trigger 撤回 + `shouldPushSnapshotOnConnection` pure helper 時間軸拡張、 280 test pass
- **2026-05-06** Bug 14 完全治療 + implicit Euler refactor ([`plans/2026-05-06-bug14-global-active-time.md`](plans/2026-05-06-bug14-global-active-time.md), build `15:52:19`): globalActive clock semantic + semi-implicit Euler closed-form 1 step + selfActive broadcast schema、 274 test pass
- **2026-05-06** NPC 非対称 causality + spawn formula 整備 ([`plans/2026-05-06-npc-asymmetric-causality.md`](plans/2026-05-06-npc-asymmetric-causality.md)): `isNpc(p)` skip 統一 + `(min+max)/2` → `sum/N` mean formula + `RelativisticPlayer.kind` type field、 263 test pass
- **2026-05-05** Bug 11 fully decommissioned + Rule B exit margin (`ad52130`): 4 軸対称性 architecture 完璧、 sleep-wake production verify ✅
- **2026-05-04** Bug 10 5 layer chain 真因 fix: virtualPos lastSync + mount storm + pastConeFallback + myDeathEvent decomposition、 meta-principles M25-28 抽出
- **2026-05-02** 因果律対称化 Stage 1-8 ([`plans/2026-05-02-causality-symmetric-jump.md`](plans/2026-05-02-causality-symmetric-jump.md)): 旧 `minPlayerT` LH jump → Rule B、 alive 自機にも Rule B 毎 tick
- **2026-04-28** 共変表現徹底 + 後 join 永遠凍結 fix (`3ba639a` spawn `(min+max)/2`) + PBC torus 隠し化 + ARENA_RADIUS 20→40

完了 plan 一覧:
- [`2026-05-02-causality-symmetric-jump`](plans/2026-05-02-causality-symmetric-jump.md), [`2026-05-04-virtualpos-lastsync-rca`](plans/2026-05-04-virtualpos-lastsync-rca.md), [`2026-05-04-mydeathevent-decomposition`](plans/2026-05-04-mydeathevent-decomposition.md), [`2026-05-04-isdead-decomposition`](plans/2026-05-04-isdead-decomposition.md), [`2026-05-05-debrisrenderer-gc-fix`](plans/2026-05-05-debrisrenderer-gc-fix.md), [`2026-05-05-depth-aware-cleanup`](plans/2026-05-05-depth-aware-cleanup.md), [`2026-05-05-lh-self-overlap-z-fight`](plans/2026-05-05-lh-self-overlap-z-fight.md), [`2026-05-06-bug14-global-active-time`](plans/2026-05-06-bug14-global-active-time.md), [`2026-05-06-snapshot-rejoin-host-push`](plans/2026-05-06-snapshot-rejoin-host-push.md), [`2026-05-06-npc-asymmetric-causality`](plans/2026-05-06-npc-asymmetric-causality.md)

### <a id="far-away-started-commits"></a>「遠くに行って戻れない」 問題の着手済 (元の行)

**着手済**: spawn / arena 中心原点統一 (`bbce03f`) + (1a) HUD CenterCompass 中心方向矢印 + 距離 (`08944d3`) + (1b) Radar 中心 past-cone marker (`7a12ddf`)
