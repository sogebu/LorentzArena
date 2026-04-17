# SESSION.md — LorentzArena 2+1

## 現在のステータス

対戦可能。**`0db4ab3` デプロイ済み** (build `2026/04/17 18:42:26 JST`)。本番 URL: https://sogebu.github.io/LorentzArena/

完了済みリファクタ (判断根拠は DESIGN.md):
- **Authority 解体 Stage A〜H** (2026-04-14〜15): target-authoritative 化 + event-sourced。plan: `plans/2026-04-14-authority-dissolution.md`
- **D pattern 化** (2026-04-15): scene の物理オブジェクトを world 座標 + 頂点単位 Lorentz に統一、3+1 拡張に親和。球は例外で C pattern 維持
- **Spawn 座標時刻の統一** (2026-04-16): `computeSpawnCoordTime(players) = max(p.phaseSpace.pos.t)` で初回/リスポーン/新 joiner 共通化。beacon holder の t 依存を廃止し、新 joiner 過去スポーンバグを解消。詳細は DESIGN.md § スポーン座標時刻
- **Thrust energy mechanic** (2026-04-16): thrust も fire と同じ energy pool を消費 (フル tank 9 秒)。両方同時で ~2.25 秒で枯渇。枯渇時は FUEL ラベル点滅で明示。詳細は DESIGN.md § thrust energy
- **アリーナ円柱** (2026-04-17): 視覚ガイドとしての world-frame 静止円柱 (半径 20, 中心 (5,5))。本体は D pattern、各プレイヤーは自分の過去光円錐との交線を独立に描画。物理判定なし。詳細は DESIGN.md §描画「アリーナ円柱」
- **ghost 物理統合 + respawn 時刻対称化** (2026-04-17): 死亡中も生存時と同じ物理 (processPlayerPhysics 流用) で自機 ghost を動的更新、光行差などの相対論的視点移動が連続する。`DeathEvent.ghostPhaseSpace` を追加、`processGhostPosition` (等速直線) を削除。`computeSpawnCoordTime(players, excludeId?)` を拡張して自機を respawn 計算から除外、ghost thrust 自由化でも自機 respawn 時刻が暴走しない。死亡プレイヤーは LH 含め「死亡時刻を持ち時刻とする placeholder」で対称扱い (原則 2 条)。詳細は DESIGN.md §物理「スポーン座標時刻」
- **アリーナ円柱を観測者因果コーンで切り出し** (2026-04-17): 各 θ で上下端を `observer.t ± ρ(θ)` に動的設定、観測者の過去光円錐交点 (下地平線) と未来光円錐交点 (上地平線) で clipped。観測者が中心なら均一な円、離れると双円錐歪みが現れる。旧 ARENA_HEIGHT 設計で発生していた「観測者が円柱外から眺めた時の overdraw FPS 低下」を自動解消。FutureConeLoop 新設 (ARENA_FUTURE_CONE_OPACITY=0.3、過去より控えめ)。詳細は DESIGN.md §描画「アリーナ円柱」
- **光円錐交差計算の二分探索化** (2026-04-17): `pastLightConeIntersectionWorldLine` / `futureLightConeIntersectionWorldLine` を O(N) → O(log N + K=16)。`findLaserHitPosition` は laser 時刻範囲で絞り込み。Vitest 導入 (`pnpm test`)、linear scan reference 実装 (`*Linear`) と binary 版の regression test 11 本 green。長時間プレイでの FPS 低下を根治
- **Exhaust v0** (2026-04-17): 自機 rest-frame での -加速度方向に 2 層 cone (外=明るい青 `hsl(210, 85%, 60%)`、内=冷たい白 `hsl(210, 70%, 92%)`、MeshBasic + additive blending で青白プラズマ発光。`EXHAUST_MAX_OPACITY = 0.45` で透明感)。プレイヤー色依存は廃止、識別は sphere / worldline に任せる。PC binary 入力の点滅防止に magnitude EMA smoothing (attack 60ms / release 180ms)、方向は即時。v0 は C pattern (step 1: rest frame で与える) のみ、他機対応の step 2-3 (world boost + 観測者 rest frame に戻す) は phaseSpace に共変 α^μ を載せる段階で実装予定。詳細は DESIGN.md §描画「Exhaust」
- **時間的距離 opacity fade (Lorentzian per-vertex shader)** (2026-04-17): `fade = r²/(r² + Δt²)`、`r = TIME_FADE_SCALE = LIGHT_CONE_HEIGHT = 20` (時間距離の 2 乗反比例、物理の逆 2 乗法則と同型)。Δt = LCH で 0.5、2×LCH で 0.2、3×LCH で 0.1。`game/timeFadeShader.ts` の `applyTimeFadeShader` を material の `onBeforeCompile` で inject、各 vertex の `modelMatrix × position` の z 成分 (= observer rest frame での時間距離) から per-vertex fade を alpha に乗算。適用対象: 世界線 (生存・凍結 tube)、デブリ (InstancedMesh、`USE_INSTANCING` 分岐)、自己光円錐 4 mesh、アリーナ円柱 4 mesh、レーザー batch。生存世界線も tail 方向が自然に消え、凍結世界線は時間経過で全体が薄くなる。詳細は DESIGN.md §描画「時間的距離 opacity fade」
- **スマホ pitch 廃止** (2026-04-17): ghost 物理統合で死亡中も thrust 入力が効くようになった後、縦スワイプ = thrust と旧 pitch 分岐が衝突していたバグを解消。`processCamera` の死亡時 pitch 分岐を削除、`pitchDelta` を毎 tick リセット。生死問わず縦スワイプ = thrust、pitch 回転は PC 矢印キーのみ。詳細は DESIGN.md §UI / 入力「モバイルタッチ入力」

