# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`17363bd` デプロイ済** (build `2026/04/22 07:25:50 JST`)。本番: https://sogebu.github.io/LorentzArena/

**2026-04-22 の主要進捗**:
1. **死亡 event 表示を (x_D, u_D, τ_0) 統一アルゴリズムに刷新** — DEBRIS_MAX_LAMBDA linear fade + ad-hoc ring anchor を全廃、`W_D(τ) = x_D + u_D·τ` と観測者過去光円錐の交点 τ_0 で全描画 (DeathMarker / DeadShipRenderer / LH) を駆動 (`8c019e3`)。DeathMarker が「出ない / 固まる」regression は構造的に解消。
2. **瞬時消失バグ解消** — 死亡瞬間に ship モデルが消え小 sphere に置換される問題。pre-death 期は OtherShipRenderer (live worldLine past-cone 交点) で routing、past-cone 到達後は DeadShipRenderer (ship モデル @ x_D で opacity fade) で routing (`bbae2b7` + `8c019e3`)。
3. **他機 worldLine 未来側末端 sphere 復活** — 3d1831d の ship-model 移行で消えていた「世界時刻 now 位置のドット」を復活 (pedagogical marker、ship との空間ずれ = 光速遅延の可視化、`17363bd`)。
4. **inner-hide 半径 9 → 4.5 に半減** — 光円錐・世界線共用、gun 時代より機体が slim なので半径は小さくてよいとの判断 (`17363bd`)。
5. **レーザー砲 v2 設計 (未 commit)** — gun とは別 design の「chin pod 一体型」レーザー砲。ShipViewer の Cannon プルダウンで gun/laser 切替可能。ゲーム側は default 'gun' で既存挙動保持。

**未 commit (WIP)**: 砲 design iterate の途中。完成したら commit + deploy 予定。詳細は末尾「## 未 commit WIP / 次セッション申し送り」参照。

## 本日 (2026-04-22) の主要 entry

`17363bd` **他機 worldLine 未来側末端 sphere 復活 + 光円錐/世界線 inner-hide 半径半減**: `3d1831d` で消失した「他機の世界時刻 now 位置」sphere (phaseSpace.pos に配置、playerSphere × PLAYER_MARKER_SIZE_OTHER、main + glow ×1.8 の 2 mesh) を復活、3d1831d 以前の alive-branch 仕様と完全一致 (color/opacity/depthWrite まで)。ship 3D model (past-cone 交点) と新 sphere (世界時刻 now) の空間ずれが光速遅延の教育的可視化。ついでに `SHIP_INNER_HIDE_RADIUS_COEFFICIENT` を 9 → 4.5 に半減、光円錐・世界線共用 (分離する意味無しとの方針)。一時的に `SHIP_LIGHT_CONE_INNER_HIDE_RADIUS` を分離したが odakin 指示で再統合。

