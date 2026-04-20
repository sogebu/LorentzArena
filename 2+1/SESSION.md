# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`e9171c4` デプロイ済み** (build `2026/04/20 10:52:08 JST`)。本番 URL: https://sogebu.github.io/LorentzArena/

マルチプレイ state バグ: **A (症状 3) / B (症状 2)** を修正 + deploy 済。
A は初版 deploy 後に再発、**新規接続 peer への intro unicast 再送** (`e9171c4`) で
真の root cause を解消。**症状 5 (host migration & タブ復帰で相手が消える)** を
本番再観測して plan に追加、別セッションで調査。C (症状 1 + 4) も未着手。
詳細: ↓ 2026-04-20 昼 entry + `plans/2026-04-20-multiplayer-state-bugs.md`。

2026-04-20 昼 (症状 3 再発の真 root cause 修正 + 症状 5 追加観測) [`e9171c4`]:
- **症状 3 (peer ID prefix 露出) の真 root cause**: `RelativisticGame.tsx` の
  intro 発信は `onMessage` 登録時の 1 回 broadcast のみで、送信時点で開いている
  connection にしか届かない。**後から接続してきた peer には永久に届かない**ので
  displayNames map に entry が入らず、`2be56b4` の 4 段 fallback も拾えない。
  本番 deploy 後に odakin が screenshot で撃破数リスト `gv14dv:` を再観測して発覚。
- **fix**: `prevConnectionIdsRef` diff で検出した新規接続 peer に対し全 peer が
  自分の intro を unicast 再送。A→B / B→A 接続順序に依存しない双方向伝播。
  beacon holder の snapshot 送信路は new joiner 判定 (`!store.players.has`) 維持。
- **症状 5 (新規観測)**: host migration & タブ復帰した相手が 3D シーンから消える。
  接続設定 UI には「接続中」表示だが ship marker が消える。B fix では解決せず、
  別原因。plan 側に 3 候補列挙、別セッション。B' と合わせて追う。

2026-04-20 昼 (マルチプレイ state バグ A + B 修正):
- **症状 3 displayName 表示 (A)** [`2be56b4`]: `displayNames` Map を reactive state
  に昇格 (`setDisplayName` / `applySnapshot` を setState 経由で immutable 更新)。
  ControlPanel の score list name 解決を 4 段 fallback に
  (players → displayNames → killLog.victimName → id.slice(0, 6))。
  applySnapshot は local と snapshot を merge (snapshot 上書き + local-only 保持)
  で、reconnection で消えた旧 peerId → name が killLog の逆引きで残る。
- **症状 2 spawnT を respawnLog 経由に (B)** [`8ce595f`]: LighthouseRenderer /
  OtherPlayerRenderer の spawnT を `worldLine.history[0]?.pos.t` から
  `respawnTime.ts` の `getLatestSpawnT(respawnLog, player)` に差し替え。
  gap-reset (WORLDLINE_GAP_THRESHOLD_MS 超過 = host migration / tab 復帰) で
  `worldLine` が fresh に置換されても spawnT は jump up しない。respawnLog は
  handleSpawn 時のみ append で gap-reset では触らないので semantics に忠実。
- test: snapshot.test.ts に displayNames merge 回帰 1 件、respawnTime.test.ts を
  新規 4 件。**46/46 pass**、typecheck clean。

2026-04-20 (ゲーム内 HUD / Lobby 位置微調整):
- **Exhaust を worldline 上位描画**: 4 nozzle の outer/inner 両 mesh に `renderOrder={10}` + material
  に `depthTest={false}`。D pattern の worldline tube と重なっても煙が必ず上にレンダされる
  (additive blending の後勝ちで色足し合わせ)。従来は worldline が後段で書かれると煙が埋もれる
  ケースがあった。
- **Lobby 待機画面の船位置微調整**: container `top: -25vh → -22vh`。船を気持ち下げて、言語
  トグル (日本語 / English) の上に nozzle 先端が被らないように。title の上の空きスペースに
  hull + nozzles、title の右脇を cannon が通る構図。