## 直近の作業

### 2026-04-17: アリーナ視覚化 + ghost 物理統合 + 光円錐交差 O(log N) 化 (全デプロイ済)

一気通貫で実装した知見は DESIGN.md に集約 (以下の pointer 先)。

- **アリーナ円柱** (DESIGN.md §描画「アリーナ円柱」): world-frame 静止の視覚ガイド。各 θ で観測者因果コーン (過去/未来光円錐) 交点を上下端にして双円錐で歪む形。4 geometry (surface / 垂直線 / 下地平線 / 上地平線) が shared BufferAttribute + in-place update で同じ頂点セットを共有し線ズレなし。frustumCulled=false で in-place boundingSphere 問題回避。`ARENA_RADIAL_SEGMENTS = 128`、暫定色シアン `hsl(180,40%,70%)`
- **ghost 物理統合** (DESIGN.md §物理「スポーン座標時刻」): 死亡中も生存時物理 `processPlayerPhysics` を流用して自機 ghost を動的更新、相対論的視点移動が連続。`DeathEvent.ghostPhaseSpace` 追加、`computeSpawnCoordTime(players, excludeId?)` で自機除外、死亡者 (LH 含む) は placeholder として対称扱い (原則 2 条)
- **光円錐交差 O(log N) 化** (DESIGN.md §worldLine.history サイズ): `pastLightConeIntersectionWorldLine` / `futureLightConeIntersectionWorldLine` を binary search + ±K=16 近傍スキャンで O(log N + K)、`findLaserHitPosition` は laser 時刻範囲で絞り込み。Vitest 導入 (`pnpm test`)、linear scan reference 実装との regression test 11 本 green。長時間プレイ FPS 低下を根治 (MAX_WORLDLINE_HISTORY 1000 維持、5000 復帰余地あり)
- **メタ原則追加** (DESIGN.md §メタ原則): M16 (時間経過悪化は蓄積 state O(N) を疑う) / M17 (Three.js + R3F の in-place BufferGeometry pattern、frustum culling trap、shared BufferAttribute) / M18 (段階的 α=0 切り分け二分法)。M15 (HMR stale) に 2026-04-17 事例を追記

### 過去セッションのダイジェスト

