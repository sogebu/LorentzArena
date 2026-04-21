# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`43a33b6` デプロイ済** (build `2026/04/21 23:50:10 JST`)。本番: https://sogebu.github.io/LorentzArena/
(ただし `43a33b6` (revert) は pushed のみで本番 deploy は `cf5b262` 時刻、コード的に同義)。

**Phase A (PhaseSpace 拡張) + Phase B (renderer 移行) 完了**。PhaseSpace を `(pos, u, heading, alpha)` に拡張して network 配管、他機も ship 3D model (SelfShipRenderer 流用) で past-cone 交点に描画。debris / laser past-cone marker 色を universal 化。**2026-04-22 未 commit**: 過去光円錐 worldline マーカー廃止 + 世界線太さ/不透明度を灯台 (0.06 / 0.4) と統一。**未解決 regression: DeathMarker が出ないことがある + sphere sinking 設計通りに動かない報告** (`plans/2026-04-21-deathmarker-regression.md` に引継ぎメモ)。

## 本日 (2026-04-22) の主要 entry

**死亡 event 表示を (x_D, u_D, τ_0) の統一アルゴリズムに刷新** (odakin 設計、未 commit): 旧実装 (DEBRIS_MAX_LAMBDA linear fade + ad-hoc ring anchor、DeathMarker が出ない/固まる regression 含む) を全廃、以下に統一。
- **中核** ([deathWorldLine.ts](src/components/game/deathWorldLine.ts), 116/116 tests pass): 死者の extrapolated 世界線 `W_D(τ) = x_D + u_D·τ` と観測者過去光円錐の交点 τ_0 を二次方程式 `τ² − 2Bτ + C = 0` (B/C = Minkowski 内積/ノルム²) で解く helper `pastLightConeIntersectionDeathWorldLine`。過去側解は `B − √(B²−C)`。τ_0 < 0 は past-cone 未到達、null は spacelike 分離 (防御的)。
- **表示窓** (constants.ts): `DEATH_TAU_MAX = 5` (body fade 完了)、`DEATH_TAU_EFFECT_MAX = 2` (sphere+ring 打ち切り)。単位は死者 proper time、高速死亡者ほど observer wall-clock で fade 窓が長引く (relativistic 不変)。
- **DeathMarker**: `{xD, uD, color}` 受取、内部で τ_0 計算、`τ_0 ∈ [0, DEATH_TAU_EFFECT_MAX]` のみ on (flash 演出)。sphere @ x_D (沈む)、ring @ `x_D + u_D·τ_0` (C pattern 並進)。静止系 ring は Stage 2 で再検討 (今は C pattern のまま)。
- **OtherPlayerRenderer**: body sphere @ x_D (固定、沈む)、opacity = `a_0·(DEATH_TAU_MAX − τ_0) / DEATH_TAU_MAX`。他者は `player.phaseSpace.{pos,u}` (死亡時刻 freeze)、自機は SceneContent から `myDeathEvent.{pos,u}` を override で注入。
- **LighthouseRenderer**: 同じ (x_D, u_D) path。生存中の spawn past-cone visibility のみ `computePastConeDisplayState` に残し、fade 分岐を削除。
- **SceneContent routing**: 死者 routing を τ_0 sign 駆動へ。`τ_0 < 0` → OtherShipRenderer (live 世界線の past-cone 交点で pre-death ship)、`τ_0 ∈ [0, DEATH_TAU_MAX]` → OtherPlayerRenderer、`> DEATH_TAU_MAX` → null。自機は observer swap `myPlayer.phaseSpace ← myDeathEvent.ghostPhaseSpace` で ghost を追従。
- **ghost 非 broadcast**: useGameLoop ghost branch の `fresh.setPlayers(... phaseSpace: ghostPs)` を削除。`players[myId].phaseSpace` は死亡時刻で凍結されたまま (= 他者 snapshot と同値、host に ghost 位置がリークしない)。観測者 frame (camera / past-cone / Radar / HUD) は `myDeathEvent.ghostPhaseSpace` に swap (SceneContent / Radar / HUD で同 pattern)。
- **debris 無変更**: user 指示「デブリやレーザー煙は昔の実装から何も変える必要はない」に従い、昨日の DebrisRenderer past-cone gate は revert 済。debris 粒子寿命 `DEBRIS_MAX_LAMBDA` は DeathMarker 窓と完全分離、debris 専用定数に降格。
- **`pastConeDisplay.ts` slimming**: 死亡 branch + alpha / deathMarkerAlpha フィールドを削除、生存 spawn past-cone visibility のみを残す (`anchorPos` + `visible` の 2 フィールド)。
- **typecheck + 116/116 tests pass**、Claude Preview clean reload。設計提案: `plans/死亡イベント.md` (odakin 原文)。

