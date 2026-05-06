# design/meta-principles.md — LorentzArena 2+1 メタ原則

DESIGN.md から分離。横断的 cross-cutting lessons (M1-M29)。個別 decision から で参照される reference 集。

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

#### 実例 2 (= audit 発見 + 同 session 完了): player.isDead の二重管理

`RelativisticPlayer.isDead: boolean` (= explicit field) と `selectIsDead(state, playerId)` (= killLog/respawnLog から derive) が同 class の二重管理。 snapshot.ts L327 で「`derivedDead !== p.isDead` なら override」 と **強制同期 patch が既に貼ってある** = 二重管理の貼り絆 sign。

**v1 plan**: 「reach 大 (= 30+ read site) で別 task」 と defer 判定。

**v2 (= 2026-05-04 同 session 完了 [`plans/2026-05-04-isdead-decomposition.md`](../plans/2026-05-04-isdead-decomposition.md))**: 実例 1 + 実例 3 の momentum を活かして同 session 内で完了。 v1 を refresh し、 性能 (a) `selectDeadPlayerIds(state): Set<string>` per-tick pre-compute / wire format (C) pass-through 維持 / Stage atomic refactor を確定して 28 file atomic で完了 (= 247 test 全 pass、 typecheck clean)。 詳細は本 §下 「caller-pass derived state pattern」 と「type narrowing for subscription decoupling」 サブ原則を参照。

#### 実例 3 (= 2026-05-04 plans/2026-05-04-stalefrozen-decomposition.md): staleFrozenIds の三重二重管理

myDeathEvent decomposition の audit pass で発見、 当初 「ref ↔ store mirror は M14 pattern (= hot path 性能の正当な複製) で正当化済」 と defer 判定したが、 user 指示で深掘りした結果 **絆創膏 sign が 2 箇所積層** で M25 違反と再認定。 単一場所に **3 つの違反**:

1. `useStaleDetection.staleFrozenRef: Set<string>` ↔ `useGameStore.staleFrozenIds: ReadonlySet<string>` の **ref ↔ store mirror dual**: 5 ad-hoc delete callsite が mirror sync を skip → 毎 tick `checkStale` 内の **drift detection patch** で self-heal という暗黙契約 (= sign 1)
2. 同 hook 内 `staleFrozenRef` (Set) ↔ `staleFrozenAtRef` (Map<id, frozenAt>) の **内部 Set/Map dual**: ad-hoc delete で Set だけ消されて Map が leak する事故を **drift prune ループ** で self-heal (= sign 2)
3. ad-hoc delete が messageHandler / RelativisticGame / useGameLoop の 5 箇所に散在、 各箇所で「ref のみ触り、 mirror + Map は self-heal 任せ」 という暗黙契約を 3 文書に分散

構造的解消: `staleFrozenAtRef: Map<id, frozenAt>` 単独化 (= キー集合 = 「stale か」、 値 = 「いつ stale 化したか」)、 全 mutation 経路 (`recoverStale` / `cleanupPeer` / `checkStale`) で `syncStoreMirror()` 即呼びで drift 不可避化、 5 ad-hoc delete を全部 `recoverStale(id)` helper 経由に統一して MessageHandlerDeps の API も `recoverStale: (id) => void` に置換。

#### 実例 4 (= 2026-05-05 evening Stage 11): causalFrozen / causalityJumping の ref ↔ store dual

Bug 11 全体作業の最後に「他に M25 違反候補は無いか?」 audit で発見。 `useGameLoop.causalFrozenRef` (= boolean) ↔ `useGameStore.causallyFrozen` (= boolean) と、 同 pattern の `causalityJumpingRef` ↔ `causalityJumping`。 各々:

- ref は毎 tick update (= hot path read 最適化の意図)
- store は **if-changed gate** (`if (ref !== frozen) setCausallyFrozen(frozen)`) で update — 一見「mutation 集約」 で (a)(b)(c) pass に見える
- 両者は構造的に同値 (= 共に boolean)、 staleFrozenAtRef (Map) ↔ staleFrozenIds (Set) のような structure 違いは無い

**初回 audit (= Explore agent + 私) は「許容 mirror」 と暫定判定**したが、 user の challenge「絆創膏の上に絆創膏じゃなくて根本治療、 という思想でも A (= docstring 補強) がいい?」 で再考。 深掘りで:

1. ref を介した re-render 抑制動機は **zustand 自体の selector 同値判定で同等に達成される** (= subscriber 側で `useGameStore((s) => s.causallyFrozen)` は同値なら React 再レンダ skip)
2. read 動機 (= hot path で getState() 重い説) も誤り、 zustand getState() は object property access 同等で cheap
3. 構造同値の boolean dual は staleFrozenAtRef のような構造的 mirror とは性質が違う、 ref 撤廃で本当に single canonical 化できる

→ **構造的解消**: `causalFrozenRef` / `causalityJumpingRef` を撤廃、 全 read site (= dead skip × 2 + checkCausalFreeze hysteresis baseline 引数 + if-changed gate × 2) を `fresh.causallyFrozen` / `fresh.causalityJumping` で代替。 if-changed gate 自体は memory allocation 抑制のため維持 (= zustand `set(partial)` の object spread を毎 tick 走らせない)。 `fresh = useGameStore.getState()` は tick 冒頭 snapshot で、 hysteresis baseline (= 前 tick の値) として ref 経由と完全同等。 typecheck + 247→253 test pass。

**教訓**: 「許容 mirror」 認定は staleFrozenAtRef pattern を anchor として安易に流用すると誤る。 staleFrozenAtRef は **構造違い (Map vs Set) で本質的に複製必須**、 boolean dual は **性能動機の余分 layer** で構造的 mirror ではない。 サブ原則 (a)(b)(c) を pass しても **「そもそも duplication が必要か?」** という前段の問いを skip するな。

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

#### サブ原則: caller-pass derived state pattern (= hot path で derive 統一)

derive 唯一化を実現するとき、 hot path (= tick loop で全 player 走査) では `selectIsDead(state, id)` を毎 site で呼ぶと O(killLog + respawnLog) × N_players の累積 cost。 解消 pattern:

- **caller が tick 開始時に 1 度 `selectDeadPlayerIds(state): Set<string>` を derive**
- **関数群の signature に `deadIds: ReadonlySet<string>` を新規 param として追加**
- 関数内部は `deadIds.has(id)` で O(1) check
- 内部 derive を関数に押し込まない (= 同一 tick 内で同じ derive を複数関数が repeat する事故を防ぐ)

**実装例** (= 2026-05-04 isDead decomposition の実装パターン):
- `processLighthouseAI` / `checkCausalFreeze` / `useStaleDetection.checkStale` / `computeSpawnCoordTime` / `createRespawnPosition` の 5 関数 signature に `deadIds: ReadonlySet<string>` 追加
- caller (= useGameLoop) は tick 開始時に `selectDeadPlayerIds(fresh)` を 1 回 derive、 全関数呼び出しで使い回す
- React component (= renderer) では `useGameStore((s) => selectIsDead(s, id))` で個別 subscribe、 list iteration の場合は親 component で deadIds を `useMemo` 化して prop pass

**意義**: derive 唯一化 (= M25 本則) は理念だが、 性能を担保しないと実装で「やっぱ explicit cache」 と退行する誘因になる。 caller-pass で derive cost を amortize すれば理念と性能を両立できる。

**when to use**: derive 関数が O(N) (= log scan 等) で、 hot path で N_players × N_calls 呼ばれる場合。 単発 check (= UI render の 1 player) では直呼び OK、 caller-pass の overhead は不要。

#### サブ原則: type narrowing for subscription decoupling (= React + zustand 専用)

zustand component が `useGameStore((s) => selector(s))` で subscribe するとき、 selector が読む state field 全てが subscription dependency になる。 必要以上に広い state を読む selector を使うと、 無関係な field 更新で component が re-render する coupling が発生。

**例 (= 2026-05-04 isDead decomposition で発見)**:
- `selectIsDead(state: LogState, id)` の旧 type は `LogState = Pick<GameState, "killLog" | "respawnLog" | "hitLog">` (= 既存 selector 群と type 共有)
- `selectIsDead` の実装は killLog + respawnLog のみ参照、 hitLog は使わない
- React component で `useGameStore((s) => selectIsDead(s, id))` すると hitLog 変更でも re-render trigger (= 非致命 hit 毎に SceneContent re-render)

**解消**: selector 専用に narrow type を導入。
```ts
// 全 derive 用の広い type (既存)
type LogState = Pick<GameState, "killLog" | "respawnLog" | "hitLog">;

// selectIsDead / selectDeadPlayerIds 専用の narrow type (新)
type DeathLogState = Pick<GameState, "killLog" | "respawnLog">;

export const selectIsDead = (state: DeathLogState, id: string): boolean => { ... };
```

`DeathLogState` は `LogState` の structural subtype なので、 既存 LogState 渡し caller は変更不要。 React component の `useMemo([killLog, respawnLog], ...)` で narrow input を構築すれば hitLog 非依存 subscribe が成立。

