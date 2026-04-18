# 2026-04-18: 2+1/CLAUDE.md Level-2 delegation

## 動機

LorentzArena session の autocompact が新 session でも速い (2026-04-18 ユーザー実測)。最大 auto-load offender は `2+1/CLAUDE.md` の 364 行で、そのうち **~280 行は reference 系 content** (毎 session では不要):

- Architecture sub-sections (i18n / highscores / physics / network / game): ~60 行の file-by-file table + 30 行の hooks table を含む
- Store 構造 (reactive state / event log / selectors / 撤去済): ~30 行
- Message types table (9 type × 経路・用途): ~30 行
- Parameters table (30+ constants × 値・説明): ~80 行
- Relay server security table: ~10 行

これらは code (constants.ts / message.ts / src/*) が canonical で、CLAUDE.md 側は実質 **重複** かつ **同期劣化リスク** を持っている。

`a833d97 docs(CLAUDE+SESSION): auto-context budget 削減のため dense content を DESIGN.md pointer 化` で一部既に移行済みだが、Level 2 の migration が未完。

## 目標

`2+1/CLAUDE.md` を **364 → ~80 行** にスリム化。reference は (a) 新 `2+1/docs/architecture.md` / (b) 直接 code pointer / (c) 既存 DESIGN.md に委譲。

## 抽出 / 保持計画

### CLAUDE.md に保持 (毎 session 必要)

- Header + overview (5)
- Commands (12)
- Tests summary + TDD 運用 pointer to DESIGN.md (7)
- Test/deploy 使い分け (5)
- Deploy 後報告ルール (6)
- Local preview 注意点 (HMR / preview ブラウザ ID 奪取 / multi-tab / single-tab カバー範囲) (15)
- Network 設定 env vars + pointer (10)
- アーキ超要約 (D pattern 1 行 / C pattern 例外 1 行 / network 概要 1 行 / authority / state / message の 1 行ずつ、計 8-10 行)
- Build 設定 (5)
- 参照ドキュメント pointer (`docs/architecture.md` / `DESIGN.md` / `EXPLORING.md` / `SESSION.md` / `../CONVENTIONS.md` / `../docs/NETWORKING.md`) (8)

**計 ~80 行**

### 新 `2+1/docs/architecture.md` へ抽出

- i18n 詳細 (I18nProvider / hook / translations)
- ハイスコア詳細 (local / global / 保存タイミング / `sessionId` 仕組み)
- Physics engine 詳細 (vector / matrix / mechanics / worldLine)
- Network 詳細 (PeerManager / WsRelayManager / PeerProvider / 自動接続フロー / プレイヤー初期化 / ホストマイグレーション / ビーコンパターン)
- Game components file-by-file table (30+ 行)
- Custom hooks table (src/hooks/*)
- D pattern の描画仕組み詳細
- 主要機能の箇条書き (PC/Mobile 操作 / 当たり判定 / Kill-Respawn / 世界オブジェクト分離 / etc.)
- Store 構造 (reactive / event log / non-reactive / selectors)
- Message types table

**計 ~200 行 (auto-load 外、pointer 経由でのみ読まれる)**

### 削除 (code へ pointer 化、CLAUDE.md / docs 両方から消す)

- **Parameters table**: constants.ts が canonical。`docs/architecture.md` に「パラメータは `src/components/game/constants.ts` 内で定義 + JSDoc、分類は `// --- Arena ---` / `// --- Stardust ---` 等の section コメントで示される」と 2 行の pointer
- **Message types table**: `src/types/message.ts` が canonical TS 型で、relay-worthy / Authority 所在・ bestvalidation rule も近接コメントに集約推奨。`docs/architecture.md` からは pointer のみ

### 既存 DESIGN.md / EXPLORING.md / SESSION.md に移動済み (変更なし)

- 設計 rationale、完了リファクタ (Authority 解体 / D pattern / 時空星屑 / etc.)
- EXPLORING 中の option space
- SESSION 管理

## 期待効果

| File | Before | After | Δ |
|---|---|---|---|
| `2+1/CLAUDE.md` (auto-load 対象) | 364 | ~80 | **-284** |
| `2+1/docs/architecture.md` (新設、auto-load 外) | 0 | ~200 | +200 (pointer 経由のみ) |

LorentzArena session の session-start auto-load:
- CLAUDE.md chain (odakin-prefs + LorentzArena + 2+1): 108 + 33 + 364 = 505 → 108 + 33 + 80 = **221** (-284)
- 他 (MEMORY.md 41 / work-discipline 321 / push-workflow 85) は今回変更なし

全体 auto-load: 952 → **668** (-284、~30% 削減、autocompact 頻度の大幅改善を期待)

## 実施手順 (新 session で)

前提: Phase A/B 系の uncommitted 変更が commit/deploy 完了していること。

1. `2+1/docs/` 新設 (mkdir)
2. `2+1/docs/architecture.md` 作成 — 現 CLAUDE.md から Architecture / Store / Messages 全セクションを移動 (実質 copy then cut)
3. `2+1/CLAUDE.md` を新 skeleton (目標 ~80 行) に書き直す
   - 保持項目は既存の文を可能な限りそのまま流用
   - 削除項目は「詳細: `docs/architecture.md` §X」の pointer に置換
   - Parameters は「詳細: `src/components/game/constants.ts`」の 2 行 pointer
   - Messages は「詳細: `src/types/message.ts`」の 2 行 pointer
4. `2+1/docs/architecture.md` の各 section に canonical code file への pointer を明記
5. 4 軸チェック:
   - **整合性**: 新 pointer 全 resolve (docs/architecture.md / constants.ts / message.ts / DESIGN.md / EXPLORING.md / SESSION.md)
   - **無矛盾性**: docs/architecture.md と code (constants.ts / message.ts) の内容に矛盾なし (数値・型・relay 経路・selector 名等)
   - **効率性**: `wc -l 2+1/CLAUDE.md` で ~80 確認、docs/architecture.md ~200、差引 -284
   - **安全性**: LorentzArena は public repo、従来同様 PII 無し
6. commit + push

## リスクと mitigation

- **Risk A**: docs/architecture.md への pointer を Claude が辿らない → session 開始時に architecture の全貌が把握できない
  - Mitigation: CLAUDE.md の超要約 10 行に D pattern / C pattern / network / authority / state / message の一行ずつを必ず含める (「詳細は辿って」と「超要約は見えている」の 2 層化)
- **Risk B**: constants.ts を pointer した後、CLAUDE.md の parameter 前提で書かれた他 doc (DESIGN.md 等) との整合が崩れる
  - Mitigation: 他 doc の参照は既に CLAUDE.md § Parameters ではなく constants.ts を指すように書き直されているか確認 (DESIGN.md は rationale で値自体の table は持たないので影響小の予想)
- **Risk C**: Level-2 migration 後に Architecture の情報が必要になった session で docs/architecture.md を丸ごと読むと、結局 ~200 行 load される
  - Mitigation: それは Architecture 情報が必要な session だけで、毎 session ではない。net で autocompact 頻度は下がる

## 関連

- `a833d97` — Level-1 migration (DESIGN.md pointer 化)
- `plans/2026-04-18-design-reorg.md` — DESIGN.md §7 retroactive (1627 → 1303)
- `odakin-prefs 2026-04-17` — auto-context 削減の methodology (claude-config §10 file-role architecture)