- **2026-04-15**: D pattern (world 座標 + 頂点単位 Lorentz)、球は C pattern 維持、spawn pillar 過去光円錐 anchor、Lighthouse 調整 (射撃間隔 / spawn grace / 無敵 / 照準ジッタ)、レーザー × 光円錐 交点マーカーの接平面三角形化、opacity 定数集約。M13/M14/M15 追加。DESIGN.md 時系列→topic 別再編。`plans/2026-04-15-design-reorg.md`
- **2026-04-14**: Authority 解体 Stage A〜E、handleKill 二重キル防止、sendBeacon CORS 修正 (`text/plain`)、制約ネットワーク検証 (Cloudflare TURN)
- **2026-04-13**: Zustand store 移行 (props drilling 解消)、空間スケール再半減、初回スポーン統一、座標時間同期 MAX_DELTA_TAU 撤廃、スポーン色の遅延解決、世界スケール 20→10、光円錐ワイヤーフレーム

各項目の設計根拠は DESIGN.md の対応節 (§Authority 解体 / §D pattern 化 / §物理 / §描画 等) を参照。

## 既知の課題

### defer 中

- DESIGN.md 残存する設計臭 #2（#1 は実質解決、#3/#4 は Authority 解体で自然消滅）
- PeerProvider Phase 1 effect のコールバックネスト
- 色調をポップで明るく（方向性未定）
- **アリーナ円柱の周期的境界条件 (トーラス化)**: 視覚ガイドとしてアリーナ円柱を入れた次ステップ。円柱壁で座標空間を周期境界にしてトーラス宇宙にする。un-defer トリガー: アリーナ実装後「壁で閉じ込める物理」が欲しくなった場合 / トーラス地図での体験向上を検証したくなった場合 / **ARENA_HEIGHT を光円錐より広く取りたくなった場合** (観測者が円柱外から見ると半透明 surface の overdraw で FPS 低下、周期境界で外に出なくなれば解消)。物理改変なので spawn 位置や rendering (世界線の折り返し描画) への影響も設計範囲
- **snapshot に frozenWorldLines / debrisRecords 同梱**: 「リスポーン時世界線連続」既知課題と同じ surface。spawn 時刻統一とは別 commit として切り出し。un-defer トリガー: リスポーン世界線連続が実際に観測されたら優先度上げ
- **host migration の LH 時刻 anchor 見直し**: 「ホストマイグレーション時の位置飛び」既知課題。spawn 座標時刻統一と同じ「時刻 anchor」族だが、今回は触れず

### パフォーマンス検討課題

- ~~**`worldLine.history` 交差計算 O(N) 走査**~~ **二分探索で O(log N + K) 化、2026-04-17 解消**。`pastLightConeIntersectionWorldLine` / `futureLightConeIntersectionWorldLine` は signed cone distance g(i) の符号反転境界を二分探索、±K=16 近傍だけ線形走査。`findLaserHitPosition` は laser 時刻範囲 `[eT, eT+range]` を `findLatestIndexAtOrBeforeTime` で絞り込み。Vitest 導入して linear scan reference 実装との regression test 11 個 green。**残課題**: `MAX_WORLDLINE_HISTORY` を 1000 → 5000 に戻して視覚的に世界線を長く見せる余地あり (別 commit)
- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング

### リスポーン時に世界線が繋がる（再発、2026-04-14 Stage F-1 後に報告）

- **現象**: リスポーン後、死亡前の世界線と新ライフの世界線が連続線として描画される (分離すべき)
- **最有力仮説**: F-1 snapshot 経路で `frozenWorldLines` が serialize されないため、死亡中 snapshot を受けた peer で生きた現 worldLine に「死ぬ直前までの history」が残り、respawn 時の appendWorldLine で繋がる
- **他候補**: メッセージ順序逆転、参照共有漏れ、描画層合成、host migration race (詳細分析は plans/ に必要時起票)
- **未調査**: 何 peer 構成で・どの peer 視点で出るか。host migration 直前直後に集中する示唆あり

### ホストマイグレーション時の位置飛び（Stage F-H 完了後に要確認）

- 灯台の位置が飛び、世界線が折れ線になる。旧ホストの位置も飛んでいた可能性
- 推定原因: 旧 beacon holder 切断→新昇格の間にタイムギャップが生じ、新 owner が最後の phaseSpace から再開すると座標時間の不連続で世界線にジャンプ。Stage D-3 で LH の上書き問題は修正済みだが、migration 中の phaseSpace 発信途絶による不連続は残る
- 現状: Stage F-H 完了後に再現テスト未実施。実機で要確認

