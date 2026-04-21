# 2026-04-21: PhaseSpace に heading (quaternion) + 4-acceleration を追加

## 目的

- **heading**: 各 worldline (自機 / 他機 / 灯台) に「向き」を持たせ、[apparent shape pattern](2026-04-21-ship-apparent-shape-pattern.md)
  の `R` 回転行列、ship 3D model の前方向制御、AccelerationArrow 基準、将来 3+1
  移行時の 3D 姿勢の素にする。**表現は quaternion** (`Vector4 = (w, x, y, z)`)。
  2+1 では yaw 1 自由度のみ使う (= `(cos(θ/2), 0, 0, sin(θ/2))`) が、型は 3+1
  互換にしておく (後で spec 再書きが不要)。
- **4-acceleration**: 各 worldline の共変加速度 `α^μ` を world 系で保持。
  peer 間送受信時に frame assumption を持たず、受信側で `Λ(u_obs)` boost して
  display 可能。exhaust visualization (D pattern) / AccelerationArrow / 将来
  Penrose-Terrell 2 次補正の入力になる。**表現は world 系 `Vector4 α^μ`** (制約
  `u·α = 0` で 2 成分独立だが、型は冗長で持つ = 数値誤差吸収 + serialize 対称性)。

旧 `PhaseSpace = (pos, u)` → 新 `PhaseSpace = (pos, u, heading, alpha)` の段階的
移行。wire format の非互換は backward compat shim (受信時に欠落フィールドをデフォル
ト補完) で吸収し、**本番デプロイ前後で旧タブと新タブが混在しても死なない**のを
保証する。

---

## 設計選択の確定

### Q1. heading 表現: quaternion vs yaw scalar vs rotation matrix

**採用: quaternion `Vector4 (w, x, y, z)`**。

- **yaw scalar (1 float)**: 最安だが 3+1 移行時に全箇所書き換え。今日の build に
  対して 2+1 でしか成立しない spec を固定してしまう = 後悔経路。
- **quaternion (4 float)**: 3+1 でそのまま動く。2+1 では yaw→quat 変換が閉じた
  formula (`(cos(θ/2), 0, 0, sin(θ/2))`)、quat→yaw も `atan2(2·w·z, 1 − 2·z²)`
  で安価。シリアライズ 16 byte/message の増分は許容 (下記 Q4)。
- **rotation matrix (9 float)**: 過剰、補間劣化、非推奨。

識別子命名: `heading`。型 `Vector4` を流用 (`w` 代わりに `.t` を使うと意味が
不明瞭になるので、新 `Quaternion` 型 alias を作るのが良い)。

### Q2. acceleration 表現: world 系 α^μ vs rest 系 a^i_rest

**採用: world 系 4-acceleration `Vector4 α^μ` (制約 u·α=0 を構築時に保証)**。

- **world 系 α^μ** (採用):
  - peer 間送信で frame assumption 不要 (Λ(u_obs) で観測者系に自由に落とせる)
  - exhaust の D pattern visualization (`Λ(u_obs)^{-1}·α_world`) に直接載る
  - 制約 `u^μ α_μ = 0` (Minkowski signature) で 2+1 では 2 成分独立、3+1 では 3
- **rest 系 `a^i_rest` (3-vec)**: 送信側で `Λ(u_own)^{-1}·(0, a)` 変換が必要、
  対称性劣る。物理的には同じ情報量だが受信が面倒。
- **scalar magnitude + unit vector**: 無駄に分解、統合しづらい。

格納型: `alpha: Vector4`。`(t, x, y, z)` で `t` 成分は `u·α = 0` から derive
可能だが、数値誤差吸収と serialize 対称性のため冗長格納。

### Q3. PhaseSpace の構造: 単一 struct vs 分離

**採用: 単一 struct (PhaseSpace を拡張)**。

- 理由: 既存 history record / snapshot / intro など全ての流れで phaseSpace は
  atomic unit として扱われている。分離すると `Player` に heading/alpha を別
  field で載せることになり、syncなし送信 / 古い snapshot 互換 / 型の重複が面倒。
- 欠点: PhaseSpace の size が 4→(4+4+4)=12 float pos/u + 4 quat + 4 alpha = 24
  float/record。worldLine.history が `MAX_WORLDLINE_HISTORY = 1000` として 1
  機あたり 24 KB → 全然許容 (現状 12 KB から倍)。

### Q4. wire format の backward compat