**意義**: TypeScript の structural subtyping を「subscription scope の最小化」 道具として使う。 derive 関数の引数を narrow するのは正確性目的に見えがちだが、 React + zustand context では **subscription decoupling** という performance / re-render 制御の目的も持つ。

**when to use**: zustand selector を React component で使う + 当該 selector が state の一部 field のみ参照する場合。 narrow type を 1 つ追加するだけで component の不要 re-render が消える。

#### 診断ヒント

- 「state 設定漏れの bug」 が連発する class は二重管理を suspect
- effect ベース同期 (= 「stale 検知 → 補正」) は流入経路増加で増殖する貼り絆 pattern、 短期 fix のみ
- 「set 文を 2 箇所に書いている」 時点で drift risk、 source of truth 1 つに decomposition 検討
- selector を React で使うとき、 引数 type が必要以上に広いと subscription coupling で perf 退行 (= 上記 narrowing サブ原則)
- hot path で derive 関数を直呼びしている function 群は caller-pass で集約候補 (= 上記 caller-pass サブ原則)

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

- M24 (鏡像 rule): 真因の **対称性視点** から疑う (= rule の片側だけ実装を疑う)
- M25 (state 単一化): 真因の **state 設計視点** から疑う (= 二重管理を疑う)
- M26 (絆創膏 sign): 真因の **patch 構造視点** から疑う (= 効果 sign を数える)
- M27 (多層 RCA): 真因の **layer chain 視点** から疑う (= 表層 fix の二次防衛化を考える)

これら 4 つは独立した axis、 真因が見つからない時は各 axis から並行 audit すると効率的。 M28 (= 暗黙 trio の踏み外し) は別系統 (= 既存 pattern の維持規律) で、 真因 audit ではなく**新規 entity 追加時の事前防衛**として運用する。

---

### M28. 暗黙 trio / triad の踏み外し: cohesive な複数 prop は spread / factory で揃える

複数の prop / setting が「揃って初めて意図通り動く cohesive な pattern」 (= 暗黙 trio / triad) を成すとき、 個別 prop を直接 set すると新規 entity 追加時に **1-2 つだけ適用 → pattern 不完全 → 動作不定** の罠に陥る。 mitigation は cohesive な prop 集合を **共通 module の prop spread / factory** に閉じ込め、 callsite では「pattern の名前」 を参照する形に倒す。

#### 構造

cohesive trio の典型:

- **always-on-top transparent overlay** (= LorentzArena LH/Ship): `renderOrder` (= late draw) + `depthTest=false` (= depth 無視で描画) + `depthWrite=false` (= 後続描画への depth 干渉なし) の 3 要素 trio。 1 つ抜けると flicker / 部分 frame 消失
- **React performant subscription**: `useGameStore((s) => x)` + selector の reference identity 維持 + `shallow` 比較 (or scalar 戻り値) の 3 要素 (M25 サブ原則の type narrowing と同系)
- **Three.js geometry rebuild throttle**: ref で latest 参照保持 + `useMemo` deps から object 自体撤去 + throttle 量子化変数を deps に置く (= LorentzArena `WorldLineRenderer` wlRef pattern、 1 つ抜けると毎 tick rebuild → main thread saturation)

cohesive 度の判定: 「この prop を 1 つだけ set したらどうなるか?」 を考えて、 **意図した挙動が破綻するなら trio 候補**。 全部単独で意味があるなら trio ではない。

#### 踏み外しの起こり方

新規 entity を pattern に追加するとき、 callsite を既存 entity から copy するなら trio は揃う。 だが「既存 entity の状態を変える」 (= 例: LH の renderOrder を bump) ときに、 trio の他要素まで触る必要があると気付かずに **1 要素だけ変える** ことが起こる。 既存 callsite で 3 要素揃っているのは「pattern として意識して書いた」 のではなく「何となく揃っていた」 状態が多いため、 後から触ると trio 認識自体を欠く。

#### 実例 1 (= 2026-05-04 LH flicker)

