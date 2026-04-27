# SESSION.md — LorentzArena 2+1

## 現在のステータス

**`e6c17cc` デプロイ済** (build `2026/04/27 15:15:46 JST`)。本番: https://sogebu.github.io/LorentzArena/

未デプロイ: 2026-04-27〜28 で **PBC torus アリーナ universal cover refactor 完遂** (= 中間版 ad hoc fold → 全 phase で image observer past-cone pattern に統一)。 思想は [`DESIGN.md` §「PBC torus...」](DESIGN.md)、 実装ログは `plans/2026-04-27-pbc-torus.md`。

主要 milestone commit (= universal cover refactor の節目、 詳細は git log):
- [`42868ad`](https://github.com/sogebu/LorentzArena/commit/42868ad): Phase A causal events 統一 (echo 発火)
- [`be5f944`](https://github.com/sogebu/LorentzArena/commit/be5f944): Phase B WorldLine + Laser image 分散
- [`8ac5e78`](https://github.com/sogebu/LorentzArena/commit/8ac5e78) / [`0898f06`](https://github.com/sogebu/LorentzArena/commit/0898f06): Phase C Debris / SquareArena image 分散
- [`dc5ec54`](https://github.com/sogebu/LorentzArena/commit/dc5ec54): **Image observer past-cone pattern 採用** (= primary intersection を 9 cells に copy する ad hoc → 各 image 独立に observer 本人の過去光円錐上で計算)
- [`d41f0d9`](https://github.com/sogebu/LorentzArena/commit/d41f0d9): **全 phase 対称化** (causal events も image observer pattern、 ad hoc 完全脱却)

維持された旧 commit: [`86ae2cf`](https://github.com/sogebu/LorentzArena/commit/86ae2cf) (光円錐 cylinder clip 解除、 torus mode 独自で universal cover とは独立)。

**実機 multi-tab 実戦テストは継続中** (= odakin の visual 確認待ち、 OK なら deploy)。

### 直近の文脈 (次セッションで意識すべき状態)

#### PBC torus アリーナ — universal cover refactor 完遂 (2026-04-28)

第 3 軸 `boundaryMode: "torus" | "open_cylinder"` (URL hash `#boundary=...` で切替、 default torus)。 LCH = ARENA_HALF_WIDTH = 20、 R = 1 → 9 image cells。

**思想と全 phase の実装 mapping は [`DESIGN.md` §「PBC torus: Universal cover image observer past-cone pattern」](DESIGN.md) に固定**。 5 行式 + 物理計算 vs 描画の意味的整合 + ad hoc 化脱却の経緯を記録。 helper は [`physics/torus.ts`](src/physics/torus.ts) (36 unit tests pass)。 LightConeRenderer のみ単一描画 (= LCH=L で球面 rim 内接、 隣接 image 重ならない)。 詳細実装ログ: [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md)。

#### Reference (= 詳細は別 file、 ここは pointer のみ)

- **操作系 / 機体形状 / 境界モード の axis 設計 + 各 controlScheme 挙動 + 機体形状 dispatch**: [`CLAUDE.md §「URL hash override」`](CLAUDE.md)
- **HeadingMarkerRenderer / LightConeRenderer one-sided**: [`design/rendering.md`](design/rendering.md) 末尾 sections
- **phaseSpace.alpha は thrust only / 死亡 event 統一アルゴリズム / 加速度表示 / LH 光源消灯 / 射撃 UI silver**: [`design/physics.md`](design/physics.md) 末尾 sections

## 既知の課題

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)

5 症状すべて解決済。根因 = transient event delivery 失敗 → state 恒久 divergence、対処 = 周期 snapshot + host self-verify + stale GC。詳細 + 各 commit は [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### defer 中

- DESIGN.md 残存する設計臭 #2
- PeerProvider Phase 1 effect のコールバックネスト
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応 — landscape 前提で HUD / touch UI / viewport 再配置

### パフォーマンス

- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰 (二分探索化で余力あり)

### 低優先リスク / 未検証

- **リスポーン時に世界線が繋がる** (2026-04-14 Stage F-1 後再発): F-1 snapshot で `frozenWorldLines` 未 serialize → respawn 時 `appendWorldLine` で連結が有力
- localId PeerJS ID 衝突 (tab-hidden 復帰時)、PeerServer ネットワークエラー stack
- モバイルハイスコア (iOS Safari ホーム画面復帰時保存)

## 次にやること

各 task の **詳細 (= debug 手順 / 設計議論内容 / 確認項目)** は [`plans/2026-04-27-pbc-torus.md` Appendix D](plans/2026-04-27-pbc-torus.md) に集約。 SESSION では概要 + pointer のみ:

### 優先

- **Phase D (b) 残り**: 補助 marker 4 種 (`DeathMarker` / `HeadingMarkerRenderer` / `AntennaBeaconRenderer` / レーザー emission marker) を image observer pattern で 9 image 化 → Appendix D §「Phase D (b) 残り」
- **他機 spawn ring 不発疑い** (odakin 2026-04-28 朝報告): 実機再現 + `firedSpawns` console log 確認 → Appendix D §「他セルの他機 spawn ring 不発疑い」 (6 step debug 手順)
- **因果律ガード設計** (odakin 2026-04-28 朝提起): 「何を guard するか」 から議論段階、 候補 4 つ列挙済 → Appendix D §「因果律ガードの設計」 (PBC future image past-cone 流入 / hit 光速超過 / network 受信 causal 整合 / その他)
- **innerHide dispatch (b-1/b-2/b-3)**: 9 hull 並ぶ visual の処理選択、 odakin 好み判断 → Appendix D §「innerHide dispatch 設計」
- **timeFade に spatial fade 追加** (任意): `fade = r²/(r²+dt²+s²)` で隣接 image 自然減衰 → Appendix D §「timeFade に spatial fade 追加」 + 本 plan Appendix B §(a)
- **実機 multi-tab 検証 + deploy**: visual OK なら `pnpm run deploy` + main push → Appendix D §「実機 multi-tab 検証 + deploy」 (確認項目 list)
- **過去光円錐 ∩ 正方形枠 の交線描画** (低優先、 描画装飾): universal cover refactor 後 individual 実装可能 → Appendix D §同名

### 既存 (優先順未決定)

- **Phase A/B で実装した worldline 向き・加速度の思想・コード対称性 audit**: `phaseSpace.alpha = thrust only` 化 ([`gameLoop.ts`](src/components/game/gameLoop.ts) で上書き) は thrust 単独信号の役割を満たすが、Phase B-5 で別途 wire field 新設するか alpha のままで運用するか方針確認。具体候補: (a) component 間の「fade / gate / routing」責務配置の統一 (M21 を広域適用)、(b) Phase B-5 (他機 exhaust の pure thrust broadcast) の再設計、(c) Phase C-1 (wire format 厳格化、heading/alpha optional → required)、(d) 世界線データと描画機構の「対応関係」を DESIGN.md に書き下し

### 既存 (優先順未決定)

- **DeathMarker regression 他機側の実機確認**: 自機側は 2026-04-22 検証で再現せず closed ([`plans/2026-04-22-self-death-marker.md`](plans/2026-04-22-self-death-marker.md) §post-mortem)、他機側が同じく出なければ「最終検証」項目は閉じる。再発時は同 plan の再仕込み手順で診断。
- **Phase B-5 (他機 exhaust) 再設計**: `phaseSpace.alpha = thrust + friction` が thrust 単独信号でない → pure thrust 用 wire field 新設が必要 ([`plans/2026-04-21-phaseSpace-heading-accel.md`](plans/2026-04-21-phaseSpace-heading-accel.md))
- **Phase C-1 (wire format 厳格化)**: 混在期間確認後、受信 optional → required、shim 削除
- **本番実戦観察**: 2026-04-22 夜の 10 commit (LH past-cone 即時消失 fix / 加速度 Lorentz 整合化 / dorsal pod / 世界線 ghost / 燃料枯渇 UX / debris 世界線 dim / laser cannon glow player 色 / silver UI 統一 / 世界線 hide 上方向伸長 / LH 死亡消灯) がすべて deployed。multi-tab 実戦テストで regression / UX 確認
- **進行方向可視化 分岐 B/C**: sphere + heading-dart (案 14) / star aberration skybox (案 16)、default frame 選択 ([`EXPLORING.md §進行方向・向きの認知支援`](EXPLORING.md))
- **操作系検討**: 現状 WASD + マウス yaw + 射撃トリガーの組み合わせを見直し。キーリマップ / ゲームパッド / スマホタッチの統一感・直感性を洗い直す (具体スコープは未定、アイデア出しから)
- **レーザー砲を短く**: 現状の `SHIP_LASER_BARREL_LENGTH = 1.5` が機体比で長め (dorsal pod を hull 上面に置いた後のバランスも再確認)。barrel / lens stack / emitter の寸法統合で再デザイン
- **機体色をプレイヤー色から導く**: 現状は hull navy 固定 + dorsal pod stripe / laser cannon glow に player 色を焼く方式で識別性を補強している。hull 本体の色自体を player 色から導出する方式 (tint / blend / hue shift 等) を検討して、dorsal/cannon への依存を下げられないか再設計アイデア出し
- **エンジンノズル形状の物理整合確認**: de Laval 型 (exit 広 / throat 狭) で噴射炎が「広がり続ける」ように見えるが、実ロケットでは exhaust が背圧 / mach 整合で収束する。現状の ExhaustCone 描画 (広がる cone) が物理として自然か再検討。under-expanded / over-expanded の違いも含めて spec 化の余地
- **フルチュートリアル** (必須、初見 UX)
- 各プレイヤー固有時刻表示 / スマホ UI 残 / 用語再考 / 音楽の時間同期
- **レーザー以外の世界線 × 未来光円錐の表示**: 現 sphere 0.15 + ring 0.12 薄い
- **DeathMarker ring を (x_D0, u_D) 静止系で描画** (Stage 2): 現 C pattern 並進のみ → u_D 方向に contracted な楕円 (relativistic apparent shape)