### 要テスト

- グローバルリーダーボード: sendBeacon 修正後、実際にスコアが KV に保存されるか確認
- モバイルハイスコア: iOS Safari でホーム画面に戻る → スコアが保存される

### 既知のリスク（低優先）

- localId PeerJS ID 衝突（tab-hidden 復帰時）
- PeerServer ネットワークエラーでスタック（WS Relay 未設定時）

## 次にやること

- **[次セッション最優先] 時空星屑 (案 17)** — N 個 (500〜2000) の spark を world frame で (x, y, t) 4D 一様分布、交差計算なし、D pattern で毎 frame `THREE.Points` 描画 (`matrix = displayMatrix`)。光行差・Lorentz 変換は per-vertex で自動。新規 `StardustRenderer.tsx`、`constants.ts` に `STARDUST_COUNT` / 空間・時間範囲 / `STARDUST_COLOR` / `STARDUST_SIZE` 追加。既実装の時間 fade と組み合わせれば観測者周辺に dynamic window が自然にできて pop-in 抑止。詳細: EXPLORING.md §「進行方向・向きの認知支援」§追加案「案 17」
- **時間 fade per-vertex v1 (将来)** — 現状 per-mesh v0 で世界線 tube は全体が一括スケール、debris も InstancedMesh 全体が 1 opacity。per-vertex に昇格すると tube tip と tail で濃淡、debris per-instance 個別 fade、laser 個別 fade が実現。shader modifier (onBeforeCompile) or vertex color alpha。v0 の体感で必要と判断したら着手
- **[上記の後] 進行方向の可視化 分岐 A: 他機の noise exhaust 対応** — phaseSpace に共変 α^μ を同梱 (発信者 owner が自機の `Λ(u_own)` で世界系へ boost)、受信側は観測者の `Λ(u_obs)^{-1}` で rest frame に戻して cone 方向決定。D pattern + Lorentz 収縮 + 光行差が自然に入る (物理モデル step 2 + step 3 を同時実装)。作業スコープ: phaseSpace message schema 拡張 + messageHandler validation + snapshot への同梱 + ExhaustCone を自機専用経路から他機対応経路に広げる。`SceneContent.tsx` の `ExhaustCone` は現在 `player={myPlayer}` 固定だが、`playerList.map` 内に組み込む形に書き換える (ただし球は C pattern、cone は step 2-3 完成で D pattern に昇格)
- **進行方向の可視化: その他分岐 (今後検討)** — 分岐 A 完了後に着手:
  - **分岐 B (Step 2 = 案 14)**: sphere + heading-dart ハイブリッド、rest-frame で静止時も向きが読める。dart を D pattern で world-frame view の Lorentz 収縮が自然に入る
  - **分岐 C (Step 3 = 案 16)**: star aberration skybox (timelike 星、案 17 時空星屑とは独立の天体背景)、β 理念・モバイル UI 要素ゼロ原則と両立、教材価値最大
  - **上位メタ TODO**: default frame 選択 (rest-frame 固定 vs world-frame 固定 vs 段階学習型)、Step 2/3 実装後に体感で再評価推奨
  - 詳細は EXPLORING.md §「進行方向・向きの認知支援」§育成パス案
- **チュートリアル（必須）** — 初見ユーザーが操作・ゲーム概念を理解できない
- 各プレイヤーに固有時刻表示
- スマホ UI 残課題（レスポンシブ HUD、オンボーディング）
- 用語の再考（`EXPLORING.md` 参照）
- 音楽の時間同期（将来計画、`EXPLORING.md` 参照）
- **レーザー以外の世界線 × 未来光円錐の表示方法を検討 (もっと目立つように)** — 現状 `futureLightConeIntersections` で他プレイヤー生存世界線 (LH 含む) × 自機未来光円錐の交点は sphere (0.15) + ring (0.12) で描画済だが薄くて目立ちにくい。opacity を上げる (sphere 0.3 / ring 0.25 等)、または別形状 (gnomon 三角形で laser 側と統一、pulse アニメーション等) に昇格する検討。凍結世界線は未来方向に延びないので対象外、debris は対象外 (ユーザー判断)
