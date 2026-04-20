# design/meta-principles.md — LorentzArena 2+1 メタ原則

DESIGN.md から分離。横断的 cross-cutting lessons (M1-M19)。個別 decision から  で参照される reference 集。

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

### M9. CORS セーフリスト (sendBeacon) ※ operationally obsolete — M19 で sendBeacon 自体を廃止

`sendBeacon` で使える Content-Type は `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` のみ。JSON を送りたい場合は `text/plain` で包む。`application/json` は CORS セーフリストに含まれないため preflight (OPTIONS) が必要だが、`sendBeacon` は preflight をサポートしないため、ブラウザがリクエストを黙って捨てる。

実害: 2026-04-12 (KV 設計デプロイ) から 2026-04-14 (本修正) までグローバルリーダーボードは dead 機能だった。Worker + KV は正常、クライアントからの送信が到達していなかった。

**2026-04-18 追記**: その後 Brave Shields が sendBeacon を block することが判明し (→ M19)、`fetch({ keepalive: true })` に全面切替。本原則は sendBeacon を使う前提が崩れたので歴史的記録として残す。

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

BufferGeometry の position が毎 frame 変わるケース (観測者依存の幾何、procedural アニメーション等) でのアンチパターン→正解。

**アンチパターン**: `useMemo(() => new THREE.BufferGeometry(), [observerPos])` で毎 tick 新規。observerPos は毎 tick 新 object → useMemo invalidate → Float32Array / BufferAttribute / BufferGeometry object が 125Hz で大量 allocation、GC 圧 + `.dispose()` 呼ばないと GPU buffer leak。

**正解パターン**: mount 時 1 回だけ geometry 作成 + useFrame で `posAttr.array` を in-place に書き換え + `posAttr.needsUpdate = true`:
```ts
const geometry = useMemo(() => {
  const positions = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return g;
}, []);
useFrame(() => {
  const arr = geometry.getAttribute("position").array as Float32Array;
  // arr を in-place 書き換え
  (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
});
```
allocation ゼロ、GPU には差分 upload のみ。

**トラップ 1: frustum culling が古い boundingSphere で判定**。初回 positions が 0 埋めで boundingSphere が原点付近の小球に初期化 → in-place 更新で再計算されず、three.js が「画面外」判定で描画 skip → **デプロイ後に見えない**。対処: `<mesh frustumCulled={false}>` (画面内が確実なら最短) / 毎 frame `computeBoundingSphere()` (正確だが cost 中) / 初期 positions を大きい box で埋める (hack)。

**トラップ 2: 複数 geometry で頂点セット共有**。surface + wireframe + 境界線で同頂点を異なる index で描画したい場合、`BufferAttribute` インスタンス自体を共有 (両 geometry が `setAttribute("position", sharedAttr)` + 個別 `setIndex`)。`sharedAttr.needsUpdate = true` 1 回で全 geometry 反映、GPU upload 1 回、頂点完全一致で離散化ズレなし。

**事例 (2026-04-17 ArenaRenderer)**: 3 トラップすべて経験 — 初版で毎 tick BufferGeometry 新規で FPS 低下 → in-place に変更で本番 Arena 消失 (frustum culling) → `frustumCulled=false` で復帰 → surface (N=64) と cone loop (N=128) で頂点密度違いで線微ズレ → shared BufferAttribute + 異なる index で単一頂点セット統一。

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

### M19. cross-origin 送信は content blocker 耐性を優先 (sendBeacon 回避)

`navigator.sendBeacon` はブラウザ内で Request Type=ping として発行される。Brave Shields / uBlock Origin 等は ping type を tracker/beacon と判定して block することがある (Brave Shields はデフォルト ON で block)。`sendBeacon` API 自体は `true` を返すので送信成功と誤認する。

対策: unload タイミングでも `fetch({ keepalive: true })` を使う。fetch type は blocker の beacon フィルタを通過する。keepalive は bfcache / unload をまたいで送信を完遂する (spec で最大 64 KB まで保証)。

実害: 2026-04-12 (KV leaderboard 初デプロイ) 〜 2026-04-18 (fetch keepalive 切替) の間、Brave ユーザーからのグローバル HS 送信が全滅。Local 保存と worker side は正常、Network tab で見ないと `net::ERR_BLOCKED_BY_CLIENT` が見えない (DevTools Console には出ない)。