**過去光円錐 worldline マーカー廃止 + 世界線太さ/不透明度を灯台と統一** (odakin 指定、未 commit):
- 他プレイヤー世界線 × 自機過去光円錐 交点の sphere+core+ring gnomon (`worldLineIntersections`)
  を削除。視覚情報は同交点に描画される ship 3D model (`OtherShipRenderer`) と DeathMarker
  が既に担うので冗長。`PAST_CONE_WORLDLINE_RING_OPACITY` 定数 + `intersectionCore` geometry
  も退場。レーザー過去光円錐マーカー / 世界線 × 未来光円錐 gnomon は残置 (別用途)。
- `WorldLineRenderer` の default `tubeRadius` を 0.03 → 0.06 (= 灯台の override 値) に、
  SceneContent の LH-only override (`{tubeRadius: 0.06, tubeOpacity: LIGHTHOUSE_WORLDLINE_OPACITY}`)
  を撤去。`LIGHTHOUSE_WORLDLINE_OPACITY` 定数 (= 0.4 で `PLAYER_WORLDLINE_OPACITY` と同値だった)
  も退場。frozenWorldLines / 他機 / 自機 / 灯台すべてが `tubeRadius=0.06`, `tubeOpacity=0.4`
  で統一。typecheck + 109/109 tests pass。

## 本日 (2026-04-21) の主要 entry

`43a33b6` **誤った DeathMarker 修正を revert**: odakin 報告「DeathMarker が出ないことがある」を sphere の past-cone anchor 化で解決できると誤読した `f494986` を revert。sphere が sink する設計 (world event の t で fixed) は意図通りで、実際の regression 原因は未特定。調査メモ: `plans/2026-04-21-deathmarker-regression.md`。仮説 1-4 (myDeathEvent.pos 意図せず更新 / snapshot が dead phaseSpace 上書き / DEBRIS_MAX_LAMBDA が短すぎる / routing 副作用) を次セッションで検証。

`cf5b262` **EXPLOSION_DEBRIS_COLOR を明るく**: 初版 `hsl(15, 8%, 65%)` (lightness 65%) が暗宇宙背景に埋もれて「死亡エフェクト出ない」報告 → `hsl(25, 25%, 82%)` (lightness 82% + warm ember tint) に。hit smoke (`hsl(40, 12%, 80%)`) より明るく、死が dramatic に出るよう調整。

`5fae0be` **debris smoke + laser past-cone marker を universal 色に**: odakin 指定の UI 整理。(1) `HIT_DEBRIS_COLOR` (warm silver、fresh spark) + `EXPLOSION_DEBRIS_COLOR` (warm ember、重い死煙) で hit / explosion 別に universal 化、per-player 色廃止。(2) レーザー過去光円錐マーカー (`laserIntersections` 三角) を `LASER_PAST_CONE_MARKER_COLOR = "hsl(210, 20%, 85%)"` (cool silver) に universal 化。未変更: world line 過去光円錐 gnomon (sphere+core+ring) / radar triangle / laser 未来光円錐 → 引き続き player 色。player 識別は HUD / kill log / 世界線 / radar で行う方針。handleDamage.test.ts 既存 3 ケースを universal constant 照合に rewrite。

