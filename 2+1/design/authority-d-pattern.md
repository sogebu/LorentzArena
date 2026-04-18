# design/authority-d-pattern.md — 完了リファクタ (Authority 解体 + D pattern 化)

DESIGN.md から分離。2026-04-14/15 に完了済みの大型 refactor 2 件。現在 code に反映済みで、今後 archive 的参照が主。

## § Authority 解体 (完了リファクタ)

2026-04-14 設計、2026-04-15 実装完了。Stage A〜H。commits: A (`4f4bddd`) / B (`8b4932f`) / C (`01fed9d` `c076192` `6ba5174` `49c65bc`) / D (`d0d05f0` `1cc05f9` `b5579fe`) / E (`0491d52`) / F (`3153585` `70f9ac7`) / G (`5de2aed`) / H 最終 commit。詳細プラン: `plans/2026-04-14-authority-dissolution.md`。

### 動機

旧構造では `host` が (a) beacon 所有者、(b) relay hub、(c) hit detection 権威、(d) Lighthouse 駆動、(e) respawn スケジューラ、(f) peerList 発行者 を兼ねており、**host 切断時に全部を新 host に引き継ぐ必要** があった。マイグレーションが怪物化し、`useHostMigration.ts` で respawn timer 再構築、`hostMigration` メッセージで scores/deadPlayers/deathTimes を丸ごと転送、`lighthouseLastFireRef` の glitch、invincibility の欠落など、漏れやすかった。また false positive (通信瞬断の誤検知) のコストが異常に高いため、heartbeat を保守的な 3s/8s に設定せざるを得なかった。

### 原理

0. **データ層と表現層を分離**: 全 peer が全プレイヤーの world line を常時共有。相対論的光円錐遅延は表現層だけ (→ § アーキ overview)
1. **各プレイヤー (人間 / Lighthouse) は 1 人の peer が owner**。Lighthouse の owner は beacon holder (兼任)
2. **Owner だけが自分のエンティティの event を発信**: `phaseSpace` / `laser` / `kill` (= 自分が撃たれた自己宣言) / `respawn`
3. **他 peer について宣言しない** (完全対称)
4. **Hit detection は target のローカルだけ** (target-authoritative)。決定論要件なし。`Math.sin/cos` も自由
5. **Derived state**: score / deadPlayers / invincibility は kill/respawn event から導出。store に authoritative 値を持たない
6. **RNG 不要**: respawn 位置等は owner が local `Math.random` で決めて phaseSpace として broadcast
7. **Coord-time 同期は join 時 1 回だけ** (`syncTime` 廃止、`snapshot` に埋め込み)
8. **Beacon ≡ relay hub ≡ Lighthouse owner ≡ 新規入口**。star topology 維持、authority は持たない

「相対論で物理的に美しい」根拠: あなたの世界線を完全に観測できるのはあなただけ。死亡も同じく自己宣言。物理原理と一致。

### Stage ごとの要点

**A. `ownerId` 型導入**: 全プレイヤーに `ownerId: string`。`isOwner = player.ownerId === myId` を判定一元化。

**B. target-authoritative hit detection**: `processHitDetection` が owner で絞り込み。各 peer は自分 owner のプレイヤー (人間=自分、beacon holder=LH) に対してのみ判定。hit 検出した target 本人が `kill` を broadcast、beacon holder は relay hub。

- `kill` の body senderId 検証はしない判断: body の `senderId` は送信者が自己申告する値で、自分で書く値を自分で検証しても spoofing 防御にならない。二重処理防止は `selectIsDead` ガードで担保
- 真の spoofing 防御は relay 層で `_senderId (PeerJS-level) === msg.senderId` を一律に照合すること。ただし全 owner 発信メッセージに一律適用すべきで、kill 単体先行は中途半端。信頼モデル強化は直交タスク