- **「射撃中」テキスト位置**: Overlays の firing indicator `top: 46% → 42%`。自機が redesign で
  視認可能面積が増えて、従来の中央寄り配置だと HUD テキストと hull が重なるようになった。

2026-04-20 (灯台光源 + Lobby ship preview + ShipPreview 抽出):
- **光源を灯台に配置**: `GameLights` に `positions` prop 追加、SceneContent で各灯台の
  過去光円錐交差点 (= LighthouseRenderer が塔を置く位置) の display 座標を毎 frame 計算して
  渡す。複数灯台なら複数灯 (将来対応)、灯台ゼロ / 観測者未設定時は default static
  `(-5, -5, -5)` に fallback。`decay={0}` 維持 (遠近で明度変えたくなった時にここで調整)。
- **Lobby に自機 3D プレビュー背景**: ShipViewer の Canvas 部分を `ShipPreview.tsx` に切り出し、
  ShipViewer と Lobby で共有。Lobby は `top: -25vh, height: 100vh` で container を viewport 上に
  はみ出させ、canvas 幾何中央を 25vh 付近に → 船が title より上にレンダ (縮小なし、船自体の
  見た目は ShipViewer と同じ)。`pointerEvents: none` で input / button を塞がず、zIndex 0 で
  コンテンツ wrapper (zIndex 1) の下に敷く。
- **ShipPreview props**: `autoRotate` / `showGrid` / `bgColor` / `interactive` / `cameraPosition`
  / `cameraTarget` / `thrustAccelRef` / `cameraYawRef` を受け付け、ShipViewer の UI state を
  そのまま橋渡し。ShipPreview は GameLights を内部 import するので、ライティング変更は Lobby /
  ShipViewer / ゲーム本体の 3 箇所すべてに即時反映。

2026-04-20 (cannon / 機体 redesign + ライティング rig 共通化):
- **砲本体 1/2 相似スケール**: BARREL radius 0.035→0.025 / length 2.3→2.5 (実質原初 5.0 からは半分)、
  TIP radius 0.025→0.0125 / length 1.67→**1.25** (更に半分、細い部分だけの長さ指定)、
  BREECH radius 0.15→0.075 / length 0.5、RING radius 0.08→0.04 / length 0.075、
  MUZZLE radius 0.05→0.025 / length 0.2。合計砲軸長 ≈ 4.45。REAR_EXT は BREECH_LENGTH/2 で自動追従。
- **Bracket (支柱)**: RADIUS 0.04→0.02 (半分のまま)、HEIGHT 0.55 維持。新定数
  `SHIP_GUN_BRACKET_BASE_RADIUS = 0.05` を追加して hull 根元側を太くした **tapered 円錐台**
  (rotation [π/2,0,0] で cylinder local +Y が world +Z に回るため `radiusTop = BASE_RADIUS` が
  根元、`radiusBottom = BRACKET_RADIUS` が cannon mount 側)。
- **Nozzle throat disk**: 4 nozzle 各々の最奥 (inward、pylon 側) に `EXHAUST_INNER_COLOR` の
  meshBasicMaterial 発光円盤 (circleGeometry, THROAT_RADIUS, DoubleSide) を追加。「奥で燃えてる」
  見え方、ライト非依存で常時 full 輝度。
- **ライティング rig 統一 `GameLights.tsx`**: ゲーム本体 (SceneContent) と ShipViewer で共有。
  旧 (ambient 0.5 + pointLight intensity 1 / ShipViewer は 4 灯 studio rig) から、**単一
  pointLight (-5, -5, -5) intensity 4 `decay={0}`** の dramatic side-lit に統一。
  `decay={0}` 理由: three.js r155+ の pointLight は physically-correct inverse-square がデフォで、
  距離 ~8.66 だと intensity 2-4 程度では実効 0.03-0.05 で真っ暗になる (user feedback で判明)。
  rig parameter (位置・intensity・色) を `GameLights.tsx` 1 箇所で集中管理、ShipViewer での
  design iterate がそのままゲームと一致する。