**採用: 新 field は optional 送信、受信時に欠落を default で埋める**。

- 送信側 (新 client): 常に `heading` / `alpha` 同梱。
- 受信側 (新 client): field 欠落なら `heading = (1, 0, 0, 0)` (identity quat)、
  `alpha = (0, 0, 0, 0)` で補完。
- 旧 client は新 field を無視 (wire format が open record なので問題なし)。
- **混在期間中の挙動**: 旧 client の球が静止 heading で描画される (UI 上 regressi
  なし、旧 client の camera yaw 相当は失われるが mid-migration の短期間のみ)。
- shim 撤去: 全 peer が新 build になったことを確認できた時点 (目安: 2-3 session
  後) で optional→required に厳格化。

### Q5. heading のソース (自機 input → heading 変換)

現状: 自機は `cameraYawRef` + WASD で thrust 方向を計算、camera yaw がそのまま
ship の向き。

新設計: 自機の heading は **camera yaw から従動**。tick ごとに
`heading = yawToQuat(cameraYawRef.current)` を phaseSpace にセットして broadcast。
入力→物理ループの 1 方向フロー、混乱なし。他機は受信した heading をそのまま
render。自機 3D model の回転も同じ heading を読む (camera yaw 直読みを置換)。

**Pitch / roll 対応**: 2+1 では不要 (WASD のみ)。3+1 移行時に cameraPitch も quat
に合成すれば自動で ship が pitch する (段階導入可、renderer がどう描くかは別問題)。

### Q6. alpha のソース

tick ごとに `gameLoop` が computeSelfPlayerStep 内で `thrustAcceleration` を rest 系
で計算 → `inverseLorentzBoost(u)` で world 系へ変換 (evolvePhaseSpace が内部で既に
やっているのと同じ) → `alpha = accel4World` を phaseSpace にセット。

他機 / LH の alpha は送信されてきたものを格納。LH は常時 `alpha = 0` (thrust なし)。

### Q7. worldLine history の heading / alpha 保存

history record も `PhaseSpace` なので自動で拡張される。**appendWorldLine** で
tick ごとの (pos, u, heading, alpha) を残す。

閲覧側は必要なら `interpolateHistory(t)` で heading / alpha も補間 (quat は slerp、
alpha は linear で ok; 現状 pos/u は linear 補間なので現状維持)。

### Q8. u·α = 0 制約の扱い

構築時に保証 (`alpha_world_t` を `(u·α_spatial) / u_t` で derive、または rest 系
から boost して自然に得る)。受信時は検証だけして invalid なら `alpha = 0` に
落とす (safety)。

---

## 影響範囲マッピング

### 触る file (型 + 物理 + network)

| file | 変更 |
|---|---|
| `src/physics/vector.ts` | `Quaternion` type alias (Vector4)、`quatIdentity`, `yawToQuat`, `quatToYaw`, `multiplyQuat`, `slerpQuat` helpers 追加 |
| `src/physics/mechanics.ts` | `PhaseSpace` 拡張、`createPhaseSpace` 引数追加 (default で quat identity / alpha zero)、`evolvePhaseSpace` 内で `alpha` を next phaseSpace に格納 |
| `src/physics/worldLine.ts` | history の型は PhaseSpace なので自動、ただし `appendWorldLine` / `interpolateAtT` の挙動確認 |
| `src/types/message.ts` | `phaseSpace` message + snapshot の `players[i].phaseSpace` + `worldLineHistory[i]` に `heading?` / `alpha?` 追加 (optional) |
| `src/components/game/messageHandler.ts` | validator で新 field を optional 扱い、受信時に default 補完 |
| `src/components/game/snapshot.ts` | build / apply で新 field を passthrough + default 補完 |
| `src/components/game/gameLoop.ts` | self step で heading / alpha を計算して phaseSpace にセット (broadcast 側) |
| `src/hooks/useGameLoop.ts` | 自機 heading = quat(cameraYaw) を phaseSpace に反映するフック |
| `src/stores/game-store.ts` | Player の phaseSpace 型変更で ripples 確認 |

### 触る file (renderer 側、Phase B)