**経緯**:
1. LH は元々 `renderOrder=-1` + `depthTest=true (default)` + `depthWrite=false` で運用 (= worldline / cone より「先に描画」 で depth buffer が空のため depthTest=true でも問題なし、 偶然成立した別 pattern)
2. user 指示「機体・LH を最前面に」 で `renderOrder=10` に bump → LH は「late draw 組」 (= self ship 等と同 layer) に転換
3. **trio の他 2 要素 (= depthTest / depthWrite) が抜けた状態**で deploy → user「LH フリッカーするようになった」 報告
4. RCA: SelfShipRenderer hull は元から `renderOrder=10 + depthTest=false + depthWrite=false` の 3 要素 trio で書かれていた (= always-on-top pattern)、 LH は trio の 1 要素 (depthTest) が default true のまま残った
5. fix: LH 全 12 mesh material に `depthTest=false` 追加 (= trio の 3 要素を揃えた、 [`f15fce4`](https://github.com/sogebu/LorentzArena/commit/f15fce4))
6. consolidation: trio を `alwaysOnTopRender.ts` に共通化、 callsite で `<mesh {...ALWAYS_ON_TOP_MESH_PROPS}><material {...ALWAYS_ON_TOP_MATERIAL_PROPS} /></mesh>` の prop spread だけで全 3 要素入る形に refactor ([`9f711ca`](https://github.com/sogebu/LorentzArena/commit/9f711ca))

**user 指摘 (= prudence trigger)**: 「フリッカー直ったけど、 直し方 ad hoc ではない？」 で立ち止まり self-audit (= M26 application)。 結論「**既存 pattern の不完全適用を完成させただけ、 absurd patch ではない**」 だが**新規 always-on-top entity 追加時の踏み外し risk は残る** → trio module 化で「踏み外せない」 構造に倒した。

#### 共通 module 化の利点

| 利点 | 説明 |
|---|---|
| 踏み外し不可能化 | callsite で `{...ALWAYS_ON_TOP_MATERIAL_PROPS}` と書けば全要素自動付与、 1 要素抜きが構造的に不可 |
| pattern 名の明示化 | `ALWAYS_ON_TOP` という名前が「これは何の pattern か」 を 1 行で伝える、 暗黙性の解消 |
| docstring 集中 | 3 要素の rationale + 失敗事例 + 適用 / 非適用 entity 一覧を 1 ヶ所に集約 ([`alwaysOnTopRender.ts`](src/components/game/alwaysOnTopRender.ts) docstring 例) |
| 調整の単一化 | 後から `renderOrder=10 → 20` 等の調整時、 共通 module を変えるだけで全 entity に反映、 callsite 側は不変 |

#### 共通 module 化の判断 heuristic

**化すべき**:
- 同 pattern が **3+ entity** に適用される (= 単一適用は abstraction premature)
- 1 要素抜けで動作不定になる cohesive trio
- 適用 entity が将来増える可能性 (= 新規 always-on-top entity 追加 risk)

**化さなくてよい**:
- 単一 entity でしか使わない (= 共通化の overhead が premature)
- prop が独立 (= 個別 set でも意図通り動く、 単なる「複数 prop を毎回書くのが冗長」 は YAGNI)

#### How to apply

1. **新規 entity を既存 pattern に追加するとき**: 既存 callsite の prop を全て copy、 1 つでも省くなら「省いて動くか?」 を明示確認 (= 省ける prop = trio 外、 省けない prop = trio 内)
2. **既存 entity の prop 1 つを変えるとき**: 「この prop は trio の一部か?」 を問う、 trio の一部なら他要素も一緒に再考
3. **3+ 適用箇所で trio が暗黙的に揃ってる pattern を発見したら**: 共通 module 化を検討、 docstring に rationale + 失敗事例を集約
4. **user / collaborator から「ad-hoc?」 と問われたら**: M26 (絆創膏 sign) audit と並行して **「既存 pattern の不完全適用を完成させただけ vs 新規 patch 追加か」** を判定、 前者なら trio 化で構造的固定を提案

#### 診断ヒント

- 「callsite 4 ヶ所で同じ 3 行が並んでる」 → trio 候補
- 「pattern A の entity に prop を 1 つだけ追加したら動作変わった」 → trio 内の prop だった可能性
- 「ad-hoc に見えるが既存類似 callsite と prop が一致する」 → trio 完成 application、 共通 module 化の機会
- 既存 callsite を `git blame` してみて 3 要素が**別々の commit で揃った**なら、 暗黙的に成立した「偶然の trio」 (= 当時の作者は trio 認識無し) → 共通 module 化で意図を明文化

#### 他 meta-principle との関係

- **M26 (絆創膏 sign)** との切り分け: 「既存 pattern の不完全適用を完成」 (= M28 application) は絆創膏ではない、 「症状を別 path で吸収」 (= 絆創膏 sign 5) は M26 違反。 user に「ad-hoc?」 と問われたら両方 audit、 別系統の判定
- **M25 (state 単一化)** との独立性: M25 は「同じ概念を複数の場所に置くな」、 M28 は「cohesive な複数 prop は揃えろ」。 前者は単一化、 後者は集合維持で逆方向だが両立 (= 「概念は 1 つ、 実装 prop は trio で揃える」)
- **M21 (描画 component は自己 gate)** との関係: M21 は responsibility 配置、 M28 は cohesive prop 集合の維持。 M21 適用後の component 内部で M28 trio が現れることが多い

---

### M29. 絆創膏剥がし時の症状再露出: 真因 fix の前に「絆創膏が抑えていた症状」 を pre-audit する

絆創膏 (= 真因を放置して症状を別 path で抑える patch、 M26 違反 sign の集約) を真因 fix で剥がす時、 **絆創膏が「副作用的に」 抑えていた他の症状が同時に再露出する** ことがある。 真因 fix のタイミングで「抑えられていた症状達」 を pre-audit して、 それぞれ真因 fix 後にどう対処するかを決めておく。

#### 構造

絆創膏は本来「症状 X」 への対処として導入される。 だが副作用として「症状 Y」 「症状 Z」 も同時に隠す効果を持つことがある。 このとき:

- 症状 X 真因が見つかって絆創膏を撤去 → X は真因 fix で解消
- 同時に絆創膏が抑えていた Y, Z が再露出 → user/play 体感に新症状として浮上
- Y, Z は X とは別 layer の bug (= 元から存在していたが「絆創膏のおかげで気付かれていなかった」)

これは「fix が新 bug を作った」 ように見えるが、 実は **既存 bug が再露出しただけ**。 user 視点では区別困難で、 fix の信頼を損なう。

#### M27 (多層 RCA) との独立性

M27 は「症状の出る layer ≠ 真因の layer」 で、 真因を遠くまで遡る指針。 M29 は「真因 fix で他の隠れた症状が surface する」 で、 **絆創膏の副作用範囲を pre-audit する** 指針。 別 axis:

- M27: 真因を**遠くに**探す
- M29: 真因 fix の影響範囲を**広く**見る

両方並行 audit が prudence。

#### M26 との関係

M26 は絆創膏 sign 5 axis (= 強制同期 patch / effect-based 同期 / defensive set 多発 / 流入経路 logic duplicate / 症状検知 → 別 path 吸収)。 M29 は「絆創膏自体を剥がす procedure」 で M26 の continuation。 絆創膏を見つけた → M29 で剥がし方を計画 → 真因 fix と並行で抑えられていた症状の対処も決める。

#### 実例 (= 2026-05-05 ALWAYS_ON_TOP pattern 4 段絆創膏スタック撤去)

**経緯**:
1. LH が他 transparent (= laser worldline 等) に遮られる症状 X → ALWAYS_ON_TOP pattern (= renderOrder=10 + depthTest=false + depthWrite=false trio) で 4 段絆創膏スタック構築 (`46f8755` → `f15fce4` → `9f711ca` → `e2608d1`)
2. user 「絆創膏の上に絆創膏」 指摘 → 真因 audit で 4 transparent material が `depthWrite` default true で書いていた offender を発見
3. 真因 fix (`2e19da2`): offender 側を `depthWrite={false}` に統一 → ALWAYS_ON_TOP pattern 全撤去 (= module ごと削除、 -151 行)
4. **副作用 surface**: 自機と LH が geometric に同 spatial 範囲を占める場面で **z-fight が新規露出** (= ALWAYS_ON_TOP の depthTest=false が「副作用的に」 抑えていた症状)
5. user 「画面で自分と灯台が重なった状態になると LH フリッカー」 報告
6. **追加 fix (`109ddf0`)**: LH 全 mesh に polygonOffset で z-fight 数値解 (= 別 layer の root cause fix)

**学習**: 絆創膏 (= ALWAYS_ON_TOP の depthTest=false) が抑えていた症状は 1 つではなかった (= 「LH が遮られる」 だけでなく「自機との z-fight」 も)。 真因 fix の前に「この絆創膏が副作用的に何を抑えているか」 を audit していれば、 同 commit で polygonOffset も併せて入れられた (= deploy 1 回で完結)。

#### Pre-audit checklist

絆創膏を剥がす計画段階で:

1. **絆創膏が「直接 fix する症状」 を文書化** (= 元の commit message / PR description / docstring)
2. **絆創膏の mechanism を構造的に分析**: どの prop / setting / pattern を変えているか
3. **mechanism から逆算して「副作用範囲」 を列挙**: 直接 fix 対象以外で同じ mechanism が抑制している症状を考える
4. **副作用範囲の各症状について真因 fix 後の状態を予測**: 真因 fix で消えるか、 別経路で対処要か
5. **対処要なものは真因 fix と同 commit / 同 plan に含める** (= 1 段階で完結、 user 視点で「fix が新 bug を作った」 体験を回避)

#### 実例の pre-audit 例

ALWAYS_ON_TOP 撤去計画時:
- 直接 fix 対象 (= 元症状 X): 「LH が他 transparent に遮られる」
- mechanism: depthTest=false で depth 比較 skip + depthWrite=false で他 transparent の depth に書かない + renderOrder=10 で late draw
- **副作用範囲列挙**:
  - depthTest=false の副作用: LH が **geometric 重なり時の z-fight** を bypass している (= 本実例で再露出した症状 Y)
  - depthWrite=false の副作用: LH 内部 mesh 同士の depth 干渉 bypass (= 真因 fix で `depthWrite={false}` 維持なら継続成立)
  - renderOrder=10 の副作用: 「LH を最前面」 (= 旧 design intent、 真因 fix で破棄なら user の game 体感変化要確認)

→ 症状 Y (z-fight) は polygonOffset で同 commit / 別 plan で対処、 renderOrder=10 撤去の体感影響は user verify で確認、 等の事前計画が立てられる。

#### How to apply

- **絆創膏を見つけたら剥がす前に M29 pre-audit checklist を実行**
- **真因 fix の plan に「副作用範囲」 セクションを含める** (= 撤去判断材料の 1 つ)
- **user に対して「真因 fix で X 解消、 ただし副作用 Y も surface する可能性、 同時に対処予定」 と pre-communicate**
- **fix 後 user 「fix が新 bug を作った」 と感じたら**: M29 の pre-audit が抜けていた可能性を反省、 副作用 layer の追加 RCA に切替

---

### M30. complex bug 完全治療の 5 phase workflow

**ルール**: 多層原因 / 多 stage refactor を要する complex bug は **5 phase の workflow pattern** で完全治療に到達する。 各 phase は trigger / output / 規律が異なり、 phase 跳ばしすると drift / 絆創膏 / 半端な治療を生む。

#### 5 phase

1. **思想 anchor 化**: 着手前に design doc 新設で「軸」 整理。 Bug 11 では `design/network-recovery.md` 6 軸 (Phase 別の対称性 / Recovery 3 直交軸 / 真因 chain / 通信トポロジー / 治療優先順 / 既存メタ原則対応) を anchor 化してから実装着手。 思想 anchor 無しで実装に入ると判断軸が ad-hoc 化、 後から「これは何のための fix?」 が分からなくなる
2. **連続実装**: 直交軸の fix を Stage X-A/B/C 等で独立 commit + 全部入り 1 deploy。 user の「どんどん行こう」 stance + 私の risk 管理 (= 各 stage typecheck + test pass 確認) の組合せ。 各 stage 独立 commit で revert 可能性確保、 deploy 1 回で user verify cost 削減
3. **4 軸 sweep drift 修正**: 連続 commit 後の最終 push 前に整合性 / 無矛盾性 / 効率性 / 安全性を sweep、 drift があれば即修正 commit (= [`work-discipline.md §Multi-commit refactor では 4 軸 sweep で docstring drift を必ず捕まえる`](../../../odakin-prefs/work-discipline.md))。 sweep を skip すると docstring と実装の caller scope drift 等が遅延発覚、 future contributor を mislead する
4. **根本治療 sweep (= user challenge driven)**: user の「絆創膏の上に絆創膏じゃなくて根本治療」 reminder で残課題を re-audit、 cosmetic / scope 外と暫定判定したものを root cause で再治療。 Bug 11 では Stage 8 (transport / direction / mesh-ish 対称性) + Stage 9 (assumeHostRole cleanup) + Stage 10 (Vite HMR pattern 文書化) として連続実施。 「fully closed」 認定後の user challenge は判定 reset trigger ([`work-discipline.md §audit verdict 「正当化済」 は user 質問で再評価する`](../../../odakin-prefs/work-discipline.md))
5. **meta-audit (= source of truth 単一化 sweep)**: 完了後の最終 audit で M25 違反候補を thorough sweep、 「許容 mirror」 暫定判定にも構造違いの有無で再判定。 Bug 11 では Stage 11 で causal* boolean dual を発見・撤廃、 教訓を M25 §実例 4 として永続化。 「Bug 11 完了 → 関連状態の M25 sweep」 が完了条件

#### Why

複雑 bug の完全治療は **「真因 fix」 だけでは不十分**:
- 思想 anchor 無しで実装すると軸が ad-hoc 化、 後で再認識コスト高
- 4 軸 sweep skip で drift が遅延発覚 (= 過去 2026-05-01 13 commits drift 事件)
- user challenge を待たずに「fully closed」 認定すると絆創膏温存 (= cosmetic 残骸 / dev-only 挙動の文書化漏れ)
- meta-audit skip で「Bug X 完了したが周辺で M25 違反残留」 (= 過去 staleFrozenIds 三重二重管理発見が同 pattern)

5 phase 全通しで **思想 / 実装 / 整合 / 根本治療 / meta-audit が clean state に到達**。

#### How to apply

- 着手判断時に「これは 5 phase 適用する complex bug?」 を問う
  - 単純 bug (= 1 commit fix) は phase 1 + 2 のみで十分
  - 多層 / 多 stage / cosmetic 残骸を伴う場合は 5 phase 全通し推奨
- 各 phase の trigger を意識する:
  - phase 1: 着手前に design/network-recovery.md 等の anchor doc を作る習慣
  - phase 2: 各 stage 独立 commit + 1 deploy (= user verify cost 削減)
  - phase 3: 連続 commit 後の push 前に 4 軸 sweep
  - phase 4: 「fully closed」 認定後の user challenge を判定 reset として受け入れる
  - phase 5: 完了後に M25 sweep audit (= [`work-discipline.md §Same-session で M25 違反を見つけたら兄弟 audit を直ちに実施`](../../../odakin-prefs/work-discipline.md) と整合)

#### 過去事例

- 2026-05-05 evening Bug 11 (= 本 entry の trigger): plan + 4 phase 経由 + Stage 11 M25 sweep + claude-config への Vite HMR pattern 文書化 (= 5 phase 全通し)。 9 commits + 1 docs commit (claude-config) で fully decommission state に到達
- 5/4 Bug 10 真因 chain fix (= 5 layer chain で部分的に同 pattern): 思想 anchor (= [`virtualpos-lastsync-rca.md`](../plans/2026-05-04-virtualpos-lastsync-rca.md)) + 多 commit refactor、 但し meta-audit phase は同 session 内で行ったが当時は workflow 化されていなかった。 M30 化で再認識可能な pattern として永続化

#### 関連メタ原則

- M2 (対症療法 vs 根治): phase 4 の根本治療 sweep の根拠
- M25 (state 単一化): phase 5 の meta-audit の標的
- M26 (絆創膏 vs 治療 sign): phase 4 の判定基準
- M27 (多層 RCA): phase 1 の思想 anchor で多層整理
- M29 (絆創膏剥がし時の症状再露出): phase 4 で副作用 layer の pre-audit を促す

#### claude-config promote 判定 (work-discipline.md L177「汎用原則がプロジェクト固有文書に埋もれている」 対応)

本 entry は LorentzArena 1 事例から抽出。 同 pattern が他リポ (= twcu-seminar / einstein-cartan / 等) で 2 件目発生したら **claude-config に promote** して全 Claude Code ユーザー向け規約に格上げする。 現時点では LorentzArena meta-principles に留めて、 future case で再認識する anchor として機能。

---

### M31. 対称物理 rule の **境界処理** も対称化する

**ルール**: M24 (= 「rule の片側だけ実装されているなら反対側の鏡像を疑う」) は **fire 条件** の対称性。 これに加えて、 rule の **boundary state 安定性 mechanism** (= hysteresis / margin / dead zone 等) も両側で対応必要。 片側だけ boundary 防御を持つと、 もう片側が「boundary 上に着地したまま」 になり、 fire/no-fire flag が数値 jitter で chatter する。

**Why**: 対称物理 rule (= LorentzArena Rule A 凍結 ↔ Rule B ジャンプ) は **fire 条件**だけ mirror image にしても、 boundary 振動の origin が片側に偏る。 例: Rule A が `wasFrozen` 条件付き hysteresis (= `CAUSAL_FREEZE_HYSTERESIS = 2.0`) で凍結 flag chattering を防ぐ一方、 Rule B が surface ぴったり着地 (= 旧仕様) なら、 jump 後 me の next-tick state は `l ≈ 0` 境界上 → Rule A 判定が flag flip → 視覚 flicker。 hysteresis は「凍結保持」 軸の boundary 安定、 margin は「jump 着地」 軸の boundary 安定で、 異なる scale (= gameplay smoothing vs numerical stability) でも **同思想 = 「boundary state ぴったりを避ける」** に収まる。

**How to apply**:

- 対称 rule pair (A / B) を実装したら、 各々に **boundary 防御 mechanism がペアで存在するか** を audit
- 片側のみ防御がある場合:
  1. 反対側に同思想の防御を追加できるか検討 (= 異 scale でも OK、 unit / mechanism は別で良い)
  2. 物理意味 / 設計対称性が両防御で保たれるか文書化 (= DESIGN.md に対称表)
- 防御の **scale 比較表** を作る (= 何 unit、 何 trigger、 どの軸の chatter を防ぐか)
- 既存 docstring が「surface ぴったり着地」 「閾値ぴったり判定」 を invariant として書いている場合、 boundary 防御追加は invariant 文書 update が必要 (= M24 と同じく drift 防止)

**過去事例**:

- 2026-05-05 night Rule B exit margin (= 本 entry の trigger): Rule A `CAUSAL_FREEZE_HYSTERESIS = 2.0` (l 単位、 wasFrozen=true 時のみ閾値厚 = gameplay smoothing) と complementary な Rule B `CAUSALITY_JUMP_EXIT_MARGIN_LS = 0.001` (λ 単位、 jump 発火時のみ加算 = numerical stability) を導入。 異 scale / 異 unit / 異 trigger だが「surface ぴったりの境界 state を回避」 の同思想。 詳細: [DESIGN.md §因果律対称化 + 5/5 exit margin 拡張](../DESIGN.md)

#### 関連メタ原則

- M24 (対称性物理量を扱う rule の片側だけ実装されているなら反対側の鏡像を疑う): 本 M31 は M24 の境界処理 axis での拡張
- M32 (boundary state ぴったり landing は chatter の温床): M31 が「対称 rule pair」 の view、 M32 が「単独 rule」 の view、 両方を併せて boundary chatter に対する設計指針

---

### M32. boundary state ぴったり landing は chatter の温床

**ルール**: 物理 rule / state machine 判定の公式が **境界 state (= null surface / 閾値線 / 等高線) ぴったりに着地する設計** は、 次 tick の境界判定が数値誤差 / extrapolation jitter / network delay で flip する race を生む。 着地点を境界より **ε だけ内側 (= 安全領域)** に押し込む terminal patch が cleanest fix。

**Why**: 物理 / state machine の判定は通常「`l < 0` で fire」 「`distance > threshold` で trigger」 等の閾値比較。 公式の出力がちょうど閾値線上に着地すると、 次 tick で:
- 数値誤差 (= ULP scale) で l が ±0 を跨ぐ
- virtualPos / extrapolation で peer 位置が微小揺れる → l が±揺れる
- network jitter で broadcast 受信タイミング ms 単位で揺れる → 境界判定 flip

→ flag が ON/OFF を毎 tick 切り替え → re-render storm / 視覚 flicker / state thrashing。

**Fix**: 公式の **terminal で ε margin** を加算し、 着地点を境界より内側に押し込む。 caller / 公式構造は不変、 ε は値に embed されて伝播。 ε size:
- 数値誤差 (= eps_machine ≈ 1e-15) を 数桁上回る (= 1e-3 〜 1e-2 scale)
- frame rate (60Hz = 16.67ms = 0.017 単位) より小 (= 視覚 / gameplay 影響ゼロ)
- 物理 invariant の有意 scale より十分小 (= 0.1% order)

**How to apply**:

- 公式が boundary に着地する設計を見たら audit:
  1. その後段で boundary state 判定があるか?
  2. 判定が flag ON/OFF を生むか? 生むなら chatter リスクあり
- ε margin を terminal patch として加算:
  - 公式の最終 return 直前で `+ MARGIN` 加算 (= `Math.max(0, ...)` ガード等の不発 case は維持)
  - ε は `constants.ts` の named export で導入 (= 値選定根拠 + 単位を docstring 化)
  - Test: surface invariant (= 旧「着地で l=0」) を「surface + ε spacelike 側」 に書き換え、 線形展開で expected 値を厳密化
- M31 と併せて: 対称 rule pair なら **両側に同思想の防御** を入れる (= scale / unit は別で OK)

**過去事例**:

- 2026-05-05 night Rule B exit margin (= 本 entry の trigger): `causalityJumpLambdaSingle` で `λ_surface = B - √disc > 0` 時のみ `+ EPS_MARGIN` 加算。 surface ぴったり着地 (= `l = 0`) → ε spacelike 側着地 (= `l ≈ -2·B'·EPS + EPS²` で正)、 次 tick Rule A 判定が確実に no-freeze。 odakin 仮説「過去光円錐ぴったりじゃなくてちょっとだけ未来まで飛ばしたら治りそう」 を物理解釈で実装した形 (= user 直感 → meta-principle 化の好例)。 詳細: [DESIGN.md §Rule B exit margin](../DESIGN.md) + [`causalityRules.ts:causalityJumpLambdaSingle`](../src/components/game/causalityRules.ts) docstring §Exit margin

#### 関連メタ原則

- M2 (対症療法 vs 根治): ε margin は terminal patch だが boundary 振動の **真因 (= 公式の境界着地設計)** に直接対処、 単なる絆創膏ではない (= 対称 rule pair に hysteresis / margin の役割分担を作る根本治療)
- M24 / M31: 対称 rule での boundary 防御の対称性
- M27 (多層 RCA): boundary chatter が「視覚 flicker」 layer で観察され、 真因が「公式の境界着地」 layer にある多層性

#### claude-config promote 判定

本 entry は LorentzArena 1 事例から抽出。 同 pattern (= numerical optimization landing on optima、 state machine threshold flicker、 物理 simulation null cone surface 等) が **他の科学計算 / 数値解析リポ (= bayes-kai / forward-scattering / einstein-cartan / 等)** で 2 件目発生したら、 [`claude-config/conventions/scientific-computing.md`](../../../claude-config/conventions/scientific-computing.md) に「公式が境界に着地する設計の chatter リスク」 として promote 検討。 現時点では LorentzArena meta-principles に留める ([`work-discipline.md L177`](../../../odakin-prefs/work-discipline.md))。

---


### M33. Listener fire timing で「mount-time vs runtime」 を即特定する

**ルール**: WebGL context loss / event-based listener の fire タイミング (= `sinceLast = Date.now() - lastSeenRef.current`) は、 issue の trigger phase を決定的に語る。 lastSeenRef が **0 (= 未初期化) のまま fire** = `sinceLast ≈ Date.now() ≈ 1.7e12ms` = **listener attach 前に既に loss / event 発生** = **mount-time / init 失敗** のサイン。 「scene 内 component を 1 つずつ disable で isolate」 のような component-level patch を試す前に、 **mount mechanism (= `<Canvas key>` の React conditional / new instance creation) 自体を疑え**。

**Why**: listener 前 event は「listener が見えなかった事象」 = listener が attach された時には既に発生していた = listener の関与する内部 component / scene の問題ではない、 component を作る器 (= mount lifecycle) の問題。 これを読み違えると component-level patch を deploy する isolation iteration を無駄に何度も繰り返す。

**Sentinel value**:
- `sinceLast` が **`Date.now()` レンジ (= 数兆 ms)**: lastSeenRef=0 = 初回 fire = mount-time failure
- `sinceLast` が **数 ms 〜 数秒**: 正常な runtime event 列、 normal listener cycle
- `sinceLast` が **数百 ms 反復 + chronic 検出**: auto-remount loop (= mount で fail → remount → 再 fail)、 これも mount-time の連鎖

**How to apply**:
- 新規 issue の console を読んで `sinceLast` の値範囲をまず確認
- mount-time signature なら investigation を「**何が mount される時に何が起きるか**」 axis に絞る:
  - React conditional (= `<Canvas key="A">` ↔ `<Canvas key="B">`) で remount 発生してないか
  - `useEffect` 内の同期処理で初期化失敗してないか
  - 初回 render で生成される resource (= Three.js camera / WebGL context / shader) が GPU に拒否されてないか
- runtime signature なら scene 内 / 累積 state / 特定 trigger event を疑う

**過去事例 (= 本 entry の trigger)**:
- 2026-05-06 朝 Bug 13 (= 正射影 / PLC 3D toggle で chronic context loss): user の最初の console screenshot で `[WebGL] context lost (sinceLast=1778020396880ms)` (= ~1.78e12ms = Date.now()) を観察、 ところが私は signature を読まずに「camera config → GameLights → ship 種別 → orthographic prop」 と component-level patch を 4 回 deploy で順次試した (= isolation 試行 #1〜#3 全て無効)。 #4 (= Canvas branch を merge して同一 key で remount 抑止) で初めて chronic loss が完全消失、 真因が「Canvas remount 自体が user GPU で WebGL context 生成失敗を trigger」 と確定 (`fb1288b`)。 console signature を最初から読めば #1〜#3 の 3 deploy + 3 verify cycle は不要だった (= user time を浪費した反省)。

#### 関連メタ原則

- M2 (対症療法 vs 根治): mount-time signature を見落として component-level patch を試したのが「絆創膏スタック」 構造、 真因 = mount mechanism という layer 1 段上に逃げた
- M27 (多層 RCA): 症状 (= chronic context loss) の出る layer ≠ 真因 (= Canvas remount lifecycle) の layer、 console signature がそれを最初から指していた

#### claude-config promote 判定

本 entry は LorentzArena 1 事例から抽出。 同 pattern (= listener-based observability で fire タイミング = trigger phase の手がかり) が他リポ (= bayes-kai / network 系 / 等) で 2 件目発生したら、 [`claude-config/docs/usage-tips.ja.md`](../../../claude-config/docs/usage-tips.ja.md) に「listener event timestamp で trigger phase を読む」 として promote 検討。 現時点では LorentzArena meta-principles に留める ([`work-discipline.md L177`](../../../odakin-prefs/work-discipline.md))。

---

### M34. 光伝達時間効果と frame 変換効果は別軸

**ルール**: 相対論的 visual rendering で「approaching object が速く / 瞬時に visible」 のような効果を説明 / 実装する時、 **光伝達時間効果** (= past null cone ∩ worldline、 観測者に届いた photon の発射事象) と **frame 変換効果** (= Lorentz boost / aberration / length contraction) は**別軸**として明確に分離する。 両者を混同 (= 「rest frame の aberration で速く見える」) すると、 boost を適用しないと効果が消えると誤認したり、 lab-frame で済む問題に boost を入れる過剰実装になったりする。

**両者の違い**:

| 軸 | 光伝達時間効果 | frame 変換効果 |
|---|---|---|
| 計算 | `t_emit + |r_emit - r_obs| = t_obs` を解く (= 過去光円錐 ∩ worldline) | Lorentz boost matrix application |
| frame | 任意の frame で同一 (= lab でも rest でも同じ事象が見える) | frame 依存 (= boost 適用前後で違う coords) |
| 物理 効果 | 「approaching laser の burst」「Doppler 周波数 shift」「光行差の時刻整合」 | 「光行差の角度 shift」「length contraction」「time dilation」 |
| 必要 input | 観測者位置 + worldline | 観測者位置 + 観測者速度 |

**両者は独立で重畳可能**: 例えば PLC 3D laser 描画では (1) 光伝達時間で past-cone 交点を計算 → (2) 必要なら boost で rest frame xy に統一、 という 2-stage。 (1) だけで「approaching が速い」 効果は出る、 (2) は entity 間の座標 frame 統一目的。

**Why**: 概念混同で誤った fix 方向に行く危険。 例:
- ❌「ortho mode で boost 抜けてるから approaching laser が遅く見える」 → boost 入れる修正 → 効果なし (= 真因は別)
- ✅「lab-frame の laser 物理現在位置を出してた = 光伝達時間無視」 → past-cone 交点に変える → 効果 OK

**How to apply**:
- 「速く見える / 瞬時に当たる / Doppler 効果が出ない」 等の visual bug:
  - **第一に光伝達時間計算 (= past-cone 交点) が正しいか**確認
  - lab-frame で光伝達時間を入れるだけで効果が出る場合が大半
  - boost / aberration が効果の本質 ではない 可能性高
- 「観測者進行方向への向き / 角度 / scale が物理的におかしい」 visual bug:
  - frame 変換効果 (= boost / aberration) を疑う
  - こちらは observer.u に依存
- code レベルでは 2 段階に分離: stage 1 = past-cone 計算 (lab frame)、 stage 2 = frame 変換 (= 必要なら)
- docstring / comment では効果の起源を明示: 「この計算は **light travel time** 効果を出すため」 vs 「この boost は **frame unification** 目的」

**過去事例 (= 本 entry の trigger)**:
- 2026-05-06 朝 Bug 6 (= PLC 3D で approaching laser がゆっくり見える): 私は最初「rest frame の aberration による compression 効果で速く見える」 と framing した、 user 訂正「lab-frame だろうが近づいてくる laser はいくらでも速くなる、 当たる laser は瞬時に当たる」 で誤りに気づく。 旧 code (`lambda·direction + emission`) は **lab-frame の laser 物理現在位置** = 光伝達時間を無視した錯誤、 修正は `pastLightConeIntersectionLaser` (= lab-frame past-cone 交点) で本質。 transformEventForDisplay の boost は他 PLC entity との座標 frame 統一目的で、 「速く見える」 効果自体には不要だった。 commit `ca7698c` の docstring 修正 + comment 訂正で framing を正しく記録。

#### 関連メタ原則

- M2 (対症療法 vs 根治): 「boost 入れる」 patch は対症療法、 真因は「光伝達時間入れる」 で別 layer
- M24 (対称物理量を扱う rule の片側だけ実装): aberration ↔ Doppler ↔ past-cone は相対論 effect の対称 family、 片側 (= boost) だけで全部説明しようとする誤り

#### claude-config promote 判定

本 entry は LorentzArena 1 事例から抽出。 相対論 simulation / visualization リポ (= twcu-phys-* の物理研究 / 教科書 project / forward-scattering) で 2 件目発生したら、 [`claude-config/conventions/scientific-computing.md`](../../../claude-config/conventions/scientific-computing.md) に「相対論 visual effect の cause 分離」 として promote 検討。 現時点では LorentzArena meta-principles に留める ([`work-discipline.md L177`](../../../odakin-prefs/work-discipline.md))。

---
### M35. NPC 非対称 causality: subordinate class は他者を制約しない

**ルール**: NPC (= subordinate class、 LH / 隕石 / ボス等) の `pos.t` は human の causality 計算 (= Rule A / Rule B / spawn 時刻) の **入力に入れない**。 逆に human の `pos.t` は NPC の causality 計算 (= NPC が human を追う側) に通常通り入力される。 NPC は「物理シミュレーションの一部」 で、 「他者の inertial frame に対する優先 reference」 ではない。

**なぜ non-trivial**: 5/2 plan §10.4 では「LH 特別扱い不要」 と結論されていた (= LH を Rule A/B 対称設計に組み込めば自動的に wall_clock-ish に収束)。 しかし 5/2 ~ 5/6 の間に経緯不明の片肺 LH skip が `checkCausalFreeze` に混入、 Rule A だけ非対称化された不整合状態が続いていた。 本 entry は「**§10.4 は LH 自身の advance ロジックの議論、 NPC 非対称は LH state が他者の入力に入るかの議論で完全直交**」 という直交性を明示し、 残り Rule B + spawn 計算にも片肺非対称を completing する。

**実装 site (= 全 4 site で uniform skip)**:
- `checkCausalFreeze` (= human の Rule A): `if (isNpc(p)) continue;`
- `useGameLoop` self Rule B (= human の causal jump): 同上 (NEW 2026-05-06)
- `processLighthouseAI` Rule B (= NPC 同士の循環防止): 同上 (= 既存 LH skip を `isNpc` 統一)
- `computeSpawnCoordTime` (= spawn 時刻 anchor): 同上 (NEW 2026-05-06)

**type-level discriminator** (= M37 と相補): `RelativisticPlayer.kind: 'human' | 'npc'` field + `isNpc(player) = player.kind === 'npc'` で表現。 ID prefix runtime check (= `isLighthouse(id)`) と意味的に分離、 LH-specific 経路 (= 色 / hit radius / 名前 / render dispatch / score) は引き続き `isLighthouse(id)` を使う。

**Bug 14 propagation race との関係**: NPC 経由の伝染を構造的に断つ (= LH が runaway 状態でも human の Rule B + spawn anchor に流出しない)。 alive human runaway 経路は本 entry では対処しない (= 別 plan の L1 plausibility filter)。

#### 関連メタ原則

- M3 (純関数で書けないか): NPC 非対称は「class 軸の filter を共通 predicate `isNpc` で uniform 化」、 4 site で同じ filter を呼ぶ pure pattern
- M25 (state 単一化): `isNpc` predicate は `kind` field 単一 source、 ID prefix と並存させない (= type-level discriminator が canonical)

#### claude-config promote 判定

本 entry は LorentzArena 固有 (= NPC class が gameplay 上 subordinate という設計判断は当 game に依存)。 他リポで NPC class が登場することは無いため、 promote しない。 但し「subordinate class が causality / state propagation で skip される」 一般 pattern として、 multi-agent シミュレーション系リポで類似 design choice が出れば LorentzArena 経験値として参照可。

---

### M36. Mean vs midpoint in spread aggregation: outlier robustness

**ルール**: peer 群の coord time / position spread を aggregate して「cluster center」 を出す formula で、 `(min + max) / 2` (midpoint) より `sum / N` (mean) が outlier に robust。 通常 cluster (= 同 cluster 内 N peer) では同値、 runaway peer / accidental outlier 1 個に対しては mean が 1/N 重みで pull、 midpoint は extremum full sensitivity で pull される。

**数値例**:
- cluster {10, 11, 12} + outlier {100}:
  - midpoint: (10 + 100) / 2 = **55** (= outlier に full pull)
  - mean: (10+11+12+100) / 4 = **33.25** (= 1/N=1/4 重み、 cluster 寄り)
- 通常 cluster {10, 11, 12}:
  - midpoint = mean = **11** (= 同値)

**実装転換 (= 2026-05-06)**: `computeSpawnCoordTime` を `(min+max)/2` (= 4/28 fix `3ba639a` の Stage 8 (γ) 案) → `sum/N` (= (γ') 案) に migration、 outlier robustness を獲得。 通常 plays で挙動差なし、 outlier scenario (= Bug 14 alive human runaway peer 等) で mean が partial defense として効く。

**併せて signature 簡素化**: `excludeId` 引数を撤去、 self も他 peer と対等に virtualPos で寄与する設計に統一。 これにより solo respawn corner case (= self 死 + 他 alive 不在 + LH のみ → peers 配列空) で fallback 経路が trigger されない (= self_dead が常に peers に居る)、 fallback 構造の structural 消滅を達成。

**Why**: midpoint が直感的に「中点」 で美しいが、 cluster 平均化の semantics には mean が natural。 N peer の対等な寄与で cluster center を出すのが mean、 extremum 2 点だけ見るのが midpoint で意味論が違う。 N=2 では同値だが N≥3 で意味的に乖離する。

#### 関連メタ原則

- M27 (多層 RCA): outlier robustness の獲得は新 Bug 14 mitigation 層、 既存 NPC skip 層 (= M35) と併せて defense-in-depth
- M29 (絆創膏剥がしの pre-audit): excludeId 撤去は既存 fallback 構造の絆創膏剥がし、 self を virtualPos で寄与させる新設計が pre-audit (= solo respawn の連続性) を満たしてから実施

#### claude-config promote 判定

本 entry は spread aggregation の universal pattern。 他の cluster center 計算 (= 学術データ集計 / scheduling 中央値 / 等) で midpoint / mean / median の選択が question になる場面で参照可。 但し LorentzArena 内 plan §1.3 の数値検証で sufficient なため、 別 plan で 2 件目発生したら [`claude-config/conventions/scientific-computing.md`](../../../claude-config/conventions/scientific-computing.md) に promote 検討。 現時点では LorentzArena に留める。

---

### M37. Type-level discriminator field for class-based filter

**ルール**: ID prefix string check (= `id.startsWith("lighthouse-")`) で class 判定する pattern を、 entity type に **`kind: 'A' | 'B'` discriminator field** + typed predicate で置換。 ID convention drift で causality / filter semantics が黙って動作変更する fragility を解消、 type-level の意味分離を確立。

**問題 (= ID prefix runtime check の fragility)**:
- ID 命名規約が変わると全 `isXxx(id)` 経路が黙って動作変更 (= silent regression)
- 型から「これ class A かもしれない」 が見えない、 全 caller が runtime check 必須
- 同義 predicate (= `isLighthouse(id)` と `isNpc(id)`) が「現時点で同値」 という coincidence で統合されやすく、 将来の class 拡張で誤動作する risk

**解決 (= 2026-05-06 実装)**:
```ts
// types.ts:
type RelativisticPlayer = {
  id: string;
  kind: 'human' | 'npc';  // ← discriminator field
  ...
};

// lighthouse.ts:
export const isNpc = (player: RelativisticPlayer): boolean =>
  player.kind === 'npc';
```

`isLighthouse(id)` (= LH 固有 identity 判定、 ID prefix 由来) は維持、 `isNpc(player)` (= causality skip class、 typed) を別軸として共存。 現時点で両者同値だが意味的に別軸。

**Wire format への影響**: `kind` は wire (= snapshot / phaseSpace message) に乗せず、 受信側で id-prefix から derive (= `isLighthouse(msg.id) ? 'npc' : 'human'`)。 旧 client との backward compat 完璧、 protocol 変更ゼロ。

**Why** (= 2 つの利点):
1. **future-proof**: 将来 NPC 種が増えた時 (= 隕石 / ボス) は `kind` に値追加 + `isNpc` を OR 拡張、 `isLighthouse` 経路 (= LH-specific 色 / hit radius / score) は不変、 LH-specific 経路と NPC 一般経路が混ざらない
2. **explicit**: 型を見れば「class A かもしれない」 が分かる、 TS narrowing で compile-time 検査も可能

**統合禁止** (= plan §11.1): 「現時点で同義だから `isLighthouse` を `isNpc` で全置換しよう」 という単純化提案を **却下**。 半年後の class 拡張で LH-specific 経路に NPC 一般 ルールが流出する risk、 grep で経路を分離できなくなる。 詳細: `~/Claude/LorentzArena/2+1/plans/2026-05-06-npc-asymmetric-causality.md §11.1`。

#### 関連メタ原則

- M25 (state 単一化): `kind` field は class 判定の single source、 ID prefix と並存させない
- M28 (cohesive prop の一括渡し): player creation 5 site で `kind: isLighthouse(id) ? 'npc' : 'human'` を統一形式で初期化、 ad-hoc な derive 散在を防ぐ

#### claude-config promote 判定

本 entry は class-based filter pattern の universal applicable insight。 但し具体例 (= LH NPC) は LorentzArena 固有。 他リポで discriminated union vs runtime check の選択が question になる場面で 2 件目出たら、 [`claude-config/CONVENTIONS.md`](../../../claude-config/CONVENTIONS.md) または `convention-design-principles.md` に promote 検討。 現時点では LorentzArena に留める。

---

### M38. (α) wall_clock anchor 案 = proper time / coord time の混同で永続却下

**ルール**: spawn / respawn 時刻として「self の wall_clock 値を直接使う」 案 (= 5/2 plan §6 Stage 8 の (α) 案) は P1 設計柱と本質矛盾するため **永続却下**。 wall_clock は **固有時** (= `dτ = wall_dt`、 各 player の rest frame での時計) と同期、 coord time `pos.t = γ × wall_clock` は wall_clock とは別軸 (= 動いた人ほど未来に進む)。 (α) は proper time / coord time の混同。

**経緯**: 5/2 plan §6 Stage 8 で 4 案 (α / β / γ / δ) を比較、 当時の plan 推奨は (α) `now wall_clock` 自分基準、 但し実機未検証で deferred。 5/6 NPC 非対称 plan の議論中、 odakin が「**wall_clock はつねに固有時と同期。 世界時刻とは一切関係ない**」 と push back、 (α) は P1 設計柱矛盾と即時判明。 5/2 plan §10.1 ✗「pos.t = wall_clock 同期」 と同型却下対象 (= [`design/physics.md`](physics.md) で「Claude が複数回再発した誤った fix 提案」 と明記済の pattern)。

**正しい spawn formula**: 5/6 (γ') `sum / N` (= mean of all non-NPC peer virtualPos.t) で確定、 詳細は [`respawnTime.ts`](../src/components/game/respawnTime.ts) docstring + DESIGN.md §NPC 非対称 + spawn formula 整備。

**Why 永続却下**: P1 設計柱を破棄する game design pivot が無い限り (α) は永続的に invalid。 「動いた人ほど pos.t が未来に進む」 という per-player coord time の semantics が本ゲームの core design choice、 wall_clock anchor はこの semantics を破る。

#### 関連メタ原則

- design/physics.md §pos.t の物理的意味 と「再発防止メモ」 の同型却下 (= 「全 player で wall_clock 同期」 / 「dτ = wall_dt / γ」 の 2 件と同 pattern)
- M2 (対症療法 vs 根治): (α) は spawn time 算出の表面的解、 真因 (= per-player coord time gap の蓄積) は別 layer (= Rule A/B convergence) で解決すべき

#### claude-config promote 判定

本 entry は LorentzArena 固有 (= per-player coord time semantics は本ゲームの design choice)。 但し「proper time / coord time / wall_clock の混同」 一般 pattern は相対論 simulation 共通。 教科書 project / forward-scattering 等で類似 question が出たら [`design/physics.md §pos.t の物理的意味`](physics.md) への引用を検討、 promote は不要。

---

### M39. dead 扱いの asymmetric: active reaction vs anchor 計算

**ルール**: 死亡 player の「causality 計算への寄与」 は経路別に異なる扱いをする:
- **走行中 Rule A/B** (= active causality reaction): dead を **完全 skip**
- **spawn 時刻計算** (= anchor 計算): dead を **virtualPos extension で寄与**

両者は **dead の役割の違い** から導出される必然 asymmetric、 ad-hoc ではない。

**Why (= 走行中 dead-skip の regression mechanism)**:
- alive other がいる場面で、 dead-me の `virtualPos` が wall_dt 経過と共に未来へ drift
- alive other 視点で「dead-me は自分の未来 timelike」 と判定 → Rule A (`checkCausalFreeze`) が `l < -threshold` を trigger → alive other が causally frozen
- gameplay 上 unacceptable (= 死んでる相手に生きてる自分が凍結される)
- 5/2 dead-skip hotfix で走行中 Rule A/B から dead を除外、 active reaction 経路では「dead = 退場」 として扱う

**Why (= spawn 計算で dead 包含 が必要)**:
- spawn 計算は anchor 計算で active reaction ではない、 上記 regression が triggering しない
- dead を spawn 計算からも除外すると alive 群が wall_dt で advance を続ける一方 dead は寄与しない
- 多数死亡 / 復活サイクルで時刻 split が systemic に広がる
- dead を virtualPos で寄与させれば、 死者の virtual continuation が cluster と一緒に drift、 cluster 同期維持

**5/2 plan §4 「死者の二本世界線モデル」 の射程確定**: §4 の `pos + u·τ` uniformity は **alive / stale / dead 全状態統一**を提案していたが、 dead-skip hotfix で走行中で破棄、 spawn 計算でのみ温存、 という 2 状態 + dead 別扱いの asymmetric が 5/6 で確定。 render layer (= DeathMarker / DeadShipRenderer) は別 concern として `W_D(τ_0)` parametric を継続使用 (= 観測者の past cone が x_D に届く時の visualization、 W_D parametric は数式 device で「dead が動いてる」 訳ではない)。

**過去の混乱と整理 (= 2026-05-06 plan §1.6 trail)**:
- (II) dead = 死亡時 spacetime 点固定 案: 「render と causality calc で frozen を統一」 framing で提案 → render が実は W_D 使っていた false premise で撤回
- (II'') dead を spawn 計算でも完全除外 案: 「走行中 dead-skip を spawn にも completing」 framing で提案 → odakin 「時刻 split が広がる」 指摘で撤回
- (II''') dead を virtualPos で寄与維持 案: 5/2 plan §4 を causality calc layer で温存、 走行中 / spawn の asymmetric を「dead の役割の違い」 から正当化 → 確定

#### 関連メタ原則

- M27 (多層 RCA): 走行中 vs spawn の asymmetric は「同じ dead でも layer 別の役割で異なる扱い」 = 多層分離原則の dead-specific 適用
- M35 (NPC 非対称): 同じ「subordinate class skip」 pattern で、 class 軸 (= NPC) は uniform skip、 state 軸 (= dead) は use case で正当化される asymmetric、 二軸独立

#### claude-config promote 判定

本 entry は LorentzArena 固有 (= dead state の取り扱いは当 game の design choice)。 但し「同じ entity を layer 別の role で異なる扱いをする」 一般 pattern は universal、 多層 RCA + 役割分離の好例として LorentzArena 内に保持。 promote は不要。

---

### M40. 構造的 constraint (= friction / cap / bound) を runaway claim 前に確認

**ルール**: 「value X が runaway する」 「Y が arbitrary に大きくなる」 等の claim を立てる前に、 該当 value の **構造的 upper / lower bound** を grep + 計算で確認。 摩擦係数 / friction model / energy bound 等の game / system 設計上の制約を見落とさない。

**LorentzArena 固有 bound (= 2026-05-06 確認済)**:
- **Player γ_max ≈ 1.89**: `PLAYER_ACCELERATION = 0.8 c/s` + `FRICTION_COEFFICIENT = 0.5 /sec` で terminal velocity u_terminal = 0.8/0.5 = 1.6、 γ = √(1+1.6²) ≈ 1.89 (= constants.ts + gameLoop.ts processPlayerPhysics で確認)
- **LH γ = 1 厳密**: u=0 固定 (= `evolvePhaseSpace(lh.phaseSpace, vector3Zero(), dTau)` で加速度ゼロ、 createLighthouse で u=vector3Zero() 初期化)、 thrust も摩擦も無し
- **MAX_VIRTUAL_TAU_SEC = 2 sec**: `virtualPos` の inertial 延長上限 (= safety net)、 dead virtualPos drift は最大 1.89 × 2 = 3.78 ls
- **Dead window ≤ 10 sec**: `RESPAWN_DELAY = 10000ms` で dead human は 10 sec 後 respawn、 stale GC = 20 sec で peers から削除。 dead state の累積 drift は bounded
- **LIGHT_CONE_HEIGHT = 20 ls**: 因果論的「相手と通信できる時刻幅」 上限、 spawn anchor の許容差は概ねこの order

**Why (= 2026-05-06 Bug 14 議論での実証)**: 私は「LH の γ が 705 まで上がって ratchet で human を引きずる」 仮説を提示。 odakin push back 「**今って抵抗力があるからそもそも γ ってそんなにでかくなれないよね?**」 で確認、 上記 bound から γ_max ≈ 1.89 が判明、 仮説は数値的に破綻。 別経路 (= dTau cap 不在 + setInterval throttle) で再仮説する必要があった。

**How to apply**:
- 「X が runaway」 と claim する前に: (1) X を生成する関数 / 方程式 grep、 (2) 関連 const (= PLAYER_ACCELERATION / FRICTION_COEFFICIENT / RESPAWN_DELAY 等) で bound 計算、 (3) claim と bound が consistent か self-check
- 物理シミュレーションでは特に **friction / drag / cap constants** を見落としやすい (= 「physics は無限に accelerate できる」 と naive に思いがち)、 bound 確認を最初に行う
- claim を立てる順序: 「X が runaway」 framing で論理を始めない、 「X の bound は?」 を最初に問い、 bound 内で説明できる仮説を優先する

#### 関連メタ原則

- M25 (state 単一化): bound 値は const に集約 (= constants.ts)、 derive ロジックを散在させない
- work-discipline.md §「物理 / 数値の構造的 constraint を確認してから runaway claim を立てない」: odakin 適用版、 universal な runaway 仮説 hygiene として記録

#### claude-config promote 判定

本 entry は universal な「数値仮説の bound check」 pattern (= 物理だけでなく性能 / メモリ / 容量 系の runaway claim にも applicable)。 他リポで類似 pattern が 2 件目発生したら [`claude-config/conventions/scientific-computing.md`](../../../claude-config/conventions/scientific-computing.md) に promote 検討。 現時点では LorentzArena に留めるが、 universal pattern として既に odakin-prefs/work-discipline.md に同型 § を新設済 (= 2026-05-06 同 plan)。

---
### M41. pos.t / pos.xy 比 と β = √(x²+y²)/t で friction-internal vs external origin を判別する diagnostic

**ルール**: relativistic game で player の `pos.t` / `pos.xy` 比から β = `√(x²+y²)/t` を計算し、 friction model の terminal γ_max から導出される **β_max** と比較。 β > β_max なら **通常 physics 経路 (= friction 内 advance) では発生不能** と判定でき、 別経路 (= state corruption / suspend resume bug / message handler bug 等) を疑う材料になる。

**LorentzArena 固有 bound**:
- friction `μ = 0.5 /sec`、 thrust `α_max = 0.8 c/s`
- u_terminal = α_max / μ = 1.6
- γ_terminal = √(1 + 1.6²) = √3.56 ≈ **1.89**
- β_terminal = u/γ = 1.6/1.89 = **0.847**

**diagnostic 適用例 (= 2026-05-06 Bug 14 live state)**:
- 観測: `pos.t = 20.37M sec`、 `pos.xy = (-19.15M, +6.82M)` → `√(19.15² + 6.82²) = 20.33M ls`
- β = 20.33 / 20.37 = **0.998** (= ほぼ光速)
- 必要 γ = 1/√(1-β²) = 1/√(0.004) ≈ **15.8**
- friction model では γ_max = 1.89、 観測 γ=15.8 は **8 倍超**
- → 「friction model 内の通常 physics で発生不能」 と即判定
- → 別経路探索: state corruption / suspend resume の異常 dTau / message handler bug 等の path を疑う

**汎用化**: 任意の relativistic / kinematics simulation で「value X が runaway」 と claim する前に:
1. X を生成する方程式 / 関数を grep
2. その方程式に流入する upstream variable の **構造的 bound** を計算 (= friction terminal、 cap 定数、 conservation 法則等)
3. 観測 X が bound から導出可能かチェック → 不可能なら別経路、 可能なら通常 advance

これは M40 (= 構造的 constraint を runaway claim 前に確認) の **実機検証 procedure 拡張版**。 M40 が「bound 確認しろ」 という general principle、 M41 が「比から β を出して γ を逆算」 という specific diagnostic。

#### 関連メタ原則

- M40 (構造的 constraint を runaway claim 前に確認): general principle、 本 entry はその relativistic kinematics specific 適用
- M27 (多層 RCA): observation layer の数値 → physical bound layer での解析 → 別経路 layer の探索、 という多層分析の一例

#### claude-config promote 判定

本 entry は LorentzArena 固有 (= friction parameter は本ゲームの design)。 但し「観測値から β を計算して γ_max と比較する」 一般 procedure は relativistic simulation 共通。 教科書 project / forward-scattering 等で類似 diagnostic が必要になったら参照可。 promote は不要。

---

### M42. ring buffer GC で過去の bug event 痕跡が消える、 long-running RCA は live capture mandatory

**ルール**: `MAX_WORLDLINE_HISTORY = 2000` 等の **直近 N entry cap** を持つ data structure は、 真因 event から `N × dτ` 時間以上経過すると GC されて消える。 LorentzArena では history.length=2000、 dτ ≈ 0.013 sec で **history 寿命 ≈ 26 sec**。 真因が「数時間前」 に発生する long-running bug は、 タブを reload せずに **live capture を即実行**しないと痕跡が永続的に失われる。

**痕跡が消える data structure 一覧 (= LorentzArena 5/6 時点)**:
- `worldLine.history` (`MAX_WORLDLINE_HISTORY = 2000`、 寿命 ~26 sec)
- `frozenWorldLines` (`MAX_FROZEN_WORLDLINES = ?`、 push 制限あり)
- `killLog` (`MAX_KILL_LOG = 1000`、 通常 GC は pair 成立で済むが overflow で truncate)
- `respawnLog` (`MAX_RESPAWN_LOG = 500`)
- `hitLog` (`MAX_HIT_LOG = 200`)
- 注: localStorage `la-highscores` は **persist する** ので reload 後も残る (= 例外的に session 跨ぎ確認可)

**GC 残存 data**:
- `players[id].phaseSpace` (= 死亡時値で凍結 / alive なら最新)
- `scores` (= 累積 derive、 GC されない)
- `lighthouseSpawnTime` / `lighthouseLastFireTime` (= Map で永続)
- `staleFrozenIds` (= Set で永続)
- `causalityJumping` / `causallyFrozen` (= boolean で永続)

**procedure**:
1. mobile phone で long-running bug が観察された瞬間、 **reload 待たずに live capture 経路を確立**
2. WiFi ADB + CDP で state dump (= 詳細: `claude-config/conventions/android-chromium-remote-debug.md`)
3. `worldLine.history` 全 entry + `frozenWorldLines` + 全 log を JSON 保存
4. `repro/<date>-<bug>/` ディレクトリに永続化、 README で観測 facts + 仮説 + next steps を記録

**why この pattern が長く運用される**: ring buffer GC は **正規の memory pressure 対策** で、 long-running session で memory blowup を防ぐ正しい設計。 これを「真因痕跡保存のため」 拡大すると trade-off (= memory cost + GC race risk)、 簡単に変えられない。 「**GC されることを前提に live capture で対処**」 が筋。

**過去事例 (= 本 entry の trigger)**:
- 2026-05-06 Bug 14: スマホで 15.77h 動いていたタブで `pos.t = 20.37M` 観測、 worldLine.history は 直近 26 sec しか残ってない、 frozenWorldLines / killLog 全 GC で **巨大 jump 痕跡が完全に失われた**。 user に reload 待ってもらって live capture 取得 → state JSON 732 KB 永続化、 但し真因 event そのものの瞬間は観察できず、 物理 bound (= M41) から「friction 内では不可能」 と判定するに留まる。 真因 isolation は live repro 前提

#### 関連メタ原則

- M27 (多層 RCA): GC は data layer の正規 mechanism、 観測 layer での痕跡保存は別経路 (= live capture)
- M30 (complex bug 完全治療の 5 phase workflow): live capture は phase 1 (= observation) の必須要素

#### claude-config promote 判定

本 entry は universal applicable な「ring buffer GC + long-running RCA」 pattern。 [`claude-config/conventions/android-chromium-remote-debug.md §5.3`](../../../claude-config/conventions/android-chromium-remote-debug.md) で「ring buffer GC を意識した repro 規律」 として universal 化済。 LorentzArena 固有の data structure 一覧は本 entry に保持、 universal 化は完了。

---

### M35 update: LH ratchet 仮説の最終否定 (= 2026-05-06 live capture confirm)

M35 制定時の Bug 14 propagation race 議論で、 旧仮説「**LH ↔ self の Rule B feedback で互いに ratchet forward**」 (= [SESSION.md Bug 14 仮説 (b)](../SESSION.md)) が想定されていた。 5/6 朝の議論で friction γ_max = 1.89 から「γ=705 は不可能」 と数値矛盾で棄却、 5/6 NPC 非対称 plan の (I) で LH を causality 入力から除外する設計に進んだ。

5/6 12:47 JST の **live state capture** で更に確実な棄却 evidence:
- LH の `pos.t = 57005 sec ≈ 15.83h` = page age (= 15.77h) と完全整合、 LH は終始 normal advance
- LH の worldLine.history (= 直近 13 秒分) も全 entry で同 spatial 位置 (= u=0)、 異常 pattern なし
- self.pos.t = 20.37M sec = LH より **20.31M sec 先**、 spatial も 20.33M ls 先
- 「LH も runaway していた、 self が引っ張られた」 ではなく **「self だけが runaway、 LH は終始 normal」** が live data で確定

つまり、 LH は **そもそも ratchet の片側でなかった**。 self.pos.t / pos.xy の異常は **self 単独**で発生した。 NPC 非対称 plan の (I) で LH 経路を遮断する Bug 14 防御は、 LH が runaway する仮想 scenario への defense-in-depth として依然 valid (= 5/6 plan §12.1 通り)、 但し本実機事例では LH 経路は活性化していなかった。

**含意**: alive human runaway 経路 (= self が単独で runaway) こそが真因経路、 (I) NPC 非対称では完全防御できない。 別 plan の **L1 plausibility filter** (= alive human runaway 検出 + 隔離) または **L0 dTau cap** (= suspend 復帰の異常 dTau 防止) が真因対処の本命。

詳細: `repro/2026-05-06-bug14-state/README.md` 参照。