- 関連 emissive: hull/nozzle/gun/bracket の SHIP_*_EMISSIVE_INTENSITY は 1/5 → 1/2 → 原初と
  ユーザーと対話しながら段階評価、最終的に原初値 (0.45 / 0.7 / 0.35 / 0.45 / 0.7) に復帰。
  ambient=0 + 単灯 rig との組合せで shadow 側にも emissive が乗って sci-fi グロウ感残し、
  lit 側は強光でコントラスト確保。

以下は過去エントリ。

2026-04-20 (Stardust ortho 可視化、投影独立な point size):

2026-04-20 (世界系 time fade 統一):
- **`buildDisplayMatrix` / `transformEventForDisplay` の world frame 分岐に時間並進を導入**
  (`T(0, 0, -observer.t)`、空間 xy は world 保持)。旧 identity 返しでは shader vertex z が
  絶対 world t になり観測者.t 進行で全 D pattern 要素 (stardust / arena / worldlines / debris /
  lasers) が一律に薄くなっていた問題を解消。新実装で shader z = Δt → rest frame と fade 挙動一致。
- 空間まで含めて rest 対称 (`event - observer`) にする案は camera rig 変更が必要になるため
  見送り、最小差分で fade 問題のみ解決 (camera は `transformEventForDisplay(observer.pos, ...)`
  が返す値を target にしているため、時間並進だけで自動的に targetT=0 となり camera z が
  constant に収束)。
- 3+1 拡張時の負債は増えない: time fade shader 自体が「display z = 時間軸」という 2+1 固有
  設計に依存しており、3+1 ではどのみち別 attribute / uniform で Δt を渡す方式に書き直しが
  必要。今の修正は 2+1 semantics の首尾一貫性回復にとどまる。
- 詳細: `design/rendering.md §時空星屑 world frame fade`、`src/components/game/displayTransform.ts` docstring。
- 検証: typecheck clean、41/41 tests pass、preview_eval で数値検証 (world frame で観測者 t=100,
  event t=110 → dp.t=10, xy 素通し、matrix translation z=-100)。視覚は localhost で odakin 確認済 (perspective
  世界系で fade 挙動が rest frame と一致、時間経過で全 D pattern 要素が薄くなる旧バグ解消)。

2026-04-20 (Stardust ortho 可視化、投影独立な point size):
- 世界系 fade 修正後、ortho モードで stardust が映らないことが顕在化。原因は three.js PointsMaterial の
  sizeAttenuation が perspective でしか `gl_PointSize *= scale/-mvPos.z` を掛けず ortho は素通し →
  `STARDUST_SIZE = 0.04` がそのまま pixels になり不可視 (pre-existing bug、従来は world frame fade が
  stardust を元々薄くしていたため目立ってなかった)。
- 修正: `stardustShader.ts` で両モード統一の pixels-per-world-unit 計算。
  - perspective: `scale / -mvPos.z` (従来式、三者距離減衰)
  - orthographic: `scale * projectionMatrix[1][1]` (= zoom、depth 非依存)
  どちらも `scale = canvas_height/2` を基準に投影行列 1 成分から導出、意味論的に同一。魔法定数なし
  (初版 `ORTHO_POINT_BOOST = 40` の hardcode は「対称性が低くて美しくない」指摘で再設計)。
- three.js の perspective 分岐は我が code で既に処理するので、`.replace()` で元の
  `if (isPerspective) gl_PointSize *= ...` を空文字に置換して二重乗算を防止。canvas resize / ortho
  zoom 変更に自動追従。

