# SESSION.md — LorentzArena 2+1

最終更新: 2026-05-26 棚卸し (= 5/16 7-commit deploy + active verify queue + open bugs のみ保持、 完了 bug + 過去 plan narrative は git log / plans/ / DESIGN.md へ defer、 `claude-config/CONVENTIONS.md §3` 80 行目安に追従)

> 📦 移した節 (5/16 batch の commit 表と 4 軸 sweep、 直近 plan + deploy 系譜、 「遠くに行って戻れない」 問題の着手済の commit) = [SESSION-archive.md](SESSION-archive.md) (verbatim)。

## 現在のステータス

**本番最新 deploy**: 2026-05-16 build `16:51:17 JST` **5/16 多 commit batch** — 1 セッション内で 7 commits を deploy、 F1 mutual-freeze 修復 + 当日小修正群 + visual polish。 chronological order の commit 表 (各 commit の verify 状態を含む) = [SESSION-archive.md](SESSION-archive.md#deploy-batch-table)。

**deploy 直後 transient (= F1 無関係)**: 5/16 16 時台に「繋がっては切れ + 両者ホスト」 を odakin 観察、 **テスト相手側の VPN 経由の NAT path 不整合** が原因と切り分け済 (= VPN 除去で復旧)。 設計議論は [`design/network-recovery.md §軸 9`](design/network-recovery.md) + 実装 plan は [`plans/2026-05-16-vpn-multi-tier-fallback.md`](plans/2026-05-16-vpn-multi-tier-fallback.md)。

## 次セッション持ち越し (= 未 verify / 検討中 / 未解決)

1. **実機 visual verify** (= odakin、 7 commit 中 5 件分): クラゲ死亡時 hull / RESPAWN 5sec 体感 / 時空図 marker tint / 撃破エフェクト名前 / hit debris killer tint
2. **「njqn9au3k」 9-char ID 表示の真因特定** (= cascade fix で改善されなければ別表示経路を追跡、 ControlPanel.resolveName / Overlays.tsx 周辺の grep)
3. **Jellyfish hull dead state での触手挙動** (= dead = thrust 0 / alpha4 未渡しで Verlet rope tentacles が「だらりと垂れる」 想定だが未検証)
4. **F1 残 flicker (= role swap) の長時間 verify**: F1 で mutual freeze は構造的解消、 hysteresis 2.0 で role swap も多くは吸収、 close-quarter 境界で残り flicker があるか long session test 必要
5. **VPN 経由接続の multi-tier fallback 実装** (= [`plans/2026-05-16-vpn-multi-tier-fallback.md`](plans/2026-05-16-vpn-multi-tier-fallback.md))。 テスト相手の次回 play で fix 確認したい優先度
6. **lerp 比率の微調整余地** (= PLC + spacetime marker 0.5 / hit debris 0.5)、 過剰なら 0.35-0.4 へ。 odakin 体感次第

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

**着手済**: spawn / arena 中心原点統一 + (1a) HUD CenterCompass 中心方向矢印 + 距離 + (1b) Radar 中心 past-cone marker (commit = [SESSION-archive.md](SESSION-archive.md#far-away-started-commits))

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
