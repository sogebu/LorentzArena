# DESIGN.md 再編 作業計画 (2026-04-18)

現状: 1627 行。`convention-design-principles.md §7.7` の retroactive 救済適用。
2026-04-15 Stage 実施で 1186 → 925 行に圧縮したが、2026-04-17 の大量実装 (アリーナ円柱 / ghost 物理統合 / 時間 fade / Exhaust / 時空星屑 / Temporal GC) + 2026-04-18 の migration 系 6 件で +700 行戻り、閾値 1000 を再突破。SESSION.md の「次にやること」先頭でユーザー明記の auto-context 軽減対応。

## 編集方針 (ユーザー確認済み)

1. **大胆に圧縮、ただし知見喪失に注意** (§7.7 の retroactive playbook を機械的に適用)
2. **既存の集約セクション**: § Authority 解体 / § D pattern 化 は 2026-04-15 で既に集約済み。軽量な圧縮のみ
3. **SESSION.md との整合**: 2026-04-17 以降の完了項目 (13+) は DESIGN.md に記録されているので SESSION.md 側を 1 行要約 + DESIGN 節参照に圧縮 (Stage 4)
4. **plans/2026-04-15-design-reorg.md**: 完了済み、Stage 5 で削除 or archive
5. **Stage 1 → Stage 2 骨子 → Stage 3 rewrite** の順、Stage 2 完成時点で user 承認 gate

## Stage 全体像

| Stage | 内容 | deliverable |
|---|---|---|
| 1. 分類監査 | 全 entry を ACTIVE / DEFER / LESSON / SP / SX に分類、Description 混在と §7.4 粒度違反を特定 | 本ファイルの「Stage 1」節 |
| 2. 新構造骨子 | 再配置計画、目標行数 | 本ファイルの「Stage 2」節 |
| 3. DESIGN.md 全文 rewrite | Write 1 回で全置換。SESSION.md から 2026-04-17 完了項目を 1 行要約化 | DESIGN.md / SESSION.md commit |
| 4. EXPLORING.md cross-check + plans/ 整理 | EXPLORING.md に decision 混入なし確認、plans/2026-04-15 を削除 | commit |
| 5. claude-config feedback | 今回の「line-count では抜ける肥大化」knowledge を §7 または CONVENTIONS.md §2 に反映 (byte 閾値 or reference 密度の観点)。別 session 推奨 | 別 session task |

---

## Stage 1: 分類監査

### 分類タグ凡例 (§7.1)

- **A** = ACTIVE (現行挙動を規定、残す)
- **D** = DEFER (un-defer トリガー付き、残す)
- **L** = LESSON (メタ原則セクションへ)
- **SP** = SUPERSEDED-with-pedagogy (集約先に吸収して削除)
- **SX** = SUPERSEDED-pure (削除、git log で復元可能)

### 処理戦略別サマリ

| 戦略 | 対象 | 削減目標 |
|---|---|---|
| **§7.2 SP/SX retroactive**: § Defer 判断 の #1/#3/#4 を超越処理 | 3 entry (当時の分析記録) | -120 |
| **§7.5 完了リファクタ集約**: 2026-04-18 migration 系 6 entry を 1 節に | § State 管理 L1241-1347 | -80 |
| **§7.3 Description 退避**: CLAUDE.md / constants.ts に重複記述を移管 | § 描画 の 2026-04-17 大項目、§ State 管理「ストア設計」表 | -60 |
| **§7.4 粒度圧縮**: 過剰な事例列挙・ボツ候補詳細・History 節を圧縮 | § 描画 大項目、§ 物理 スポーン座標時刻、M17 | -120 |
| **軽量 in-place 圧縮**: 重複・冗長の排除 | 全体 | -50 |
| 合計 | | **-430** |

目標: 1627 → **~1200 行** (stretch goal: ~1000)。2026-04-15 と同率の 25% 圧縮ライン。

### セクション別分類

#### § メタ原則・教訓 (L21-301, 280 行) → 目標 **240 行** (-40)

| M | 節 | L | Tag | 処理 |
|---|---|---|---|---|
| M1-M12 | 2026-04-15 lift 済み | 25-150 | A | 現状維持 |
| M13 | 時空 anchor は表現で選ぶ | 152-167 | A | 現状維持 |
| M14 | 球除外 + extended 物体 D pattern | 168-178 | A | 現状維持 |
| M15 | HMR stale 切り分け | 179-188 | A | 現状維持 |
| M16 | 時間蓄積 O(N) 性能問題 | 189-205 | A | 事例節 3 段落 → 1 段落、-5 |
| **M17** | 毎 tick geometry in-place update | 207-279 | A | **74 行と突出**。v0 antipattern + v1 正解 code を各 10 行→6 行、trap 1/2 保持、事例 5 段落→1 段落、-25 |
| M18 | 性能切り分け二分法 | 281-298 | A | 事例節 2 段落 → 1 段落、-5 |