2026-04-20 朝 (workflow 知見、design/ への永続化):
- 本セッションの設計知見を `design/rendering.md` (SelfShipRenderer / Inner-hide shader / 死亡 past-cone エフェクト共通化) と `design/state-ui.md` (Ghost 燃料制約撤去 + Speedometer ghost 非表示) に集約。SESSION.md の対応 entry は historical record として残置 (autocompact 後も design/ side で findable)。
- **Deploy 前に `pkill -f "vite"` で background dev server を殺さない** ことを `2+1/CLAUDE.md` に明文化。`pnpm run deploy` (= vite build → gh-pages) は dev server に依存せず、`pkill` は background task を SIGTERM (exit 143) で殺して harness が「Background command 'Restart dev server' failed」通知を出す原因になる。動作無害だが notification noise。今後は dev server 触らず deploy。
- **ShipViewer (`#viewer` hash)** ルートを `2+1/CLAUDE.md` に明文化。AVG drei 誤検知事件と three native OrbitControls 直 import 経緯も記録。

2026-04-20 朝 (敵世界線も inner-hide 対象に拡張):
- `WorldLineRenderer` の hide center を旧「最終 vertex (= player の現在世界位置)」から
  **観測者の過去光円錐との交差点** (`pastLightConeIntersectionWorldLine(wl, observerPos)`)
  に変更。これは gnomon マーカーが描画される位置 = 観測者が「今見ている」spacetime 点。
- `innerHideShader.ts`: `createInnerHideShader(radius, centerWorld: Vector3)` に汎用化、
  Vector3 ref を受け取り useFrame で in-place 更新 (uniform auto sync)。
- `LightConeRenderer` (= self): hide center を observer.pos に毎 frame 同期。
- `WorldLineRenderer` (= 全 worldline): hide center を past-cone intersection に毎 frame 同期。
- `SceneContent`: 全 worldline (生存中: 自機 / 他機 / LH、凍結) に `innerHideRadius` を渡す。
  LH は `LH_INNER_HIDE_RADIUS = SHIP_HULL_RADIUS × 2.5 = 0.8` (機体 2.88 の 1/3.6)、
  他は `SHIP_INNER_HIDE_RADIUS = 2.88`。

2026-04-20 朝 (HUD 微調整): Ghost 中 (= 自機死亡中) に Speedometer の energy bar を非表示
(`{!player.isDead && (...)}` で wrap)。Ghost は燃料制約なしで常時フル加速できるため、
バー表示は意味なし → 視覚 noise 削減。

2026-04-20 朝 (死亡 past-cone エフェクト共通化 + 自機本体周辺 inner-hide + ghost 燃料制約撤去):

**死亡 past-cone エフェクト共通化** (LH に準拠して全プレイヤーに展開):
- 新 `pastConeDisplay.ts` の `computePastConeDisplayState(playerPos, spawnT, isDead, observerPos)`:
  past-cone surface anchor + 死亡 fade を計算する pure 関数。`{anchorPos, visible, alpha,
  deathMarkerAlpha}` を返す。LH / 他機 / 自機 共通の死亡エフェクトロジック。
- 新 `DeathMarker.tsx` (sphere + ring): 共通コンポーネント。**sphere は world event 位置で
  沈む** (`transformEventForDisplay(deathEventPos)`)、**ring は過去光円錐 surface anchor で
  沈まない** (`anchorT = observer.t - ρ`、観測者進行で世界時刻が +Δt 足される / display.t
  = -ρ で固定)。fade 1→0 を `DEBRIS_MAX_LAMBDA` で同期。
- 新 `OtherPlayerRenderer.tsx`: 他プレイヤーの sphere + glow + 死亡 marker を担当。生存中は
  current world pos の live sphere、死亡中は past-cone anchor + fade + DeathMarker。`deathEventOverride`
  prop で self-dead のときの実 death event (= myDeathEvent.pos、ghost 追従の phaseSpace.pos
  と区別) を受け取る。
- LighthouseRenderer も同 utility / DeathMarker を使うよう refactor (旧 inline ロジック撤去)。
- SceneContent: 旧 `killNotification` の 3D sphere+ring 描画 (killer===me の時だけ 1500ms)
  を撤去、各 player renderer 内で全死亡に対し render するよう変更。store の killNotification
  は HUD text 通知 (Overlays) のみ用途で残置。
- 自機死亡時も SelfShipRenderer をスキップして OtherPlayerRenderer (with deathEventOverride)
  を出すよう SceneContent の routing 整理。