`8c019e3` **死亡 event を (x_D, u_D, τ_0) の統一アルゴリズムに刷新**: 旧実装 (DEBRIS_MAX_LAMBDA linear fade + ad-hoc ring anchor、DeathMarker が出ない/固まる regression 含む) を全廃、以下に統一。
- **中核** ([deathWorldLine.ts](src/components/game/deathWorldLine.ts)): 死者 extrapolated 世界線 `W_D(τ) = x_D + u_D·τ` と観測者過去光円錐の交点 τ_0 を二次方程式 `τ² − 2Bτ + C = 0` (B = Minkowski 内積 (+,-,-,-) of u_D and Δ、C = Minkowski norm² of Δ、Δ = observer − x_D) で解く helper `pastLightConeIntersectionDeathWorldLine`。過去側解は `B − √(B²−C)`。τ_0 < 0 は past-cone 未到達、null は discriminant 負 (spacelike 分離、防御的)。`deathWorldLine.test.ts` で stationary / ρ=5 / v=0.8c 含む 7 ケース検証。
- **表示窓** (constants.ts): `DEATH_TAU_MAX = 5` (body fade 完了)、`DEATH_TAU_EFFECT_MAX = 2` (sphere+ring 打ち切り)。単位は死者 proper time、高速死亡者ほど observer wall-clock で fade 窓が長引く (relativistic 不変)。
- **DeathMarker**: `{xD, uD, color}` 受取、内部で τ_0 計算、`τ_0 ∈ [0, DEATH_TAU_EFFECT_MAX]` のみ on。sphere @ x_D (沈む)、ring @ `x_D + u_D·τ_0` (C pattern 並進)。
- **DeadShipRenderer** 新設: SelfShipRenderer を仮想 player (pos=x_D, heading=heading_D) で wrap、useFrame で group traverse + material.opacity 上書き (transparent=true + depthWrite=false) で **ship 全体に opacity fade** を適用。opacity = `(DEATH_TAU_MAX − τ_0) / DEATH_TAU_MAX`。OtherPlayerRenderer の小 sphere path は廃止 (「model is the ship」の odakin 指摘)。
- **LighthouseRenderer**: 同じ (x_D, u_D) path。生存中の spawn past-cone visibility のみ `computePastConeDisplayState` に残し、fade 分岐を削除。
- **SceneContent routing**: 死者 routing を τ_0 sign 駆動へ。`τ_0 < 0` → OtherShipRenderer (live 世界線の past-cone 交点で pre-death ship)、`τ_0 ∈ [0, DEATH_TAU_MAX]` → DeadShipRenderer + DeathMarker、`> DEATH_TAU_MAX` → null。self/other 統一 (`player.phaseSpace` から x_D/u_D/heading_D 導出、dead self の phaseSpace も自 broadcast 停止で凍結済)。
- **ghost 非 broadcast**: useGameLoop ghost branch の `fresh.setPlayers(... phaseSpace: ghostPs)` を削除。`players[myId].phaseSpace` は死亡時刻で凍結、観測者 frame (camera / past-cone / Radar / HUD) は `myDeathEvent.ghostPhaseSpace` に swap (SceneContent / Radar / HUD で同 pattern)。「他者から見える phaseSpace == worldline データ」= odakin の設計原則。
- **DeathEvent 型**: `pos, u, heading, ghostPhaseSpace` で死亡時 snapshot + 動的 ghost 分離。
- **`pastConeDisplay.ts` slimming**: 死亡 branch + alpha / deathMarkerAlpha を削除、生存 spawn past-cone visibility のみ残す。
- 設計 doc: `plans/死亡イベント.md` (odakin 原文)。

`bbae2b7` **kill 瞬間の相手消失を past-cone 遅延で延期 (暫定)**: `player.isDead` 即 switch → OtherShipRenderer を past-cone 未到達期 (pastConeT < deathT) に継続使用、到達後に OtherPlayerRenderer に routing。死亡光子が観測者に届くまで相手が「まだ生きて見える」ようにする暫定修正。`8c019e3` の統一アルゴリズムに吸収された (τ_0 < 0 で OtherShipRenderer、τ_0 ≥ 0 で DeadShipRenderer + DeathMarker)。

`d840a23` **過去光円錐 worldline マーカー廃止 + 世界線太さ/不透明度を灯台と統一**:
- 他プレイヤー世界線 × 自機過去光円錐 交点の sphere+core+ring gnomon (`worldLineIntersections`) を削除。視覚情報は同交点に描画される ship 3D model (`OtherShipRenderer`) と DeathMarker が既に担うので冗長。`PAST_CONE_WORLDLINE_RING_OPACITY` 定数 + `intersectionCore` geometry も退場 (ただし 17363bd で未来側末端 sphere 復活時に intersectionCore は不要になったので `17363bd` では playerSphere 系に統一)。
- `WorldLineRenderer` の default `tubeRadius` を 0.03 → 0.06 (= 灯台の override 値) に、SceneContent の LH-only override を撤去。`LIGHTHOUSE_WORLDLINE_OPACITY` 定数 (= PLAYER と同値 0.4) も退場。frozenWorldLines / 他機 / 自機 / 灯台すべてが `tubeRadius=0.06`, `tubeOpacity=0.4` で統一。

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