#### § アーキテクチャ overview (L302-344, 42 行) → 目標 **40 行** (-2)

ほぼ現状維持。`データ層と表現層の分離` 以下 6 小節、各 4-8 行で既に簡潔。

#### § Authority 解体 (L345-435, 90 行) → 目標 **80 行** (-10)

| L | 節 | Tag | 処理 |
|---|---|---|---|
| 347 | commit 一覧 (preamble) | A | 一部 hash を削除可 (詳細 commit は plan ファイル側で参照済み) -5 |
| 349-366 | 動機 / 原理 | A | 現状維持 |
| 367-418 | Stage A〜H 要点 | A | Stage B の「body senderId 検証しない判断」2 段落→1 段落、-5 |
| 419-432 | マイグレーションで消えたもの / mesh 化 | A | 現状維持 |

#### § D pattern 化 (L436-510, 75 行) → 目標 **70 行** (-5)

| L | 節 | Tag | 処理 |
|---|---|---|---|
| 440-445 | 動機 | A | 現状維持 |
| 446-465 | 原理 / Phase 別要点 | A | 現状維持 |
| 466-475 | 球の例外 → M14 | A | M14 cross-ref で重複部分を 1-2 行削れる、-3 |
| 476-510 | 代替検討 / 残存 / commit / 今後 | A | commit 一覧を 1 行に、-2 |

#### § ネットワーク (L511-585, 75 行) → 目標 **75 行** (±0)

現状維持。8 小節、各 6-10 行で簡潔。OFFSET 設計は M10 と cross-ref 済み。

#### § 物理 (L586-764, 180 行) → 目標 **155 行** (-25)

| L | 節 | Tag | 処理 |
|---|---|---|---|
| 590-642 | 時間積分〜isInPastLightCone 抽出 | A | 現状維持 |
| 644-650 | 因果的 trimming | A | 現状維持 |
| **652-688** | **スポーン座標時刻 (38 行)** | A | 「将来耐性」「LH alive 役割」「History リスト (6 段階)」「対称設計なぜ」節を圧縮、中核の「自機除外 + 死亡者 placeholder」原則 2 項目と excludeId fallback + buildSnapshot 統合 と最終採択理由のみ残す、-15 |
| 690-709 | Thrust energy (20 行) | A | 6/9/12 秒比較表は保持、ブレーキ優遇不採用を 1 行に、UI 強調節を 1 行に、-5 |
| 710-762 | 初回スポーン統一〜ゴースト 4-velocity | A | 現状維持 |

#### § 描画 (L765-1156, 390 行) → 目標 **290 行** (-100)

最大の圧縮対象。各 2026-04-17 大項目を Description 退避 + ボツ候補圧縮で 20-30% 削減。

| L | 節 (行数) | Tag | 処理 |
|---|---|---|---|
| 767-776 | WorldLine Lorentz 行列 (10) | A | 現状維持 |
| 777-780 | 世界線の過去延長廃止 (4) | A | 現状維持 |
| 781-794 | R3F 宣言的マテリアル + 光円錐 (14) | A | 現状維持 |
| 795-806 | 永続デブリ + maxLambda (12) | A | 軽量、-2 |
| 807-831 | 色割り当て (25) | A | 現状維持 |
| 832-858 | レーザー方向 / 光円錐交点三角形 (27) | A | 現状維持 |
| 859-874 | opacity 定数化 (16) | A | tradeoff 節を圧縮、-3 |
| 875-896 | Spawn エフェクト (22) | A | latent bug 記述を 2 段落→1 段落、-5 |
| **897-913** | **worldLine.history 5000→1000 (17)** | A | 「O(N) 発生元」列挙 2 段落を CLAUDE.md の既存「物理コア規約」節へ退避、判断部分のみ残す、-5 |
| **914-921** | **実装 (二分探索) (8)** | A | 複雑度試算表は保持、-3 |
| **922-940** | **Vitest 導入 (19)** | A + Description 混在 | **手順部分 (pnpm add -D vitest 等)** は CLAUDE.md の既存「テスト (Vitest)」節と重複 → 削除。判断 + 教訓のみ残す、-10 |
| **941-967** | **Temporal GC (27)** | A | 最未来点 table を constants.ts コメント側 or CLAUDE.md へ退避、判断部分と閾値根拠のみ残す、-10 |
| 968-975 | Spawn effect depthWrite (8) | A+L | LESSON「透明物は depthWrite=false 統一」として M19 候補 or in-place。§7.5 では 3+ で lift、他に同種なら次回、in-place で -3 |
| **976-1024** | **アリーナ円柱 (49)** | A | **最重要圧縮**: position attribute layout の詳細 (「clamped 共有 attribute × N×2×3、unclamped pastCone × N×3」) は CLAUDE.md「アリーナ円柱」既存記述へ退避、「2026-04-18 下限ガード案」「surface 削除案却下」など過去経緯を 1-2 行に、代替検討は 1 箇所に統合、-25 |
| **1026-1057** | **Exhaust (32)** | A | 色試行錯誤の歴史 (初版プレイヤー色 → 青プラズマ統一) を 1 段落に、パラメータ列挙を constants.ts 参照に、-12 |
| **1058-1117** | **時間 fade (60)** | A | 対象オブジェクト表を CLAUDE.md へ (CLAUDE.md に既に類似記述あり)、却下式 4 種を 1 段落に、r 選択経緯 4 段階を 1 段落に、Fragment inject key 対応は M17 cross-ref で短縮、-25 |
| **1118-1146** | **時空星屑 (29)** | A | 定数表を CLAUDE.md「StardustRenderer」節へ、Haiku 版欠陥 3 段落を git log に委任 (revert commit 記録済み)、timelike drift 実験を 1 段落に、-12 |
| 1147-1154 | 世界系カメラ (8) | A | 現状維持 |