**C. event log を source of truth、cache 撤去**:
- `killLog: KillEventRecord[]` / `respawnLog: RespawnEventRecord[]` を authoritative として追加
- `deadPlayers: Set` / `invincibleUntil: Map` / `pendingKillEvents[]` / `deathTimeMap` を撤去、全て log からの selector で derive
- `selectIsDead(state, id)` / `selectInvincibleUntil(state, id)` / `selectPendingKillEvents(state)` 等
- `firedForUi: boolean` で pending kill events を log に統合 (`killLog.filter(!firedForUi)` で derive)
- 初期プレイヤー生成も「初回 spawn = 初回 respawn」として respawnLog への entry 追加に統一。`selectInvincibleUntil` が latest respawn wallTime + `INVINCIBILITY_DURATION` を返すため、初回と 2 回目以降の spawn が同じ経路
- GC: useGameLoop tick 末尾で `gcLogs` を毎フレーム。pair 成立 kill を除去、respawn は latest 1 件/player のみ残す。`MAX_KILL_LOG=1000` / `MAX_RESPAWN_LOG=500` は安全 cap
- `gcLogs` の参照同一性トリック: 長さ不変 ⇔ 内容不変 (削除のみの transform) なので、長さ不変なら入力と同じ array 参照を返して `setState` を trigger しない (Zustand 購読者再評価抑制)
- `score` メッセージ型ごと削除 (各 peer が `killLog` から独立 count、結果は可換加算で収束)

設計幅として α (per-player latest Map) / β (log source + selector derive) / γ (log + cache 併存) を検討し **β を採択**。理由: 原理 5「authoritative 値を持たない」に構造的に忠実、Stage F の snapshot 配信が log dump で実現できる先行投資、cache 撤去の変更面は ~10 箇所で広くない。

**D. respawn schedule を owner-local に**:
- 人間の respawn timer は各 owner がローカルに持ち続ける (`if (isHost)` wrap 撤去)。`processHitDetection` が B で owner 絞り込み済みなので、hit 検出時点で「その kill の target は必ず自分が owner」が成立
- `respawn` メッセージを sendToNetwork 経由に切替。client 発信 → beacon holder relay
- `useHostMigration` を LH handoff 専用に縮退
- LH init effect の idempotent ガード: `useEffect([myId, isHost])` が isHost 変化で再実行されると `createLighthouse()` で LH を新規作成・上書きし、LH の位置・世界線・spawn grace がリセットされる問題を修正。既存エントリを確認し owner だけ差し替える

**E. Lighthouse を owner-based filter に**:
- `lighthouseLastFireTime: Map<string, number>` を non-reactive state として追加
- messageHandler の `laser` 受信で `isLighthouse(msg.playerId)` なら wallTime を更新
- useGameLoop の LH AI は fire 時にも同 Map を更新
- 結果: どの peer が owner になっても常に最新の observed-fire-wallTime を Map から読むだけで continuity 保持。明示的な migration ロジック不要
- `isLighthouse(id)` は 3 つの metadata 役割のみ (色決定 / AI 分岐 / invincibility 除外)。authority や所有構造の判定には使わず、owner 判定は `player.ownerId === myId` に統一

**F. `snapshot` メッセージ新設、syncTime/hostMigration 送信撤去**:
- F-1: `snapshot` は新規 join 時の 1 回だけ送信。既存 peer は event-sourced state で自己維持できる (`hostMigration.deadPlayers` payload は受信側で一度も参照されていなかった dead code)
- snapshot payload: `players / killLog / respawnLog / scores / displayNames / hostTime` (OFFSET 同期用)
- 各プレイヤーの `worldLine.history` を丸ごと serialize するため、最大で 5000 サンプル × プレイヤー数 = 数 MB。許容理由: 送信頻度は新規 join 時の 1 回だけ、過去世界線がないと観測者の過去光円錐交差計算が機能せず UX 破綻、差分配信は scope 外
- F-1 副作用で「migration 時に新 host の init effect が既存 peer に syncTime を誤送信して自機を reset する」潜在バグも同時解消 (init effect から全 connection 送信を撤去、新 connection 検出は `prevConnectionIdsRef` 差分だけに)
- F-2: naming refactor (`host` → `beaconHolder`、`useHostMigration` → `useBeaconMigration`、ファイル git mv)
- **保持**: relay-server との wire protocol (`{type:"join_host", hostId}` 等) は既デプロイ relay との互換のため WsRelayManager 内で翻訳。UI 文字列 / connection phase (`"trying-host"` 等) も UX 用語として保持