**自機本体周辺の inner-hide** (砲身等との視覚被り解消):
- 新 `innerHideShader.ts` の `createInnerHideShader(R)`: per-vertex shader、`length(displayPos.xyz)
  < R` の vertex を `alpha=0` に。`applyTimeFadeShader` と並列に onBeforeCompile chain 可
  (varying / uniform 名衝突なし)。
- `LightConeRenderer`: 常に inner hide 適用 (= self 専用)。
- `WorldLineRenderer`: 新 prop `innerHideRadius?: number`、self の worldline にだけ渡す。
- 半径は `SHIP_HULL_RADIUS × SHIP_INNER_HIDE_RADIUS_COEFFICIENT` で hull サイズ連動。係数 9
  (= radius 2.88) 着地。

**Ghost (自機死亡中) の燃料制約撤去** (useGameLoop ghost branch):
- `processPlayerPhysics(ghostMe, ..., availableEnergy=Infinity)` でフル加速常時許可、
  `energy -= thrustEnergyConsumed` 減算撤去 (死亡中 energy 消費の意味なし、respawn でリセット)。

## 完了済みリファクタ

**歴史記録**。詳細は `git log --since=<date>` / `design/*.md` を grep で必要時のみ調査。**個別 bullet の pointer は意図的に削除済** (session 冒頭の follow-read を抑制して autocompact 頻度を下げるため、2026-04-18 §10.7 byte budget rationale)。

**2026-04-19〜20 (自機デザイン + inner-hide + 死亡 effect 共通化)**:
- **自機 SelfShipRenderer 着地** (deadpan SF、六角プリズム + 4 隅 RCS nozzle + belly-mounted cannon、SHIP_LIFT_Z で cannon 軸が world origin を通過、3 層 navy/steel-blue/dark-mid palette)。Direction A (観測ドローン) と D (asymmetric belly-turret) を比較検討して D 系着地、Direction H (telescope) は途中で却下し git restore。詳細: `design/rendering.md §自機 SelfShipRenderer`
- **ShipViewer (`#viewer` hash)** 追加: ゲーム本体起動せずに自機モデル 360° preview。OrbitControls は `three/examples/jsm` 直 import (drei AVG `JS:Prontexi-Z` 誤検知回避)。詳細: `2+1/CLAUDE.md §ShipViewer ルート`
- **死亡 past-cone エフェクト共通化** (`pastConeDisplay.ts` + `DeathMarker.tsx` + `OtherPlayerRenderer.tsx`): LH / 他機 / 自機 を同一ロジックに、自機死亡時は `OtherPlayerRenderer + deathEventOverride={myDeathEvent.pos}` で routing。**球は world event で沈む / 輪は過去光円錐 surface で沈まない** に最終着地 (5 段階の試行錯誤)。詳細: `design/rendering.md §死亡 past-cone エフェクト共通化`
- **Inner-hide shader** (`innerHideShader.ts`): 自機本体周辺の過去光円錐 / 世界線を hide して cannon 視認性確保。`createInnerHideShader(radius, centerWorld: Vector3 ref)` で uniform auto-sync、`applyTimeFadeShader` と並列 chain。**hide center は「観測者の過去光円錐との交差点」(= gnomon 位置)** が semantic に正しい (最終 vertex ではなく)。半径 `SHIP_HULL_RADIUS × COEFFICIENT` で hull 連動 (自機/他機 ×9 = 2.88、LH ×2.5 = 0.8)。詳細: `design/rendering.md §Inner-hide shader`
- **Ghost (自機死亡中) 燃料制約撤去 + Speedometer ghost 非表示**: `useGameLoop` ghost branch で `availableEnergy = Infinity` + energy 減算撤去、HUD は `{!player.isDead && (...)}` で wrap。詳細: `design/state-ui.md §Ghost 燃料制約撤去`
- **LH post-hit i-frame 共通化** (2026-04-19 昼): 灯台にも 0.5s post-hit i-frame 適用、`selectPostHitUntil` の LH 短絡撤廃、最短殺害時間 5×500ms = 2.5s。test 39→41 件
- **opacity / flash 4 値再チューン** (2026-04-19 昼): `PLAYER_WORLDLINE_OPACITY` 0.65→0.4、`ARENA_PAST_CONE_OPACITY` 1.0→0.5、`LIGHT_CONE_WIRE_OPACITY` 0.05→0.02、`STARDUST_FLASH_FUTURE_BOOST` 0.5→0.75
- **host migration 対称性整備 5 点修正** (2026-04-19 朝): split election (peerOrder を ping に相乗り)、snapshot LH owner stale (buildSnapshot で rewrite)、Drift A/B/C 解消。詳細: `plans/2026-04-19-host-migration-symmetry.md` + `design/network.md`
- **workflow 知見** (本セッション): Deploy 前に `pkill -f "vite"` で background dev server を殺さない (harness が「Background command failed」通知を出すため)。詳細: `2+1/CLAUDE.md §Deploy 前に dev server を pkill しないこと`
- **マルチプレイ state バグ A + B 修正** (2026-04-20 昼、`2be56b4` + `8ce595f` + 再発 fix `e9171c4`): (A) `displayNames` を reactive state に昇格 + ControlPanel 4 段 fallback + applySnapshot の local/remote merge で peer ID prefix 露出を解消。初版 deploy 後に再発 (`RelativisticGame.tsx` の intro 1 回 broadcast が open 前 conn で drop)、**connection watcher で新規接続 peer へ intro unicast 再送**で収束 (`e9171c4`)。beacon holder は `registerHostRelay` が intro を他 client に broadcast forward するので全員が全員の name を取得。(B) LH / 他機 dead branch の spawnT を `respawnTime.ts §getLatestSpawnT` 経由に差し替え、gap-reset で `worldLine.history[0]` が書き換わっても spawnT jump しないように。残 (C = 症状 1 host split + 症状 4 ghost 張り付き + 新規 症状 5 host migration & タブ復帰で相手消失) は `plans/2026-04-20-multiplayer-state-bugs.md`