`3d1831d` **他機を ship 3D model で描画 (OtherShipRenderer 新設)**: SelfShipRenderer を synthetic player (past-cone 交点の pos + heading) + synthetic thrustRef (alpha + FRICTION·u で thrust 単独を近似復元) でラップして他機にも流用。生存他機の render target を `OtherPlayerRenderer` (sphere + glow + 一時 nose/arrow) → `OtherShipRenderer` (ship model at past-cone 交点) に切替。OtherPlayerRenderer は死亡専用に縮小、B-3 nose indicator + B-4 AccelerationArrow を削除 (ship model に吸収)。lighting は既存 GameLights (灯台 past-cone 交点 position + `decay={0}`) を流用、他機 ship color 差別化は defer。

`b204295` **nose / 加速度矢印を past-cone 交点に**: odakin 指摘「他機の heading / alpha は光が届いた時点 (= past-cone 交点) の値を使うべき」の修正。`pastLightConeIntersectionWorldLine` が Phase A-4 の補間ロジックで交点位置の (pos, u, heading, alpha) を返すので、OtherPlayerRenderer の nose/arrow anchor を現在位置 → 交点位置に切替。sphere 本体は gameplay 視認性で現在位置のまま (sphere と nose/arrow の空間ずれ = 相対論的光遅延の educational 可視化)。3d1831d で OtherShipRenderer に吸収された。

`4a026d7` + `0865859` **Phase B-3 / B-4: OtherPlayerRenderer に nose indicator + AccelerationArrow を追加**: heading / alpha が cross-peer broadcast されることの visible proof として、sphere 外側に player 色の短い nose bar + display 方向に normalize した矢印。sphere だけの他機表現に方向情報を付与。3d1831d で ship 3D model 移行時に吸収・削除。

`f158faf` + `0ededd8` **Phase B-1 / B-2: apparent shape helper に heading 引数 + SelfShipRenderer の yaw source を phaseSpace.heading に**: (1) `buildApparentShapeMatrix` に `anchorHeading: Quaternion` 引数を追加、display xy plane 内で model 先に `R_q` (yaw 回転) → S (k=√2 x_∥^O stretch) の順に合成。LH は heading=identity で従来挙動と等価。(2) SelfShipRenderer の `cameraYawRef` 直読を `quatToYaw(player.phaseSpace.heading)` に置換、ShipPreview に `HeadingUpdater` helper (Canvas 内 useFrame) を追加して yawRef → stubPlayer.heading を同期。

`65ada08` + `fadedf3` + `f1299dc` + `2085790` **Phase A-1..A-4: PhaseSpace 拡張 + 配管**:
  - A-1 `2085790`: Quaternion helpers (`Quaternion` 型 + identity / yawToQuat / quatToYaw / multiplyQuat / slerpQuat / normalizeQuat / conjugateQuat) を vector.ts に、PhaseSpace を `(pos, u, heading, alpha)` に拡張、`createPhaseSpace` は default 引数 (identity / zero) で救済、`evolvePhaseSpace` は内部で既に計算していた world 4-加速度 `accel4World` を `alpha` に格納 + heading は transport。99/99 pass。
  - A-2 `f1299dc`: wire format に `heading?` / `alpha?` を optional 追加 (旧 build 互換)、`messageHandler` / `snapshot` で `parseOptionalQuaternion` / `parseOptionalAlpha` helper 経由で default 補完。build 側で default (identity/zero) は wire 省略で帯域節約。104/104 pass。
  - A-3 `fadedf3`: 自機 heading source を `cameraYawRef` に固定、gameLoop の 3 経路 (ballistic catchup / alive tick / ghost tick) で `yawToQuat(cameraYaw)` を newPhaseSpace に上書き。
  - A-4 `65ada08`: `pastLightConeIntersectionWorldLine` / future 版 / Linear reference の 4 箇所で `interpolateSegmentPhaseSpace(prev, curr, tParam, interpPos)` 新 helper 経由に統一、heading は slerp、alpha は linear 補間で交点の PhaseSpace を返す。106/106 pass。