| file | 変更 |
|---|---|
| `src/components/game/apparentShape.ts` | `R` 回転 (heading quat) を底面 stretch の前段に合成 (§Phase B-1) |
| `src/components/game/SelfShipRenderer.tsx` | `cameraYawRef.current` 直読 → `player.phaseSpace.heading` から yaw 取得 |
| `src/components/game/OtherPlayerRenderer.tsx` | `phaseSpace.heading` で他機の向き描画 (現状 velocity 方向 fallback から) |
| `src/components/game/SceneContent.tsx` | `AccelerationArrow` の他機展開: `phaseSpace.alpha` を `Λ(u_obs)^{-1}` で観測者系に落として矢印描画 |
| `src/components/game/LighthouseRenderer.tsx` | 現状変更なし (uA=0, alpha=0, heading=identity) |

### テスト

| test | 変更 |
|---|---|
| `physics/worldLine.test.ts` | history fixture を新型で生成、interpolation 互換確認 |
| `components/game/messageHandler.test.ts` | 旧 client 送信 (新 field 欠落) / 新 client 送信 (新 field 完備) 両方で受信正常 |
| `components/game/snapshot.test.ts` | build→apply round-trip で heading / alpha 保存確認、旧 build wire の受信 (default 補完) |
| `components/game/apparentShape.test.ts` | heading 非 identity で底面楕円が回転する case 追加 |
| `components/game/ballisticCatchup.test.ts` | heading / alpha が invariant で維持されることを確認 |
| `stores/handleDamage.test.ts` | phaseSpace 構築ヘルパが新型を返すか確認 |

### 合計

新規 2 helper (quat ops 一式) + 6 主要 file 変更 + 6 renderer / test 更新 = **約
15 file**。1 commit で Phase A 全部収めるのは大きすぎるので、以下の通り分割する。

---

## Phase 分け

### Phase A: 型 + 物理 + 配管 (network 含む、renderer は読まない)

目標: 型が拡張され、heading/alpha が phaseSpace にセットされ、worldLine history
にも流れ、snapshot / phaseSpace broadcast / kill / respawn / intro も wire で
運搬される。**ただし renderer は既存 ref を参照続行** (挙動変化なし、値は circulate
するだけ)。

1. **Commit A-1** `feat(physics): Quaternion helpers + PhaseSpace に heading / alpha 追加`
   - `vector.ts` に `Quaternion` type、identity / yawToQuat / quatToYaw / mult / slerp
   - `mechanics.ts` で PhaseSpace 拡張、`createPhaseSpace(pos, u, heading?, alpha?)`
     に default 引数追加
   - `evolvePhaseSpace` が next PS に `alpha = accel4World` を入れるように変更、
     heading は dτ 中不変 (角速度 input なしなので identity transport)
   - 既存 test が `createPhaseSpace(pos, u)` で通り続けること = default 引数で救済
   - 新規 test: quat helpers unit test、PhaseSpace の default 補完
2. **Commit A-2** `feat(network): phaseSpace / snapshot / intro に heading / alpha を optional で追加`
   - `types/message.ts` で wire type 拡張 (optional field)
   - `messageHandler.ts` validator + handler で default 補完
   - `snapshot.ts` build / apply で passthrough + default 補完
   - test: 旧 wire 受信 / 新 wire 受信 の両方 pass
3. **Commit A-3** `feat(gameLoop): self step で heading = quat(cameraYaw) + alpha = accel4World をセット`
   - `gameLoop.ts` / `useGameLoop.ts` で heading / alpha を phaseSpace にセット
   - self broadcast 時に heading / alpha が実際に流れることを test (既存 loop test
     の extension)
4. **Commit A-4** `refactor: worldLine history / interpolation で heading / alpha を保存 + slerp 補間`
   - `worldLine.ts` interpolateAtT で heading を slerp 補間、alpha を linear 補間
   - test: interpolation で heading / alpha が保存される

**Phase A 完了時点で**: 挙動は全く変わらない、wire format に新 field が乗る、型が
拡張されている。本番 deploy して **新旧混在期間** に入る (新 client は heading
送信、旧 client は無視、新 client 受信は default 補完で無害)。

**デプロイ**: A-4 後に 1 回デプロイして 1-2 日本番で観察 → 問題なければ Phase B へ。

---

### Phase B: renderer 段階導入 (LH 無関係、ship から)

1. **Commit B-1** `feat(apparentShape): heading 引数追加、底面 stretch の前段に R_q 合成`
   - `buildApparentShapeMatrix(..., anchorHeading)` で quat → 2×2 rotation を
     base の前に適用
   - LH は identity quat なので挙動不変
   - ship を将来差し替えるための準備 commit (renderer 側はまだ渡さない)