**2026-04-18**:
- **Phase C2 Radar** 着地 (左下 Canvas 2D、観測者静止系 heading-up、過去光円錐交点を黄金 gnomon で描画)。詳細: `design/rendering.md §Radar`
- **Phase C2 前哨**: 灯台 3D 塔モデル化 (`LighthouseRenderer`)、過去光円錐マーカー完全置換、`LIGHTHOUSE_HIT_DAMAGE = 0.2` (6 発死)、`LIGHTHOUSE_SINK = 0.16`。詳細: `design/rendering.md §灯台 3D 塔モデル`
- **Phase C1 Damage-based death**: hit 即死 → energy pool 被弾共有 (`HIT_DAMAGE=0.5`、2 発で死) + `POST_HIT_IFRAME_MS=500ms` post-hit i-frame (no-hitLog 実装で連続被弾 i-frame 延長封じ) + target-authoritative 維持 (`hit` に `laserDir` 追加)。非致命 hit デブリ (scatter 中心 = `k^μ + u^μ` 空間成分、色 = killer)、`debrisRecords[]` 単一 array に `type` タグ統合。test `handleDamage.test.ts` 5 シナリオ。詳細: `design/physics.md §被弾デブリ`、`design/state-ui.md §Phase C1`
- **UX 統一**: hit デブリ size+kick を explosion と同値、Lobby に build 表示、`hud.dead` 撃沈→被撃墜 (旧軍電文 "被〜" 系)、レーザー × 光円錐マーカー過去/未来 scale 分離 (3/1.5)、星屑密度倍化 (20000→40000)
- **typecheck 13 errors 解消**: Authority 解体期 drift の型不整合を全消去 (`NetworkManager` 共有型化 + `disconnectPeer` parity 等)。test 38/38 不変
- **build infra**: `tsconfig.json` references を `./` に修正、`build` を vite build 単独に / `typecheck = tsc -b` を別 script に分離。詳細: root `DESIGN.md §build と typecheck の分離`
- **spawn/respawn 経路統合** (`handleSpawn` action): 旧 4 経路 (handleRespawn + applyRespawn + RelativisticGame init + snapshot self-not-in) を一本化、self-spawn も `pendingSpawnEvents` 経由
- **i18n JA 全日本語化** + **WS Relay 未配備 UI クリーンアップ**: `LIGHTHOUSE_DISPLAY_NAME` 定数化、`KillNotification3D` に `victimId` 追加して `isLighthouse(id)` 判定に統一
- **Brave Shields 対応**: `navigator.sendBeacon` を block されるため `fetch({keepalive:true})` に切替。詳細: `design/meta-principles.md M19`