**G. heartbeat 積極化**:
- 前提: false positive のコストがほぼゼロ (state 引き継ぎなし、再選出だけ)
- `3s / 8s` → `1s / 2.5s`
- `HOST_HIDDEN_GRACE < HEARTBEAT_TIMEOUT` の invariant (`1500ms < 2500ms`) を保つ。順序が逆転すると host が自分を壊す前に client が migrate → host が復帰しても別世界
- visibility 復帰時の `lastPingRef.current = Date.now()` reset で「次の 1 ping が実際に来るか」を新たに計測し直し、false positive migration を回避。heartbeat ロジック自体を触らずに済む timestamp reset 方式

**H. 型削除とドキュメント最終化**:
- `syncTime` / `hostMigration` の型とハンドラを削除 (F-1 で送信を止めてから、H で型を削除する 2 段階)
- `beaconChange` メッセージは新設せず: 各 peer は `peerOrderRef` ベースの local election で新 beacon holder を独立決定でき、broadcast を待つ必要がない

### マイグレーションで消えたもの

- `hostMigration` メッセージの重い payload (scores / deadPlayers / deathTimes / displayNames)
- `respawnTimeoutsRef` の再構築
- `lighthouseLastFireRef` の引き継ぎ課題
- `processedLasers` の重複防止 (log-derived selector ガードへ)
- 決定論性 (固定ステップ格子 / seeded RNG) への全要求
- host/client 二重実装の hit detection

残る singular 役割: beacon 所有 (PeerJS ID 制約による物理的 singular) のみ。

### mesh 化

このリファクタの範囲外だが、完了後に独立に検討可能になった。

---

## § D pattern 化 (完了リファクタ)

scene の物理オブジェクトを **「world 座標で geometry を定義 + mesh matrix に world→display 変換」** に統一したリファクタ (2026-04-15 完了)。`DisplayFrameContext` が `displayMatrix = boost × T(-observerPos)` を配信、各 mesh は `matrix = displayMatrix × T(worldEventPos) × [optional worldRotation]` を `matrixAutoUpdate={false}` で固定。

### 動機

従来の C pattern (React で `transformEventForDisplay` を呼び display 座標を props で渡す) は呼び出しが 20+ 箇所に散在し、Lorentz 変換の責務が React / GPU に分散していた。D pattern では GPU が per-vertex で合成、React は world 座標だけを扱う。

**最大の理由は 3+1 次元化への親和性**: boost matrix を 5×5 に差し替えれば全 mesh が自動追従 (geometry・render code 無改造)。

### 原理

- World 座標系は全 observer が共有する frame (ネットワーク層の共通 state)
- 観測者は world → 自分の rest frame への transformation = `displayMatrix`
- 「event の位置」は world 側、「観測者がどう見るか」は matrix 側、責務分離

`buildMeshMatrix(worldPos, displayMatrix)` helper (`DisplayFrameContext.tsx`):
```ts
new Matrix4().multiplyMatrices(displayMatrix, makeTranslation(worldPos))
```

### Phase 別要点