#### § State 管理 (L1157-1347, 190 行) → 目標 **110 行** (-80)

**§7.5 新集約セクション**: 「§ 完了リファクタ: migration 堅牢化 (2026-04-18)」を新設して 6 entry を集約。isMigrating reset は SX (本人も「後続で削除」明記)。

既存 ACTIVE 部分:

| L | 節 | Tag | 処理 |
|---|---|---|---|
| 1159-1192 | Zustand 移行 | A + Description 混在 | **「ストア設計」表 (L1175-1184)** は CLAUDE.md「Store 構造」と重複 → 削除、judgment 部分「判断」節 (L1186-1192) のみ残す、-10 |
| 1193-1204 | リファクタリング現状評価 | A | 現状維持 (既に表のみ) |
| 1205-1210 | handleKill 二重キル防止ガード | A | 現状維持 |
| 1211-1234 | Stale プレイヤー処理 | A | S-1〜S-5 修正済みの enumeration を詳細化 (構造ブロックは残す)、-3 |
| 1235-1240 | myDeathEvent は ref で持つ | A+L | 現状維持 (M6 と cross-ref 済み) |

**新集約: § 完了リファクタ: migration 堅牢化 (2026-04-18)** (新設、目標 60 行):

| 元 L | 元節 | Tag | 集約先 |
|---|---|---|---|
| 1241-1256 | owner respawn tick poll (16 行) | SP | 集約節「tick poll 駆動」、教訓「setTimeout は state-derived polling に置換」を in-place (LESSON lift は別 decision で参照され始めた時に) |
| **1257-1273** | **isMigrating reset (17 行)** | **SX** | 本人明記「後続で削除」、assumeHostRole 節の「anti-pattern 背景」として 2 段落吸収 → 削除 |
| 1274-1294 | assumeHostRole 集約 (21 行) | A (核) | 集約節の主節、教訓「transition 内部で副作用を同期実行」を in-place |
| 1295-1304 | snapshot pull retry (10 行) | SP | 集約節「snapshot 二経路」、教訓「silently-failing 初期化路に retry」を in-place |
| 1305-1321 | migration gap (17 行) | SP | 集約節「worldLine gap 検知」、教訓「幾何補間のなめらかな嘘」を in-place |
| 1322-1325 | 世界線凍結先の統一 (4 行) | A | 集約節に 1 段落吸収 |
| 1326-1347 | alone solo host (22 行) | SP | 集約節「alone 判定」、教訓「role transition で role variable bump + alone 判定」を in-place |