**2026-04-17**: ghost 物理統合 + respawn 対称化 (`computeSpawnCoordTime` excludeId)、アリーナ円柱 (世界系静止、観測者因果コーン切り出し)、光円錐交差 O(log N+K) 化 + Vitest 導入、Exhaust v0 (C pattern)、時間的距離 opacity fade (per-vertex Lorentzian shader)、時空星屑 (N=20000 4D event + periodic boundary)、Temporal GC (5×LCH 過去で削除)、スマホ pitch 廃止

**2026-04-16**: Spawn 座標時刻統一、Thrust energy mechanic (fire と pool 共有、9s フル tank)

**2026-04-15**: D pattern 化 (world 座標 + 頂点単位 Lorentz、球は C pattern 例外)、spawn pillar 過去光円錐 anchor、Lighthouse 調整、レーザー×光円錐交点の接平面三角形、M13/M14/M15

**2026-04-14**: Authority 解体 Stage A〜H (target-authoritative + event-sourced、plan: `plans/2026-04-14-authority-dissolution.md`)

**2026-04-13**: Zustand 移行、座標時間同期 MAX_DELTA_TAU 撤廃、世界スケール 20→10、光円錐 wireframe

## 既知の課題

### マルチプレイ state バグ 5 点 (2026-04-20 観測)

本番 (`a1554be` デプロイ後) で連続観測、分析 + 修正方針は `plans/2026-04-20-multiplayer-state-bugs.md` に詳述。

