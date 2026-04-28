# SESSION.md — LorentzArena 2+1

## 現在のステータス

**本番デプロイ済**: `bbce03f` (build `2026/04/28 21:50:37 JST`、 https://sogebu.github.io/LorentzArena/)。 main は origin と同期。

**2026-04-28 セッションの大物 fix 群** (詳細 git log):
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

### defer 中
- DESIGN.md 残存する設計臭 #2 (PeerProvider Phase 1 effect コールバックネスト)
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応
- **ballistic 軌跡 frozenWorldLines 描画** — 死から復帰までの世界線連続性、 odakin defer 判断 2026-04-28
- **spawn time が「ホストよりずっと未来」 になって既存 client が軒並み凍結する逆 bug 疑い** —
  2026-04-28 spawn time を `(min+max)/2` 中間に変更 (= 後 join client 永遠凍結 fix) したが、
  逆に高 γ host から見て新 joiner が過去側 (close-spatial) に来ると **host が freeze** する
  race が起こり得る。 typical な spatial spread (random spawn within `[0, SPAWN_RANGE]²` =
  10) より `(max-min)/2` lag が大きい場面で顕在化。 実機検証 + 顕在化したら spawn 位置を
  既存 player から `LCH` 以上離す等の追加対策検討

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

**未着手 (推奨順、 効果 / 工数の見積りも EXPLORING.md)**:
1. **HUD 中心方向矢印 + radar center dot** (= 物理に手を入れず即効、 計 2-3h)
2. 1 で帰れない事例が残れば → 中心方向 thrust 燃料優遇 or soft pull
3. 枠半幅 `ARENA_RADIUS = 40` の縮小 (40 → 15-20) は UX 改善後に効果評価して判断

### 実機検証待ち (2026-04-28 セッション全 fix)

3+ tab multi-player で:
- 後 join client 永遠凍結 が `3ba639a` の spawn 時刻 (min+max)/2 中間化で治癒したか
- 逆 bug 疑い: 高 γ host から見て新 joiner が close-spatial に着地して **host が freeze** する race (SESSION 「defer 中」 参照)
- spawn ring / 撃破 / 燃料消費 / Causal Freeze overlay / debris 等の通常 multiplay flow
- **`bbce03f` 後の spawn 位置 / 枠位置**: 原点中心 spawn `[-5, +5)²`、 正方形枠 `[-40, +40]²` で挙動確認

### Phase 2 議論 (PBC torus 復活時に再着手)

PBC torus は隠しオプション化中。 復活時は universal cover refactor の他 phase (ship / worldLine / debris / laser renderer) も observer-centered minimum image folding pattern で統一するか議論。 詳細 [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md)。