**Phase B-5 (他機 exhaust) は defer** (`plans/2026-04-21-phaseSpace-heading-accel.md` 参照): 自機 exhaust は thrust 単独を `thrustAccelRef` に持つが `phaseSpace.alpha = thrust + friction` で semantic 一致しない。他機への展開は thrust 単独を broadcast する新 field 追加が必要で、別 plan (他機 ship 3D model 導入時) に退避。B-4 の AccelerationArrow が alpha 方向を既に可視化済なので現状の視覚情報価値は B-1..B-4 範囲で十分。Phase C (旧 ref 撤去) は B-2 で cameraYawRef の ship 向き用途が除去済、残り Phase C-1 (wire optional → required) は混在期間確認後に。

`dc758db` **apparent-shape 2 本 plan + rendering.md + SESSION.md 整備**: `1933908` の全面書き換えで散らかった plan (v1/v4 + 実装更新) を再構成、odakin 原案 M matrix 提案を `plans/2026-04-21-ship-apparent-shape-M-matrix.md` に復元 (`4b1017c` の 284 行を git から書き戻し)。

`f0e6627` **apparent-shape を M pattern に刷新**: odakin spec「底面は O 静止系時間軸に垂直 (display xy plane に flat)、塔軸は `L(uO)·L(−uA)·(0,0,1)` 方向 (= A の 4-velocity を O 静止系で観た向き)」+ ship 対応 generic 化。`(anchorPos, anchorU, observerPos, displayMatrix)` signature。LH phaseSpace.u=0 で従来挙動と numerically 一致、ship 拡張は call site 変更なしでそのまま載る設計。

## 以前の主要 entry

`fe365ad` **PeerProvider top-level helpers を `peer-helpers.ts` に分離** (未 deploy、本番は `1b9e743` のまま): 1,379 LOC まで累積した PeerProvider.tsx を pure file move で組織化。抽出対象は `NetworkManager` 型 + 8 helper (type guards / appendToJoinRegistry / registerPeerOrderListener / registerHostRelay / transferLighthouseOwnership / performDemotion / discoverBeaconHolder)、いずれも self-contained。component-specific な types (ActiveTransport / ConnectionPhase / PeerContextValue) + timing constants (policy として useEffect が参照) + PeerProvider 本体は残留。`NetworkManager` は consumer (useGameLoop / useSnapshotRetry) 互換維持のため `export type { NetworkManager };` で PeerProvider 経由でも import 可。PeerProvider.tsx: 1,379 → 1,125 LOC (-18%)、peer-helpers.ts: 294 LOC 新規。責任分離: React component logic ↔ pure network/state helpers がファイル境界で明示。typecheck + Vitest 58/58 pass。

`f93eb37` **PeerProvider 思想対称性 refactor** (未 deploy、本番は `1b9e743` のまま): Stage 1/1.5/2/3 + audit 足し算後のコード対称性を odakin 要請で review、2 つの DRY 違反を helper 化。(1) `transferLighthouseOwnership(newOwnerId)` を抽出 — `assumeHostRole` (駆動権取得) と `performDemotion` (放出) で同一だった LH.ownerId 更新 loop を集約、対称操作がコード対称で書ける。(2) `discoverBeaconHolder({...callbacks})` を抽出 — `demoteToClient` (beacon-acquire) と Stage 2 `runProbe` で structurally 同一だった「使い捨て probe PM lifecycle」を統合、内部 `done` flag で late callback の one-shot semantics を保証。旧外部 stale guard (`probePm !== pm` 3 箇所) を helper 内部に吸収。performDemotion doc に assumeHostRole との対称操作表 markdown を追加。pure refactor、動作変化無し、typecheck + 58/58 pass。

`8add53d` **dead code 削除 + Stage 3 audit round 3 記録**: Stage 3 実装直後に 15+ candidate を系統的に深掘り検証、新規 critical bug 無しを確認。軽微な trade-off (4+ peer 遅延 joiner で ghost 収束 ~40s、pre-Stage 3 の永久残留よりは大幅改善、完全解消には `recentlyRemovedRef` plumbing 必要で defer) のみ。副産物として pre-existing dead code 発見 (`useStaleDetection.cleanupDisconnected` + `purgeDisconnected` が外部呼び出し無し) → 削除 (-20 LOC)。詳細は plan §Stage 3 audit round 3。