集約節構成 (目標 60 行):
```
### § 完了リファクタ: migration 堅牢化 (2026-04-18)

#### 動機
React component lifecycle に依存した scheduling (setTimeout) と、
外部 hook による flag reset anti-pattern、
stale beacon redirect で ghost host chase が発生する alone edge case の 3 系統を同時解消。

#### 改修内容
- **tick poll 駆動**: owner respawn を killLog.wallTime poll に切替 (setTimeout は belt)
- **assumeHostRole 集約**: isMigrating state + useBeaconMigration hook 削除、
  LH ownership rewrite を transition 関数内部で同期実行
- **snapshot 二経路**: push (host → client connections diff) + pull (client が
  players.has(myId) 観測で snapshotRequest) の belt-and-suspenders
- **worldLine gap 検知**: wall-time gap >500ms で frozenWorldLines に切り出し、
  CatmullRom の「なめらかな嘘」発生源を除去
- **alone 判定**: heartbeat timeout / beacon fallback / demoteToClient の 3 経路に
  「他 peer 0 なら solo host」判定を入れ、ghost host chase を断つ
- **setRoleVersion bump**: attempt BeaconFallback redirect 経路で bump 漏れ修正、
  watchdog 再起動を保証

#### 関連原則 (in-place)
- 不安定な lifecycle に依存する scheduling → state-derived polling に置換
- transition の副作用は flag で外部に通知せず、transition 関数内部で同期実行
- silently-failing 初期化路 → source-of-truth observable (例: players.has(myId)) の retry 経路をセットで
- 幾何補間 (CatmullRom, TubeGeometry) は不連続性を明示的に導入しないと補間器がなめらかな嘘を生成
- role transition で role variable bump を忘れると watchdog 再起動しない
- alone (他 peer なし) は solo host の必要条件、fallback 経路の alone 判定で ghost chase を断つ
```

#### § UI / 入力 (L1348-1411, 63 行) → 目標 **63 行** (±0)

現状維持。4 小節、各 6-20 行で簡潔。pitch 廃止 (L1375-1377) は 2026-04-17 ghost 物理統合の余波だが、既に 2 段落で簡潔。

#### § 通信・セキュリティ (L1412-1455, 43 行) → 目標 **43 行** (±0)

現状維持。

#### § Defer 判断 (L1456-1627, 170 行) → 目標 **50 行** (-120)

**最大の圧縮対象**。現行 DEFER は #2 のみ、#1/#3/#4 は既に超越済みと entry 内に明記あり。§7.2 適用。