診断ヒント: 「local save OK / global save だけ失敗 / worker curl OK / bundle に正しい URL 含まれる」のパターンが出たら content blocker を疑う。`fetch POST` を DevTools で手打ちして比較するのが最短。

診断手順 (2026-04-18 実施):
1. Network tab の Type 列を確認 (Console にはエラー出ない)。Type=`ping` の行に `net::ERR_BLOCKED_BY_CLIENT` が出ていれば content blocker 確定
2. DevTools Console で直接手打ち比較:
   - `fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(entry)}).then(r=>console.log(r.status))` → 200
   - `navigator.sendBeacon(url, new Blob([JSON.stringify(entry)], {type:'text/plain'}))` → `true` を返すが Network で block
3. Brave shield パネル (URL バー横のライオンマーク) を開くと blocked tracker URL が直接見える

**path 独立**: Brave は Request Type=ping を全 block する (path 非依存)。`/leaderboard` → `/scores` に変えても block。フィルタは Type のみ、URL path filter 仮説は誤り。

初期 misdiagnose の落とし穴 (2026-04-18 で実際に時間を溶かしかけた候補):
- (a) sessionId dedup が entry を filter → ❌ localStorage で entry 存在確認して棄却
- (b) `/leaderboard` という path が filter trigger → ❌ `/scores` 代替も block されるので path 非依存
- (c) `.env.local` に `VITE_LEADERBOARD_URL` 欠落 → ❌ production bundle には正しい URL が入っている (localhost 検証の罠と混同しない)

いずれも Network tab Type=ping を最初に見れば即棄却できる。本筋は **「API 成功 (sendBeacon が true) と実送信 (ping type block) の乖離」** — 全 sync API が silent success を装う content blocker 固有のパターン。

→ 旧メタ原則 M9 (sendBeacon CORS セーフリスト) は sendBeacon を使う前提が崩れたので operationally obsolete (歴史的記録として残す)。

---

### M20. 頻度で一貫性モデルを分ける (transient event delivery に全信頼を置かない)

state を peer 間で同期する仕組みを設計するとき、**全データ一律 strong consistency** にしがち。だが多くの場合、**data type ごとに要求される consistency model は違う**:

- **高頻度 stream** (phaseSpace / laser 等、~125Hz): order / latency sensitive → leader-ordered (star/BH relay)
- **sparse authoritative events** (kill / respawn 等): owner-authoritative、delivery 保証は relay + snapshot でフォロー
- **低頻度 state dump** (snapshot 等、0.2Hz): eventual consistency で十分、多ソース冗長性が効く → peer 貢献型 reconciliation

distributed systems の古典 (Raft + Gossip ハイブリッド) の直接適用。1 種類の消息に全機能を任せると、**delivery 失敗 = 恒久 state divergence** の構造的脆弱性が生まれる。

実例 (Stage 1 + 1.5、2026-04-20〜21、`design/network.md §Snapshot Reconciliation`):
- kill / respawn 等の one-shot delivery を 1 発取り逃すと受信側が恒久 ghost 化する症状 (B')
- 対策: 5s 周期 snapshot を reconciliation channel として追加。delivery 失敗は次 snapshot で自動救済
- さらに BH だけが snapshot 発信する Stage 1 設計は **BH 自身の missed event を救済できない** 非対称性があり、Stage 1.5 で全 peer が発信するよう反転

診断ヒント: 「X event を受信し損ねると永久にその state」のような症状が出たら一貫性モデルの不適合を疑う。retry / ack / ordering を入れる方向もあるが、**周期的な冗長再送 (snapshot / heartbeat) の方が往々にして軽くて堅い**。

関連 bug の副作用: "BH 専用" 機能を全 peer で使い回すとき、**implicit な BH 前提 (権限主張ロジック) を引数で明示化する必要がある**。Stage 1.5 で `buildSnapshot` の LH ownerId 強制 rewrite が表面化 → `isBeaconHolder: boolean` 引数で役割を明示 (`design/network.md §buildSnapshot 引数の意味論`)。

---

