# DESIGN.md 再編 作業計画 (2026-04-15)

現状: 1186 行。閾値 (1000 行、`convention-design-principles.md` §6 の延長) を超過。

## 編集方針 (ユーザー確認済み)

1. **実編集の積極度**: 大胆、ただし知見喪失に注意
2. **Authority 解体**: 1 主セクションに集約、散在 ※ 注釈 entry は本文吸収 → 削除
3. **claude-config**: 実践先行、規約はその後
4. **Stage 1 から着手**

---

## Stage 1: 分類監査 (本ファイル)

タグ凡例:
- **A** = ACTIVE (現行挙動を規定、残す)
- **D** = DEFER (un-defer トリガー付き、残す)
- **SP** = SUPERSEDED-with-pedagogy (他 entry に吸収 or 統合)
- **SX** = SUPERSEDED-pure (削除、git log に委任)
- **L** = LESSON (メタ原則セクションへ集約)
- **A+L** = 両方の性質を持つ (分解)

全 70 entries:

| L | Section (短縮) | Tag | 新構造での行き先 |
|---|---|---|---|
| 5 | Authority 解体アーキテクチャ | A+L | § Authority 解体 (主) / メタ原則に教訓抽出 |
| 184 | リファクタリング現状評価 (表) | A | § State 管理 (圧縮) |
| 196 | Zustand 移行 | A+L | § State 管理 / メタ原則 (stale スナップショット教訓) |
| 235 | MAX_DELTA_TAU 撤廃 | A+L | § 物理 / メタ (座標時間は壁時計に忠実) |
| 241 | スポーンエフェクト色の遅延解決 | A | § 描画 |
| 247 | gameLoop 後半 stale state 修正 | A+L | § State 管理 / メタ (getState 再取得 pattern) |
| 253 | 世界線ジャンプの根本原因 | L★ | メタ原則 (対症療法 vs 根治、書き込み元を断つ) |
| 260 | レーザー方向マーカー | A | § 描画 |
| 267 | A/D 横移動方向修正 | SX | **削除** (trivial bug fix) |
| 272 | 初回スポーンの統一 | A | § 物理 |
| 278 | リスポーン後無敵 | A (with SP body) | § 物理 (※ 注釈旧本文を削除、respawnLog 派生の現行のみ) |
| 290 | 世界スケール半減 | A+L | § 描画 / メタ (二重半減の罠、機械的半減後の視覚チューニング) |
| 302 | 光円錐描画の再調整 | A | § 描画 (L840 と統合) |
| 308 | FIRING 表示バグ修正 | SX | **削除** (trivial) |
| 313 | コードベース一括整理 (8 項目の列挙) | SX | **削除** (commit log) |
| 328 | game/ のファイル配置 flat vs subdir | A | § アーキ (小) |
| 334 | visibilitychange によるゲームループ停止 | A | § UI / ライフサイクル |
| 341 | ~~syncTime タイミング問題~~ | SX | **削除** (完全廃止の stub) |
| 345 | ~~setPlayers ラッパー~~ | SX | **削除** (廃止の stub) |
| 349 | 灯台因果律ジャンプ | A | § 物理 |
| 356 | リスポーン座標時間の全員死亡フォールバック | A | § 物理 (L875 と統合) |
| 362 | ホストマイグレーション堅牢化 | SP | § Authority 解体に吸収 (roleVersion, 降格, redirect の要点保持) |
| 408 | START でホスト決定 + syncTime 初期化 | SP | § Authority 解体に吸収 (syncTime 廃止済み) |
| 419 | ホスト ID 根本修正: ビーコン専用化 | A | § ネットワーク (L1153 と統合) |
| 435 | デブリの相対論的速度合成 | A | § 物理 |
| 441 | useGameLoop の依存管理設計 | A+L | § State 管理 / メタ (deps 安定性分析) |
| 447 | ゴースト reducer の React batch race | A+L★ | メタ原則 (reducer 純関数、batch race) |
| 454 | グローバルリーダーボード: KV 単一キー | A | § 通信 |
| 460 | sendBeacon CORS: text/plain | A+L | § 通信 / メタ (CORS セーフリスト) |
| 467 | handleKill 二重キル防止ガード | A | § State 管理 |
| 473 | score メッセージの未使用 | SX | **削除** (Stage C-1 で型ごと削除済み) |
| 480 | Stale プレイヤー処理の設計整理 | A+L | § State 管理 (S-1〜S-5 の教訓統合) |
| 512 | ロビー画面 + i18n + 表示名 + ハイスコア | A | § UI / 通信 に分解 (i18n, 表示名, ハイスコア) |
| 538 | ホストタブ hidden 時の PeerJS ID 解放 | A | § ネットワーク |
| 546 | ホストマイグレーション (2026-04-11) | SP | § Authority 解体に吸収 (heartbeat, peerList, 選出) |
| 562 | レーザーエネルギー制 | A | § UI / ゲーム |
| 573 | 因果律スコア | A (with SP body) | § 物理/UI (※ 注釈部分を残し旧 `score` broadcast 記述削除) |
| 582 | モバイルタッチ入力: 全画面ジェスチャ | A | § UI |
| 598 | myDeathEvent は ref 一本 | A+L | § State 管理 / メタ (effect deps 注意) |
| 604 | ICE servers: 動的 credential fetch | A | § ネットワーク |
| 612 | setState reducer は純関数 | L★★ | メタ原則 (中核教訓、~35 行) |
| 648 | 物理エンジン: ファクトリパターン | A | § 物理 (1 行に圧縮可) |
| 654 | ネットワーク: WebRTC + WS Relay | A | § ネットワーク (overview) |
| 660 | 自動接続: PeerJS の unavailable-id | SP | § ネットワーク (ビーコン化で部分 supersede、簡略化) |
| 666 | レンダリング: 過去光円錐に基づく描画 | A | § 描画 (philosophy) |
| 672 | 過去光円錐交差の統一ソルバー | A | § 物理 |
| 680 | WorldLine 描画最適化: Lorentz 行列適用 | A | § 描画 |
| 687 | 当たり判定: ホスト権威 + 世界系 | SP | § Authority 解体に吸収 (Stage B で target-authoritative 化) |
| 694 | 永続デブリ | A | § 描画 |
| 700 | 世界系カメラ: プレイヤー追随 | A | § 描画 / UI |
| 707 | 因果律の守護者: 未来光円錐チェック | A | § 物理 (L854 と統合) |
| 715 | 色割り当て: joinOrder × 黄金角 | A+L★ | § 描画 (現行) / メタ原則 (「純関数で書けないか」の教訓) / 5 パッチ履歴は git log 委任 (大幅圧縮) |
| 795 | 世界線管理: lives[] 廃止 | SX | **削除** (完全廃止) |
| 801 | 世界線の過去延長: origin + 半直線 | SP | § 描画 (L272 で origin = null 統一、現行は半直線なしに圧縮) |
| 808 | 因果的 trimming | A | § 物理 |
| 816 | マテリアル管理: R3F 宣言的 | A | § 描画 |
| 822 | Kill/Respawn: 世界線凍結 + isDead 一元管理 | A (with SP) | § 物理 / § State 管理 |
| 833 | 死亡時の描画哲学: 物理に任せる | A | § 描画 (philosophy) |
| 840 | 光円錐の奥行き知覚: FrontSide | SP | § 描画 (L302 と統合、現行 DoubleSide opacity 0.08 + ワイヤーフレーム) |
| 847 | メッセージバリデーション | A | § 通信 |
| 854 | 因果律の守護者: 死亡プレイヤー除外 | A | § 物理 (L707 と統合) |
| 861 | 世界オブジェクト分離 | A | § 描画 (philosophy) |
| 869 | デブリ maxLambda: observer 非依存化 | A | § 描画 |
| 875 | リスポーン座標時刻: 全プレイヤー maxT | A | § 物理 (L356 と統合) |
| 883 | キル通知の因果律遅延 | A | § 物理 |
| 891 | スポーンエフェクトの因果律遅延 | A | § 物理 |
| 899 | isInPastLightCone: 関数抽出 | A | § 物理 |
| 906 | pastLightConeIntersectionPhaseSpace 削除 | SX | **削除** (trivial) |
| 911 | 時間積分: Semi-implicit Euler | A | § 物理 |
| 917 | ゴースト 4-velocity: Vector3→Vector4 | A+L | § 物理 / メタ (TypeScript 構造型付けの穴) |
| 923 | ホスト権威メッセージの二重処理防止 | SP | § Authority 解体に吸収 (Stage B/C/D で解消) |
| 937 | 残存する設計臭 #1-#4 (~205 行) | D | § Defer (現状維持、僅かに圧縮) |
| 1145 | カスタム hook の返り値安定性 | A+L | § State 管理 / メタ (useMemo で安定化) |
| 1153 | ビーコン Peer パターン | A | § ネットワーク (L419 と統合) |
| 1168 | OFFSET 設計: 固定値の失敗 | A+L | § ネットワーク / メタ (Float32 の罠) |
| 1176 | クライアント自己初期化 | SP | § Authority 解体に吸収 (syncTime 廃止済み) |

