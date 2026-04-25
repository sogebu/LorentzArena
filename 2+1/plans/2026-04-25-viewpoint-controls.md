# 視点・操作系の再設計 (camera mode + control mode + heading 線)

## 動機

現状の不満点 (2026-04-25 odakin):

1. **自機が永遠に背中**: camera が heading に追従するため、自機 mesh は常に画面奥を向き、姿勢・形状が見えない
2. **進行方向が直感しにくい**: rest frame で加速すると world が後方に流れる相対論的逆転、加えて過去光円錐の遠面が進行方向側を隠す → 「どっちに進んでいるか」が分からない
3. **camera が機体周りで回ると認知負荷が高い**: heading 急変時に camera も回り、過去光円錐の hide 面も常に画面奥に貼り付き、「世界の見え方」が不安定

直接的な解決:
- **heading を未来光円錐の母線 (null geodesic) として時空に貼る** → 機体姿勢に依存せず向きが一目瞭然、aim 線も兼ねる
- **camera を heading から外す option** → 機体が画面内で色んな方向を向いて見える、cone の見え方が安定する
- ただし既存体験を破壊しないよう **設定 mode 切替** で実装

## 方針

- 既存挙動を保存しつつ、新挙動を **設定 mode** で並列に提供
- **camera mode** と **control mode** は独立な直交軸 (4 通り組み合わせ可)
- 物理コア (慣性、heading ≠ velocity、Lorentz boost 計算) は不変
- スマホは camera 操作 UI を追加しない (現行どおり)、PC は矢印キー camera 操作を両 mode で維持

## 軸の定義

### camera mode

| mode | 説明 | 現行/新 |
|---|---|---|
| `heading-follow` | camera は heading に追従、yaw 同期。機体は常に画面奥固定 | 現行 |
| `world-fixed` | camera position は自機追従、orientation は world 基底固定。機体は画面内を旋回して見える | 新 |

両 mode で PC 矢印キーの camera 操作 (pitch / orbit offset) は有効。スマホは camera 固定のまま (両 mode で動かない)。

### control mode

| mode | 説明 | 現行/新 |
|---|---|---|
| `body-relative` | WASD / 仮想 stick = 機体目線の thrust 方向 (前後左右)。FPS / 飛行機ライク | 現行 |
| `screen-relative` | WASD / 仮想 stick = world (画面) 基底の **進みたい方向**。倒した方向に heading 向き直す + thrust。トップダウン / アクション RPG ライク | 新 |

物理は両 mode で同一: **入力 → heading 決定 → thrust 方向 = heading**。違いは「heading が機体相対で決まるか、world 相対で決まるか」のみ。慣性は両 mode で残る (heading と velocity の不一致は維持)。

### 4 通りの組み合わせ

| | body-relative | screen-relative |
|---|---|---|
| **heading-follow** | 現行 (操縦体験、自機背中固定) | 旋回入力直感的 + 自機背中固定 |
| **world-fixed** | 機体側面が見える + body 操作違和感 (camera 固定 + body 操作の古典問題) | **推奨組み合わせ**: 直感性 + 機体可視 + 進行方向安定 |

`world-fixed × body-relative` は違和感が出る組み合わせ (例: 機体手前向きで前進入力 → 画面手前に進む = 画面下に動く)。設定で選べはするが default 推奨ではない。

## Stage

### Stage 1: heading 線描画 (`HeadingMarkerRenderer`)

**狙い**: 機体姿勢に依存しない「向き」の visualizer。camera mode 切替前にこれだけで体感が大きく改善するはず。

**仕様**:
- 自機の位置から heading 方向に未来光円錐の母線 (null geodesic) を描画
- 半透明 (silver / 薄い player 色)、長さは数 unit (`SHIP_LASER_BARREL_LENGTH` 程度から実験)
- 常時表示 (thrust ON/OFF 関係なし)
- 物理: t = t_self + s, x = x_self + s · heading_unit (s ∈ [0, L])
- レーザー描画機構 (`LaserRenderer` 系) を流用、ただし damage / hit 判定なし