- **DeathMarker regression (2026-04-21 報告)**: `8c019e3` の統一アルゴリズム (x_D, u_D, τ_0) で構造的に解消したと推定。「出ないことがある」は `DEATH_TAU_EFFECT_MAX = 2` proper sec の窓で十分カバー、「固まる」は `players[myId].phaseSpace` ghost leak 停止で解消。実機 multi-tab 追試で最終確認予定。調査メモ [`plans/2026-04-21-deathmarker-regression.md`](plans/2026-04-21-deathmarker-regression.md) は歴史資料として保持。
- **リスポーン時に世界線が繋がる** (2026-04-14 Stage F-1 後再発): 最有力は F-1 snapshot で `frozenWorldLines` 未 serialize → respawn 時 `appendWorldLine` で連結。何 peer 視点で出るか未調査
- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラー stack (WS Relay 未設定時)
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

## 未 commit WIP / 次セッション申し送り

### 進行中: cannon design iterate

**gun**: 「銃として固定」状態 (sci-fi refine 適用後 odakin 合意版、`constants.ts` の SHIP_GUN_*):
- BARREL: R=**0.025**, L=**2.0** (旧 2.5 から 0.8x)
- TIP: R=**0.018** (旧 0.0125 → 太く)、L=**0.3** (旧 1.25 → 短い step に)
- BREECH: R=**0.08** (旧 0.075 → chunky)、L=**0.5**
- RING: R=**0.045** (旧 0.04)、L=**0.09** (旧 0.075)、COUNT=3
- MUZZLE_BRAKE: R=**0.04** (旧 0.025 → flared、BARREL/TIP より太く)、L=**0.2**
- BRACKET: tapered cone 0.05→0.02, H=0.55 (無変更)

iterate 経緯は SESSION.md の直前 session 部分参照 (BARREL/TIP length 調整を往復した後、odakin が「銃っぽくなくなった」指摘 → sci-fi refine で「銃として固定」合意)。gameplay 側は引き続き `cannonStyle='gun'` default で既存見た目保持。

**laser (v2、`LaserCannonRenderer.tsx`)**: 全く別 design として `cannonStyle='laser'` path に wire、ShipViewer のプルダウンで live 切替。**現在の構成** (`constants.ts` の SHIP_LASER_*):
- Chin pod (hull 底面の半埋没 ellipsoid、fore-aft 0.6 × lateral 0.26 × vertical 0.55) を bracket/pylon 代わりに設置。pod 下極が cannon mount、world origin を通る制約維持。
- Barrel (R=0.045, L=1.5) slender cylinder、pod から 45° 下前方。
- Crystal bulge (R=0.055, L=0.1) barrel 55% 位置、cyan emissive。
- Lens stack 3 段 nested torus (outer 0.068 → 0.046、emissive 0.6 → 1.5)、barrel 前端。
- Emitter disc (R=0.032, L=0.016) lens 最奥、bright cyan。

**v1 → v2 の iterate 経緯** (参考): v0 (sphere + casing + 2 torus cooling + cone + disc、2.3 長) → v1 (sci-fi ref: chunky capacitor + bands + coupling + fins + crystal + lens + emitter、3 部構成 mount: root fairing + oval pylon + collar) → **v1 は cannon が pylon に埋もれる問題で却下** → v2 (chin pod 一体型、cannon は slender barrel のみ、pod が power pack 機能を吸収) で odakin 合意。詳細 history は [`plans/2026-04-22-laser-cannon.md`](plans/2026-04-22-laser-cannon.md)。

**cannonStyle prop アーキテクチャ**:
- `SelfShipRenderer` に `cannonStyle?: 'gun' | 'laser'` prop 追加 (default 'gun')。
- gun の既存 JSX ブロック (bracket + cannon group + parts) は条件分岐で温存、`cannonStyle === 'laser'` なら `<LaserCannonRenderer />` 単独 render。
- `ShipPreview` → `ShipViewer` に prop 通し、ShipViewer で `<select>` toggle。
- ゲーム本体 (SceneContent の SelfShipRenderer 呼出し) は prop 未指定 → default 'gun' で既存挙動。

