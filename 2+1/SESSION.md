# SESSION.md — LorentzArena 2+1

## 現在のステータス

**本番最新 deploy**: `df98bb4` (build `2026/05/02 16:22:07 JST`、 https://sogebu.github.io/LorentzArena/、 安田くんと 2-player demo 用途)。 main は origin と同期。
deploy 後の追加 commit (= localhost only、 push 済 / deploy 未): `75aaae8` (test 追従) + `c7f7960` (Bug 7 fix)。 次回 deploy 時にまとめて反映。

**2026-05-02 セッション** (時系列 commit、 build 値 / 影響範囲付き):

1. `f573b20` **viewMode / controlScheme 2 段 dropdown 復活** — Lobby (START の下) + HUD ControlPanel (in-arena 左上) の 2 ヶ所、 e6c17cc で hidden オプション化していたものを CLAUDE.md 設計通り復活。 Lobby 背景の ShipPreview を `viewMode` 連動化 (= 安田くん demo で「見た目」 を即時切替できる)。 i18n に `viewMode.label` / `viewMode.jellyfish` / `controlScheme.{label,legacy_classic,legacy_shooter,modern}` 追加。 URL hash + LS 永続化は併存。
2. `e27b9ea` **jellyfish 機体の 2 bug fix** — (a) Bug 3: `alpha4` 加速度矢印が出てなかった (props 宣言だけ destructure 無しの TODO 残存) → RocketShipRenderer 同等仕様で sibling mesh 配置。 (b) Bug 4: legacy_classic で触手の振れる方向が逆 (= dropdown 復活で combo 到達可能になり顕在化)、 `thrustAccelRef.current` を world frame と認識せず machine local 仮定していた → `group.rotation.z` で R(-θ) 適用、 全 controlScheme で正しく動く。
3. `054a595` **window.__game diagnostic helper** — Bug 1 (ghost freeze) 調査用、 dev console から `__game.getState().myDeathEvent.ghostPhaseSpace.{u,pos}` で観察可能。 prod でも有効、 secrets 無し、 perf 影響 0、 調査終了後削除予定。
4. `0e18fc9` **LASER_WORLDLINE_OPACITY 0.4 → 0.2** — odakin 指示、 demo 視認性。
5. `df98bb4` **ENERGY 消費 1/10** — `ENERGY_PER_SHOT` 1/30 → 1/300、 `THRUST_ENERGY_RATE` 1/9 → 1/90 (= 90 秒で枯渇)。 `ENERGY_RECOVERY_RATE` 据え置き (= 撃 / 推いずれもしてない時の 6 秒で 0 → 満タン)。
6. `75aaae8` **ballisticCatchup test 追従** — df98bb4 で THRUST_ENERGY_RATE 変更により dτ=30 では枯渇しないため dτ=100 に拡張 (= 90 秒 thrust + 10 秒 friction 単独)。
7. `c7f7960` **Bug 7 fix: past-cone marker の isDead filter 除去 (因果律違反修復)** — `worldLineMarkerEntries` useMemo で `if (player.isDead) continue;` が past-cone marker と future marker の両方を一気に skip していた。 past-cone marker は **観測者本人の過去光円錐 ∩ worldLine** で gate されるべき causal hint で death event が past cone 到達前なら表示継続が正解。 future marker (= world-now god view) のみ isDead で skip。 PLC slice mode の past-cone disc も同 useMemo を使うので同時修復。

**5/2 セッション後半 (= 安田くん退場後の autonomous 作業)**:

8. `099e072` / `25b5ded` SESSION.md を 5/2 セッションの全 commit + Bug ledger で正規化、 Bug 1 (ghost freeze) の最有力仮説を「DevTools console focus による WASD non-routing (= false alarm)」 に更新。
9. `bedae12` ShipViewer の `<a href="#">` を `href="./"` に置き換え (= biome useValidAnchor a11y error 解消)。 `#` は a11y anti-pattern + App.tsx に hashchange listener なし → reload 経由が動作的にも正解。
10. `7a12ddf` **Radar に arena 中心 (= 原点) past-cone marker 追加** (EXPLORING.md §1b)。 観測者の過去光円錐 ∩ {(t, 0, 0): t ∈ ℝ} の交点 = `(obs.t − |obs.xy|, 0, 0)` を projectEvent で投影、 半径 3 の白丸 + cross "+" で表示。 torus mode は subVector4Torus で最短画像 origin に折り畳み。 「上方向に行けば帰れる」 が一目で読める。
11. `08944d3` **HUD CenterCompass 追加** (EXPLORING.md §1a)。 画面上中央に SVG chevron + 距離 (m)、 自機 cameraYaw 基準で原点方向の screen-space angle を計算し CSS rotate に渡す。 modern (cameraYaw=0) / legacy (cameraYaw=heading) いずれも screen 「上」 = 自機の前方として動作。 死亡中は ghost phaseSpace で観測者位置取得。 1m 以内は arrow hide で「● 中心」 表示。 (1b) radar dot と相補的に onboarding fix を完成。

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
| 1 | 死後 ghost が時間発展しない (= 「死後硬直」、 WASD 効かないが arrow keys は効く、 他機は普通に未来へ動く、 自機は時空間で固まる) | **調査中 (false alarm 疑い濃)** | `054a595` で `window.__game` 診断 helper 設置済 (= `__game.getState().myDeathEvent.ghostPhaseSpace.{u,pos}` 観察可)。 cold-read で setMyDeathEvent / processPlayerPhysics の chain は正しく動くはず。 host migration thrashing (= console に `Host heartbeat timeout` ↔ `Becoming solo host` ↔ `split detected — demoting self` の cycling) と同時発生してたが、 PeerProvider の `performDemotion` は `setPeerManager` を呼ばないので useGameLoop deps `[peerManager, myId]` は発火しない (= gameLoop は thrashing で停止しない)。 **最有力仮説**: DevTools console に focus がある状態で WASD 押下 → `useKeyboardInput` の `window.addEventListener("keydown")` は console input が consume するため keysPressed に届かない、 一方 arrow keys は canvas focus 時に試した可能性。 demo 中 user が pasting / typing で console focus 持ってた状態と整合。 確証取るには実 browser で **canvas を一度 click してから** WASD を試してもらう |
| 2 | 相手機が見えたり見えなくなったり (flicker) | **あとで** | 4/28 sweep 以降に regression。 OtherShipRenderer / past-cone intersection / universal cover refactor 周辺の疑い。 Bug 1 と共通根因 (pos.t 比較不安定) の可能性 |
| 5 | 灯台の時刻ジャンプ — user 仮説 「クライアント含めたいちばん未来側 ではなく ホストだけの時刻に飛んでる」 | **あとで (設計判断)** | `processLighthouseAI` (gameLoop.ts:347-367) は **`minPlayerT`** に jump する仕様 (cb9fa10 以降不変、 コメントは「一番過去にいる生存プレイヤー」)。 多人数で host が静止 + client が動いた場面で host.t < client.t → minPlayerT = host.t、 LH は host time に jump。 user 観察と一致。 fix は **意図が `minPlayerT` か `maxPlayerT` か** の設計判断、 user input 待ち |
| 6 | PLC スライス 3D で こちらに飛んでくる弾がゆっくり見える (2D は正しい) | **あとで** | 3D 視点での visual artifact、 2D radar mode は正常 |
| 7 | 相手が死んだ瞬間 (kill event が past cone に到達する前) に描画消える | ✅ **fix 済 (`c7f7960`)** | `SceneContent.tsx` `worldLineMarkerEntries` の `isDead` filter が past-cone marker (causal) と future marker (god view) を区別してなかった。 past-cone marker は OtherShipRenderer 本体描画と同じ causal gate のみ、 future marker のみ isDead で skip に refactor |

### defer 中 (= 既存)
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