### 集計

| タグ | 数 | 処理 |
|---|---|---|
| A / A+L | 44 | トピック別再編 |
| SP | 10 | Authority 解体セクションに吸収 or 現行 entry に統合 (6 は Authority 解体、4 は別統合) |
| SX | 8 | **削除** (git log 保持) |
| L★ | 3 | メタ原則セクションに重点採録 |
| D | 1 (大) | § Defer 現状維持 |

---

## Stage 2: 新構造 (骨子)

```
DESIGN.md (目標 600-700 行)
│
├─ § メタ原則・教訓 (新設、冒頭)
│   ├─ setState reducer は純関数に保つ (L612 from、大)
│   ├─ 書き込み元を断つ: 対症療法 vs 根治 (L253 + L715 色バグ)
│   ├─ 「X を Y の純関数で書けないか」 (L715 メタ設計節抽出)
│   ├─ Zustand getState の stale スナップショット (L196 末尾抽出)
│   ├─ stale state は tick 内で getState 再取得 (L247)
│   ├─ useEffect deps の安定性分析 (L441, L1145)
│   ├─ 座標時間は壁時計に忠実 (L235)
│   ├─ 二重半減の罠 / 機械的 refactor 後の視覚チューニング (L290)
│   ├─ CORS セーフリスト (sendBeacon は text/plain) (L460)
│   ├─ THREE.js は Float32 — 時空座標は小さく保つ (L1168)
│   └─ TypeScript 構造的型付けの穴 (L917)
│
├─ § アーキテクチャ overview (超短縮)
│   ├─ データ層と表現層の分離 (Authority 解体 原理 0)
│   ├─ 世界オブジェクト分離 (L861)
│   ├─ 死亡時の描画哲学 (L833)
│   ├─ 過去光円錐に基づく描画 (L666)
│   ├─ 物理エンジン: ファクトリパターン (L648 圧縮)
│   └─ game/ 配置: flat vs subdir 基準 (L328 短縮)
│
├─ § Authority 解体 (完了リファクタ、集約)
│   ├─ 動機 / 原理 / 結果 (L5 上部)
│   ├─ Stage A〜H の要点 (L5 下部の節を集約)
│   ├─ 旧設計との差分 (吸収: L362 堅牢化、L408 START 決定、L546 マイグレ、L687 当たり判定、L923 二重処理防止、L1176 自己初期化)
│   └─ Heartbeat 積極化 (Stage G の前提)
│
├─ § ネットワーク
│   ├─ WebRTC + WS Relay 概観 (L654)
│   ├─ 自動接続: unavailable-id (L660 簡略)
│   ├─ ビーコン専用化 (L419 + L1153 統合)
│   ├─ ホストタブ hidden grace (L538)
│   ├─ ICE servers: 動的 fetch (L604)
│   └─ OFFSET 設計 (L1168 現行部分)
│
├─ § 物理
│   ├─ 時間積分: Semi-implicit Euler (L911)
│   ├─ 因果律の守護者 (L707 + L854 統合)
│   ├─ 過去光円錐交差ソルバー (L672 + L899)
│   ├─ 因果的 trimming (L808)
│   ├─ リスポーン座標時刻 (L356 + L875 統合)
│   ├─ 初回スポーン = リスポーン統一 (L272)
│   ├─ 灯台因果律ジャンプ (L349)
│   ├─ デブリ速度合成 (L435)
│   ├─ キル・スポーン通知の因果律遅延 (L883 + L891 統合)
│   ├─ リスポーン後無敵 (L278 現行部分)
│   └─ ゴースト 4-velocity (L917 決定部分)
│
├─ § 描画
│   ├─ WorldLine: Lorentz 行列最適化 (L680)
│   ├─ WorldLine origin (L801 現行部分、半直線なし)
│   ├─ R3F 宣言的マテリアル (L816)
│   ├─ 光円錐描画 (L302 + L840 統合)
│   ├─ 永続デブリ + maxLambda observer 非依存 (L694 + L869)
│   ├─ 色割り当て (L715 現行: joinOrder × 黄金角 + ハッシュ)
│   ├─ スポーンエフェクト色遅延解決 (L241)
│   ├─ レーザー方向マーカー (L260)
│   └─ 世界系カメラ (L700)
│
├─ § State 管理
│   ├─ Zustand 移行 (L196 構造表 + 設計判断)
│   ├─ リファクタリング現状評価 (L184 圧縮)
│   ├─ Kill/Respawn 世界線凍結 (L822)
│   ├─ handleKill 二重キル防止 (L467)
│   ├─ Stale プレイヤー処理 (L480)
│   ├─ myDeathEvent ref 管理 (L598)
│   └─ gameLoop tick 3 フェーズ分割 (L247)
│
├─ § UI / 入力
│   ├─ visibilitychange ループ停止 (L334)
│   ├─ モバイルタッチ入力 (L582)
│   ├─ レーザーエネルギー制 (L562)
│   ├─ ロビー + i18n + 表示名 + ハイスコア (L512)
│   └─ 因果律スコア (L573 現行)
│
├─ § 通信・セキュリティ
│   ├─ メッセージバリデーション (L847)
│   ├─ グローバルリーダーボード KV (L454)
│   └─ sendBeacon CORS (L460)
│
└─ § Defer 判断
    └─ 残存する設計臭 #1-#4 (L937 現状維持、4 エントリ内の冗長部分を僅かに圧縮)
```