**uncommitted files** (2026-04-22 session 終了時点):
- `2+1/src/components/game/constants.ts` (gun tuning + laser v2 constants + inner-hide 再統合)
- `2+1/src/components/game/LightConeRenderer.tsx` (inner-hide 再統合、SHIP_LIGHT_CONE_INNER_HIDE_RADIUS → SHIP_INNER_HIDE_RADIUS に戻し)
- `2+1/src/components/game/SelfShipRenderer.tsx` (cannonStyle prop + LaserCannonRenderer import + 条件分岐)
- `2+1/src/components/ShipPreview.tsx` (cannonStyle prop 通し)
- `2+1/src/components/ShipViewer.tsx` (Cannon toggle UI 追加、default 'laser')
- **新規**: `2+1/src/components/game/LaserCannonRenderer.tsx`
- **新規**: [`2+1/plans/2026-04-22-laser-cannon.md`](plans/2026-04-22-laser-cannon.md) (v0/v1/v2 iterate 経緯 + cannonStyle architecture + 残課題)

### 次セッション冒頭でやること

1. **レーザー砲 v2 の視覚的確認完了判断**: http://localhost:5174/LorentzArena/#viewer または本番 `#viewer` で最終確認、odakin OK なら commit + deploy。commit メッセージ案: `feat(laser-cannon): cannonStyle prop + v2 chin pod 一体型デザイン新設` 等。
2. **ゲーム本体で laser を default にするか判断**: 現状 `cannonStyle='gun'` default。将来的に `cannonStyle='laser'` で本番移行するか、player の選択性にするか、本番ビルドでは laser でプレイ、など方針決定が必要。
3. **DeathMarker regression 最終検証**: multi-tab 実機で「出ない / 固まる」が `8c019e3` 以降発生しないか odakin に確認依頼。解決確認後 [`plans/2026-04-21-deathmarker-regression.md`](plans/2026-04-21-deathmarker-regression.md) を「closed」として末尾に status 追記。
4. **他の「次にやること」**: 以下。

## 次にやること

- **自機・他機 ship にプレイヤー色を埋め込む**: hull 材質が固定 navy (`SHIP_HULL_*`
  定数) なので自機/他機ともに識別手がかりが薄い。accent stripe / fin / turret emissive
  など、モデルのデザインのどこかに player color を load する material variant が必要。
  自機側の色は他機視点 (= OtherShipRenderer は SelfShipRenderer 流用) で初めて意味を
  持つので、SelfShipRenderer に color prop を通す設計で揃える。
- **Phase B-5 (他機 exhaust) 再設計**: `phaseSpace.alpha = thrust + friction` が
  thrust 単独信号でないため、他機への ship 3D model exhaust 展開は pure thrust を
  新 wire field で broadcast する必要あり。別 plan 起こし時に対応。
- **Phase C-1 (wire format 厳格化)**: 新 build (heading/alpha 送信) のみの混在期間
  確認後、受信 optional → required に厳格化して shim を削除。タイミングは
  `plans/2026-04-21-phaseSpace-heading-accel.md` 参照。
- **本番実戦観察**: 死亡 event 統一アルゴリズム + future-pt sphere + inner-hide 半減
  がデプロイ済。multi-tab 本番テストで regression / UX 確認。
- **進行方向可視化 分岐 B/C**: sphere + heading-dart (案 14) / star aberration skybox (案 16)、default frame 選択。詳細: `EXPLORING.md §進行方向・向きの認知支援`
- **フルチュートリアル** (必須、初見 UX、B3 とは別)
- 各プレイヤー固有時刻表示 / スマホ UI 残 / 用語再考 / 音楽の時間同期
- **レーザー以外の世界線 × 未来光円錐の表示**: 現 sphere 0.15 + ring 0.12 薄い、opacity 上げ or gnomon/pulse 昇格
- **DeathMarker ring を (x_D0, u_D) 静止系で描画** (Stage 2、2026-04-22 統一アルゴリズム): 現在 C pattern 並進のみ。きっちりやると u_D 方向に contracted な楕円 (= 進行方向に潰れた ring、relativistic apparent shape)。`buildApparentShapeMatrix` 相当の ring 版が必要。
