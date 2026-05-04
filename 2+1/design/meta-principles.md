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

**事例 (2026-04-17)**: 世界時刻 ~170s で FPS 10 まで低下。surface / 光円錐 / WorldLine Tube を順次無効化しても改善せず、`MAX_WORLDLINE_HISTORY` を 5000 → 100 に下げた瞬間に時間経過劣化停止 → `SceneContent.tsx` の `worldLineIntersections` / `laserIntersections` / `futureLightConeIntersections` useMemo と game loop 内の `pastLightConeIntersectionWorldLine` が毎フレーム全 history を走査する O(N) コストが主因と確定。§worldLine.history サイズ 節参照。

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

### M21. 描画 component は自己 gate、caller 側で routing しない

spec (例: `plans/死亡イベント.md` の死亡 event 描画) が「(x_D, u_D) を受けて τ_0 で発火・fade・打ち切り」のように **component-local な入力 → 条件** で定義されている時、**caller (SceneContent 等) 側で τ_0 を計算して 3-way routing** するのは二重管理。各 component が自分の入力だけ受けて内部で τ_0 計算・自己 null 判定する構造が sprectに忠実で、caller の条件分岐を 1 つ減らせる。

**実例 (2026-04-22、`8098032` 死亡 routing refactor)**: 旧実装は SceneContent で `if (player.isDead) { if (tau0 < 0) → OtherShip; if (tau0 > max) → null; else → Dead + Marker }` と 3-way 条件分岐。これを `DeadShipRenderer` と `DeathMarker` が内部で τ_0 計算し自己 gate する形に統一、SceneContent は `flatMap` で per-player に component を無条件 emit するだけ。副次効果として、OtherShipRenderer (past-cone ∩ worldline) と DeadShipRenderer (τ_0 fade) が **同時配置** でき、past-cone が worldLine 末端 (= xD) を通過する瞬間の継ぎ目問題 (片方が null を返しても他方が既に発火してる) が構造的に解消。

**適用条件**:
- component の描画条件が component-local なデータ (props + context) だけで計算できる
- 複数 regime の描画を同じ caller が持っている (= caller で routing しがち)
- regime 境界で 1 frame の null-gap が問題になる可能性あり

**反対側の失敗例 (参考)**: component が caller の知識を要求する形 (例: 「自機死亡中なら特殊処理」みたいな isMe + isDead の組合せ) は gate を caller から剥がせず、routing 残る。その場合は caller 側で持つのが素直。

診断ヒント: caller の routing が 3-way 以上になったら component 側に condition を移せないか疑う。`design/rendering.md §SelfShipRenderer / OtherShipRenderer / DeadShipRenderer / DeathMarker` 参照。

---

### M22. marker / indicator は「観測者視点」か「神の視点」かをまず決めてから gate を書く

2+1 時空ゲームの特性上、**同じ physical object に対して 2 種類の異なる視点層の marker を並存させる**ことがある:

- **観測者視点 (observer view)**: 観測者の過去光円錐が既に光を届けた位置を示す marker。referent = 「観測者が今まさに見ている (光を受信した) 事象」。ship / tower base / past-cone sphere 等。**anchor は past-cone ∩ worldLine (等) で、gate は「交差が non-null」**。光未到達のフレームは描画しない — referent が存在しないから (= 観測者はまだ光を受信していない)。
- **神の視点 (god's view、比喩)**: 観測者の光円錐と独立に world frame での状況そのものを描く pedagogical helper。**player について言えば referent は「player の現在の世界時刻上の存在そのもの」** — 観測者が光を受信済かどうかとは無関係。future-most sphere (= `phaseSpace.pos`) / future light cone intersection / future cone laser triangle 等。**anchor は world-now / future-cone 等の world frame で、past-cone gate は絶対にかけない** (光を待つと光速遅延 gap が見えなくなり pedagogy が消える)。

両層を**同じ object について同時に描く**と、display 上の 2 marker 間の gap がそのまま「光速遅延」の視覚化になる (= このゲーム最大の pedagogical 価値)。どちらか一方に統合したくなるが、**2 層は原理的に別物で、混ぜると両方が壊れる**:

- 神の視点 marker に past-cone gate をかける → gap が見えない (respawn 直後〜光到達までの「光が追いついてくる」過程を観察できない)。
- 観測者視点 marker を world-now anchor に動かす → 死亡後 wp が x_D に freeze しているのに past-cone が追いかけるため、marker が x_D から past-cone まで display z 軸を「降りてくる」曖昧な軌跡になる + respawn 新位置が光到達前に露出する。

**Dead state の扱いも層で非対称** (各層の referent 定義から素直に導かれる):
- 観測者視点: referent = past-cone ∩ worldLine の交点。frozen worldLine に past-cone が touch している間は交点が存在 → 描く。末端 (x_D) を past-cone が通過した瞬間に交点消失 → marker null → DeathMarker が以降を担当。`aliveIntersection` 非 null が gate。
- 神の視点: referent = player の現在の世界時刻上の存在。**死亡中 (幽霊期間) は player がそもそもこの世に居ない** ので referent が存在しない (wp は過去の x_D event を指し続けるだけで「現在の位置」ではない、現在の player はどこにも居ない)。よって描かない — **情報隠蔽ではなく「描く対象が無い」**。`!player.isDead` が gate (= referent 存在条件そのまま)。

**実例 (2026-04-23、commit cfcd5af + 0113413 + 後続)**:
- 旧実装は他機 / LH の sphere を 1 つだけ world-now anchor で描画し、観測者視点と神の視点を曖昧に兼ねていた。respawn 直後に pre-light 露出する regression (= SpawnRenderer ring の視覚的意味喪失) が発生。
- 初期 fix は「sphere を past-cone anchor に一本化」→ 観測者視点側は正しくなったが神の視点 marker を丸ごと失い、光速遅延の pedagogical gap が消えた。
- 最終形は **2 sphere 並存**。past-cone anchor の球 (aliveIntersection gate) + world-now anchor の球 (`!isDead` gate) を同色・同サイズで重畳、display 上の gap が光速遅延そのもの。

**Hybrid case — SpawnRenderer**: ring は D pattern で spawn event の world frame 位置に直接描画 (神の視点) だが、**fire trigger 自体は `isInPastLightCone(spawnPos, myPos)` で観測者視点 gate**。これは「光が届いた瞬間に爆発演出を始める」= 観測者ベースの時系列で fire 判定し、fire 後 ring が神視点で (world 座標基準で) 演出される、という正常な混成。同じ object でも「いつ fire するか」と「どこに描くか」は別レイヤーで決めてよい。

**適用手順**:
1. 描こうとしている marker が **「観測者が物理的に見えるはずの位置」** を示すのか、**「観測者に光が届いていなくても world で起きている事象」** を示すのかをまず決める。
2. 前者なら past-cone 系 anchor + past-cone 交差 non-null gate。後者なら world-now / future-cone 系 anchor + dead 除外のみ (past-cone gate を絶対にかけない)。
3. 両方必要なら両方描く。統合を試みない。

関連: `design/rendering.md §marker 2 層 (observer / god view)` (描画実装の具体箇所)。M23 も参照 (gate 導出の一般原理)。

---

### M23. marker の gate は semantic referent から導く (defensive に書くな)

marker (sphere / ring / arrow / 三角) は必ず具体的な **referent** (指し示す対象 — event / 位置 / 状態 / 存在) を持つ。gate (いつ描く / 描かない) を決めるとき、「regression が出るから」「情報が漏れるから」と **防御的に** 条件を追加する前に、「この marker の referent が今このフレームで現に存在するか?」を直接問う。referent が存在しなければ描かない、存在するなら描く。それだけ。

**実例 1** (神の視点 future-most sphere、`!isDead` gate):
- referent = 「player の現在の世界時刻上の存在」
- 幽霊期間は player が世界時刻上に存在しない (wp は過去の x_D event を指すだけで「現在位置」ではない)
- referent 無し → 描かない。**情報隠蔽ではなく、描く対象が無いから描かない**。

**実例 2** (観測者視点 past-cone sphere、`aliveIntersection != null` gate):
- referent = 「観測者の過去光円錐 ∩ player worldLine の交点」
- 交差が存在しない (respawn 光未到達 / worldLine 末端通過) → referent 無し → 描かない
- これも情報隠蔽ではなく referent 不在、直接的。

**defensive gate の匂い (2026-04-23 このセッションの寄り道)**:
- 一時期「respawn regression 防止のため future-most marker にも `aliveIntersection != null` を追加」していた。referent 再考で「神の視点 marker は光到達を待たない pedagogical helper だから、光円錐交差は referent の一部ではない」と判明 → gate 戻した。
- 「死亡位置が先行露出しないように」と書きたくなったが、実質は「幽霊中は referent が存在しない」だけ。情報論的語り口では本質 (存在論) が見えなくなる。

**導出手順**:
1. この marker の referent は何か? (event / 位置 / 状態 / 存在のどれに分類されるか含め)
2. その referent は各フレームでいつ存在 / 成立するか?
3. それが gate。

**診断ヒント**: 防御的 gate を書きたくなったら、referent 解析を飛ばしていないか疑う。「regression 回避」の条件を足しているなら、それは referent の定義自体に含まれるべきもの (含まれないなら regression ではなく設計ミス)。

---

### M24. 因果律 / 対称性物理量を扱う rule の片側だけ実装されているなら、 反対側の鏡像を疑う

`X が成立 → action A` という rule が実装されている場合、 「**`¬X が成立 → action B (= A の鏡像)** がない」 ことを疑う。 片側だけの rule は半端で、 反対側の状況で別 bug を生む傾向がある。 因果律 / 対称性 / 双対性が関わるドメインで特に強力な heuristic。

**実例 1** (= 2026-05-02 plans/2026-05-02-causality-symmetric-jump.md の動機):
- 既存 Rule A: 「自分が他者の **未来** 光円錐に入ったら凍結」 (`checkCausalFreeze`、 `gameLoop.ts:574+`)
- 反対側の状況: 「自分が他者の **過去** 光円錐に入った」 (= 他者から見て自分が遅すぎる、 通信できない側) → 既存実装なし
- Bug 5 / 8 / 9 はすべてこの「反対側」 の対処欠如による cliff edge
- 解決: 鏡像の Rule B 「過去光円錐に入ったら自 u^μ 方向に jump」 を追加、 両ルールで convoy 性質が emergent → 全 bug 同時解消

**実例 2** (= 2026-04-27 PBC torus universal cover refactor):
- 既存: 「観測者中心 minimum image fold」 で他機を観測者の primary cell に折り畳む
- 反対側: 他機側からの観測 path (= 他機 → 観測者を folding する path) の不整合
- 解決: universal cover image observer past-cone pattern で全 phase 対称化

**How to apply:**
- 因果律 / 対称的物理量を扱うコードで rule を書くとき、 「逆向きの状況」 がカバーされているか必ず checklist
- `if (X) { ... }` の else 側 が暗黙の no-op か、 明示的に no-op 妥当か、 鏡像 action が必要か を問う
- bug 報告で「特定方向だけおかしい」 を見たら、 反対方向の処理欠落を suspect
- 単独 fix は対症療法、 対称化は構造解消

**診断ヒント:** 「片側だけ実装されてる rule は code smell」。 とくに「N 個の bug が一見独立に見えるが全部似た時刻ジャンプや特殊扱いで対処されてる」 場面では、 共通根因として「反対側 rule の欠落」 を疑う。

---

### M25. state の単一化原則: derive 可能な state は explicit field と並存させない

「同じ事実を 2 箇所に持つ」 設計は **流入経路ごとに独立 set される drift / set 漏れ bug の温床**。 derive で書ける fact は **derive 唯一**、 explicit field は **動的 state のみ**、 という単一化を貫く。

#### 二重管理 pattern の構造

| pattern | 同期方式 |
|---|---|
| 流入経路 N 系 (= handleKill / snapshot / messageHandler / etc) | 各経路で explicit set、 経路漏れ = drift / set 漏れ |
| derive (= log / 純関数 / 親 state から導出) | 全経路自動同期、 source of truth 1 個 |

両者を **混在** させると:
- explicit field = derive cache、 だが set 経路ごとに独立 → drift する
- どこかで「derive ≠ explicit」 になっても気付けない (= 「synchronize check」 を貼り絆として追加する増殖構造、 例: snapshot.ts L327 `if (derivedDead !== p.isDead) { override }`)
- 流入経路を増やすたびに「set し忘れ」 を入れ込み bug の温床

#### decomposition 戦略 (= 単一化への分解)

**Step 1**: state を **静的部分** と **動的部分** に分解
- 静的 = 親 state (= log / phaseSpace / 何でも) から derive 可能
- 動的 = explicit にしか持てない (= ローカル UI 状態、 dynamic accumulation 等)

**Step 2**: 静的部分は **derive で唯一** (= explicit field 削除)
- 全 read 箇所を derive 関数経由に書き換え
- 「set 漏れ」 経路が原理的に消滅 (= 親 state は applyKill / merged log 等で経路非依存に同期される)

**Step 3**: 動的部分は **explicit、 但し consumer 側 lazy init を設計の一部** に
- `null だった場合の fallback 初期化` を「流入経路の責任」 ではなく「consumer (= 使う側) の責任」 に取り込む
- 例: `const ghostStart = store.myGhostPhaseSpace ?? freshMe?.phaseSpace ?? null;`
- 流入経路で「set し忘れ」 ても consumer 側で自動補正、 「set 漏れ class の bug」 が原理的に発生不可

#### 実例 1 (= 2026-05-04 plans/2026-05-04-mydeathevent-decomposition.md): myDeathEvent の二重管理解消

**旧設計 (= 二重管理)**:
- `selectIsDead(myId)` = killLog vs respawnLog から derive
- `myDeathEvent: DeathEvent | null` = handleKill で explicit set (= 経路依存、 set 漏れ可能)
- 流入経路: handleKill / snapshot 等
- 真因 bug: snapshot で killLog merge → `selectIsDead` true、 後続 handleKill が guard `if (selectIsDead) return;` で early return → `myDeathEvent` 永遠未 set → 自機死亡時 stardust 凍結 (= 「死亡中 ghost.pos.t 進まない」 user 観察、 真因は「ghost 観測者の displayMatrix freeze で stardust shader の z 軸 shift が止まる」)

**新設計 (= 単一化)**:
- 静的 death meta (= pos / u / heading) → `players.get(myId).phaseSpace` から derive (= applyKill で死亡時刻凍結保持されるため自動同期、 流入経路非依存)
- 動的 ghost (= 自機入力で processPlayerPhysics 流用 update) → `myGhostPhaseSpace: PhaseSpace \| null` 新 explicit field
- useGameLoop dead branch lazy init: `myGhostPhaseSpace ?? freshMe.phaseSpace` で consumer 側 fallback

#### 実例 2 (= audit 発見、 別 plan で fix 予定): player.isDead の二重管理

`RelativisticPlayer.isDead: boolean` (= explicit field) と `selectIsDead(state, playerId)` (= killLog/respawnLog から derive) が同 class の二重管理。 snapshot.ts L327 で「`derivedDead !== p.isDead` なら override」 と **強制同期 patch が既に貼ってある** = 二重管理の貼り絆 sign。

真の解消: 全 isDead read を `selectIsDead` 化 (= 25+ 箇所、 reach 大)、 `RelativisticPlayer.isDead` field 削除。 plan 化して別 task で進める。

#### 実例 3 (= 2026-05-04 plans/2026-05-04-stalefrozen-decomposition.md): staleFrozenIds の三重二重管理

myDeathEvent decomposition の audit pass で発見、 当初 「ref ↔ store mirror は M14 pattern (= hot path 性能の正当な複製) で正当化済」 と defer 判定したが、 user 指示で深掘りした結果 **絆創膏 sign が 2 箇所積層** で M25 違反と再認定。 単一場所に **3 つの違反**:

1. `useStaleDetection.staleFrozenRef: Set<string>` ↔ `useGameStore.staleFrozenIds: ReadonlySet<string>` の **ref ↔ store mirror dual**: 5 ad-hoc delete callsite が mirror sync を skip → 毎 tick `checkStale` 内の **drift detection patch** で self-heal という暗黙契約 (= sign 1)
2. 同 hook 内 `staleFrozenRef` (Set) ↔ `staleFrozenAtRef` (Map<id, frozenAt>) の **内部 Set/Map dual**: ad-hoc delete で Set だけ消されて Map が leak する事故を **drift prune ループ** で self-heal (= sign 2)
3. ad-hoc delete が messageHandler / RelativisticGame / useGameLoop の 5 箇所に散在、 各箇所で「ref のみ触り、 mirror + Map は self-heal 任せ」 という暗黙契約を 3 文書に分散

構造的解消: `staleFrozenAtRef: Map<id, frozenAt>` 単独化 (= キー集合 = 「stale か」、 値 = 「いつ stale 化したか」)、 全 mutation 経路 (`recoverStale` / `cleanupPeer` / `checkStale`) で `syncStoreMirror()` 即呼びで drift 不可避化、 5 ad-hoc delete を全部 `recoverStale(id)` helper 経由に統一して MessageHandlerDeps の API も `recoverStale: (id) => void` に置換。

#### サブ原則: explicit duplication の正当性チェックリスト (= 派生不能な複製の場合)

state を「2 箇所に literal copy」 する設計 (= ref ↔ store mirror、 cache table、 worker thread 状態 mirror 等) は **derive で唯一化できない場合に限り正当**。 但し正当化されるには **mutation 経路集約** が前提。 以下を全て pass しない限り「M14 pattern として正当化済」 と書いてはいけない:

- (a) **mutation 経路が 1 関数 (= 同期 helper) に集約されている**: 全 mutation site が helper を呼び、 helper 内で両 copy + sync が atomic に走る
- (b) **drift detection / drift prune patch が無い**: 「version compare → drift してたら sync」 や「size mismatch prune」 が必要なら、 設計上の drift 余地を残している sign
- (c) **ad-hoc 直 mutate path が無い**: callsite が `ref.current.delete(id)` 等を直接呼ばない、 必ず helper API 経由

(a)(b)(c) を全て pass するなら正当な duplication、 1 つでも fail するなら **mutation 集約 refactor** で M25 違反を解消する。 「正当化 docstring」 だけでは不十分 (= staleFrozenIds 旧版に「正本」 と書いてあったが実態は drift 不可避だった)。

#### 関連 meta-principle

- M2 (書き込み元を断つ: 対症療法 vs 根治): 「set 漏れ補正」 effect は対症療法、 二重管理解消が根治
- M3 (X を Y の純関数で書けないか?): derive 思想の系列、 M25 はその application
- M24 (鏡像 rule の suspect): 鏡像欠落 = 因果対称性、 M25 = state 単一性、 異なる軸の構造的 audit

#### How to apply

1. 「同じ事実を 2 箇所に持っていないか?」 を state 設計時に問う
2. 「flow A で set / flow B で set / flow C で set...」 の繰り返しが見えたら **derive 化検討**
3. 「`if (derive !== explicit) override`」 / 「`useEffect で同期取る`」 が貼られていたら **二重管理 sign**、 構造解消で patch 撤去
4. 完全 derive 不可なら **explicit + lazy init** で consumer 側補正を「設計の一部」 に取り込む

#### 診断ヒント

- 「state 設定漏れの bug」 が連発する class は二重管理を suspect
- effect ベース同期 (= 「stale 検知 → 補正」) は流入経路増加で増殖する貼り絆 pattern、 短期 fix のみ
- 「set 文を 2 箇所に書いている」 時点で drift risk、 source of truth 1 つに decomposition 検討

---

### M26. 絆創膏 vs 根本治療: 構造的 sign で見分ける

「症状を別 path で吸収する fix」 (= 絆創膏) と「真因の構造的解消」 (= 根本治療) は、 短期成果は似ているが **長期的な bug 増殖性** が真逆。 絆創膏は同 class の bug を異なる symptom で再発させ、 patch を増殖させる。 根本治療は同 class が原理的に発生不可能になる。

**絆創膏の構造的 sign**:

1. **強制同期 patch**: `if (derive !== explicit) override` (= snapshot.ts L327 例、 二重管理の貼り絆)
2. **effect ベース同期**: `useEffect(() => { if (stale 検知) fix })` (= state 同期不能性に対する後処理)
3. **defensive set 多発**: `if (state == null) initialize` を流入経路ごとに add
4. **流入経路 logic duplicate**: 「flow A で X / flow B で X / flow C で X」 の繰り返し
5. **症状検知 → 別 path で吸収**: 症状を catch する mechanism (例: WebGL Context Lost auto-remount listener) を増設、 真因 (= GPU 圧 / rebuild storm) は放置
6. **「N 個の bug が一見独立だが全部似た特殊扱いで対処」** (= M24 と相互 reinforcement): 共通根因の symptom が表層で N 通り manifest、 個別 patch は無限 loop

**根本治療への転換**:

絆創膏 sign を見つけたら、 「**この patch が必要な理由は何の構造的矛盾か?**」 を問う。 真因が見えると `decomposition` (= state 単一化、 M25)、 鏡像 rule 補完 (= M24)、 物理 model 再考 等で原理解消できる。

**実例 1** (= 2026-05-04 myDeathEvent): user の effect-based fix proposal (= isDead && myDeathEvent null を検知して initialize) を user 自身が「絆創膏」 と却下、 真因 (= 二重管理) の decomposition で M25 + 構造解消。

**実例 2** (= 2026-05-02 → 2026-05-04 Bug 10 真因再特定): 5/2 RCA「renderer mount storm」 で WorldLineRenderer wlRef pattern を fix (= 単体修復)、 5/4 で同 symptom 再発 → 真因は virtualPos lastSync で 5/2 fix は 二次症状の対症療法だったと判明、 多層 root fix で chain 解消 (= M27 link)。

#### サブ原則: 絆創膏 sign 数 = severity (= 単一場所への積層は構造負債の sign)

同一 state / 同一場所に **絆創膏 sign が複数積層** していたら、 reach (= 影響 callsite 数) が小さくても優先度高。 sign 数は「設計負債の積み上がり」 の indicator で、 1 sign は「許容できる単発 patch」 だが 2-3 sign 積層は「構造そのものが drift を許容している」 sign。

**実例** (= 2026-05-04 staleFrozenIds vs player.isDead):

| 案件 | sign 数 | 影響 callsite | severity 判定 |
|---|---|---|---|
| `player.isDead` | 1 (= snapshot.ts L327 強制同期 patch) | 30+ read site | reach 大、 plan で別 task |
| `staleFrozenIds` | **2** (= drift detection patch + drift prune ループ) | 5 callsite | reach 小だが**先に処理**、 同 session で実装可能、 構造負債の方が深刻 |

reach (= callsite 数) は影響範囲指標、 sign 数は **構造負債の深さ** 指標。 両者は独立 axis、 reach 小 + sign 多 の case が先に処理されるべき (= 構造解消は工数小、 後回しすると更に sign が積み増される)。

**How to apply (severity heuristic)**:
- audit で「違反候補」 を発見したら、 影響範囲 (reach) と独立に **絆創膏 sign を数える**
- sign 2+ なら工数小でも即着手、 sign 1 なら工数 / reach トレードオフで判断
- 「sign 1 つだけ」 と判定したものでも、 隣接機構を audit すると更に sign が出ることがある (= staleFrozenIds は当初 sign 1 想定、 深掘りで sign 2 に格上げ → 即着手判定に変更)

#### How to apply (絆創膏判定)

- 自分の fix proposal に対して「これは絆創膏 sign のどれかに該当しないか?」 を 1 度問う (= self-audit)
- user / collaborator から「絆創膏」 と指摘されたら即立ち止まる (= prudence)
- 「正しく実装されてたら起きないはず」 という domain expert の直感を信じる (= 起きているなら実装の構造的矛盾、 探せ)
- 短期 fix が必要な場合は「これは patch、 後で根本治療 plan を立てる」 を明示記録 (= debt visibility)

#### 診断ヒント

- patch 自体に「set 漏れ補正」「stale 検知補正」「強制同期」 等の名前が付いていれば 99% 絆創膏
- 「`if (X が壊れてたら Y で復活)`」 path を見たら、 X が壊れる構造的理由 (= 二重管理 / 経路依存) を探す
- effect / patch を 1 個追加するたびに増殖性 risk が上がる、 同 class bug の数を count して trend を見る

---

### M27. 多層 RCA: 症状の出る layer ≠ 真因の layer

観察される症状は **表層 layer の出力**だが、 真因は **数 layer 下の structural 矛盾** の可能性がある。 表層 fix で症状が一時消えても、 真因残存で **異なる symptom** で再発する。 多層 chain で各 layer の root cause を identify し、 全 layer を root fix するのが根本治療。

#### 多層 chain の構造

```
[Layer N] 観察される症状 (= 表層、 user visible)
   ↑
[Layer N-1] symptom を生む 中間機構
   ↑
... (連鎖)
   ↑
[Layer 1] 真因 (= 構造的矛盾 / 経路依存 / 設計 axiom 違反)
```

層が深いほど fix の reach は広く、 浅い fix は二次防衛として残せる場合あり。

#### 実例: Bug 10 (= 全世界凍結 + 星屑止まる) の 5 layer chain

| Layer | 内容 | Fix |
|---|---|---|
| 5 (表層) | rAF starve / WebGL Context Lost → user 観察「凍結」 | (= 真因 fix で消える、 5/2 fix は二次防衛として温存) |
| 4 | main thread saturation / setInterval Violation 累積 | (= layer 1-3 で消える) |
| 3 | WorldLineRenderer mount/unmount storm / TubeGeometry rebuild 連発 | frozenWorldLines stable id (`18adb8b`) |
| 2 | frozenWorldLines cycling (= 大ジャンプ毎に push、 MAX 容量で truncate) | LH 大ジャンプ凍結機構 Fix C (`b002d50`) で push 頻度を Stage 3 機構に流す + 真因解消で頻度激減 |
| 1 (真因) | virtualPos lastSync semantic 矛盾 (= host 自身処理 LH の lastSync 更新漏れ → 線形発散 → Rule B 暴走) | Fix A/B (`dcd7469`/`c8ef4b3`) |

5/2 では Layer 3 を「真因」 と誤認、 fix 後しばらく症状消えたが、 5/4 で別経路 (= host migration trigger) で Layer 1 が顕在化 → Layer 5 で同症状再発。 5/4 で多層 RCA、 Layer 1-3 全 root fix で chain 完結。

#### How to apply

1. **症状再発を診断 signal とする**: 表層 fix 後、 同 class の症状が異なる trigger で再発したら、 fix した layer は二次防衛で **真因は別 layer** と疑う。 「fix したのに直ってない」 場合に「fix が間違っていた」 と即断せず、 「症状 layer ≠ 真因 layer」 の可能性を考える。
2. **「fix したら別 symptom が出た」**: 同 真因 chain の別 manifestation の可能性、 真因 layer まで掘る。
3. **多層 fix は併用**: 各 layer の root fix を全部入れた上で、 上層 fix も「別経路で同症状が起きた場合の二次防衛」 として温存。 上層 fix を revert する必要は無い (= 設計の重層化)。
4. **真因仮説の検証**: 「真因が解消されれば、 上層の patch は不要になる」 が成立するか check。 不要にならない場合は真因仮説の誤り、 別 layer suspect。

#### 診断ヒント

- 「症状 X の fix を入れたが、 数日後に X が再発」 は典型的な多層 chain
- user の domain 直感「正しく実装されてたら起きないはず」 + 自分の RCA の不一致は、 RCA layer が浅い sign
- chain の最深層に到達した時、 「上層 fix が全て二次防衛として temporal に温存できる」 ように整理されているのが理想形

#### M24/M25/M26 との関係

- M24 (鏡像 rule): 真因の **対称性視点** から疑う
- M25 (state 単一化): 真因の **state 設計視点** から疑う
- M26 (絆創膏 sign): 真因の **patch 構造視点** から疑う
- M27 (多層 RCA): 真因の **layer chain 視点** から疑う

これら 4 つは独立した axis、 真因が見つからない時は各 axis から並行 audit すると効率的。

---