予想行数: 600-700 行 (1186 - 削除分 ~200 - 統合重複排除 ~200 - SP 本文吸収圧縮 ~100 + メタ原則新設 +80)

---

## Stage 3: 実編集の手順

大きい変更なので全文書き換え (Write tool で全体置換) とする。Edit で細切れにすると保守困難。

1. 新 DESIGN.md を丸ごと書く (Stage 2 骨子 + 既存本文の再配置・圧縮)
2. 旧 DESIGN.md の本文をセクション順に拾って新構造に配置
3. SP entries の本文を吸収先 entry に段落単位で統合
4. L★ を メタ原則セクションに移動・再構成
5. SX を確実に落とす (git log で復元可能)

**重要**: 新 DESIGN.md は 1 回の Write で生成し、Stage 3 完了時点で commit。後続作業で行番号が変わっても既存参照 (SESSION.md の L39 仮説 1 引用等) は「DESIGN.md 『過去半直線延長を廃止』参照」のような semantic reference にする。

## Stage 4: EXPLORING.md cross-check

EXPLORING.md L152-208「2026-04-10 の設計議論と方針決定」— "方針決定" というタイトルが (c) defer または (a) active decision の混入を示唆。精読して、決定部分が含まれていたら DESIGN.md に promote。

## Stage 5: claude-config フィードバック

Stage 1-4 完了後、実践で得た知見を `convention-design-principles.md` §6 拡張または §7 新設としてまとめる:

1. **超越済み content の lifecycle 規則**
   - ABANDONED → 削除 (git log)
   - SUPERSEDED-pedagogy → 現 decision に統合 or 完了リファクタセクションに集約
   - SUPERSEDED-pure → 1-2 行 stub にするか削除
2. **完了リファクタの集約 pattern**
   - N 箇所に ※ 注釈を散在させず、1 つの「完了リファクタ」セクションへ
   - 各 Stage の要点 + 旧設計との差分を 1 箇所で
3. **メタ原則 / 教訓セクション**
   - post-mortem (設計原理として再利用できる学び) は各 decision に埋めず冒頭に集約
   - 個別 decision entry は実装事実、メタ原則は横断的学び、の役割分離
4. **サイズ閾値**
   - 400 行超: EXPLORING.md 分離を検討
   - 1000 行超: トピック別再編を検討
   - SP/SX entry が 10 個超: 完了リファクタ集約を検討

---

## 次の Action

Stage 2-3 (実編集) に進むか、その前に Stage 2 骨子への詳細コメントを貰うか。