`1b9e743` **Stage 3 stale player GC + snapshot.ts lastUpdate refresh 条件化** (症状 4 残存分 + Bug X resurrection 対策): freeze(5s) + GC(15s) = 計 20s 無通信で removePlayer。client は star topology で他 peer 切断を検知できず、Stage 1.5 local 保護と合わせて切断 peer が永久存続する (Bug X) を解消。audit で Stage 3 を **単独で無効化する critical bug** を発見し同時修正: `applySnapshot` §163 が毎回全 entry の lastUpdate を refresh → 他 peer 保持分の snapshot で disconnected peer の stale 時計が永久リセットされていた。修正: 新規追加 (`!store.players.has(sp.id)`) のみ lastUpdate を初期化、既存 entry は phaseSpace (強い生存信号) だけが refresh。useStaleDetection に `staleFrozenAtRef` + `STALE_GC_THRESHOLD=15000` 追加、`checkStale` を `() => string[]` 化、useGameLoop 側で `removePlayer` + `cleanupPeer` を実行。drift prune で外部 ad-hoc delete との desync を self-heal。58/58 pass。

`305d779` + `13ebd64` + `235900f` + `f8a4589` **Stage 2 host self-verification probe + audit 4 件 fix** (症状 1 = host split 対策): tab-hidden 復帰の ~1s 窓で PeerServer race により両 peer が BH と信じる split-brain を能動検出・自動解消する。使い捨て `probe-*` PeerManager で `la-{roomName}` に接続 → redirect で realHostId 取得 → myId と比較、split なら `performDemotion` 共通 helper で末端処理 (redirect broadcast → clearBeaconHolder → reconnect → **LH ownership 移譲** → roleVersion bump)。主 trigger = initial probe on mount + visibilitychange→visible、副 trigger = 30s setInterval、timeout 8s で false-positive demote 回避。設計詳細 + audit で発見した 4 bug (初回 probe 欠落 / stale callback race / self-demote guard / **LH 二重駆動 catastrophic pre-existing**) の post-mortem は `plans/2026-04-20-multiplayer-state-bugs.md §Stage 2 実装記録`。Vitest 58/58 pass。

`c9503a4` + `76ba182` **Stage 1.5 peer 貢献 snapshot + audit fix**: 全 peer が 5s 周期で snapshot 送信、BH が union-merge して enriched snapshot を再配信。高頻度 (phaseSpace=star) / 低頻度 (snapshot=peer 貢献) で通信形態を分ける。`getIsBeaconHolder()` guard 1 行撤去で実現。BH 帯域 O(N) 維持、BH missed event を他 peer 観測から自動救済。深掘り audit で発見した critical bug (client 送信時の `buildSnapshot` が LH.ownerId を自分に rewrite → BH merge で LH 所有権汚染 → BH の LH AI 沈黙) を `76ba182` で fix (`isBeaconHolder` 引数追加)。58/58 pass。

`55401f4` **Stage 1 bug audit fix**: snapshot 適用で local-only player (local store にあるが snapshot に含まれない entry) が setState で捨てられる race bug を修正。`nextPlayers` に local-only entry を移植するだけで復旧。test 1 件追加、56/56 pass。

`4ef4fca` **Stage 1 周期 snapshot broadcast**: beacon holder が 5 秒ごとに全 peer へ `buildSnapshot` を送信、受信側は `applySnapshot` の isMigrationPath 分岐で **log union-merge + isDead 再導出 + scores 保持** 適用。missed respawn で isDead 貼り付きでも次 snapshot で自動救済。4 files +285/-16、Vitest 55/55。

`c49ce40` **hidden 復帰 clock drift → ballistic catchup**: `useGameLoop.ts:134` で `document.hidden` 中 `lastTimeRef` を fresh に保っていたのを止め、復帰時 first tick の大 dTau を `ballisticCatchupPhaseSpace` (thrust=0、friction のみ、STEP=0.1s sub-step) で吸収。worldLine は `freeze + 1 点 reset` で clean 切断、catchup 後の phaseSpace を network 通知。scope 外: LH AI catchup (host hidden 中 LH pause 受け入れ) / ghost 経路 (特殊)。test 5 件新規、51/51 pass。