- **Phase 1 (点マーカー)**: プレイヤー球、kill 球、交差球、pillar — 当初 D pattern だったが sphere distortion のため後に球だけ C pattern に戻す判断 (例外参照)
- **Phase 2 (ring)**: 過去/未来交差 ring、kill ring、spawn ring — D pattern で世界系同時面 (接線 u = Λ x̂_w, v = Λ ŷ_w で張られる面) に自動的に寝る
- **Phase 4 (光円錐接平面三角形)**: `computeConeTangentQuaternion` (display 依存) → `computeConeTangentWorldRotation` (world 導出) に書き換え。`Δ = event − observer` で `n = (Δx, Δy, -Δt)/(ρ√2)` (詳細は § 描画「レーザー × 光円錐 交点マーカー」)
- **Phase 煙 (Debris)**: `InstancedMesh.matrix = displayMatrix`、per-instance matrix を world frame で compose
- **Phase 5 (レーザーバッチ)**: BufferGeometry の position を world 頂点で構築、`lineSegments.matrix = displayMatrix` で統合変換
- **Phase 3 SKIP (照準矢印)**: 2+1 固有の gameplay/UX 装飾 (自機から過去光円錐方向に三角形マーカー 3 個) — 3+1 では再設計が必要なので C pattern のまま維持

### 球 (volumetric 点マーカー) の例外 → メタ原則 M14

球ジオメトリに per-vertex Lorentz を掛けると運動方向に γ 倍の楕円化。「点」の意味が損なわれるため、球だけは C pattern (`position={[dp.x, dp.y, dp.t]}`) で display 並進のみ。

該当: `playerSphere` (自機 + 他機)、`intersectionSphere` (+ core、過去光円錐)、`intersectionSphere` scale 0.6 (未来光円錐)、`killSphere`、`explosionParticle` (debris marker)。

対して細長いリング/三角形/チューブは Lorentz 変形が「物理的に正しい視覚化」になるので D pattern を維持。hybrid policy の詳細は M14 参照。

**sphere + ring の同居 group は分割**: 元は 1 group (matrix) で共有していたが、球が分化した結果 group を 2 本 (position-group と matrix-group) に分割。

### 代替検討: quaternion tilt 方式

リングに対してだけ quaternion で「世界系同時面の向き」を与えて固定サイズの円として描画する方式と比較検討:

- **メリット**: 固定サイズで視認性高い、sphere と一貫性取りやすい
- **デメリット**: 3+1 への拡張時に「tangent 2D plane の選び方」が新たな設計決定として浮上。D pattern は boost matrix だけ差し替えれば終わる
- **結論**: ring は D pattern (stretch を正として受け入れる)、球だけは distortion 避けたいので C pattern、の hybrid が最も clean

### `transformEventForDisplay` の残存

D pattern 化後に残るのは (a) カメラ追随計算、(b) 照準矢印、(c) 球の位置取得 — 3 用途。残存は意図的で、球と camera は distortion を忌避し、矢印は 2+1 固有。

### 旧設計との差分

- C pattern (20+ `transformEventForDisplay` call sites 分散) → D pattern (2 箇所の意図的 call + context で集中管理)
- リング向きの quaternion 計算 → `displayMatrix × T(worldPos)` で自動導出
- `computeConeTangentQuaternion` (display 依存) → `computeConeTangentWorldRotation` (world 導出)
- Debris InstancedMesh の per-instance display-coord compose → world-coord compose + mesh-level displayMatrix

### 関連 commit

- `a7a728c` Phase 1+2+4 実装
- `fc6d7e9` Phase 煙 + Phase 5 実装
- `f155696` 自機 identity matrix + pillar 半径 0.5
- `302f7da` 球を C pattern に戻す (例外確立) + pillar 過去光円錐 anchor
- `3f31e74` docs 記録

### 今後の拡張余地

- 3+1 次元化: `buildDisplayMatrix` を 5×5 boost に差し替える (現在は (x, y, t) の 3 成分を three.js の (x, y, z) に mapping 済み、4 成分を使う vertex shader が必要になる — WorldLineRenderer の既存 matrix trick の限界も同じ)
- Phase 3 の照準矢印を 3+1 対応で再設計する場合: 「自機から過去光円錐 (3D 超曲面) に向かう三角形」をどの 2D 平面に貼るか要再設計
- 球を distortion 込み描画に戻す (e.g., 速度メーター的な視覚化) 場合も、matrix prop を切り替えるだけで対応可能

---