2. **Commit B-2** `feat(SelfShipRenderer): cameraYawRef 直読 → phaseSpace.heading`
   - 自機 hull の回転を `player.phaseSpace.heading` から yaw 取得
   - camera yaw と heading は同期しているので挙動不変を期待、visual に差分がない
     ことを確認
3. **Commit B-3** `feat(OtherPlayerRenderer): 他機の描画を phaseSpace.heading で向ける`
   - 現状が velocity 方向 fallback 等なら、そこから明示的 heading へ
   - ship 展開済ならここで M pattern と組み合わせ
4. **Commit B-4** `feat(AccelerationArrow): 他機にも展開、phaseSpace.alpha を Λ(u_obs)^{-1} で boost`
   - SESSION.md 「進行方向可視化 分岐 A」の実現。自機だけだったものを他機へ
5. **Commit B-5** `feat(exhaust): exhaust の方向を phaseSpace.alpha から駆動`
   - 他機 exhaust の向きが物理整合
   - LH は alpha=0 なので exhaust なしのまま

**デプロイ**: 各 commit 単位か、B-1..B-2 を 1 セット、B-3..B-5 を 1 セットで 2 回
deploy が無難。

---

### Phase C: 旧 ref / 旧 wire 互換 shim 撤去

1. **Commit C-1** `chore: 受信側 heading / alpha の optional default 補完を厳格化`
   - 数 session 後、全 peer 新 build 確認できたら optional → required
   - 旧 client が混入した場合は無視 or error log (接続維持)
2. **Commit C-2** `refactor: cameraYawRef の ship 向き情報として使う箇所を全撤去`
   - ship 描画は phaseSpace.heading に一本化、cameraYawRef は camera にのみ使う

---

## リスク + 対策

| リスク | 対策 |
|---|---|
| wire format 混在期に新 client の UI に旧 client の heading / alpha が欠落 = 静止描画 | Phase A で default 補完、UI 上 regressi が出ない (ship が不動かはヒアリング) |
| Phase A デプロイ後に phaseSpace の size 倍増で 帯域圧迫 | 試算: +16 floats × 10 Hz × N_peers = +64 byte/s/peer、無視できる |
| quaternion の singular / 非正規化蓄積 | tick ごとに `normalize(heading)` (安価)、broadcast 直前にも念のため |
| u·α = 0 制約違反 | 構築時に rest 系→world boost で自然に満たす、受信時は alpha_t を `(u·α_spatial)/u_t` で再導出 (spatial だけ受信する手もあるが Vector4 対称性優先で冗長格納) |
| 既存 worldLine.history が旧型 snapshot だった場合の load | `applySnapshot` で default 補完、旧 session の snapshot file は捨てて良い |
| Phase B で renderer 差し替え時の座標系取り違え | 1 commit 1 renderer に絞って小刻みに deploy、visual regression を odakin が localhost で確認 |
| quat yaw↔rotation 方向の sign 間違い | 専用 unit test: yaw=π/2 が `(0, 1, 0)` を `(0, 1, 0)` から `(1, 0, 0)` に回すか逆か、明示的に確認 |

---

## 合計サイズ見積り

- **Phase A**: 4 commit、約 12 file、新規 150 行 (quat helpers) + 300 行
  (型拡張 + validator + snapshot + gameLoop + worldLine + test)、delete 少量。
  **1 day 規模**。
- **Phase B**: 5 commit、約 5 file、1 commit あたり 50-100 行。**半 day 規模**。
- **Phase C**: 2 commit、renderer 側 cleanup のみ。**数時間**。

トータル **1.5-2 day の集中作業**、段階デプロイで 3-4 日のカレンダー時間。

---

## Future work (本 plan の範囲外)

- **RotationalMomentum / 角速度**: heading を dynamically 変化させるには angular
  velocity state と integration が要る。現状 camera yaw 直駆動なので不要、ship に
  自律旋回 (thrust 中の自動 yaw とか) を足す時に Q5 見直し
- **η-perp cross-section (B-1 of M-matrix doc)**: 現 apparent shape は Euclidean
  perp。高速 ship で η-perp に変えるなら heading と alpha を使って rest frame 分解
  が必要
- **AccelerationArrow の共変 α^μ 可視化**: Phase B-4 で導入するが、教育的 UX の
  設計は別途
- **camera pitch も heading に統合**: 3+1 移行時に。2+1 では yaw のみ使用