`0066399` **症状 5 → grace period 付き peer removal**: 切断 peer 削除を `PEER_REMOVAL_GRACE_MS = 3000ms` の `setTimeout` に、再接続で `clearTimeout` キャンセル。`useStaleDetection.cleanupPeer(id)` helper 追加 (stale refs 一括 purge)、unmount cleanup 追加。副次効果として上記 hidden drift を可視化、`c49ce40` で独立解消。

`e9171c4` **症状 3 再発 → intro unicast 再送**: `RelativisticGame.tsx` で connection watcher (`prevConnectionIdsRef` diff) で新規接続 peer に unicast intro 再送、A→B/B→A 接続順序非依存に。beacon holder の broadcast forward (`registerHostRelay`) と組合せで全員が全員の displayName を保持。

`2be56b4` **症状 3 (displayName) 初版**: displayNames reactive state 昇格、ControlPanel で 4 段 fallback (players → displayNames → killLog.victimName → id.slice)、applySnapshot は local/remote merge。

`8ce595f` **症状 2 (respawn 消失)**: LH / 他機 dead branch の spawnT を `worldLine.history[0]?.pos.t` から `respawnTime.ts §getLatestSpawnT` 経由に。gap-reset (WORLDLINE_GAP_THRESHOLD_MS 超過) で `worldLine` が fresh 置換されても spawnT が jump up しない。

## 完了済みリファクタ (歴史記録、詳細は `git log` / `design/*.md` / plans/)

**2026-04-20 朝〜夕**: 自機 SelfShipRenderer (deadpan SF、D 系 asymmetric belly-turret) + ShipViewer `#viewer`、死亡 past-cone 共通化 (`pastConeDisplay` / `DeathMarker` / `OtherPlayerRenderer`)、Inner-hide shader (observer past-cone 交点 center)、Ghost 燃料制約撤去、cannon/機体 redesign + `GameLights` 共通化、Stardust ortho 対応、世界系 time fade 統一 (`buildDisplayMatrix` world frame に時間並進)、HUD/Lobby 微調整、マルチプレイバグ A/B/5 + hidden drift 解消

**2026-04-18〜19**: Phase C1 (damage-based death / energy pool / post-hit i-frame) / Phase C2 (Radar / 灯台 3D 塔モデル / 6 発死) / host migration 対称性 5 点 / opacity 再チューン / LH post-hit i-frame 共通化 / build infra (typecheck 分離 + pre-existing 13 errors 解消) / spawn/respawn 経路統合 / i18n JA / Brave Shields 対応

**2026-04-17**: ghost 物理統合、アリーナ円柱、光円錐交差 O(log N+K) + Vitest、Exhaust v0、Lorentzian time fade、時空星屑 N=40000、Temporal GC、スマホ pitch 廃止

**2026-04-13〜16**: Zustand 移行、MAX_DELTA_TAU 撤廃、D pattern 化、Spawn 座標時刻統一、Thrust energy、Authority 解体 Stage A〜H、光円錐 wireframe

## 既知の課題

### マルチプレイ state バグ 5 点

| # | 症状 | 状態 |
|---|---|---|
| 1 | host split (両 peer が自分を host と認識) | **修正済 `305d779`** (Stage 2 自動解消) |
| 2 | 他 player respawn 消失 | **修正済 `8ce595f`** |
| 3 | 撃破数リストに peer ID prefix | **修正済 `2be56b4` + `e9171c4`** |
| 4 | ghost 張り付き (missed respawn → isDead 貼り付き) | **修正済** (Stage 1 `4ef4fca` + 1.5 `c9503a4` 自動救済 + Stage 3 `1b9e743` stale GC で残存パスも解消) |
| 5 | migration & タブ復帰で相手消失 | **修正済 `0066399`** |