| # | 症状 | 状態 |
|---|---|---|
| 1 | **host split**: 切断→再接続後、両 peer が自分を host と認識 | 未着手 (案 C) |
| 2 | **他 player respawn 消失**: spawnT 計算が gap-reset で bumped | **修正済 `8ce595f`** |
| 3 | **撃破数リストに peer ID prefix**: intro が新規接続 peer に届かない | **修正済 `2be56b4` + `e9171c4`** |
| 4 | **ghost 張り付き**: reconnection で peerId 変わり selectIsDead が stale | 未着手 (案 C) |
| 5 | **host migration & タブ復帰で相手が消える**: 切断 GC race で players map から蒸発? | 未着手 (B' 合流) |

共通根因は message order-of-arrival 依存。A + B は修正完了 + deploy 済、
C (症状 1 + 4) と 症状 5 (+ B') は設計変更大きく別セッション。詳細は plan。

### defer 中

- DESIGN.md 残存する設計臭 #2 (#1/#3/#4 は自然解消)
- PeerProvider Phase 1 effect のコールバックネスト
- 色調をポップで明るく (方向性未定)
- **アリーナ円柱の周期的境界条件 (トーラス化)**: un-defer トリガー = 壁閉じ込め物理希望 / トーラス体験向上検証 / ARENA_HEIGHT を LCH より広くしたくなった場合
- **snapshot に frozenWorldLines / debrisRecords 同梱**: un-defer = リスポーン世界線連続観測時
- **host migration の LH 時刻 anchor 見直し**: spawn 座標時刻統一と同じ族、現状定着待ち
- ~~**typecheck pre-existing 13 errors** (2026-04-18 夜 build infra で露呈)~~ → 2026-04-18 夜 解消済 (上記「現在のステータス」参照)

### パフォーマンス残課題

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰 (二分探索化で余力あり、別 commit)

### リスポーン時に世界線が繋がる (2026-04-14 Stage F-1 後に再発報告)

現象: リスポーン後、死亡前 WL と新ライフが連続線描画。最有力仮説は F-1 snapshot 経路で `frozenWorldLines` 未 serialize → 死亡中 snapshot 受信 peer で 生きた WL に history 残存 → respawn 時 appendWorldLine で連結。他候補: 順序逆転・参照共有漏れ・描画層合成・host migration race。何 peer 構成 / どの peer 視点で出るかが未調査、migration 直前直後に集中する示唆あり

### ~~モバイル: 指離しても加速継続 (2026-04-17 報告)~~ → 2026-04-18 A1 で解消済

`touchInput.ts` に visibilitychange / blur / pagehide listener を追加し `touchRef / state.thrust` を強制 reset。経路そのもの (iOS Safari で handleTouchEnd/touchcancel が未発火) は未解明だが、タブ遷移 / app 復帰の各段階で確実に reset されるようにして実体として解消。

### 要テスト

- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

### 既知のリスク (低)

- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラーでスタック (WS Relay 未設定時)

## 次にやること

### マルチプレイバグ修正 残 (別セッション)

A / B は 2026-04-20 昼に修正 + deploy 済 (`e9171c4`)。残作業は
`plans/2026-04-20-multiplayer-state-bugs.md §C / §B' / §症状 5` に集約:

- **C (症状 1 host split + 症状 4 ghost 張り付き)**: reconnection で peerId 変わる時の
  ID 同一性問題、設計変更が要る。3 案列挙済、方針選択から
- **症状 5 (host migration & タブ復帰で相手消失)**: 最有力は切断 GC race で players
  map から蒸発。grace period 付き removal を検討
- **B' (OtherPlayerRenderer LIVE 消失)**: 症状 5 と同根の可能性、合流調査

### Phase C (別セッション)

- ~~**C1 Damage-based death (#7)**~~ → 2026-04-18 完了 (上記「完了済みリファクタ」参照)
- ~~**C2 レーダー画面 (#11)**~~ → 2026-04-18 深夜 完了 (上記「現在のステータス」参照)

### 既存の積み残し (Phase 非依存)

- ~~**世界系時の time fade 統一** (architectural)~~ → 2026-04-20 解消 (上記「現在のステータス」参照、world frame 分岐に時間並進導入で shader z = Δt に統一)
- **進行方向可視化 分岐 A: 他機 exhaust 対応 (step 2-3)** — phaseSpace に共変 α^μ 同梱 (発信者 `Λ(u_own)` boost、受信者 `Λ(u_obs)^{-1}` で戻す)、D pattern + Lorentz 収縮 + 光行差。作業: message schema 拡張 + validation + snapshot 同梱 + ExhaustCone を `playerList.map` に広げる。**AccelerationArrow** も同様に他機展開 (入力意図は発信者の rest-frame α だけでなく heading に紐づくので設計再考)
- **進行方向可視化 分岐 B/C (今後)** — B: sphere + heading-dart ハイブリッド (案 14、rest-frame 静止でも向きが読める)、C: star aberration skybox (案 16、案 17 と独立な天体背景)。上位メタ: default frame 選択 (rest-frame vs world-frame vs 段階学習)。詳細: EXPLORING.md §進行方向・向きの認知支援
- **フルチュートリアル (必須、Phase B3 とは別)** — 初見ユーザーが操作・ゲーム概念を理解できない。B3 は hint のみ、完全 onboarding 別セッション
- 各プレイヤーに固有時刻表示 / スマホ UI 残 (レスポンシブ HUD) / 用語の再考 (EXPLORING.md) / 音楽の時間同期 (将来、EXPLORING.md)
- **レーザー以外の世界線 × 未来光円錐の表示方法** — 現状 sphere 0.15 + ring 0.12 が薄い。opacity 上げ or 別形状 (gnomon 三角形 / pulse) に昇格検討。凍結 WL と debris は対象外
