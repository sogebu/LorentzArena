# DESIGN.md — LorentzArena 2+1

設計判断の記録。分類原則は `claude-config/docs/convention-design-principles.md` §6。未決定の探索・代替案比較は [`EXPLORING.md`](./EXPLORING.md) へ。

## 目次

- [§ メタ原則・教訓](#-メタ原則教訓)
- [§ アーキテクチャ overview](#-アーキテクチャ-overview)
- [§ Authority 解体 (完了リファクタ)](#-authority-解体-完了リファクタ)
- [§ D pattern 化 (完了リファクタ)](#-d-pattern-化-完了リファクタ)
- [§ ネットワーク](#-ネットワーク)
- [§ 物理](#-物理)
- [§ 描画](#-描画)
- [§ State 管理](#-state-管理)
- [§ UI / 入力](#-ui--入力)
- [§ 通信・セキュリティ](#-通信セキュリティ)
- [§ Defer 判断](#-defer-判断)

---

## § メタ原則・教訓

個別判断から横断的に抽出した原則。新しい設計を始める前・バグの根本原因を探るときに参照する。

### M1. setState reducer は純関数に保つ (StrictMode 安全)

`setPlayers` / `setLasers` 等の updater (reducer) の内部では、副作用 (`peerManager.send`、`ref.mutation`、`Math.random`、`Date.now`、`generateExplosionParticles` 等) を一切呼ばない。副作用と非決定的計算は reducer の外で行い、結果を closure 経由で reducer に渡す。

React 18 StrictMode は dev モードで reducer を **2 回** 呼び出す。reducer 内の副作用は 2 回実行され、`ref.delete()` のような破壊的操作は 1 回目の結果を 2 回目で壊す。色バグ「ホストが灰色のまま」はこのパターンの極端例: `pendingColorsRef.delete()` を reducer 内で呼んでいたため、1 回目で pending 消費 → 2 回目で pending 空 → gray fallback が commit されていた。

```ts
// BAD: reducer に副作用と非決定性
setPlayers((prev) => {
  const next = new Map(prev);
  const color = Math.random() > 0.5 ? "red" : "blue"; // non-deterministic
  peerManager.send(msg);                              // side effect
  pendingRef.current.delete(key);                     // ref mutation
  next.set(id, { ...existing, color });
  return next;
});

// GOOD: すべて reducer の外で計算 → closure で束縛
const color = Math.random() > 0.5 ? "red" : "blue";
setPlayers((prev) => {
  const next = new Map(prev);
  next.set(id, { ...prev.get(id)!, color });
  return next;
});
peerManager.send(msg);
pendingRef.current.delete(key);
```

例外: `setXxx(nextValue)` のように関数ではなく値を直接渡す場合は対象外。`applyKill(prev, victimId)` のような **純関数を reducer として使う** のは OK (2 回呼ばれても同じ結果)。

教訓: StrictMode の 2 回実行は「純粋性契約違反のセンサー」。dev で二重実行が発生したら、それは「本番で dispatch 戦略が変わったときに壊れる予兆」。

### M2. 書き込み元を断つ: 対症療法 vs 根治

世界線ジャンプ事件 (2026-04-13 夜): リスポーン後に世界線が前の位置に飛ぶ現象で、対症療法 3 回 (stale ref 同期、shadow ref ラッパー、fresh getState 再取得) が治らなかった。根本原因は **自分の phaseSpace メッセージがホスト経由でリレーされて戻ってくる** こと。死亡前の phaseSpace がリスポーン後に到着 → `appendWorldLine` (インプレース変更) が新 WorldLine に古い位置を追加。修正は messageHandler で `playerId === myId` の phaseSpace を無視するだけ。

教訓:
- `appendWorldLine` がインプレース変更であることが根本の脆弱性
- ネットワークリレーによる古いメッセージの到着タイミングと組み合わさって発現
- 対症療法 (読み取り側の fresh 化) では根治できず、**書き込み元を断つ** 必要があった
- 同じ箇所のパッチが 3 回を超えたら、根の設計を疑う

関連: 色バグの 5 連パッチも全て枝葉で、根は最初のコミット (`pickDistinctColor` の stateful 設計) にあった。パッチが増えるほど既存コードに適合させる制約が強まり、根本治療の機会が遠のく。

### M3. 「X を Y の純関数で書けないか？」

色 = f(ID) で書けるなら、一切の同期・ブロードキャスト・バッファ・race は発生しない。state 同期を設計する前に、純関数で済む可能性を必ず検討する。

要件を 1 つ緩和すれば設計全体が単純化することがある:
- 旧色割り当ては「色相距離最大化」を絶対視 → 同期経路が全て必要
- 「統計的に十分分離すればよい」に緩和 → 全経路消滅
- 要件の強度は設計複雑度に非線形に効く

State は常にコスト。React state・ref・ネットワークメッセージ・キャッシュのどれも「読み書きのタイミング」という隠れた次元を持つ。計算で代替できるなら、state を増やすより計算する方がほぼ常に安い。

Authority 解体でも同じ: score / deadPlayers / invincibility を「authoritative 値」として持たず、kill/respawn event log からの derived state にした。

### M4. Zustand getState の stale スナップショット

`const store = getState()` はスナップショット。その後 `set()` が呼ばれると Zustand は `{ ...oldState, ...partial }` で新 state を作成する。

- **Set/Map のインプレース変更** (`store.deadPlayers.add(x)`) は新旧 state が同一インスタンスを共有するので **安全**
- **配列の再代入** (`store.pendingKillEvents = filtered`) は old state のプロパティを変えるだけで、new state には反映 **されない** (spread 時にコピー済みの古い参照が使われる)

ルール: 配列フィールドの更新は必ず `useGameStore.setState({ field: newArray })` を使う。直接再代入は禁止。

### M5. gameLoop tick 内の stale state: getState 再取得 pattern

useGameLoop は 1 tick 内で複数の `set()` を呼ぶ。tick 前半の `setPlayers`/`setLasers` で state が更新された後、Lighthouse AI が tick 冒頭の stale `store` スナップショットから `store.players` を読むと古い位置で因果律ジャンプ判定をしてしまう。

解決パターン: tick を 3 フェーズに分割し、各フェーズ冒頭で `useGameStore.getState()` を再取得:
1. cleanup / camera / causal events (stale store OK)
2. ghost / physics (fresh re-read)
3. lighthouse / hit detection (fresh re-read)

### M6. useEffect deps の安定性分析

オブジェクトリテラルや毎レンダー新規作成されるオブジェクトを deps に入れると、毎レンダーで effect が再実行 → cleanup でリスポーンタイマーが全クリア → リスポーン不能。

- 30+ フィールドのうち参照が変わりうるのは peerManager と myId のみ (ref は安定、React setState は安定、useCallback([]) は安定、handleKill/handleRespawn は myId 依存で連動) と分析し、`[peerManager, myId]` のみを deps にする
- カスタム hook が返すオブジェクトは `useMemo` で安定化すること。中身が全て `useRef` でも、ラッパーオブジェクトが毎回新規作成されると依存配列が変化する
- `getPlayerColor` が `useCallback([peerManager])` で peerManager 変更時に参照が変わる。これを `handleRespawn` → `handleKill` → ゲームループ effect の deps に入れると、接続変更のたびにゲームループが teardown → 再作成され **ゲーム凍結** を引き起こす

教訓: deps オブジェクトをまとめて渡すと安定性分析が隠蔽される。

### M7. 座標時間は壁時計に忠実であるべき

`MAX_DELTA_TAU` (100ms → 500ms → 2s → 撤廃): タブ切り替え時の 1-6 秒スパイクで座標時間が削られ、ホストがクライアントより過去に落ちていた。`document.hidden` チェックがタブ復帰を既に処理しているためキャップは二重防御。

教訓: 座標時間の進行を壁時計から切り離すとプレイヤー間で累積的にずれる。

### M8. 機械的 refactor 後の視覚チューニング

世界スケール半減 (2026-04-13) で得た 3 教訓:

1. **ジオメトリの定数未連動**: `ConeGeometry(40, 40)` がハードコードで `LIGHT_CONE_HEIGHT` と同期していなかった。**定数化したらジオメトリ生成も必ず定数参照にする**
2. **二重半減の罠**: threeCache のジオメトリ (例: `SphereGeometry(0.5)`) を半減した上に、それに掛かるスケール乗数 (例: `p.size * 0.75`) も半減すると、実効サイズが 1/4 になる。**ジオメトリ自体を半減したら、スケール乗数は元の値を維持する**。5 箇所で発生
3. **視覚サイズは空間スケールと独立**: プレイヤーマーカー、キルエフェクト、交差マーカー等は「画面上の視認性」が重要で、物理空間と厳密に比例させる必要はない。機械的半減の後に視覚チューニングのパスが必須

### M9. CORS セーフリスト (sendBeacon)

`sendBeacon` で使える Content-Type は `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` のみ。JSON を送りたい場合は `text/plain` で包む。`application/json` は CORS セーフリストに含まれないため preflight (OPTIONS) が必要だが、`sendBeacon` は preflight をサポートしないため、ブラウザがリクエストを黙って捨てる。

実害: 2026-04-12 (KV 設計デプロイ) から 2026-04-14 (本修正) までグローバルリーダーボードは dead 機能だった。Worker + KV は正常、クライアントからの送信が到達していなかった。

### M10. THREE.js は Float32 — 時空座標は小さく保つ

`OFFSET = 1735689600` (固定値) を試みた結果: pos.t ≈ 4000 万秒。THREE.js は内部で Float32 を使用し、精度が ±4 程度に劣化。ワールドライン座標が全てスナップして描画が崩壊。

教訓: Float64 で計算しても THREE.js の頂点バッファ / シェーダーユニフォームが Float32 なので、表示座標系で精度が死ぬ。時空座標は 0 近辺に保つ必要がある。

最終設計: `OFFSET = Date.now()/1000` で小さい値を保ち、同期は `snapshot` メッセージで `hostTime` を送ることで実現 (Authority 解体 Stage F-1)。

### M11. TypeScript 構造的型付けの穴

`u: Vector4` という型定義に `phaseSpace.u: Vector3` を代入しても TypeScript は気付かない。ゴースト移動で `de.u.t * tau` を計算するが Vector3 には `.t` がなく `undefined * tau = NaN` になっていた。修正は `getVelocity4(phaseSpace.u)` で明示変換。

教訓: 構造的型付けは部分一致で通ってしまう。Vector3 ⊂ Vector4 ではないが、代入時にエラーにならない。

### M12. 因果律チェックは「ゲームに参加している」プレイヤーにのみ

因果律の守護者 (他プレイヤーの未来光円錐内なら操作凍結) から、phaseSpace が更新されないオブジェクト (死亡中、切断等) を除外する。

背景: 死亡中のプレイヤーは phaseSpace を送信しないため座標が凍結。生存プレイヤーの世界時が進むと、凍結された座標との lorentzDot が timelike (< 0) になり、因果律チェックに引っかかって観測者の時間進行が停止。結果、デブリマーカーの maxLambda が固定され「出現後に動かない」バグ。

教訓: 動かないオブジェクトを因果律チェックに含めると偽陽性で時間停止が起きる。

### M13. 時空オブジェクトの anchor は「何を表現したいか」で選ぶ (正解はない)

相対論的時空図に object を置くとき、object の `(x, y, t)` を決める anchor は複数ある:

| anchor | 意味論 | 使いどころ |
|---|---|---|
| World frame 静止 | 「事件は世界系で一意に生じた」 | レーザー世界線、凍結世界線、spawn ring (短時間) |
| Observer rest frame 原点 | 「自機は自分の frame で常に原点」 | 自機マーカー (γ 楕円化を避ける) |
| Observer の rest frame 同時面 static | 「観測者の「今」に追従」 | HUD 要素 (通常は 3D scene 外) |
| Observer の past light cone anchor | 「観測者が今まさに見ている時点」 | spawn pillar (表示連続性)、光円錐交差マーカー |
| Object own rest frame static | 「その object 自身の inertial frame で固定」 | プレイヤー世界線チューブ (proper time で生成) |

物理的に「正しい」anchor は**ない** — 時空の slicing が任意なのと同じで、どれも合理的。**意味論的選択** であり、「何を視覚的に伝えたいか」で決まる。例: spawn pillar を world-static にすると観測者の時間前進で過去側に流れて見える — 物理的には正しいが UX 上「沈んでいく光柱」で意図と食い違う → past light cone anchor に変更 (2026-04-15)。

教訓: anchor 変更はバグ修正ではなく **意味論的再設計** として DESIGN.md に記録する。代替案も併記。

### M14. 球は per-vertex Lorentz から除外、extended 物体は D pattern

3D の volumetric 点マーカー (sphere) に per-vertex Lorentz 変換をかけると運動方向に γ 倍の楕円化 → 「点」マーカーとしての意味が毀損。リング・三角形・チューブのような **方向性/連続性を持つ object** は Lorentz 変形が物理的視覚化として意味を持つので D pattern (per-vertex 変換) で OK。

運用基準:
- 球 (player/kill/intersection markers、debris particle) → C pattern (`position={[dp.x, dp.y, dp.t]}`)
- リング、三角形、チューブ、シリンダー → D pattern (`matrix = displayMatrix × T(worldPos) × [rotation]`)
- Sphere + ring の同居 group は 2 本に分割 (C-positioned 球 + D-matrix リング)

背景: D pattern 化リファクタ (2026-04-15) で最初は全 mesh を D pattern に揃えたが、自機球が boost で楕円化し違和感。volumetric object は distortion 免除、extended object は distortion 活用、の hybrid に収束。

### M15. HMR stale state の切り分け: 症状だけでバグ推定しない

Vite HMR は module 更新を hot-reload するが、失敗時に前の module state が残り挙動がおかしくなる。特に module-level singleton (`sharedGeometries`, React Context value キャッシュ) や useState 内の stale object を握ったまま partial reload が走ると、見かけのバグ (FPS 0 フリーズ、レンダリング消失、位置ずれ等) が出る。

対処: **症状をコードにマップする前に、まずフルリロード (`window.location.reload()` または preview_stop → preview_start) で再現性を確認**。reload で直るなら HMR stale であり、コード側のバグではない (commit 対象外)。

事例:
- 2026-04-15 D pattern 化作業中、spawn 効果に「謎のレスポーンエフェクト」が見える事象。full reload で解消
- 2026-04-17 FPS 調査中、`physics/worldLine.ts` の交差計算二分探索化を HMR 反映した直後、**自機プレイヤー・光円錐・世界線・Speedometer HUD がすべて消える**現象が発生。見かけ上 B 案 (二分探索化) のバグに見えたが、論理的には `worldLineIntersections` useMemo の結果が変わるだけで「全描画消失」は説明不能。revert 後にフルリロード + 再 START で正常復帰 → **HMR の Provider 再マウントで PeerJS / zustand state が START 前に戻った副作用**と判定。B 案自体は未検証のまま revert (commit 対象外)、別セッションで test 付きで再挑戦

### M16. 時間経過で悪化する性能問題は「蓄積 state への O(N) ロジック」を疑う

**症状**: 位置を変えず操作もしていないのに、時間経過だけで FPS が単調に落ちる。

**誤認しがちな犯人** (先にここから疑うと外れる):
- 半透明 surface の overdraw → これは**位置依存** (画面占有率による)、時間非依存
- TubeGeometry 再生成コスト → `TUBE_REGEN_INTERVAL` で throttling 済み、history 長に比例はするが GPU primitive 転送は amortized
- GPU の draw call 数 → geometry 数が時間で増えない限り一定

**本当の犯人になりがち**:
- `history`/`log`/`records` のような時系列 array に対する毎フレーム O(N) 走査
- useMemo の依存がオブジェクト参照で毎 tick 新規 → cache miss で毎フレーム再計算
- ゲームループ内の物理計算 (hit detection、causality check) が history を舐める

**判定**: 「時間依存 (放置で悪化) か / 位置依存 (外へ行くと悪化) か」を先に切り分ける。時間依存なら overdraw / draw call 系ではない。

**事例 (2026-04-17)**: 固有時間 ~170s で FPS 10 まで低下。surface / 光円錐 / WorldLine Tube を順次無効化しても改善せず、`MAX_WORLDLINE_HISTORY` を 5000 → 100 に下げた瞬間に時間経過劣化停止 → `SceneContent.tsx` の `worldLineIntersections` / `laserIntersections` / `futureLightConeIntersections` useMemo と game loop 内の `pastLightConeIntersectionWorldLine` が毎フレーム全 history を走査する O(N) コストが主因と確定。§worldLine.history サイズ 節参照。

### M17. Three.js + R3F で毎 tick 変化する geometry は in-place update

BufferGeometry の position が毎 frame 変わるケース (観測者依存の幾何、procedural
アニメーション等) で、以下のアンチパターンに陥りがち:

**アンチパターン: useMemo で毎 tick 新 BufferGeometry**
```ts
const geometry = useMemo(() => {
  const positions = new Float32Array(N * 3);
  // ...毎 tick observerPos に依存して positions を埋める
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return g;
}, [observerPos]);
```

- observerPos は毎 tick 新 object → useMemo invalidate → BufferGeometry 毎 tick new
- Float32Array / BufferAttribute / BufferGeometry object が 125Hz で大量 allocation → GC 圧
- 旧 BufferGeometry が `.dispose()` されず GPU buffer leak する可能性 (three.js で dispose 呼ばないと GPU 側リソース残存)

**正解パターン: 1 回だけ geometry 作成 + useFrame で position を in-place 更新**
```ts
// マウント時 1 回
const geometry = useMemo(() => {
  const positions = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return g;
}, []);

// 毎 frame
useFrame(() => {
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  // arr を in-place に書き換え
  posAttr.needsUpdate = true; // 差分 upload フラグ
});
```

allocation ゼロ、GPU には同サイズ buffer の差分 upload のみ。

**トラップ 1: frustum culling が古い boundingSphere で判定する**

初回 positions は 0 埋め → `boundingSphere` は原点付近の小球として初期化される。
in-place 更新しても boundingSphere は再計算されない → three.js の frustum culling が
「bounding 0 → 画面外」判定で mesh 描画をスキップし、**デプロイ後に見えない**症状に。

対処:
- `<mesh frustumCulled={false}>` で culling 無効化 (cost 軽微、当該 geometry が
  確実に画面内にあるなら最良)
- または毎 frame `geometry.computeBoundingSphere()` (cost 中、正確)
- または初期 positions を十分大きい box で埋めて bounding を巨大化 (hack)

通常は `frustumCulled={false}` が最短。

**トラップ 2: 複数 geometry で頂点セットを共有したいとき**

surface + wireframe + 境界線など、同じ頂点を異なる index で描画したい場合は
**`BufferAttribute` インスタンスを共有**する:
```ts
const positionAttr = new THREE.BufferAttribute(positions, 3);
const geoA = new THREE.BufferGeometry(); geoA.setAttribute("position", positionAttr); geoA.setIndex(idxA);
const geoB = new THREE.BufferGeometry(); geoB.setAttribute("position", positionAttr); geoB.setIndex(idxB);
```
`positionAttr.needsUpdate = true` が 1 回で複数 geometry 全部に反映され、GPU upload も
1 回で済む。**複数 geometry の頂点が完全一致するので離散化差によるズレゼロ**。

**事例 (2026-04-17)**: ArenaRenderer でこの 3 つのトラップすべてを経験 —
- 初版: 毎 tick の BufferGeometry 新規作成で FPS 低下
- in-place update 版: FPS 回復したが本番で Arena が消失 (frustum culling)
- frustumCulled=false 追加: 表示復帰
- surface (N=64) と cone loop (N=128) で頂点密度が違い線が微ズレ → shared
  BufferAttribute + 異なる index buffer で単一頂点セットに統一

### M18. 性能切り分けは「個別要素を段階的に α=0 にする二分法」

複数 suspect があるとき、Chrome DevTools Performance の前に**個別要素を無効化して FPS を測る**のが速い。

手順:
1. 最も疑わしい要素 1 つを無効化 (opacity 0, `return null`, mesh を if で skip 等)
2. HMR で即反映、FPS 測定
3. 回復 → その要素が主因。回復せず → 次の suspect へ
4. 切り分けに応じて仮説を絞る

ポイント:
- 「要素単位」で切る (surface 削除 / 光円錐 削除 / WorldLine 削除 / history サイズ縮小 / ...)
- 要素が多ければ二分法で一度に半分無効化して探索空間を絞る
- **切り分け実験用の変更は commit しない** — M15 の HMR stale や実験値漏洩を防ぐため、終わったら revert

Chrome DevTools Performance は「どの関数が重い」は特定できるが、「要因が複合していて interaction が効いている」時は数値だけでは判断つかない。段階的無効化は因果関係を直接見られる。

事例 (2026-04-17): アリーナ surface → 光円錐 surface → WorldLine Tube → `MAX_WORLDLINE_HISTORY` と段階的に無効化して 4 回目で主因特定 (§worldLine.history サイズ)。

---

## § アーキテクチャ overview

全体を貫く設計原理。個別判断の前提になる。

### データ層と表現層の分離

全 peer が全プレイヤーの world line を常時共有する (データ層)。相対論的な光円錐遅延は「いつ UI に表示するか」の表現層だけで効かせる。データを光円錐で絞る必要はない。

**この原則を見失うと「各 peer は自分の光円錐内のデータしか持てない」と誤解し、設計が無駄に複雑化する** (Authority 解体の議論中盤に実際に一度そうなった)。

### 世界オブジェクト分離: 死亡 = プレイヤーから世界への遷移

死亡イベントで生まれるオブジェクト (凍結世界線、デブリ、ゴースト軌跡) は `RelativisticPlayer` から分離し、独立した state として管理 (`frozenWorldLines[]`, `debrisRecords[]`, `myDeathEvent`)。プレイヤーが持つのは「今生きてるライフの世界線」だけ。

設計原理: 世界に放たれた物理オブジェクト (レーザー、デブリ、凍結世界線) はプレイヤーとは独立に存在し続ける。

副次効果として切断プレイヤーの痕跡も残る。因果律の守護者バグの遠因 (紐付けによる座標時刻の不整合) も解消。

### 死亡時の描画哲学: 物理に任せる

死亡時の唯一の特別処理は「死んだ本人が自分のマーカーを見ない」のみ。世界線・デブリ・他プレイヤーのマーカー表示は通常通り。

凍結された世界線は他プレイヤーの過去光円錐と交点を持つ間は可視 (因果的に正しい「遅延された死亡」)。交点がなくなって初めて消える。リスポーン後も過去光円錐が新世界線に触れるまで不可視。デブリも同様。

以前の `if (player.isDead) return null` で死亡プレイヤーの全マーカーを全観測者から非表示にしていた実装はデブリ表示タイミングに波及していた。相対論的ゲームでは、描画判定に「特殊ケース」を増やすのではなく、過去光円錐交差という統一的メカニズムに任せるべき。

### 過去光円錐に基づく描画

プレイヤーは他オブジェクトの「現在位置」ではなく過去光円錐上の位置を見る。特殊相対論を正確に反映するゲームメカニクスの根幹。計算コストは増えるが、ゲームの存在意義そのもの。

### 物理エンジン: ファクトリパターン (クラス不使用)

イミュータブルな phase space オブジェクトとの相性がよく、テストしやすい。OOP 的な継承は物理演算には不要。

### game/ のファイル配置: flat vs subdirectory

基準: 共有ユーティリティがあるか、3 ファイル以上の密結合グループか → サブディレクトリ。独立モジュールの列挙 → flat。

- `game/` 直下 (flat): 独立した描画モジュールで相互参照がなく、SceneContent.tsx からのみ import される (WorldLineRenderer 等)
- `game/hud/` (subdir): 共有ユーティリティ (`utils.ts`) があり、テーマ的に密結合 (ControlPanel, Speedometer, Overlays, utils)

---

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

## § ネットワーク

### WebRTC (PeerJS) + WS Relay フォールバック

P2P 通信を基本とし、制限的なネットワーク環境では WebSocket Relay にフォールバック。レイテンシ最小化 (P2P) と到達性 (Relay) の両立。

### 自動接続: PeerJS の unavailable-id を発見メカニズム

ページを開くと自動でルーム ID (`la-{roomName}`) でホスト登録を試行。ID が既に使われていれば (unavailable-id エラー) クライアントとして接続。ID の手動共有が不要 (URL を開くだけ)。

注: `la-{roomName}` は Authority 解体前はゲーム PM の ID として使っていたが、現在はビーコン (発見専用) のみに使用 (下記「ビーコン専用化」参照)。

### ビーコン専用化: `la-{roomName}` をビーコン ID に固定

ホストが `la-{roomName}` をゲーム PM の PeerJS ID として使う設計を廃止。全ピア (ホスト含む) がランダム ID でゲーム接続し、`la-{roomName}` はビーコン (発見専用) のみに使用。

旧設計では、ホストの tab-hidden 復帰時に ID が `la-{roomName}` → ランダム ID に変わり、joinRegistry index が変化して色が変わっていた。ad-hoc パッチ (`previousId` in intro, joinRegistry 置換 hack) は複雑すぎたため revert し、根本解決として Phase 1 を 2 段階に分割:

1. `la-{roomName}` で一時 PM を作成 (ビーコンプローブ)。成功 → `beaconRef.current` に格納
2. `localIdRef.current` (ランダム ID) でゲーム PM を作成。open → `setAsHost()`, 標準ハンドラ登録
- ビーコンの redirect ハンドラはゲーム PM open 後に登録 (`hostId` 確定後)
- プローブ中に来たクライアントには `getConnectedPeerIds()` で遡って redirect 送信

構造的効果: 初期ホスト・マイグレーション後ホスト・tab-hidden 復帰ホストがすべて同じパターン (ランダム ID + ビーコン) に統一。Phase 2 の joinRegistry 色修正 hack は不要になり削除。

レースコンディション: ビーコンプローブ成功 → ゲーム PM open の間に別ピアが来ても、ビーコン PM が `la-{roomName}` を占有中なので競合しない。

ゲーム PM エラー時のビーコン解放: Phase 1 でビーコン取得後にゲーム PM が PeerServer エラーで失敗した場合、ビーコンだけが生き残って `la-{roomName}` を永続占有するバグを防ぐため、ゲーム PM の `onPeerStatusChange` error 分岐で `beaconRef.current.destroy()` を実行。

トレードオフ: クライアント接続レイテンシ ~100-200ms 追加 (常にビーコン経由 redirect)。ロビーの初回接続時のみ許容。

### ビーコンベースのホスト降格 (dual-host 解消)

peerOrderRef のずれで 2 ノードが同時にホスト化した場合、ビーコン PeerJS ID の一意性で解決する。ビーコン取得 3 回失敗したホストは別のホストが存在すると判断して降格:

1. `discoveryPm` でビーコンに接続
2. redirect で本物のホスト ID 取得
3. 自分のクライアントに `{ type: "redirect", hostId }` を broadcast
4. `clearHost()` + 本物のホストに接続
5. `setRoleVersion(v+1)` で全 effect 再評価

安全弁: discoveryPm がビーコンに 8 秒接続できない場合 (ビーコン保持者がクラッシュ済み)、降格を中止してビーコンリトライを再開。

### `roleVersion` による effect 再評価

`peerManager.setAsHost()` / `clearHost()` は PeerManager の内部フラグを変更するが React state 参照は変わらない。effect の deps が変わらないと cleanup + 再実行が起きず、(a) ビーコンが作成されない (b) heartbeat send/detect の切り替えが起きない (c) peerList broadcast が開始/停止しない。

`roleVersion` state を追加し、全ロール変更時 (ホスト昇格・ソロホスト化・降格) にインクリメント。`getIsHost()` をチェックする 4 つの effect の deps に含める。

`assumeHostRole()` ヘルパー: `clearHost + setAsHost + registerStandardHandlers + setRoleVersion` の 4 操作をバンドル。「`setAsHost()` には必ず `setRoleVersion` が伴う」という不変条件を構造的に保証。

教訓: `isMigrating` をビーコン effect の deps に入れてトリガー流用する方式は一度実装したが、ガードとトリガーの二重目的が混乱を招き即座にバグを再発させた。`roleVersion` のような単一目的のカウンターが正しい抽象化。

### ホストタブ hidden 時の PeerJS ID 解放

ホストのタブが 5 秒以上 hidden になったら PeerManager + ビーコンを destroy し、`la-{roomName}` PeerJS ID を解放。タブ復帰時は Phase 1 から再接続。

旧挙動: ホストのタブが hidden でも PeerJS シグナリング WebSocket は生きたまま。`la-{roomName}` が解放されず、新ホストのビーコン作成が永続的に失敗 → MAX_BEACON_RETRIES で誤った降格が発動していた。

`HOST_HIDDEN_GRACE = 5000` は `HEARTBEAT_TIMEOUT = 8000` より短い必要がある (クライアントがマイグレーション発動する前に ID を解放するため)。5 秒未満の alt-tab はキャンセルされ無害。

### ICE servers: 静的 env → 動的 credential fetch

`VITE_TURN_CREDENTIAL_URL` が設定されていれば、アプリ起動時に Cloudflare Worker から短命 TURN credential を fetch し、ICE servers に使う。未設定なら `VITE_WEBRTC_ICE_SERVERS` (静的 JSON)、さらに未設定なら PeerJS デフォルト (STUN のみ)。

学校ネットワーク (Symmetric NAT + FQDN blacklist) で WebRTC P2P が不可な環境のため。Open Relay (`openrelay.metered.ca`) は全ポート遮断、Cloudflare TURN (`turn.cloudflare.com`) は全ポート開通しており Cloudflare インフラは構造的にブロック不能。短命 credential は Worker で発行し API token を隔離。

Priority: dynamic (Worker fetch) > static (`VITE_WEBRTC_ICE_SERVERS`) > PeerJS defaults。Fetch 失敗は 5s timeout、失敗時は TURN なしで続行。学校ネットでは ICE 失敗 → 既存の auto fallback to WS Relay が効く。

### OFFSET 設計

`OFFSET = Date.now()/1000` (ページロード時刻)。全クライアントで値が異なるため snapshot メッセージで `hostTime` を送信して join 時に 1 回だけ補正。固定値 (`1735689600`) を試みたが Float32 精度の罠に落ちた (→ メタ原則 M10)。

---

## § 物理

単位系: c = 1。座標は (t, x, y)、速度は u (proper velocity、固有速度)、γ = √(1+u²)。

### 時間積分: Semi-implicit Euler

`evolvePhaseSpace` で位置更新に加速 **後** の新しい速度 `newU` を使用 (semi-implicit / symplectic Euler)。標準 explicit Euler よりエネルギー保存性が良く、相対論的運動での数値安定性が高い。摩擦を含む系で振動を抑制。同じ計算コストで精度向上。

### 因果律の守護者

毎フレーム、自分のイベントが他プレイヤーの未来光円錐の内側にあるか判定。内側なら `setPlayers` を `return prev` でスキップし、全操作 (加速・レーザー・ネットワーク送信) を凍結する。

**判定**: `diff = B.pos - A.pos`, `lorentzDotVector4(diff, diff) < 0` (timelike) かつ `B.t < A.t` なら A は B の未来光円錐内。

**なぜ**: A が B の未来光円錐より未来側にいるとき、A がレーザーを撃てると因果律に反する矛盾が生じる (B のレーザーが因果的に先に A を倒していた可能性がある)。

**体験**: プレイヤーにはラグとして感じられる。高速ブーストで座標時刻が先に進むほど凍結されやすくなる — 物理的に自然なペナルティ。

**除外対象**: `isDead` プレイヤー、Lighthouse (別方式、下記)。phaseSpace が更新されないオブジェクトを含めると偽陽性で時間停止 (→ メタ原則 M12)。

**ヒステリシス**: `CAUSAL_FREEZE_HYSTERESIS = 2.0` で振動防止。

### Lighthouse 照準ジッタ: ガウス N(0, σ²) + 3σ clamp、σ=0.3 rad

Lighthouse の `computeInterceptDirection` は相対論的偏差射撃で「慣性運動なら必中」の直線弾道を返す。プレイヤーが加速・方向転換すれば外せるが、純粋必中だと恐怖感が強すぎて至近距離は避けようがなく gameplay として厳しい。そこで方向ベクトルに xy 平面内の角度ノイズ θ を加える。

**分布**: ガウス N(0, σ²) を 3σ で clamp。

**代替検討 (一様分布)**: θ ~ U(−√3·σ, +√3·σ) で分散同じ、`Math.random()` 1 回で済み `Math.log` / `Math.cos` 不要。採用しなかった理由は裾の質: 一様は境界で突然切れて「最大外し量でほぼ一定の外れ方」が出るのに対し、ガウスは中央集中 + 希少な大外しで「人間の手ブレ」に近い。

**性能**: 発射頻度は LH 1 体につき 1/`LIGHTHOUSE_FIRE_INTERVAL` = 0.5 Hz。Box–Muller 1 サンプル ~100 ns なので毎秒 100 ns = 0.00001% CPU。毎 tick (125 Hz) 呼んでも 0.01% CPU 未満で、ガウス採用のオーバーヘッドは測定不能。**判断基準**: perf 議論の前に呼び出し頻度を確認する。低頻度なら分布形の自由度を取る。

**σ=0.3 rad の選定**: 距離 D で横ズレ RMS ≈ σ·D、3σ 時 tan(0.9)·10 ≈ 12.6 マス (射程 10)。至近 (D < HIT_RADIUS/σ ≈ 0.83) はほぼ必中、中距離以上は加速で避けられる分布。σ=0.1 (中距離必中気味) / σ=0.2 (中程度) を実機で試し、σ=0.3 が「避けられるが油断はできない」バランスだった。

**実装**: `perturbDirection` (lighthouse.ts) が owner (beacon holder) のみで 1 発につき 1 回サンプリングし、結果を `laser` メッセージで broadcast。受信側は direction をそのまま使うので peer 間で direction が一致する (決定論性は seeded RNG にしなくても同期は壊れない)。

### Lighthouse 因果律ジャンプ

Lighthouse (静止 AI) が誰かの過去光円錐内に落ちたら、最も過去にいる生存プレイヤーの座標時間にジャンプ。

灯台は静止 (γ=1, dt=dτ) だがプレイヤーが加速すると dt=γ·dτ で座標時間が速く進み、灯台が置いていかれる。従来は因果律ガード (フリーズ) から灯台を除外していたため因果律が破れていた。フリーズは灯台には不適切 (入力がないので永久にフリーズし続ける)。ジャンプなら灯台の世界線は時間方向に不連続になるが、因果律は保たれる。

検出条件: 任意のプレイヤー P について、灯台 L との差 `L.pos - P.pos` がミンコフスキー的に時間的 (l < 0) かつ L.t < P.t → L は P の過去光円錐内。

ジャンプ先: 全生存プレイヤーの座標時間の最小値。最も遅れているプレイヤーに合わせることで全員に対して因果律を回復。

### 過去光円錐交差の統一ソルバー: `pastLightConeIntersectionSegment`

レーザー・デブリ・世界線の過去光円錐交差計算で共通の二次方程式ソルバー (`physics/vector.ts`)。時空区間 X(λ) = start + λ·delta (λ ∈ [0,1]) と観測者の過去光円錐の交差を解く。

`laserPhysics.ts` (レーザー描画) と `debris.ts` (デブリ描画) は同じアルゴリズムを重複実装していたため抽出。世界線の描画は引き続き `worldLine.ts` 内の独自実装 (セグメント列の走査 + binary search + 半直線延長があるため、単一セグメントソルバーへの単純委譲ではない)。

### `isInPastLightCone`: 過去光円錐判定の関数抽出

`isInPastLightCone(event, observer)` を `physics/vector.ts` に追加 (`lorentzDot(diff, diff) <= 0 && observer.t > event.t`)。キル通知とスポーンエフェクトの両方で使用。

因果律の守護者は未来光円錐判定 (strict `< 0`、方向逆) で別の操作。`isInPastLightCone` に統合しない。

### 因果的 trimming

`appendWorldLine` で `maxHistorySize` を超えたとき、最古の点が全他プレイヤーの過去光円錐の内側にある場合のみ削除。そうでなければ保持。

判定: `diff = otherPos - oldest.pos`、`diff.t > 0 && lorentzDot(diff, diff) < 0` なら oldest は otherPos の過去光円錐の内側 → 削除 OK。

安全弁: `maxHistorySize * 2` を超えたら因果的判定を無視して強制削除 (メモリ保護)。コストは O(P) per frame、P = 2-4。無視できる。

### スポーン座標時刻: 自分以外の全プレイヤー最大値

`computeSpawnCoordTime(players, excludeId?)` (`game/respawnTime.ts`): **excludeId を除いた全プレイヤー** (生存/死亡/LH 問わず) の `phaseSpace.pos.t` 最大値。初回スポーン・リスポーン・新 joiner スポーンの **3 経路すべてで共通**。

**2 つの原則**:

1. **自機除外 (excludeId)**: 呼び出し元が自機 ID を渡すと除外される。自機が ghost 中の自己 respawn 計算で自分の ghost.pos.t を参照するのを防ぐ。ghost は thrust 自由 + energy 消費ありで生存時と同じ物理で進むが、自由に加速すると `pos.t` が γ に比例して先走る。自己参照しなければ他人の timeline で respawn 時刻が決まり、自機 ghost 挙動は自分の respawn に影響しない。初回スポーン・新 joiner 経路では自機がまだ `players` に未登録 (or 登録時のみ) なので `excludeId` を渡さなくても結果は変わらないが、意味論的統一のため呼び分けは呼び出し元の責務。

2. **死亡プレイヤー (LH 含む) は死亡時刻を持ち時刻とする (純粋な placeholder)**: 他人間・LH 問わず死亡中の entity は tick されず、`phaseSpace.pos.t` は死亡時刻で固定された「placeholder」として `players` Map に残り、max 計算に参加する。これは各 peer 側で:
   - **他人間 ghost**: 死亡中の phaseSpace は**ネットワーク送信されない**ため他 peer 側で自然に死亡時刻 fixed (ネットワーク同期の副作用として明示的ロジック不要で成立)
   - **LH ghost**: `useGameLoop` の LH loop が `if (lh.isDead) continue;` で tick をスキップ、phaseSpace は死亡時刻のまま変化しない
   
   両者は**対称的に扱われる**。alive の entity (自機以外の他人間 + alive LH) が 1 人でもいれば彼らの進行中 `pos.t` が max に勝つため、死亡時刻の寄与は背景に沈む。全員死亡の稀なケースでは「最後に死んだ event の時刻」が respawn 時刻になる (この瞬間 respawn する人間は死亡時刻相当に戻る形で spawn、wall clock での 10 秒 RESPAWN_DELAY は回っているが coord time は巻き戻る)。

**将来耐性**: 原則 2 の「他人間 ghost 死亡時刻固定」は「死亡中 phaseSpace 非送信」というネットワーク仕様に依存している。将来「死亡中も phaseSpace を送信する」設計変更が入ると他人間 ghost も進行して max 計算に寄与してしまうため、その時点で `computeSpawnCoordTime` に明示的な `isDead` フィルタを加える必要がある (LH は `useGameLoop` 側で tick skip が担保するので影響なし、ただし LH の phaseSpace を誰かが死亡中に触る変更を入れないことが前提)。respawnTime.ts 冒頭コメントで依存を明示。

**fallback 0 は形式保険のみ**: `players` map が完全に空 (ゲーム初期化直前の一瞬) のときだけ `maxT = -∞` で 0 fallback。LH は常に `players` に登録されているため、通常プレイ中は必ず maxT 有限。

**LH が alive の場合の役割**: alive な LH は通常プレイ中は **常に `pos.t` を進行している構成員**として max 計算に参加し、solo プレイ (他人間 0) でも LH.pos.t が maxT を確保する。wall clock・OFFSET・Date.now() 等の外部時刻への退避は respawn 計算経路から一切消えて、peer 合意だけで閉じた clean な coord-time モデルを構成する。死亡中だけ placeholder になる点が人間と対称。

**buildSnapshot との統一**: `snapshot.hostTime` も `computeSpawnCoordTime(players)` で算出 (新 joiner 自身はまだ `players` に未登録なので excludeId なしでも自然に除外された状態)。旧実装は `me?.phaseSpace.pos.t` (= beacon holder 本人の t) を使っていたため、beacon holder が γ で遅れている・ghosting 中等で他プレイヤーより過去の t を持っていると新 joiner が過去にスポーンしていた。

**History**:
- ホスト時刻
- → maxT (全)
- → (minT+maxT)/2 (`36abf67`)
- → maxT (生存のみ、`getRespawnCoordTime`)
- → maxT (全プレイヤー、`computeSpawnCoordTime`) (2026-04-16)
- → **maxT (自機除外、死亡者は LH 含め placeholder)** (2026-04-17、ghost thrust 自由化に向けた調整。自機 ghost の自己参照を排除、死亡した他人間と LH は死亡時刻で固定された placeholder として対称扱い)

**なぜ「自機のみ除外 + LH も死亡時は placeholder」の対称設計か**:
- 自機除外なし → ghost thrust 自由で自機 respawn が遠未来へ暴走
- LH 幽霊化 (死亡中も tick して pos.t 進行) → 非対称 (LH だけ特別)、tick コスト、設計が肥大
- LH 除外 → solo 時に他 alive 0 人で fallback 必要、wall clock 依存等で複雑化
- → **自機除外 + 死亡者 (人間・LH 問わず) は死亡時刻固定** が、対称性・実装・エッジケースの全方面で最もシンプル。全員死亡の稀なケースだけ「最後に死んだ event 時刻に respawn」になるが、wall clock 10 秒 RESPAWN_DELAY は回っているので実プレイ的には視点巻き戻りを伴うものの許容範囲

`createRespawnPosition(players, excludeId?)`: 座標時間 (`computeSpawnCoordTime`) + ランダム空間位置 (`[0, SPAWN_RANGE]²`) の生成もここに抽出。

### Thrust energy: laser と同一プール

プレイヤーの推進 (W/S/A/D + touch thrust) は laser と**同一の energy pool** (`ENERGY_MAX = 1.0`) を消費する。`THRUST_ENERGY_RATE = 1/9` (フル thrust 連続で 9 秒で空)、推力使用率 (`|a| / PLAYER_ACCELERATION`) に比例した消費。energy 不足時は賄える分だけ scale して適用し、残りはカット。recovery は「fire も thrust もしていないとき」のみ (`ENERGY_RECOVERY_RATE = 1/6`)。

**なぜ同一プール**:
- drifter 対策（Issue 2）の最小侵襲解として、連続推力を燃料で natural に制限する。物理 metaphor: ロケット燃料
- 「撃ちながら動き続けられない」という**戦術的意思決定**を発生させる (fire + thrust 同時で ~2.25s 枯渇)

**なぜ 9 秒 (選択肢: 6/9/12/∞)**:
- 6 秒: fire 3 秒との 2× 比。厳しすぎて戦闘が常に燃料残量戦になる → 却下
- **9 秒** (採用): fire 3 秒の 3× 比。記憶しやすい比率。通常戦闘で消費 72% → 意思決定を迫る強さ
- 12 秒: 4× 比、余裕あり。制度の圧が弱く drifter 抑制として形式的
- 無制限: R1 (推力垂れ流し) drifter 抑止できず、Issue 2 再発

**ブレーキ優遇は不採用**: 「減速方向の推力は無料」案は gameplay 救済として検討したが、物理的嘘 (減速も proper acceleration) + 実装複雑化 + 9 秒基本タンクで実害なし、で却下。

**Thrust 不足時の挙動**: energy == 0 で thrust 停止、friction (FRICTION_COEFFICIENT=0.5) で自然減速。τ ≈ 2s。終端速度近く (≈c) から停止まで coast 距離 ~2 マス。`R_HORIZON` 仮置 30 に対して到達不能 → B (燃料) だけで drifter を封じられる。A (地平) は一旦不要と判断、当面 defer。

**UI 強調**: `energy < 0.001` で "FUEL" 赤ラベル + バー点滅 (`fuel-empty-pulse` 0.7s cycle)。`energy < 0.2` で赤色化 (従来継続)。枯渇瞬間のフラッシュは過剰と判断し採用せず。

### 初回スポーン = リスポーン統一

初期スポーンの過去半直線延長を廃止。全 `createWorldLine()` 呼び出しから origin パラメータを削除。初回スポーンにもリスポーンと同じエフェクトを `pendingSpawnEvents` 経由で追加 (自機 + Lighthouse)。

旧: 初回スポーンで過去に世界線を無限延長し、過去光円錐交差マーカーを表示 → 物理的に不自然。リスポーンと同じ扱いに統一。

`WorldLine.origin` は常に null。半直線描画コード削除済み。`FrozenWorldLine.showHalfLine` フィールドも削除。

### Kill/Respawn: 世界線凍結 + isDead フラグ

kill 時:
- プレイヤーの `worldLine` を `frozenWorldLines[]` に移動
- `isDead = true` フラグ
- 死亡中はゴースト (不可視等速直線運動) — `DeathEvent` (pos + 4-velocity) から決定論的計算
- デブリ生成

respawn 時:
- 新 `worldLine` を作成 (origin なし)
- `isDead = false`
- `respawnLog` に entry 追加 → `selectInvincibleUntil` が latest respawn wallTime + `INVINCIBILITY_DURATION` を返す

`applyKill(prev, victimId)` / `applyRespawn(prev, ...)` は純粋関数として `game/killRespawn.ts` に。全 peer で共通の state transition。

### リスポーン後無敵

`INVINCIBILITY_DURATION` (現 5000 ms) でレーザー被弾しない。初回スポーンも同様。視覚表現は opacity パルス (0.3–1.0, ~2Hz)。Lighthouse は除外 (AI は `LIGHTHOUSE_SPAWN_GRACE` で射撃遅延を別途管理)。

現行実装 (Stage C-3 以降): `respawnLog` 派生。各 peer が独立に latest respawn を観測するため host 権威不要。`selectInvincibleIds(state, now)` が `respawnLog` の latest wallTime + `INVINCIBILITY_DURATION > now` で derive。

### デブリの相対論的速度合成

デブリ速度を被撃破機の固有速度空間で生成。ランダム kick を固有速度 (γv) に加算し、`ut = √(1+ux²+uy²)` で正規化してから 3速度 `v = u/γ` に変換。

固有速度空間での加算は: (1) 足し算で直感的、(2) `|v| < 1` が正規化で自動保証、(3) 行列演算不要 — ローレンツブースト行列より自然で軽量。

パラメータ: kick 幅 0〜0.8 (γv 単位)。高速移動中の撃破ではデブリが進行方向に偏る。

### キル通知・スポーンエフェクトの因果律遅延

キル通知 (KILL テキスト、death flash) とスポーンエフェクト (リング + 光柱) を、事象の時空点が観測者の過去光円錐に入った時点で発火。

**実装**: `killLog` の `firedForUi: false` entry を毎 tick スキャンし `isInPastLightCone(hitPos, myPos)` で判定。到達時に死亡フラッシュ / kill notification 発火 + `firedForUi = true` 更新。スポーンは `pendingSpawnEvents` に蓄積、同様の判定で発火、fired をバッチ化して 1 フレーム 1 回の `setSpawns` 呼び出し。

**自分が死んだ場合**: 自分はキルイベントの時空点にいるので lorentzDot = 0 → 即座成立、事実上即時。

**自分のリスポーン**: 即時 (自分の位置と spawnPos が同一)。他プレイヤーのリスポーンのみ遅延。

**教訓**: setInterval 8ms ループ内で `setSpawns` をイベント毎に個別呼び出しするとクラッシュする。fired を配列にまとめてバッチ化する必要がある。

### ゴースト 4-velocity: Vector3 → Vector4 変換

DeathEvent の `u` フィールドに `getVelocity4(phaseSpace.u)` で Vector4 に変換して保存 (→ メタ原則 M11)。ゴースト移動は `de.u.t * tau` で等速直線運動を計算。

---

## § 描画

### WorldLine: Lorentz 行列による最適化 (2+1 限定)

TubeGeometry を世界系座標で生成し、表示系への変換はメッシュの Matrix4 として毎フレーム適用。geometry 再生成は `WorldLine.version` を `TUBE_REGEN_INTERVAL = 8` で量子化してスロットリング (8 append ごとに再生成)。

ローレンツ変換は線形変換なので、CatmullRom スプラインの制御点に適用した結果はスプライン全体に適用した結果と一致。行列更新 (16 値のコピー) は TubeGeometry 再生成より桁違いに軽い。5000 点 CatmullRom + TubeGeometry の計算コストを 1/8 に削減。

**制約: 2+1 次元でのみ成立**。時空 (t, x, y) の 3 成分が THREE.js の頂点 (x, y, z) にちょうど収まるため、4×4 ローレンツ行列を列並べ替えで 3×3 部分行列 (+ 平行移動) として表現できる。3+1 次元では t の格納先がないため同じ手法は使えない (カスタム頂点シェーダー必要)。

Tradeoff: 世界線の先端が最大 8 フレーム分遅れて描画される。ゲームプレイ上は視認不可能な差。

### 世界線の過去延長: 廃止済み

`WorldLine.origin` は常に null (「初回スポーン = リスポーン統一」参照)。半直線延長コードと `FrozenWorldLine.showHalfLine` は削除済み。

### R3F 宣言的マテリアル

`getMaterial` + モジュールレベル `materialCache` を廃止し、R3F の宣言的マテリアル (`<meshStandardMaterial color={...} />`) に置き換え。色の変更を自動反映し、ライフサイクルは React が管理。プレイヤー数分 (2-4 個) のマテリアルにキャッシュのパフォーマンス効果はほぼゼロ。

旧: マテリアルキャッシュのキーに色が含まれておらず、仮色 `hsl(0, 0%, 70%)` でキャッシュされたマテリアルが確定色に更新されないバグがあった。

### 光円錐描画: サーフェス + ワイヤーフレーム 2 層

DoubleSide サーフェス (`LIGHT_CONE_SURFACE_OPACITY`) + ワイヤーフレーム (`LIGHT_CONE_WIRE_OPACITY`) の 2 層構造で未来/過去光円錐を表示 (未来/過去各 2 メッシュ、計 4 メッシュ)。

旧実装 (FrontSide サーフェス 0.2 + FrontSide ワイヤーフレーム 0.3) から、DoubleSide に戻して全体を薄くし骨組みで形を出す方針に変更。世界スケール半減で光円錐が小さくなり、FrontSide だと見えにくくなったため。

不採用案: fog (カメラ距離ベースなので、手前と奥がカメラから等距離の場合に効果がない)、gridHelper (空間参照にはなるが奥行き区別には効かない)。

### 永続デブリ + maxLambda observer 非依存

死亡時のデブリをアニメーション (Date.now ベース) ではなく、死亡イベント + パーティクル方向の静的データとして永続保存。過去光円錐との交差を毎フレーム計算して描画。

アニメーション爆発は一定時間で消えるが、遠方観測者の過去光円錐に届く前に消えてしまう問題を解消。

デブリの過去光円錐交差計算で使う `maxLambda` は固定値 `5` (observer 非依存)。デブリ世界線は死亡イベントから無限の未来に伸びる直線で、過去光円錐との交差は純粋に幾何学的に決まる。`observer.t > intersection.t` の条件が既にカバーするため observer の時刻で切り詰める必要はない。

観測依存 (`observer.pos.t - death.t`) だとゴースト中に phaseSpace が止まるとマーカーも止まるバグがあった。

描画コスト: 30 パーティクル × デブリ数 × 毎フレーム二次方程式。MAX_DEBRIS = 20 で上限。

### 色割り当て: joinOrder × 黄金角 + ハッシュフォールバック

2 層構造:
1. **主**: `colorForJoinOrder(index)` — 接続順 × 黄金角 137.5° で hue を割り当て。2 人で 137.5° 離れることが **保証** される
2. **フォールバック**: `colorForPlayerId(id)` — ID の FNV-1a ハッシュ × 黄金角。peerList 未受信時に使用

PeerProvider が append-only `joinRegistryRef` を管理。peerList 受信時にホストの joinRegistry を丸ごと置換 (マージではない)。`getPlayerColor(id)` が joinRegistry にあれば joinOrder 色、なければハッシュ色を返す。

**色の分離性 (黄金角)**: 連続整数 n に対する `n * 137.5° mod 360°` は最も一様な列 (Vogel の螺旋)。ハッシュ出力のビット相関があっても色相が密集しにくい。

**saturation / lightness のビット切り出し**: `hash >>> 8`, `hash >>> 16` は hue に使うビットと独立。必ず符号なし `>>>` を使う (符号付き `>>` は最上位ビットが立つと負数を返し `80 + 負` で想定外の値になる)。

**呼び出し戦略**:
- init 時に一度だけ呼ぶ — `RelativisticPlayer.color: string` フィールドにキャッシュ
- 呼び出し箇所: `RelativisticGame.tsx` init (自分) と `messageHandler.ts` phaseSpace / snapshot ハンドラ (他プレイヤー)
- 派生物 (レーザー色、デブリ、凍結世界線) は作成時の `player.color` を継承

**joinRegistry 同期: マージ → 置換**: クライアントがホストの `peerList` メッセージから joinRegistry を受け取る際、丸ごと置換する。append-only マージは順序の整合を保証できない (タイミング依存) ため、ホストの joinRegistry を単一正本として扱う。マイグレーション後も B の joinRegistry は `[A, B, C]` (A の歴史を保持)、C は置換で `[A, B, C]` を受け取り自分が index 2 になる。

**スポーンエフェクト色の遅延解決**: `PendingSpawnEvent` に `playerId` フィールドを追加し、`firePendingSpawnEvents` が発火時に `players.get(playerId)?.color` で最新色を解決。snapshot 時点では joinRegistry 未受信のため古い色になる問題を修正。

**`getPlayerColor` を useEffect deps に入れない**: `useCallback([peerManager])` で peerManager 変更時に参照が変わる。これを deps に入れると接続変更のたびにゲームループが teardown → ゲーム凍結 (`2472464` で修正)。色は作成時に一度だけ読むので deps に不要。

**トレードオフ**: 「色相距離の最大化」を捨てた。2〜4 人なら統計的に十分分離。もし将来問題になれば `colorForPlayerId` 内部だけで色相テーブルの 12 色パレット化など純関数のまま改善できる。

### レーザー方向マーカー

トリガー中に自機から過去光円錐方向 (45° 下向き) に 3 つの三角形マーカーを表示 (0s/0.05s/0.1s で順次出現、spacing=1.2 で tip↔base 接合)。レーザーが時空図上でどの方向に飛んでいるかのフィードバック。

三角形は過去光円錐の 45° 斜面上に同一平面で配置。向き = `(cos(yaw), sin(yaw), -1)` を正規化。

### レーザー × 光円錐 交点マーカー: 接平面に貼り付く三角形

観測者の過去/未来光円錐とレーザーの交点に、レーザーの向きベクトルを tip とする三角形を **光円錐の接平面上に** 配置する。交点の情報「どの位置で、どっち向きに」を同時に伝達。

**代替検討**:
- 球 (旧): 位置のみ、向き情報なし — 却下
- xy 平面フラット (第一歩): 向きは分かるが、3D 中で「浮いた板」として見え、光円錐との関係が視覚的に切れる — 却下
- 接平面 (採用): 光円錐の 45° 斜面に同一平面で貼り付き、交点と光円錐の一体感が出る

**接平面の幾何**: world 座標で Δ = event − observer、ρ = |Δ_xy|。過去 (Δt<0) / 未来 (Δt>0) 共通で、光円錐 F = Δx² + Δy² − Δt² = 0 の勾配から外向き単位法線は `n = (Δx, Δy, -Δt) / (ρ√2)`。レーザー xy 方向 `ℓ = (ℓx, ℓy, 0)` を接平面へ射影 → `u = ℓ − (ℓ·n)·n` を正規化、`v = n × u` で右手系を閉じ、回転行列 [u|v|n] を生成。world-frame 導出なので観測者静止系/世界系表示どちらでも同一式で動き、D pattern (頂点単位 Lorentz) と整合。

**三角形形状: Acute golden gnomon (頂角 36°、脚:底辺 = φ:1)**

細長い方向指示としては縦:底辺 ≈ 3 前後が視認性に優れる。当初縦:底辺=3.75 / φ:1 分割等を試して最終的に golden gnomon 形 (縦≈1.84·底辺) を採用。これは古典的な「形状としての黄金比」(脚と底辺の比) で、placement としての golden section ではない (**命名時はどちらの黄金比か区別すること**)。

**交点の扱い**: 三角形の重心 ((tip + 2·back)/3) が交点に一致するよう配置 (tip=2h/3, back=−h/3)。球時代の「中心 = 交点」の直感を保存。

**DoubleSide material**: 接平面は斜めなので上下どちらから覗かれても見えるようにする。過去側は不透明 (`1.0`)、未来側は薄表示 (`0.15`) で「既に観測済み」と「これから観測する」の視覚階層を維持。

**実装**: `computeConeTangentWorldRotation` ヘルパー (SceneContent.tsx) が world-frame 回転行列を返し、`buildMeshMatrix(event, displayMatrix) × rotation` で mesh matrix に合成。過去/未来両方の render loop で共通利用。

### 光円錐 / 世界線 / レーザー の opacity を定数化

`constants.ts` に 5 定数を集約:

| 定数 | 値 | 旧リテラル箇所数 |
|---|---|---|
| `LIGHT_CONE_SURFACE_OPACITY` | 0.08 | 2 (過去/未来サーフェス) |
| `LIGHT_CONE_WIRE_OPACITY` | 0.04 | 2 (過去/未来ワイヤー) |
| `PLAYER_WORLDLINE_OPACITY` | 0.65 | 1 (WorldLineRenderer default) |
| `LIGHTHOUSE_WORLDLINE_OPACITY` | 0.4 | 1 (SceneContent LH override) |
| `LASER_WORLDLINE_OPACITY` | 0.3 | 1 (LaserBatchRenderer) |

**基準 (§7.4 運用)**: 「代替検討 / tradeoff 議論のある判断」のみ定数化。光円錐 surface/wire は 4 箇所重複 + 意味のペア、worldline 3 定数は「人間 vs 灯台」「実体 vs 仮想」の視覚階層を名前で expressive にする。対して単発の局所値 (未来交差 0.15 / 0.12、キル通知 0.6 / 0.8、プレイヤー自他 1.0 / 0.5 等) は in-place のまま: 三項内の対比が読めるので定数名にするより直接数値の方が分かりやすい場合がある。

**トレードオフ**: surface と wire を別定数にしたのは、将来「ワイヤーだけ濃くしたい / 薄くしたい」の可能性のため (実際 0.12→0.08→0.04 と独立に調整)。同値でも分離維持。

### Spawn エフェクト: pillar は過去光円錐 anchor、ring は世界系同時面

**Pillar (時間軸の光柱)**:

World-frame で spawn event から未来方向に固定配置すると、観測者が時間前進する分 display 上で過去側に流れてしまう (観測者基準では「沈んでいく」)。観測者の rest frame で見た目静止させるには、観測者の null cone に anchor するのが物理的に正しい: `anchorT = observer.t − |Δxy|` (spawn xy 上の過去光円錐交差)。

- ρ=0 (= spawn 瞬間に自分が spawn 地点): anchorT = observer.t = spawn.t、pillar が display 中央に
- 観測者が spawn 地点から離れる: ρ 増加、anchorT が遅れる → 光伝播遅延として正しい「光がまだ届いていない」表示

**代替検討**:
- World-frame 固定: 「スポーン事象は世界系で確定した事件」と主張できるが、観測者視点で過去に流れて見える → 却下
- 観測者 rest frame 同時面 anchor (`anchorT = observer.t`): 物理的に光速越え (spacelike separation の点にすら「今ここ」で物体を置く) — spawn 事象の位置なのに光より速く見えてしまい逆に不自然 → 却下
- 過去光円錐 anchor (採用): 「観測者が今まさに見ている時点」で pillar を描画、光速伝播の時間遅延と整合

**pillar 形状は世界系で固定、opacity のみフェード**: 高さ 3 を固定、scale アニメーションは撤廃 (従来の高さ縮退は「流れる」印象を与えた)。`opacity * 0.6` で時間経過と共にフェード。

**軸オリエンテーション修正 (2026-04-15 latent bug)**: `sharedGeometries.spawnPillar` の `CylinderGeometry` は default 軸が local +Y。元コードは rotation なしで `scale=[1, pillarHeight, 1]` をかけていたため pillar は **空間 Y 方向** に伸びていた (コメントでは「時間軸方向」と主張していたが実態と矛盾していた latent bug)。`rotation={[Math.PI/2, 0, 0]}` を追加して local +Y を world +Z (時間軸) に起こした。

**太さ修正**: 半径 0.04 (直径 0.08) では実視不可能なほど細い。0.5 (直径 1) へ。放射 segment 6→12。

**Ring (世界系同時面)**: pillar と違い ring は 5 本が spawn event からわずかに未来側 (ringT = spawn.pos.t + 0.25·i) に配置された world-frame 静止オブジェクト。D pattern で描画することで世界系同時面に自動で乗り、観測者が運動していれば Lorentz 傾斜も反映される。pillar のような anchor 不要 (観測者が時間前進しても ring は world 座標で静止、display 上では過去に流れていくが、5 本の時間方向スタックが「時間軸に広がる波紋」として読めるので違和感ない)。

### worldLine.history サイズ: 5000 → 1000 (FPS 対策、2026-04-17)

**現象**: 固有時間 ~170s の長時間プレイで FPS が 10 まで低下。位置 (円柱内外) にかかわらず、時間経過だけで単調悪化。

**切り分け**: 半透明 surface overdraw・光円錐 overdraw・WorldLine TubeGeometry 再生成を順に無効化して FPS 測定したが、いずれも主因ではなかった (Tube を完全無効化しても放置で FPS 114 → 7)。`MAX_WORLDLINE_HISTORY` を 5000 → 100 に下げると時間経過での劣化が停止 → **`worldLine.history` に対する O(N) 処理** が主因と確定。

**O(N) の発生元**:

- `SceneContent.tsx` の `worldLineIntersections` / `laserIntersections` / `futureLightConeIntersections` useMemo: 毎フレーム全 player × 全 frozen × 全 laser の history を `pastLightConeIntersectionWorldLine` / `futureLightConeIntersectionWorldLine` で走査
- `gameLoop.ts` の `findLaserHitPosition`: 同様に history を舐める

これらが history 長 N に比例。N=5000 では固有時間蓄積で GC + JS execution が 16ms 予算を食い潰す。

**短期対策 (採用)**: `MAX_WORLDLINE_HISTORY = 1000`。視覚的には世界線が過去側で切れる点が手前に来る (= 短い tube) が、実プレイ感はほぼ変わらず。FPS は 120 以上を維持。

**中期対策 (実装完了、2026-04-17 午後)**: `physics/worldLine.ts` の交差系 API を**二分探索**で O(log N) 化。

### 実装 (二分探索 + ±K 近傍)

- `pastLightConeIntersectionWorldLine`: signed cone distance `g(i) = (observer.t − history[i].t) − ρ_i` の符号反転境界を binary search (history は pos.t 単調増加なので有効)、その index から ±K=16 近傍だけ線形走査して **non-monotonic g にも tolerant**。
- `futureLightConeIntersectionWorldLine`: 対称的に `f(i) = history[i].t − observer.t − ρ_i` の `f ≥ 0` となる最小 i を binary search、±K 近傍スキャン。
- `findLaserHitPosition`: laser の時刻範囲 `[emissionPos.t, emissionPos.t + range]` に対応する segment index を `findLatestIndexAtOrBeforeTime` で両端 binary search して絞り込み走査。`history span > laser range` のとき効く (MAX 5000 に戻す際に有効化)。

複雑度: N=1000 で O(N) → O(log N + K) ≈ 26 ops。34 呼び出し/tick として 34 × 26 = 884 ops ≈ 0.1 % CPU (従来 4 % 前後から大幅減)。`MAX_WORLDLINE_HISTORY` を 5000 に戻しても同じ次元で収まる (別 commit で defer)。

### Vitest 導入とテスト駆動

2026-04-17 午前に一度二分探索化を試みたが、HMR で「全描画消失」が起きて B 案のバグに見えて revert した。後に HMR Provider 再マウントの副作用と判明 (M15 事例)。**再挑戦時は linear scan reference 実装との regression test を先に書く** と判断し、以下を実施:

- `pnpm add -D vitest` で Vitest を devDependencies 追加、`pnpm test` / `pnpm test:watch` script を `package.json` に追加
- 旧 linear scan 実装を `pastLightConeIntersectionWorldLineLinear` / `futureLightConeIntersectionWorldLineLinear` として export 維持 (deprecated、regression test 比較用)
- `src/physics/worldLine.test.ts` に **11 件のテスト**: 空 history / 短い history (N=1..10) / 大規模 random (N=50-1000, 100 trials) / observer 末端付近 / 空間的に遠い observer (非単調 g stress) / observer history 開始前 or 終了後 / 急激な方向転換 worldLine など
- reproducible PRNG (LCG) で seed 固定、linear 版と binary 版の PhaseSpace 出力が `EPS = 1e-9` 以内で一致することを全ケースで確認
- 全 test green 後に main 本経路 (`SceneContent` / `gameLoop` / LH AI) が binary 版を使うよう差し替え

**教訓**: 物理コア (pure 関数だが 100 行超のロジック) を触るときはまず既存実装を reference として残し、新実装が同じ result を返す regression test を書いてから呼び出し元を切り替える。bug 混入時も linear 版に即 revert できる。feat branch 上で Vitest + TDD の流れで安全に merge 可能。

**ボツ候補 (採用せず)**:

- MAX を 100 未満: 視覚的に世界線がほぼ点に見える、戦闘情報としても不足
- Tube geometry の incremental update: 交差計算側が主因なので効かない (試験済)
- ring buffer + in-place update: append コスト自体は軽微 (zustand set が主ではない)。交差側の O(N) が根本
- incremental boundary cache (observer 依存 index を Map で持ち ±K linear scan): 理論的には O(1) amortized で二分探索より高速だが、cache 管理 (respawn で worldLine identity 変化時の invalidate 等) が複雑化。実行差は N=1000 で 100 μs/tick 程度で体感不可 → 二分探索の cost/benefit が最良と判断

### アリーナ円柱: world-frame 静止円柱 + 過去光円錐交線ハイライト

**動機**: Thrust energy (§物理) により drifter は燃料で封じられ物理的 drift 制御は不要だが、戦闘領域を空間的に可視化するガイドが欲しいとの要望で un-defer。実装は視覚ガイドのみで物理判定なし (壁で跳ね返す・外に出たら死亡等は検討せず)。§物理「Thrust energy」の `R_HORIZON` 仮置き 30 と異なり、画面内で見える `ARENA_RADIUS = 20` (= LASER_RANGE × 2) を採用。

**幾何**: (x − cx)² + (y − cy)² = R² の円柱、中心 (cx, cy) = spawn 一様分布の中心 (SPAWN_RANGE/2, SPAWN_RANGE/2)。spawn 範囲を [−R, R]² に対称化する選択肢もあったが、対称化は別 commit 扱い (spawn 実装変更を伴うため）。

**時間方向: 観測者因果コーンで切り出される (2026-04-17 改)**: 円柱側面の各 θ について、観測者 `(x_o, y_o, t_o)` からの空間距離 `ρ(θ) = √((x(θ) − x_o)² + (y(θ) − y_o)²)` を計算し、その θ の時間方向を **下端 `t_o − ρ(θ)` (過去光円錐との交点) から上端 `t_o + ρ(θ)` (未来光円錐との交点) まで**に設定する。

- 観測者が円柱中心にいると全 θ で `ρ = R = ARENA_RADIUS` となり、上下端は均一 (= 従来の ±H/2 に相当)
- 観測者が中心からずれると、近い θ は `ρ` 小で上下端が観測者 t に近く (狭く)、遠い θ は `ρ` 大で観測者の過去・未来に大きく伸びる。結果、円柱は**観測者の双円錐で切り出された形**になる
- 上下端が観測者因果コーンに密着するため、「観測者が見えない外の円柱」を描画する無駄がなくなり、過去に試行した `ARENA_HEIGHT = 400` 設計で発生していた**観測者が円柱外から眺めた時の overdraw 問題 (画面全体を覆う半透明 surface が fill-rate bound を招いて FPS 10 まで低下、位置 (67, 52) で実測) が自動的に解消**される

D pattern は維持: 全 geometry は world 座標で vertex を持ち、`matrix=displayMatrix` で per-vertex Lorentz 変換。rest frame では光行差で円 → 楕円に歪む。

**4 geometry は shared BufferAttribute + in-place update** (M17 の一般則を適用): surface / 垂直線 / 過去光円錐交線 / 未来光円錐交線の 4 geometry が**同じ position Float32Array** を共有し、各 geometry は `setIndex` だけが異なる:
- surface: triangle strip の index (N × 2 triangle)
- 垂直線: `(上 vertex, 下 vertex)` の pair index (N pair の LineSegments)
- pastCone: 下 vertex の輪 index (N 頂点 LineLoop)
- futureCone: 上 vertex の輪 index (N 頂点 LineLoop)

`N = ARENA_RADIAL_SEGMENTS = 128` の頂点 (上・下の pair × N) を初回 1 回だけ allocation、以後 `useFrame` で positions を **in-place 更新 + `positionAttr.needsUpdate = true`**。共有 attribute なので needsUpdate 1 回で 4 geometry 全部に反映、GPU upload も 1 回/frame。

**頂点共有の効能**: surface の下辺と pastCone loop、surface の上辺と futureCone loop が**完全に同じ頂点を通る**ので、密度差による線ズレが発生しない。旧実装では surface 64 頂点 / cone loop 128 頂点と密度が違い、直線補間の曲線近似が微妙に食い違って線が数ピクセルずれていた。shared attribute で原理的に解消。

**frustumCulled=false**: in-place update では BufferGeometry の `boundingSphere` が初回 positions (0 埋め) のまま再計算されず、three.js の frustum culling が「画面外判定」で描画スキップし Arena が見えなくなる (本番で実測)。観測者中心で必ず画面内にあるので culling 無効化で回避。M17 の trap 1 事例。

**採用しなかった代替**:
- 固定 `ARENA_HEIGHT` + observer.t 中心 window: overdraw 問題 / 「観測者外側から円柱全体が画面を覆う」を招く
- 線だけ因果コーンで clip、surface は ±H/2 固定: 下端・上端で線と surface がズレて違和感
- CylinderGeometry を使い続けて scale だけ動的変更: scale は均一なので θ 方向の非対称性 (= 観測者中心ずれ時の ρ(θ) 依存) が表現できない
- 毎 tick 新 BufferGeometry 再生成: Float32Array / BufferAttribute / BufferGeometry object を 125 Hz で 4 個 allocate、GC 圧 + GPU buffer leak 懸念で FPS 低下 (M17 アンチパターン)

**FutureConeLoop の透明度を控えめにする**: 過去光円錐交線 (下地平線) は `ARENA_PAST_CONE_OPACITY = 1.0` で強調、未来光円錐交線 (上地平線) は `ARENA_FUTURE_CONE_OPACITY = 0.3` で控えめ。既に起きた event (過去光円錐境界で観測者が実際に見ている周縁) と、まだ起きていない event (未来光円錐境界で観測者が今後届く先) という**情報量の非対称**を視覚で反映。

**過去光円錐 × 円柱 交線 (PastConeLoop)**: 観測者 (xo, yo, to) から見て、円柱上の各点 (cx + R cos θ, cy + R sin θ, t(θ)) が過去光円錐 t = to − √((x−xo)² + (y−yo)²) を満たす closed curve。surface の下 vertex と同じ position attribute を共有するので surface 下辺と完全一致。**各プレイヤーが自分の過去光円錐との交線を独立に描画** (`observerPos` は自機): 「今まさに光が届いている円柱の周縁」を明示し、world 静止円柱本体が薄く描画されていることを認知的に補完する。

**anchor 思想の対比**: spawn pillar は「点 + null cone anchor」、アリーナは「時間方向に延びた空間構造 + observer.t 中心 window + 交線ハイライト」。M13 (時空 anchor は表現したいもので選ぶ) の 2 つ目の適用例。時間的に拡張された幾何は「固定 anchor 1 点」では足らず、「window + 今の周縁」の 2 層が要る。

**透明度と両面可視**: surface 0.08 (= 光円錐 surface と同値) / 垂直線 0.04 (= 光円錐 wireframe と同値) / PastConeLoop 1.0 / FutureConeLoop 0.3 (過去光円錐より控えめ、まだ起きていない event の情報量差を視覚反映)。surface は `THREE.DoubleSide` (光円錐と同じ扱い、カメラが円柱の内側にあっても裏面から側面が見える)。

**surface 削除案を検討して却下 (历史)**: 初期の overdraw FPS 問題の調査で、surface を削除して垂直線 + 交線のみにする案も試したが、線だけでは円柱の「存在感」が失われて視認性が大きく低下。**その後に観測者因果コーンで切り出す方式へ移行したことで overdraw 問題自体が根本解決**し、surface も維持できる構成に到達。

**色 (暫定)**: `ARENA_COLOR = "hsl(180, 40%, 70%)"` (シアン、仮想空間境界のメタファー)。surface / 垂直線 / 交線すべて同色。プレイヤー色 (黄金角分散) と Lighthouse (`hsl(220, 70%, 75%)`) の色相帯を避けた暫定値で、パステル化 (SESSION.md 「色調をポップで明るく」) 時に再検討。**交線を自機プレイヤー色 (= 光円錐 wireframe と同色) にする案は不採用**: 意味論的に交線は円柱上の点の軌跡 = 円柱の所有物であり、光円錐の所有物ではない。自機の過去光円錐 wireframe が帯びるプレイヤー色と、円柱の交線が帯びる円柱色は別の「色の紐付け先」を明示したほうが読みやすい。

**骨組みは垂直線 LineSegments (wireframe は不採用)**: 初版では `CylinderGeometry` + `wireframe:true` を使ったが、side quad が 2 三角形に分割され三角形の全エッジ (= 4 辺 + 対角線) が描画されてジグザグに見える。時間方向に sweep する直線 (= timelike worldline of a fixed spatial point) の集合が概念的に正しく、対角線や上下 ring は邪魔。自前 BufferGeometry で θ 毎に 2 頂点ペア (下端 = 観測者過去光円錐交点、上端 = 観測者未来光円錐交点) の LineSegments を作り、`ARENA_RADIAL_SEGMENTS` 本の純粋な縦線だけ描画。per-vertex Lorentz で rest frame では boost 方向に応じて傾斜 (timelike line as a straight line under Lorentz transformation) する。

**物理判定なし (視覚ガイドのみ)**: 越えても何も起きない。代替案 (壁で跳ね返す / 外に出たら即死 / 周期境界でトーラス化) は別議論として defer。SESSION.md にトーラス化 todo を保持、un-defer トリガーは「壁で閉じ込める物理」要望 / 「トーラス地図で体験向上」検証希望。

### 世界系カメラ: プレイヤー追随

世界系カメラモードではプレイヤーの世界系座標 (x, y, t) にカメラが追随。カメラ向き (yaw) もプレイヤーと同じ。静止系と世界系でカメラ挙動を統一 (ローレンツブーストの有無だけが異なる)。

当初は空間 (15,15) に固定していたが、加速方向が視認できず有用性が低かったためプレイヤー追随に変更。

「世界系で世界線が加速方向に曲がって見える」問題は描画バグではなく、摩擦 (`mu = 0.5`) による減速が物理的に正しく反映されていた。

---

## § State 管理

### Zustand 移行

**動機**: invincibility 実装で「ref 1 本追加 → 7 ファイル変更」の props drilling 税が顕在化。

**結果** (`src/stores/game-store.ts` に共有ゲーム状態を集約):

| 指標 | Before | After |
|---|---|---|
| GameLoopDeps props | 34 | 14 |
| MessageHandlerDeps props | 15 | 6 |
| SceneContentProps props | 12 | 5 |
| HUDProps props | 16 | 11 |
| RelativisticGame useState | 14 | 6 |
| RelativisticGame useRef | 22 | 3 |
| shadow refs (playersRef 等) | 3 | 0 |

**ストア設計** (Authority 解体 C 以降):

| カテゴリ | 項目 | 購読方式 |
|---|---|---|
| Reactive (selector 購読) | players, lasers, scores, spawns, frozenWorldLines, debrisRecords, killNotification, myDeathEvent, killLog, respawnLog | `useGameStore(s => s.X)` |
| Non-reactive (getState のみ) | processedLasers, pendingSpawnEvents, displayNames, lighthouseSpawnTime, lighthouseLastFireTime | `store.getState().X` |
| Local UI (RelativisticGame) | showInRestFrame, useOrthographic, deathFlash, isFiring, fps, energy | useState |
| Local ref (useGameLoop 内部) | causalFrozen, lighthouseLastFire, lastLaserTime, fpsRef, energyRef, ghostTau | useRef |

**撤去済み** (Authority 解体 C): `deadPlayers: Set`, `invincibleUntil: Map`, `pendingKillEvents[]`, `deathTimeMap: Map` — event log 由来の selector に置換。

**判断**:
- `killNotification` と `myDeathEvent` は HUD + SceneContent + gameLoop の 3 モジュールが参照 → store (reactive) に昇格
- `lighthouseSpawnTime` は handleRespawn + messageHandler が書き込む → store (non-reactive) に昇格
- `handleKill`/`handleRespawn` は store actions に吸収。`handleRespawnRef` 間接参照パターン解消
- `ghostTauRef` は useGameLoop 内部 ref に移動
- `getPlayerColor` は PeerProvider 由来のため store に入れず、必要な場所にパラメータで渡す

### リファクタリング現状評価

| ファイル | 行数 | 判断 | 理由 |
|---|---|---|---|
| `PeerProvider.tsx` | 1023 | defer | Phase 1 effect のコールバックネストは PeerJS ライフサイクルと密結合。分割しない理由は依然有効 |
| `RelativisticGame.tsx` | ~340 | — | Zustand 移行で 539→340 行に大幅削減。state/ref/callback の大半を store に移行済み |
| `useGameLoop.ts` | ~480 | defer | GameLoopDeps 34→14 props に縮小。内部 ref 化で依存が明確に |
| `SceneContent.tsx` | ~545 | — | store selectors + レーザー方向マーカー追加で微増。SceneContentProps 12→6 |
| `game-store.ts` | ~255 | — | handleKill/handleRespawn を store actions として集約 |

**再評価トリガー**: PeerProvider が 1100 行を超えたら分割を再検討。

### handleKill 二重キル防止ガード

`handleKill` 冒頭に `if (selectIsDead(state, victimId)) return` を追加。hit detection (`processHitDetection`) の `deadIds.has()` チェックと二重防御。

背景: ハイスコアに異常値 (6099 キル / 1:48) が報告されたため防御的に追加。現行コード (Zustand 移行後) は kill rate 0.1/s で正常と確認済み。異常値は Zustand 移行前後の過渡期のものと推定。

### Stale プレイヤー処理

**構造**:
```
stale 検知 (ゲームループ内、毎 tick)
├── 壁時計 5 秒更新なし → staleFrozenRef.add(id)  [切断・タブ停止]
└── 座標時間進行率 < 0.1 → staleFrozenRef.add(id) [タブ throttle]

stale 回復 (messageHandler、phaseSpace 受信時)
└── staleFrozenRef.has(playerId) かつ isHost → respawn + delete

stale 除外
├── 因果律ガード: staleFrozenRef.has(id) → skip
├── 死亡中プレイヤー: isDead → stale 検知しない
└── visibilitychange: document.hidden → ゲームループ停止 → 検知も止まる
```

**S-1〜S-5 修正済み** (2026-04-13 一括解消):
- S-1: Lighthouse を stale 検知から除外 (`isLighthouse(id) → continue`)
- S-2: Kill + stale の二重 respawn を防ぐ (`staleFrozenRef.delete(victimId)`)
- S-3: `lastCoordTimeRef` の cleanup 漏れ → `purgeDisconnected` ヘルパーで 3 ref 一括 cleanup
- S-4: stale recovery 時の `lastCoordTimeRef` 未リセット
- S-5: 死亡中に stale 検知が止まる → `stale.checkStale` を isDead 分岐の外に

### myDeathEvent は ref で持つ

`myDeathEvent` (kill 時のゴーストカメラ用 DeathEvent) を `useState` ではなく `useRef` のみで管理していた時期あり。state で持つとゲームループ useEffect の deps に入り、kill のたびに effect がクリーンアップ → respawn timeout が clearTimeout される → ホストがリスポーンしない致命バグ。

現在は store の reactive state (3 モジュール参照のため)。`ghostTauRef` と同じパターンで HUD の re-render は `setPlayers(applyKill(...))` の副次効果として保証される。

---

## § UI / 入力

### visibilitychange によるゲームループ停止

`document.hidden` のとき、ゲームループ (`setInterval` 8ms) と PeerProvider の ping 送信をスキップ (`clearInterval` ではなくループ内チェック)。

理由: ブラウザはバックグラウンドタブの `setInterval` を throttle する (Chrome: ~1s、Safari: もっと遅い)。throttle されたループが中途半端な頻度で走ると: (1) stale な phaseSpace を低頻度で送信し続ける (2) Lighthouse AI が極低速で動く (3) 座標時間の進行率が異常に低くなる等の不整合が生じる。完全に止めるのが正しい。

チェック位置をループ内にした理由: `clearInterval` + `visibilitychange` で再開するアプローチでは、ループ本体のクロージャを再構築する必要がある (useEffect の deps 問題)。ループ先頭の 1 行 `if (document.hidden) { lastTimeRef.current = Date.now(); return; }` で同等の効果を得られ、`lastTimeRef` 更新で復帰時のジャンプも防止。

既存メカニズムとの連携: ping 停止 → クライアントがハートビートタイムアウト → migration。phaseSpace 停止 → stale 検知。新プロトコル不要。

### モバイルタッチ入力: 全画面ジェスチャ + UI 要素ゼロ

スマホ操作を `touchInput.ts` で実装。横スワイプ=heading、縦変位=thrust (連続値)、ダブルタップ=射撃。画面に描画する UI 要素はゼロ。

画面 100% を 3D ビューに使い、物理デモとしての没入感を最大化。

**採用根拠**:
- thrust はボタン (binary) ではなく縦変位の連続値 — 中間速度巡航ができる
- 射撃はダブルタップ (2 回目を保持) — シングルタッチと自然に区別でき、保持+スワイプで射撃しながら heading+thrust の全操作を 1 本の指で同時実行可能
- heading はフレーム間差分 (相対操作)、thrust はタッチ開始点からの変位 (絶対位置操作) — 非対称性が自然な操作感

HUD のインタラクティブ要素 (ボタン・チェックボックス等) はタッチ入力から除外 (`isInteractiveElement` ガード)。

Keyboard coexistence: ゲームループで keyboard と touch の入力を加算。両方同時に使えるがタッチデバイスでキーボードを使うケースは稀なので問題なし。

設計検討の詳細経緯: [`EXPLORING.md`](./EXPLORING.md) の「スマホ UI の設計思考」および「2026-04-10 の設計議論と方針決定」参照。

### レーザーエネルギー制

`ENERGY_MAX = 1.0`、`ENERGY_PER_SHOT ≈ 0.033` (1/30)、`ENERGY_RECOVERY_RATE ≈ 0.167/s` (1/6)。30 発 (≈3 秒連射) で枯渇、6 秒で 0→満タン。

- 回復は撃っていないときのみ (`!firingNow`)
- `energyRef` (ref) でゲームループ管理、`energy` (state) で HUD 表示
- リスポーン時に満タンリセット
- ネットワーク同期不要 (各プレイヤーがローカルで管理)

旧バグ: 初版では `firedThisFrame` (発射フレームのみ true) で回復を止めていたが、cooldown 100ms に対し 8ms ループで 12 フレーム中 11 フレームが回復 → 枯渇しない。`firingNow` (ボタン押下中) に修正。

### ロビー画面 + i18n + 表示名 + ハイスコア

**ロビー**: START を押した人がホスト。PeerProvider を `gameStarted` 内に移動。Lobby は PeerProvider の外 (`usePeer()` 不使用)。接続レイテンシ ~300-500ms は体感的に問題なし。

**i18n** (`src/i18n/`): 自前 Context + TypeScript 辞書 (ライブラリなし)。`useI18n()` hook で `t(key)`。言語は localStorage `"la-lang"` に永続化、default `"ja"`。~50 文字列で pluralization 不要、react-intl / i18next は過剰、0 依存で ~60 行。`TranslationKey` 型を `ja.ts` から export し compile-time チェック。

**表示名**: 専用 `intro` メッセージ型 (`{ senderId, displayName }`)。接続時に 1 回送信、beacon holder が relay。phaseSpace に相乗りすると毎フレーム +20 bytes/peer の帯域消費、intro は 1 回きりで帯域ゼロに近い。Fallback は `player.displayName ?? id.slice(0, 6)`。

**ローカルハイスコア** (`src/services/highScores.ts`): 純関数。localStorage key `"la-highscores"`、JSON 配列、最大 20 件、kills 降順。セッション境界は Start 押下 → タブ close/reload。

**pagehide 対応**: モバイル Safari では `beforeunload` がバックグラウンド化時に発火しない。`pagehide` リスナーを追加し、`savedRef` フラグで同一アンロードシーケンスの二重保存を防止。`pageshow` で `persisted === true` (bfcache 復帰) なら `savedRef` をリセット。

### 因果律スコア

キルスコアの加算タイミングは「各プレイヤーの過去光円錐に hitPos が入ったとき」。`killLog` の entry が全 peer で独立に観測され、`firePendingKillEvents` が過去光円錐到達を判定してスコアを加算。全員が同じイベントセットを受け取るので最終的に一致 (加算は可換)。

KILL テキストが出るのと同じタイミングでスコアが増えるのが自然。物理デモとしてスコアも因果律に従うべき。

---

## § 通信・セキュリティ

### メッセージバリデーション

`messageHandler.ts` で全メッセージタイプに `isFiniteNumber` / `isValidVector4` / `isValidVector3` / `isValidColor` / `isValidString` のランタイム検証を実施。laser range は `0 < range <= 100` (LASER_RANGE=10 の 10 倍をマージン)。

**意図**: `msg: any` で受け取ったネットワークメッセージの NaN/Infinity 注入防止、laser の color フィールドなど CSS 文字列で CSS インジェクション防止、文字列フィールドの型安全性確保、不正メッセージのリレー防止。

ホストリレー (PeerProvider) でも `isRelayable()` で構造を検証してからブロードキャスト。

**不採用**: body の sender 検証。body の `senderId` は送信者が自己申告する値で spoofing 防御にならない (→ § Authority 解体 B 参照)。

注: `playerColor` メッセージ型は 2026-04-06 に廃止済み (色は決定的算出)。

zod 等のスキーマライブラリは導入せず手書きで軽量に。

### グローバルリーダーボード: Cloudflare KV 単一キー設計

リーダーボード全エントリを KV の単一キー `"top"` に JSON 配列として格納。Worker 側でトップ 50 フィルタ (read → 比較 → 条件付き write)。

KV は値サイズ 25 MB まで。50 エントリ × ~100 bytes ≈ 5 KB で十分収まる。単一キーなら read 1 回 + write 最大 1 回。トップ 50 に入らないスコアは read only (無料枠 100K reads/日で十分)。write は条件付きなので無料枠 1K writes/日を大幅に節約。

トレードオフ: 同時書き込みの last-write-wins。物理デモゲームでは許容。

Worker ソースは `turn-worker/src/index.ts` (TURN credential proxy と同居)。クライアント側 URL は `.env.production` の `VITE_LEADERBOARD_URL`。

### sendBeacon CORS: text/plain 選択

`submitScore` の `sendBeacon` で送る Blob の Content-Type は `text/plain` (→ メタ原則 M9)。`beforeunload` / `pagehide` 両方で発火。

### Relay サーバーセキュリティ

| パラメータ | 値 | 説明 |
|---|---|---|
| `MAX_MESSAGE_SIZE` | 16 KB | メッセージサイズ上限 |
| `RATE_LIMIT_MAX_MSGS` | 60 msg/s | クライアントごとのレート制限 |
| `MAX_CONNECTIONS` | 100 | 同時接続上限 |
| `HEARTBEAT_INTERVAL_MS` | 30s | WebSocket ping (サーバー→クライアント) |
| `HEARTBEAT_TIMEOUT_MS` | 10s | WebSocket pong タイムアウト |

注: 上記は relay server の WebSocket レベル heartbeat。ゲームクライアントの beacon holder 切断検知は別 (`PeerProvider` の `ping`、Stage G 以降 1s / 2.5s)。

---

## § Defer 判断

### 残存する設計臭 (2026-04-06 監査 → 2026-04-06 再評価で全件 defer)

色バグの掃除と 4 軸レビューの後、同類の匂い (単一情報源の違反・派生可能な state・外部イベントの React 化・二重エントリポイント) が残っている箇所を棚卸ししたもの。**監査時点では #2 → #1 → #4 → #3 の順で掃除する計画だったが、同日夕方に再評価して全 4 件を defer に決定した**。

各エントリの技術分析は将来 un-defer する際の下敷きとして原文のまま残し、各エントリ末尾に「現状判断」ブロックを追加して defer 理由と un-defer トリガーを明記した。

#### 残存臭 #1: `deadPlayersRef` / `processedLasersRef` は async state の sync mirror

**場所**: `RelativisticGame.tsx:79-80` (ref 宣言)、`:623-636` (当たり判定で参照)、`:655-680` (更新)

**現状**: `RelativisticPlayer.isDead: boolean` が `players` Map の各プレイヤーに既に存在するのに、別途 `deadPlayersRef: Set<string>` を持って同じ情報を manual に同期している。同じく `processedLasersRef: Set<string>` は「このティックで既にヒット判定を処理したレーザー」を追跡。

```ts
// ホストが kill 検出 (game loop 内)
deadPlayersRef.current.add(victimId);           // sync で即時反映
handleKill(victimId, killerId, hitPos);         // setPlayers で isDead=true (async)
// ↑ 同じティックの後続の当たり判定が deadPlayersRef を見て skip する必要あり
```

**根本原因**: React の `setState` は async、game loop は sync というインピーダンスミスマッチ。

**色との類似**: 色は「ID から算出できる純関数データ」を state + pending + メッセージ型で 3 重管理していた。これは「React state の真実 (`isDead`)」を ref で mirror している。**同じ情報が 2 箇所に書かれ、手で同期を維持する必要がある**。色ほど race は致命的にならないが、同期忘れバグの温床。

**解消方向**:
- 現状でも `killedThisFrame: Set<string>` というローカル変数が per-tick dedup を担当しているので、1 ティック内は `killedThisFrame` に任せる
- 2 ティック目以降は `playersRef.current.get(id)?.isDead` で判定できるはず
- 検証: 120Hz のゲームループ内で setPlayers の commit が次ティックまでに確実に反映されるか

**優先度**: 高 (mirror 同期忘れバグは潜在的に高リスク)、難易度: 中

**解決 (2026-04-12)**: `setPlayers` ラッパーで `playersRef.current` を updater 内で即座に同期する方式を実装 (`172b600`)。これにより `deadPlayersRef` mirror は不要になった (`playersRef.current.get(id)?.isDead` が常に最新値を返す)。ただし `deadPlayersRef` 自体の削除は未実施 (動いているので低優先度)。

#### 残存臭 #2: connections useEffect で外部イベントを React state 経由で diff している

**場所**: `RelativisticGame.tsx:227-266` (特に `:229` の `prevConnectionIdsRef` 宣言と `:236-244` の比較ループ)

**現状**:
```ts
const prevConnectionIdsRef = useRef<Set<string>>(new Set());
useEffect(() => {
  if (peerManager?.getIsHost()) {
    for (const conn of connections) {
      if (conn.open && !prevConnectionIdsRef.current.has(conn.id)) {
        peerManager.sendTo(conn.id, { type: "snapshot", ... });
      }
    }
  }
  prevConnectionIdsRef.current = new Set(connections.filter((c) => c.open).map((c) => c.id));
}, [connections, myId, peerManager]);
```

**なぜ smell か**: `dc.on('open')` の **その瞬間** に PeerManager は「これは新規接続だ」と分かっている。それをわざわざ `setConnections` で React state に昇格させ、再レンダーを起こし、前回の ref と diff を取って「新規」を復元している。情報の流れが「イベント → スナップショット → diff 検出」と遠回り。

**色との類似**: 色の `playerColor` ブロードキャスト (host → 新クライアントに対して既存プレイヤーの色を送り直す) と同じクラス。**外部の事象 (接続開始、色決定) を、同期機構 (React useEffect / ネットワークメッセージ) に載せて復元している**。

**解消方向**:
- PeerManager に `onNewPeerOpen(cb: (peerId: string) => void)` を足す
- `dc.on('open', () => { cb(dc.peer); notifyConnectionChange(); })` で即時コールバック
- RelativisticGame は useEffect ではなく一度だけ購読:
  ```ts
  useEffect(() => {
    if (!peerManager) return;
    return peerManager.onNewPeerOpen((peerId) => {
      if (peerManager.getIsHost()) {
        // snapshot 送信
      }
    });
  }, [peerManager, myId]);
  ```
- `prevConnectionIdsRef` を削除
- 注意: `connections` state は UI (接続インジケータ) で使っているので削除せず、diffing ロジックだけ消す

**優先度**: 高 (コード量削減・バグ温床除去)、難易度: 中 (PeerManager + PeerProvider + RelativisticGame の 3 ファイル変更)

**現状判断 (2026-04-06 再評価)**: **defer**。
- 実コード読み直しで、変更範囲が監査時見積より広いことを確認: PeerManager だけでなく `WsRelayManager.ts` にも同じ callback API を足す必要がある
- diffing は動いている。現時点で実害ゼロ
- 節約される行は 20 行前後、得られるのは「ライフサイクルイベント型の API」という美学
- **un-defer トリガー**: (a) 接続ライフサイクルに絡む実バグ観測、(b) snapshot / sync ハンドシェイクを別設計に差し替える機会、(c) PeerProvider に `reconnecting` 等の phase 概念が必要な機能を足すとき (#4 と合流)

#### 残存臭 #3: kill 処理の dual entry point (ホスト権威メッセージ)

**※ Authority 解体 Stage B/C/D で解消済み** (`8b4932f` / `01fed9d` / `d0d05f0`): target-authoritative 化で「host だけ game loop で直接呼び、他は messageHandler」という dual entry は消え、全 peer が `sendToNetwork(kill)` + `handleKill` を自分の game loop で呼ぶ単一経路に。host skip guard も撤去。self-loopback pattern を導入する代わりに、発信責任を owner 本人に一元化することで自然解消。respawn も同様 (Stage D)、score は型ごと削除 (Stage C-1)。

(以下は 2026-04-06 当時の分析記録を un-defer の下敷きとして保持)

**場所**: `RelativisticGame.tsx:678` 付近 (ホストのゲームループが直接 `handleKill`) + `messageHandler.ts:184-193` (クライアントが kill メッセージを受けて `handleKill`) + `messageHandler.ts:185`「ホスト skip」guard

**現状 (当時)**:
```ts
// ホスト側: game loop
peerManager.send({ type: "kill", victimId, killerId, hitPos });
handleKill(victimId, killerId, hitPos);  // 直接呼ぶ
```
```ts
// messageHandler
} else if (msg.type === "kill") {
  if (peerManager.getIsHost()) return;  // ← dual entry 回避の guard (smell の本体)
  ...
  handleKill(msg.victimId, msg.killerId, msg.hitPos);
}
```

**なぜ smell か**: 同じ状態変更関数 `handleKill` に **2 本の入り口** (ゲームループ直呼び + メッセージ受信) があり、ホストだけ「自分のメッセージを自分で受け取ったら skip」という分岐を書く必要が生じている。**guard の存在自体が dual entry を認めた証**。

**色との類似**: **極めて高い**。色も init useEffect で直接 pickDistinctColor + messageHandler の phaseSpace で pickDistinctColor の 2 経路があり、掃除前はどちらかを先に実行するかで state が揺れていた。

**解消方向**: **self-loopback パターン** (PeerManager に `sendWithLoopback(msg)` を追加し、ゲームループは `handleKill` を直接呼ばず統一)。

**現状判断 (2026-04-06 再評価)**: **defer (4 件の中で最も強く defer)**。Authority 解体で自然解消 (上記)。

#### 残存臭 #4: `timeSyncedRef` が接続ライフサイクルを React に漏らしている

**※ Authority 解体 Stage F-1/H で `syncTime` 廃止済み**: `timeSyncedRef` も不要になった (snapshot を 1 回受け取るだけ、gate 不要)。

(以下は 2026-04-06 当時の分析記録)

**場所**: `RelativisticGame.tsx:78` (ref 宣言)、`:583` (ゲームループで gate)、`messageHandler.ts:118` (syncTime 受信でフラグ立て)

**なぜ smell か**: 「クライアントのクロックはホストの `syncTime` で初期化されるまでズレている、その前に phaseSpace を送ってはいけない」という接続ライフサイクルの状態が、ゲームロジック層のフラグとして露出している。本来これは PeerProvider の接続フェーズの延長で管理すべき情報。

**解消方向**: PeerProvider の `connectionPhase` に `"syncing"` / `"synced"` を追加、ゲームループは `peerStatus === "synced"` を gate に使う、`timeSyncedRef` と messageHandler のフラグ立て処理を削除。

**優先度**: 低 (実害少、1 ファイル程度の変更)、難易度: 低

**現状判断 (2026-04-06 再評価)**: **defer**。後に Authority 解体 Stage F-1/H で syncTime 自体が廃止され、`timeSyncedRef` も消えた。phase 概念の導入は「同期中…」UI 表示や再接続・再同期機能を実装するときに同時対応するのが健全。

---

#### 再評価後の判断 (2026-04-06)

監査当日の夕方、「そもそもこれをやるべきか」を深く考え直した結果、**4 件すべてを現状 defer** に決定した。監査時の優先順 (#2 → #1 → #4 → #3) はコード内在的な見た目の美学に基づく並びで、**「なぜ今これをやるのか」というプロダクト側からの問いに耐えなかった**。

##### 色バグとの「アナロジー」を疑う

監査は色バグの掃除直後に行われ、「同類の匂い」という枠で 4 件を並べた。しかし実際には色バグと 4 件は **質が違う**:

| | 色バグ | #1 mirror | #2 diffing | #3 dual entry | #4 timeSyncedRef |
|---|---|---|---|---|---|
| 本番で観測された実害 | **あり (5 パッチ)** | なし | なし | なし | なし |
| 分散・race 要素 | **ネットワーク越し** | ローカル | ネットワーク側だが副作用はローカル | ローカル | ローカル |
| 現状の guard の有無 | なし | `killedThisFrame` で intra-tick カバー済 | `prevConnectionIdsRef` が機能 | host skip guard が明示 | 動いている |

**色バグは「guard がないまま distributed race していた」** のに対し、4 件はすべて **「guard があって正しく動いているが見た目が冗長 / 層が不整合」**。同じクラスではない。

##### ROI で並べ直す

4 件はいずれも **実害ゼロ・preemptive fix のトリガーなし・コスト非ゼロ** という共通構造。物理デモアプリの価値は「相対論の時空図を触って体験できる」ことで、4 件のどれもこの価値を 1 mm も前進させない。機会費用の観点で、cleanup は負ける。

##### 「束ねる論法」の破綻

監査時に #2 と #4 を「接続ライフサイクル refactor として束ねれば同じファイルに 2 回触らずに済む」と考えたが、これは **「どのみちやる」前提に依存した節約論**で、やる価値自体を疑うと節約効果も 0 × 2 = 0 になる。

##### 後日談 (2026-04-15 時点)

- #1: `setPlayers` ラッパーで実質解決 (`172b600`)。`deadPlayersRef` 自体の削除は未実施だが動いている
- #3: Authority 解体 Stage B/C/D で自然消滅
- #4: Authority 解体 Stage F-1/H で自然消滅
- #2: 未解決。un-defer トリガー未発生

「具体 bug or 具体機能トリガーが出るまで touch しない」という defer 判断は妥当だった。4 件中 3 件は別プロジェクト (Authority 解体) の副次効果で消えたか、未着手で害を出していない。

##### 再 un-defer の条件 (全件共通)

どれか 1 件でも un-defer する際は以下のチェックを通すこと:

- [ ] 具体的な bug 観測 or 具体的な機能トリガーがあるか？ (「なんとなく気になる」ではない)
- [ ] 現時点で物理デモとして価値のあるタスク (チュートリアル・固有時刻表示・スマホ UI 等) がこれより優先されないか？
- [ ] 修正による regression リスク (特に race / timing 系) は受容可能か？
- [ ] lint + tsc + preview 2 タブテストで検証可能な単位で 1 コミットに収まるか？