共通根因: **transient event delivery 失敗 = state 恒久 divergence**。reconciliation 機構が構造的に欠けていた。Stage 1 で周期 snapshot broadcast を追加 → 次 snapshot で自動再同期。Stage 2/3 (host self-verification + stale GC) は plan に段階設計。案 C (playerName primary key) は Stage 1-3 後も残存する UX 課題のみなので defer。

### defer 中

- DESIGN.md 残存する設計臭 #2
- PeerProvider Phase 1 effect のコールバックネスト
- アリーナ円柱の周期的境界条件 (トーラス化) — un-defer: 壁閉じ込め希望 / ARENA_HEIGHT > LCH
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応 — landscape orientation 前提で HUD / touch UI / viewport を再配置。fullscreen API でアドレスバー / ホームインジケータ退避、safe-area-inset で notch 回避。現状は縦画面前提で横にすると HUD が潰れる

### パフォーマンス

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰 (二分探索化で余力あり)

### 低優先リスク / 未検証

- **DeathMarker が出ないことがある + sphere sinking 設計通り動かない (odakin 報告、未解決、最優先)**: 調査メモ
  [`plans/2026-04-21-deathmarker-regression.md`](plans/2026-04-21-deathmarker-regression.md)。
  仮説 4 つ (myDeathEvent.pos 不意の更新 / snapshot が dead phaseSpace 上書き /
  `DEBRIS_MAX_LAMBDA=2.5s` の窓が短い / 生存→死亡 routing の副作用) を次セッション
  で実機再現して eliminate する順序を記載。誤 fix `f494986` は `43a33b6` で revert 済。
- **リスポーン時に世界線が繋がる** (2026-04-14 Stage F-1 後再発): 最有力は F-1 snapshot で `frozenWorldLines` 未 serialize → respawn 時 `appendWorldLine` で連結。何 peer 視点で出るか未調査
- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラー stack (WS Relay 未設定時)
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

## 次にやること

- **(最優先) DeathMarker regression 解決**: 上記「低優先リスク / 未検証」の最上段、および
  [`plans/2026-04-21-deathmarker-regression.md`](plans/2026-04-21-deathmarker-regression.md) の仮説 1-4 を
  multi-tab 実機で順に eliminate。仮説 3 (DEATH_MARKER_LAMBDA 導入で窓長く) は quick win
  候補として先に試す価値あり (physics ではなく UX 改善)。
- **Phase B-5 (他機 exhaust) 再設計**: `phaseSpace.alpha = thrust + friction` が
  thrust 単独信号でないため、他機への ship 3D model exhaust 展開は pure thrust を
  新 wire field で broadcast する必要あり。別 plan 起こし時に対応。
- **Phase C-1 (wire format 厳格化)**: 新 build (heading/alpha 送信) のみの混在期間
  確認後、受信 optional → required に厳格化して shim を削除。タイミングは
  `plans/2026-04-21-phaseSpace-heading-accel.md` 参照。
- **自機・他機 ship にプレイヤー色を埋め込む**: hull 材質が固定 navy (`SHIP_HULL_*`
  定数) なので自機/他機ともに識別手がかりが薄い。accent stripe / fin / turret emissive
  など、モデルのデザインのどこかに player color を load する material variant が必要。
  自機側の色は他機視点 (= OtherShipRenderer は SelfShipRenderer 流用) で初めて意味を
  持つので、SelfShipRenderer に color prop を通す設計で揃える。
- **本番実戦観察**: 多機能が 1 日で入ったので (Phase A + B + color + ship model)、
  multi-tab 本番テストで regression 探索と UX 確認。DeathMarker 調査はその一環。
- **進行方向可視化 分岐 B/C**: sphere + heading-dart (案 14) / star aberration skybox (案 16)、default frame 選択。詳細: `EXPLORING.md §進行方向・向きの認知支援`
- **フルチュートリアル** (必須、初見 UX、B3 とは別)
- 各プレイヤー固有時刻表示 / スマホ UI 残 / 用語再考 / 音楽の時間同期
- **レーザー以外の世界線 × 未来光円錐の表示**: 現 sphere 0.15 + ring 0.12 薄い、opacity 上げ or gnomon/pulse 昇格