**実装ヒント**:
- `src/components/game/HeadingMarkerRenderer.tsx` 新設
- D pattern 使用 (per-vertex Lorentz 変換)、display frame に応じた boost
- 自機のみ初版。他機分は `phaseSpace.heading` がすでに乗っているので、他機側 renderer もほぼ同コードで足せる (Stage 1 後半 or 別 stage)
- aim crosshair との重複検討: heading 線は world に貼る、crosshair は HUD overlay。両立可、ただし silver 統一 (UI 規約) で色衝突なし

**検証**:
- localhost で旋回時の線の動き確認
- 加速時、線方向と機体姿勢が一致しているか
- world-fixed camera mode 実装前でも違和感なく見えるか

### Stage 2: control mode 切替 (`screen-relative` 追加)

**狙い**: world-fixed camera と整合する操作系を確立。

**仕様**:
- 設定 store に `controlMode: 'body-relative' | 'screen-relative'` 追加
- `screen-relative` 時:
  - WASD / 仮想 stick の入力ベクトル (sx, sy) を **camera basis (world 軸)** で解釈
  - heading を「camera 平面上で (sx, sy) 方向」に向ける
  - thrust 強度は入力強度 (PC は ON/OFF、stick は連続)
  - 慣性は別途残る (velocity は heading と独立に時間発展)
- `body-relative` (現行): 既存ロジックそのまま

**実装ヒント**:
- 入力ハンドラ (`useKeyboardInput` / `VirtualStick`) の終端で control mode 分岐
- camera basis は `DisplayFrameContext` から取得
- heading の変化率は両 mode で同じ感度に揃える

**検証**:
- `heading-follow + screen-relative` で「stick 上 → 画面上に進む」を確認
- `world-fixed + body-relative` の違和感を再現 (= 想定どおりか確認)
- PC の WASD で screen-relative の挙動を確認

### Stage 3: camera mode 切替 (`world-fixed` 追加)

**狙い**: camera を heading から外し、機体姿勢を画面内で見えるように。

**仕様**:
- 設定 store に `cameraMode: 'heading-follow' | 'world-fixed'` 追加
- `world-fixed` 時:
  - camera position = 自機 world 位置 + offset (offset は固定 or PC 矢印キーで調整可)
  - camera orientation = world 基底固定 (up vector = world +z = 時間軸 display 方向)
  - PC 矢印キーは「world 基底に対する camera offset / pitch」を加算
- `heading-follow` (現行): 既存ロジックそのまま

**実装ヒント**:
- `DisplayFrameContext` の camera 計算箇所を分岐
- world basis と heading basis を別 vector として保持、camera mode で切替
- 過去光円錐 (`LightConeRenderer`) は camera basis 変更で自動的に「向きが安定」するはず (cone は世界に貼っているので)

**検証**:
- `world-fixed + screen-relative` で機体が画面内を旋回することを確認
- 過去光円錐の hide 面が画面に対して固定方向になることを確認
- PC 矢印キーで camera 動かして world 内を見渡せることを確認
- スマホで camera が動かないことを確認

### Stage 4: 設定 UI + default 決定

**狙い**: プレイヤーが mode を選択できる UI と、初心者が触ったときの default 決定。

**仕様**:
- menu (現行 HUD のどこか / 設定パネル新設) に 2 つのセレクタ追加:
  - camera mode: `heading-follow` / `world-fixed`
  - control mode: `body-relative` / `screen-relative`
- localStorage 永続化 (`la-camera-mode`, `la-control-mode`)
- default 値: **本番実戦観察 (Stage 1-3 完了後、odakin が触って判断)** で決定
  - 暫定 default: `heading-follow + body-relative` (= 現行) で merge、既存プレイヤーへの影響ゼロ
  - 観察後に推奨組み合わせ (`world-fixed + screen-relative`) に default 切替検討