| L | 節 | Tag | 処理 |
|---|---|---|---|
| 1458-1462 | 残存する設計臭 preamble | A | 簡略化 (2026-04-06 監査 → #2 のみ現行 DEFER、他は Authority 解体で自然消滅) |
| **1464-1489** | **#1 deadPlayersRef mirror (26 行)** | **SP** | 末尾「解決 (2026-04-12) `172b600`」と既に明記 → 削除、再評価判断表 (L1596) の 1 行に統合 |
| 1490-1537 | **#2 connections useEffect diff (48 行)** | **D** | **唯一の現行 DEFER**、コード例と再評価判断を残しつつ圧縮 30 行へ |
| **1538-1568** | **#3 kill dual entry (31 行)** | **SX** | 冒頭「※ Authority 解体 Stage B/C/D で解消済み」明記、2026-04-06 当時の分析記録は git log に委任 → 削除 |
| **1569-1583** | **#4 timeSyncedRef (15 行)** | **SX** | 冒頭「※ Authority 解体 Stage F-1/H で `syncTime` 廃止済み」明記 → 削除 |
| 1587-1627 | 再評価判断 (41 行) | SP | 「色バグとの類似を疑う」「ROI 並べ直し」「束ねる論法の破綻」は pedagogy として価値 → 圧縮して残す、後日談表 (L1612) は 1 行に、再 un-defer 条件 (4 項目 checklist) は残す。15 行へ |

**圧縮後の § Defer 判断** (目標 50 行):
```
### § Defer 判断

2026-04-06 に「残存する設計臭 #1-#4」として監査したが、#1/#3/#4 は Authority 解体
(2026-04-15) 等で自然消滅、現行 DEFER は #2 のみ。

#### 残存臭 #2: connections useEffect で外部イベントを React state 経由で diff

[コード例 + なぜ smell か + 解消方向、30 行]

**un-defer トリガー**: (a) 接続ライフサイクルに絡む実バグ観測、
(b) snapshot / sync ハンドシェイクを別設計に差し替える機会、
(c) PeerProvider に reconnecting 等の phase 概念が必要な機能

#### 再 un-defer 共通チェック

[4 項目 checklist、15 行]

#### 振り返り (2026-04-06 再評価 pedagogy、圧縮版、5 行)

4 件すべて「guard があって正しく動いているが見た目が冗長」で、
色バグ (distributed race で実害あり) と質が違う。ROI で並べ直すと全件 defer が正。
「束ねる論法」は「どのみちやる」前提の節約論で、やる価値自体を疑うと節約効果も 0×2=0。
```

---

## Stage 2: 新構造骨子

```
DESIGN.md (目標 ~1200 行、stretch goal ~1000)
│
├─ 目次 (16 行)
│
├─ § メタ原則・教訓 (240 行、M1-M18 維持、M17 圧縮)
│
├─ § アーキテクチャ overview (40 行)
│
├─ § Authority 解体 (完了リファクタ) (80 行)
│
├─ § D pattern 化 (完了リファクタ) (70 行)
│
├─ § 完了リファクタ: migration 堅牢化 (2026-04-18) (新設、60 行)
│   ├─ 動機
│   ├─ 改修内容 (6 項目要約)
│   └─ 関連原則 (6 項目 in-place LESSON)
│
├─ § ネットワーク (75 行)
│
├─ § 物理 (155 行、スポーン座標時刻圧縮)
│
├─ § 描画 (290 行、2026-04-17 大項目圧縮)
│
├─ § State 管理 (110 行、migration 系は上記集約に移譲、Zustand 表 → CLAUDE.md 退避)
│
├─ § UI / 入力 (63 行)
│
├─ § 通信・セキュリティ (43 行)
│
└─ § Defer 判断 (50 行、#2 + 共通チェック + 振り返り)
```

**合計: 1292 行** (stretch goal 達成のため Stage 3 rewrite で更に -100 目指す — 特に § 描画 の 2026-04-17 項目を 30% でなく 40% 削れるか実寸試行)

---

## Stage 3: 実編集の手順

1. DESIGN.md を **Write 1 回で全置換** (Edit 連打は file state 依存で fragile、2026-04-15 実施済みパターン)
2. SESSION.md の完了リファクタ列挙 (L9-27) を 1 行要約 + DESIGN § 節名参照に圧縮
3. 内部参照は **semantic reference** (CONVENTIONS.md §2 の規約、行番号禁止)
4. constants.ts / CLAUDE.md 側への Description 退避は commit を分離 (まず DESIGN.md 圧縮 commit → 続いて Description 統合 commit)
5. 各 commit 後に lint + tsc + preview 確認

---

## Stage 4: EXPLORING.md cross-check + plans/ 整理

1. EXPLORING.md に decision 混入がないか確認 (2026-04-15 でも同様 cross-check 実施済み、大規模な混入は無かったが retroactive migration 対応済み)
2. **plans/2026-04-15-design-reorg.md を削除** (完了済み、322 行、knowledge は claude-config §7 に昇格済み)
3. SESSION.md の最終圧縮確認 (目標 <10KB)

---

## Stage 5: claude-config feedback

今回の棚卸しで発生した新しい knowledge:

1. **SESSION.md の肥大化は line-count では抜ける**: 94 行で 23.8KB (1 行 250 bytes)。CONVENTIONS.md §2 の「目安 80 行」に **byte 閾値 (例: 10KB)** を追加
2. **plans/YYYY-MM-DD-*.md の lifecycle**: 完了後の処理 (削除推奨 / archive 保留 / 1 行要約化) を明文化
3. **reference 密度の観点**: SESSION.md の各完了項目が DESIGN.md の長大な節名を詰め込むと行が膨れる。「完了項目は 1 行 = 1 commit hash + DESIGN § 節名」のみ規約化

これらは LorentzArena 個別対応後に別 session で claude-config に反映 (ユーザー初期対話の推奨順 A → B に対応)。

---

## 実施結果 (Stage 3 完了時に追記)

| Stage | 結果 | commit |
|---|---|---|
| 1. 分類監査 | 本ファイル | — |
| 2. 新構造骨子 | 本ファイル | — |
| 3. DESIGN.md rewrite + SESSION.md 圧縮 | 未実施 | — |
| 4. EXPLORING cross-check + plans/ 整理 | 未実施 | — |
| 5. claude-config feedback | 別 session | — |

---

## 次の action (user 承認待ち)

- Stage 1 分類監査 + Stage 2 新構造骨子 が本ファイルで完成
- **Stage 3 rewrite に進む前の user 確認事項**:
  1. **目標行数 ~1200 行 (stretch ~1000)** でよいか? (2026-04-15 の 1186→925 と同率)
  2. **§ 完了リファクタ: migration 堅牢化 (2026-04-18)** 新設してよいか? (§7.5 集約 pattern、6 entry → 1 節)
  3. **§ Defer 判断 の #1/#3/#4 を削除**してよいか? (§7.2、当時の分析は git log 参照可能、#2 のみ現行 DEFER として残す)
  4. **Description 退避**: § 描画の対象オブジェクト表 / 定数列挙を CLAUDE.md / constants.ts 側に (既に一部重複しているので実質「DESIGN 側を削る」)
  5. **SESSION.md の完了項目圧縮** は DESIGN.md rewrite と同 commit で行うか、別 commit にするか