**実装ヒント**:
- 設定 UI は既存の menu 機構 (`StartMenu` / HUD 設定領域) を流用
- 4 通り組み合わせを bug なく回す test を vitest で書く
- 切替時の挙動: 即時反映 (リロード不要) + camera 滑らか遷移 (lerp 0.3s 程度)

**検証**:
- 4 通り全 mode 組み合わせで実戦テスト
- localStorage 永続化確認
- 初見プレイヤー (= odakin が「初見ぽく触る」) で違和感を観察

## 過去光円錐の hide 面処理

D 案 (cone 遠面の透明化 / カリング) は本 plan に **含めない** (2026-04-25 odakin: 半透明は現状どおり)。`world-fixed` mode に切り替えると cone の見え方が安定するため、camera 設計だけで隠蔽問題はかなり緩和されるはず。それでも残る場合に別 plan で扱う。

## 関連ドキュメント

- `EXPLORING.md §進行方向・向きの認知支援`: 既存 13 案、本 plan は案 1 (heading 矢印) を null geodesic に格上げ + camera 設計の根本見直しで「root cause 1: rest-frame で世界が遠ざかる」「root cause 2: heading-camera coupling」両方に踏み込む
- `DESIGN.md §camera`: 本 plan 完了時に責務分担を追記 (camera mode / control mode の責務、`DisplayFrameContext` の API 変更)
- `design/meta-principles.md M21`: component の fade/gate/routing 責務統一。camera mode 切替は「描画 frame の決定」を 1 箇所に集約する形で M21 と整合
- `plans/2026-04-21-phaseSpace-heading-accel.md`: phaseSpace は heading を既に持つ。Stage 1 の他機 heading 線描画はこの基盤の上に乗る
- `SESSION.md §次にやること`: 「Phase A/B 対称性 audit」優先候補 — 本 plan は audit の一部として位置付けられる (camera + control の責務分離が対称性向上)

## 段階・順序

各 stage 完了時に localhost で odakin OK → push、deploy は Stage 4 完了後に一括 (途中段階で本番に出すと既存プレイヤーが混乱するため)。

1. **Stage 1** (heading 線): 単独 merge 可、即体感改善
2. **Stage 2** (control mode): screen-relative 追加、現行体験は不変
3. **Stage 3** (camera mode): world-fixed 追加、現行体験は不変
4. **Stage 4** (設定 UI + default): プレイヤーに mode 選択を開放

## 検証マトリクス (Stage 4 完了時)

| 状況 | heading-follow + body | heading-follow + screen | world-fixed + body | world-fixed + screen |
|---|---|---|---|---|
| 静止旋回 | ✅ 現行 | 旋回入力直感性 | 機体側面見える | 直感 + 機体可視 |
| 加速時の進行方向 | 画面奥 (固定) | 画面奥 (固定) | 入力方向に進む | stick 方向に進む |
| 機体姿勢の visibility | 背中のみ | 背中のみ | 全方位見える | 全方位見える |
| 過去光円錐の見え方 | 不安定 (camera 回る) | 不安定 | 安定 (固定) | 安定 (固定) |
| スマホ操作 | 既存 | screen で簡素化 | 機体可視 + body 違和感 | 推奨 |
| heading 線描画 | 動く線 | 動く線 | 静止系で安定 | 静止系で安定 |

## 未決事項 / open questions

- **heading 線の長さ**: SHIP_LASER_BARREL_LENGTH 1.5 と統一すべきか、もっと短く / 長く実験
- **heading 線の色**: silver UI 規約に従うか、player 色 (cannon glow と統一)
- **PC の矢印キー camera offset の永続化**: タブ越しに保存するか、リスポーンでリセットするか
- **stage 1 の他機対応**: 自機のみ初版 → 他機含めるかは Phase B-5 (他機 exhaust pure thrust wire field) と同時設計の余地
- **default 切替タイミング**: 観察期間 (1-2 週間?) 後に判断、本 plan 外で扱う
