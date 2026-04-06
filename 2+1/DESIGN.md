# DESIGN.md — LorentzArena 2+1

## 設計判断の記録

### setState reducer は純関数に保つ（StrictMode 安全）

- **What**: `setPlayers` / `setLasers` / `setDebrisRecords` / `setSpawns` 等の updater 関数（reducer）の内部では、**副作用（`peerManager.send`、`ref.mutation`、`Math.random`、`Date.now`、`generateExplosionParticles` 等）を一切呼ばない**。副作用や非決定的計算は reducer の外（setState 呼び出しの前または後）で行い、結果を closure 経由で reducer に渡す
- **Why**: React 18 StrictMode は dev モードで reducer を **2 回** 呼び出して副作用検知を行う。reducer 内で副作用を起こすと: (1) 副作用が 2 回実行される（ネット送信 2x、ログ 2x など）(2) `ref.delete()` のような破壊的操作が 1 回目の結果を壊し、2 回目が空状態を見て誤った分岐に落ちる。**色バグ「ホストが灰色のまま」はこのパターンの極端例**: `pendingColorsRef.delete()` を reducer 内で呼んでいたため、1 回目で pending 消費 → 2 回目で pending 空 → gray fallback が commit されていた
- **canonical pattern**:
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
- **Why (closure で束縛する理由)**: `let x; setPlayers(...x = foo()...); use(x);` のように reducer 内で変数を書いても、reducer は後の render phase まで実行されないため、setState 直後の `use(x)` は常に `undefined`。reducer の外で先に計算すれば `x` は setPlayers が呼ばれる時点で確定しており、両方の経路（reducer + 後続の副作用）から参照できる
- **適用箇所**（2026-04-06 監査で修正済み）:
  1. `messageHandler.ts` phaseSpace handler: `pendingColorsRef.delete` + `peerManager.send` を外出し（色バグ修正、後に大掃除で完全削除）
  2. `RelativisticGame.tsx` ゲームループ movement: 因果律チェック・物理積分・`peerManager.send(phaseSpace)` を reducer 外に。reducer は新状態の Map 生成のみ
  3. `RelativisticGame.tsx` init: `Math.random` / `Date.now` / `createWorldLine` を reducer 外で計算
  4. `RelativisticGame.tsx` `handleKill`: `generateExplosionParticles()` を reducer 外で呼び `closure` で渡す
  5. `RelativisticGame.tsx` `handleRespawn`: `Date.now()` を reducer 外で 1 回だけ取得
- **例外**: `setXxx(nextValue)` のように関数ではなく値を直接渡す場合は reducer がないので対象外。`applyKill(prev, victimId)`・`applyRespawn(prev, ...)` のような **純関数を reducer として使う**のは OK（純関数は 2 回呼ばれても同じ結果）
- **教訓**: React 18 の StrictMode は「純粋性契約違反」を検知するセンサー。dev で二重実行が発生したら、それは「本番で dispatch 戦略が変わったときに壊れる予兆」と考える。2 回呼ばれても結果が同じになる reducer を書くのは Future-Proof 戦略

### 物理エンジン: ファクトリパターン（クラス不使用）

- **What**: physics モジュールはクラスではなく関数ベースのファクトリパターンで実装
- **Why**: イミュータブルな phase space オブジェクトとの相性がよく、テストしやすい
- **Tradeoff**: OOP 的な継承が使えないが、物理演算には不要

### ネットワーク: WebRTC (PeerJS) + WS Relay フォールバック

- **What**: P2P 通信を基本とし、制限的なネットワーク環境では WebSocket Relay にフォールバック
- **Why**: レイテンシ最小化（P2P）と到達性（Relay）の両立
- **Tradeoff**: 2つの通信経路を保守する必要がある

### 自動接続: PeerJS の unavailable-id を発見メカニズムとして利用

- **What**: ページを開くと自動でルーム ID（`la-{roomName}`）でホスト登録を試行。ID が既に使われていれば（unavailable-id エラー）クライアントとして接続
- **Why**: ID の手動共有が不要になる。「URL を開くだけ」で参加可能
- **Tradeoff**: WS Relay モードでは使えない（PeerJS のシグナリングサーバーに依存）。ホスト切断時の自動復旧は未実装

### レンダリング: 過去光円錐に基づく描画

- **What**: プレイヤーは他オブジェクトの「現在位置」ではなく過去光円錐上の位置を見る
- **Why**: 特殊相対論を正確に反映するゲームメカニクスの根幹
- **Tradeoff**: 計算コストが増えるが、ゲームの存在意義そのもの

### WorldLine 描画最適化: ローレンツ変換を THREE.js 行列で適用（2+1 限定）

- **What**: TubeGeometry を世界系座標で生成し、表示系への変換はメッシュの Matrix4 として毎フレーム適用。geometry 再生成は `WorldLine.version` を `TUBE_REGEN_INTERVAL=8` で量子化してスロットリング（8 append ごとに再生成）
- **Why**: ローレンツ変換は線形変換なので、CatmullRom スプラインの制御点に適用した結果はスプライン全体に適用した結果と一致。行列更新（16値のコピー）は TubeGeometry 再生成より桁違いに軽い。毎フレーム再生成を間引くことで、5000点 CatmullRom + TubeGeometry の計算コストを 1/8 に削減
- **Tradeoff**: 世界線の先端が最大 8 フレーム分遅れて描画される。ゲームプレイ上は視認不可能な差
- **制約: 2+1 次元でのみ成立**。時空 (t, x, y) の3成分が THREE.js の頂点 (x, y, z) にちょうど収まるため、4x4 ローレンツ行列を列並べ替えで 3x3 部分行列（+ 平行移動）として表現できる。3+1 次元では時空が4成分、THREE.js 頂点が3成分で、t の格納先がないため同じ手法は使えない。3+1 で同等の最適化をするにはカスタム頂点シェーダー（t を頂点属性として持たせ、GPU 側で変換）が必要

### 当たり判定: ホスト権威 + 世界系での交差計算

- **What**: ホストが毎フレーム全レーザー x 全プレイヤーの当たり判定を実行。レーザーの null geodesic とワールドラインの各セグメントで同時刻の空間距離を解析的に計算
- **Why**: ホスト権威でネットワーク遅延による不整合を防止。解析解（二次方程式）で離散化誤差を回避
- **Tradeoff**: ホストに計算負荷が集中。O(L x P x H) だが期限切れレーザーの早期除外で実用上問題なし

### 永続デブリ: アニメーション爆発から静的世界線データへ

- **What**: 死亡時のデブリをアニメーション（Date.now ベース）ではなく、死亡イベント + パーティクル方向の静的データとして永続保存。過去光円錐との交差を毎フレーム計算して描画
- **Why**: アニメーション爆発は一定時間で消えるが、遠方の観測者の過去光円錐に届く前に消えてしまう。永続データなら光が届くまで待てる
- **Tradeoff**: 描画コスト（30パーティクル x デブリ数 x 毎フレーム二次方程式）。MAX_DEBRIS = 20 で上限

### 世界系カメラ: プレイヤー追随（デバッグ用）

- **What**: 世界系カメラモードではプレイヤーの世界系座標 (x, y, t) にカメラが追随。カメラの向き（yaw）もプレイヤーと同じ
- **Why**: 静止系と世界系でカメラ挙動を統一（ローレンツブーストの有無だけが異なる）。デバッグ時に世界系での世界線の曲がり方を確認できる
- **変更履歴**: 当初は空間 (15,15) に固定していたが、加速方向が視認できず有用性が低かったためプレイヤー追随に変更
- **バグ疑惑 → 解決**: 世界系で世界線が加速方向に曲がって見えたのは、摩擦（`mu = 0.5`）が原因。カメラを回す操作中にも摩擦で減速が起き、世界線が曲がっていた。摩擦を切ると世界系での世界線は正しく直線的に見える。描画バグではなく物理の挙動が正しく反映されていた

### 因果律の守護者: 未来光円錐チェックによる操作凍結

- **What**: 毎フレーム、自分のイベントが他プレイヤーの未来光円錐の内側にあるか判定。内側なら `setPlayers` を `return prev` でスキップし、全操作（加速・レーザー・ネットワーク送信）を凍結する
- **Why**: A が B の未来光円錐より未来側にいるとき、A がレーザーを撃てると因果律に反する矛盾が生じる（B のレーザーが因果的に先に A を倒していた可能性がある）。B の未来光円錐が A の世界線の最未来端に追いつくまで A は待つ
- **判定**: `diff = B.pos - A.pos`, `lorentzDotVector4(diff, diff) < 0`（timelike）かつ `B.t < A.t` なら A は B の未来光円錐内
- **体験**: プレイヤーにはラグとして感じられる。高速ブーストで座標時刻が先に進むほど凍結されやすくなる — 物理的に自然なペナルティ
- **実装箇所**: `RelativisticGame.tsx` ゲームループ内、物理更新の直前

### 色割り当て: 決定的純関数（`colorForPlayerId`、2026-04-06 大掃除済み）

#### What

```ts
// colors.ts
const hashString32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export const colorForPlayerId = (id: string): string => {
  const hash = hashString32(id);
  const hue = Math.floor((((hash * 137.50776405) % 360) + 360) % 360);
  const saturation = 80 + ((hash >>> 8) % 17);  // 80-96%
  const lightness = 50 + ((hash >>> 16) % 14);  // 50-63%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};
```

プレイヤー ID から色を計算する純関数。副作用なし、外部状態依存なし、ネットワーク同期なし。全ピア（ホスト・クライアント）が同じ関数を同じ ID で呼べば同じ色を得る。

#### Why

色は本質的に「プレイヤー ID の関数」であって React state に格納する情報ではない。state として扱うと、初期化タイミング・メッセージ順序・StrictMode 二重実行・接続再構築・HMR 時の state 保持などあらゆる境界で race が発生する。一方、ID から決定的に算出するなら、ピア間の一致は数学的に保証される。

**色の分離性（黄金角）**: ID の小さな差を色環上の大きな差に飛ばしたい。黄金角 137.5° は連続整数 n に対する `n * 137.5° mod 360°` の列が最も一様になる角度（Vogel の螺旋で使われる性質）で、ハッシュ出力のビット相関があっても色相が密集しにくい。2〜4 人程度なら統計的に十分分離する。

**saturation / lightness のビット切り出し**: `hash >>> 8`, `hash >>> 16` は hue に使うビットと独立なので、hue が近い 2 人でも saturation・lightness が異なる可能性が上がり、視覚的分離が補強される。注意: 符号付き `>>` は hash の最上位ビットが立つと負数を返し、`負数 % n` も負で戻るため `80 + 負` で想定外の値になる。必ず符号なし `>>>` を使う（2026-04-06 の緊急修正はまさにここだった）。

#### How（呼び出し戦略）

- **init 時に一度だけ呼ぶ** — `RelativisticPlayer.color: string` フィールドにキャッシュ。描画ループで毎フレーム文字列生成しないため
- **呼び出し箇所**: `RelativisticGame.tsx` init useEffect（自分のプレイヤー作成時）と `messageHandler.ts` phaseSpace ハンドラ（他プレイヤー作成時）の 2 箇所のみ
- **派生物**: レーザー色は `getLaserColor(player.color)`（HSL を少し明るくする変換）、デブリ・凍結世界線は作成時の `player.color` を継承。派生物を持つ瞬間に一度だけ計算されるので、後から player.color が変わっても古い派生物は影響を受けない（そもそも ID は不変なので player.color も不変）

#### 削除したもの（大掃除で消えたコードと概念）

| 項目 | 役割 | なぜ不要になったか |
|---|---|---|
| `playerColor` メッセージ型 | ホスト → 全員への色配信 | 全員が純関数で同じ色を計算できるので配信不要 |
| `pendingColorsRef` | playerColor が phaseSpace より先に届いた場合のバッファ | playerColor メッセージ自体が消滅 |
| `connections` useEffect の color broadcast | 新クライアント接続時に既存プレイヤーの色を送る処理 | 同上 |
| ゲームループの「自分の色が gray なら修正」ブロック | init タイミングで isHost が未確定だった場合のリカバリ | そもそも gray placeholder を使わないので不要 |
| `messageHandler` の色割り当てロジック（pickDistinctColor + 副作用 broadcast） | 新プレイヤー検出時のホスト側色決定 | 同上 |
| gray placeholder `hsl(0, 0%, 70%)` | 「まだ色が決まっていない」sentinel | 決定的なので「未決定状態」が存在しない |
| `pickDistinctColor(id, existingPlayers)` | 他プレイヤーと色相距離を最大化 | 純関数化のため最大距離要件を捨てた |

**正味削減**: 約 87 行、4 ファイル。

#### トレードオフ

「色相距離の最大化」を捨てた。黄金角 + ID ハッシュは統計的に十分分離するが、確率的には「たまたま似た色の 2 人」が起こり得る。実運用でプレイヤー数が 2〜4 人なら気にならない。もし将来問題になれば、`colorForPlayerId` の内部だけで色相テーブルの 12 色パレット化など純関数のまま改善できる（外部 API は変わらない）。

#### 経緯（歴史資料）

この箇所は過去に 5 回のパッチを繰り返した。以下は掃除前の履歴で、同じ根の別症状が継承的に増殖していく典型例として残す。

1. **`a1ddfdf`** — `pickDistinctColor(id, existingPlayers)` で「既存色から最大距離を選ぶ」stateful 設計を導入（**原罪**）。この瞬間、色は「ID の関数」ではなく「ID と既存プレイヤー集合の関数」になり、「どの時点の既存プレイヤー集合か」という問題が生まれた
2. **`ef8b61e`** — `playerColor` メッセージが `phaseSpace` より先に届くと捨てられる問題 → `pendingColorsRef` で緩衝
3. **`2db183f`** — クライアントが独立に色を選ぶと race → ホスト集中管理に集約
4. **`b6ee80e`** — マテリアルキャッシュ key に色が含まれておらず仮色 `hsl(0, 0%, 70%)` のままキャッシュが固着 → key に色を含める（後に R3F 宣言的マテリアルに置換）
5. **`9d10e03`** — 新クライアント接続時に既存プレイヤーの色を送っていなかった → `connections` useEffect で一括送信
6. **2026-04-06 緊急パッチ** — `pendingColorsRef.delete()` と `peerManager.send()` を `setPlayers` reducer 内で呼んでいたため、React 18 StrictMode の reducer 二重実行で「1 回目で pending 消費・delete → 2 回目で pending 空 → gray fallback にコミット」となり「ホストが灰色のまま」症状を発生。color 決定と副作用を reducer 外に出して応急処置
7. **2026-04-06 大掃除（このエントリ）** — 原罪（`a1ddfdf` の「最大距離」要件）を捨てて stateful 設計そのものを削除。5 回のパッチは全て同じ根（stateful 色割り当て）の別症状だったので、根を抜いたら枝葉もまとめて消えた

#### 教訓（メタ設計）

- **「X を Y の純粋な関数として計算できないか？」を最初に問う。** 色 = f(ID) で書けるなら、一切の同期・ブロードキャスト・バッファ・race は発生しない。state 同期を設計する前に、純関数で済む可能性を必ず検討する
- **要件を 1 つ緩和すれば設計全体が単純化することがある。** 「色相距離最大化」を絶対視したために、同期経路を全て通す必要が生じた。要件を「統計的に十分分離すればよい」に緩和したら、全経路が消えた。要件の強度は設計複雑度に非線形に効く
- **同じ箇所のパッチが 3 回を超えたら、根の設計を疑う。** 5 回のパッチは全て枝葉で、根は最初のコミットにあった。パッチが増えるほど既存コードに適合させる制約が強まり、根本治療の機会が遠のく
- **State は常にコスト。** React state・ref・ネットワークメッセージ・キャッシュのどれも、「読み書きのタイミング」という隠れた次元を持つ。計算で代替できるなら、state を増やすより計算する方がほぼ常に安い

### 世界線管理: lives[] 統合 → 廃止（世界オブジェクト分離に移行）

- **What**: ~~`lives: WorldLine[]` に統合~~ → プレイヤーは `worldLine` 1本のみ、過去のライフは `frozenWorldLines[]`（独立 state）に
- **経緯**: 当初は `lives[]` で全ライフを管理していたが、デブリ・ゴーストと共にプレイヤーに紐づけている設計が因果律バグの遠因に。世界オブジェクト分離により廃止
- **現在の操作**: kill → worldLine を frozenWorldLines に移動 + isDead=true。respawn → 新 worldLine を作成

### 世界線の過去延長: origin + 半直線

- **What**: WorldLine に `origin` フィールド（スポーン時の初期 PhaseSpace）を追加。`pastLightConeIntersectionWorldLine` で history を走査して交差が見つからなかった場合、origin から過去方向に等速直線運動の半直線との交差を解析的に計算
- **Why**: スポーン直後の短い世界線でも、過去光円錐との交差が必ず見つかるようにする。初期位置で静止（または初期速度で等速直線運動）していたと仮定すれば物理的に正しい
- **描画**: `WorldLine.origin !== null` のもののみ半直線を描画。リスポーン後の worldLine には origin をつけない（前の命と繋がって見えるのを防止）
- **制約**: history trimming で origin と history[0] の間にギャップが生じうる。origin → history[0] のセグメントでも交差を探す

### 因果的 trimming

- **What**: `appendWorldLine` で `maxHistorySize` を超えたとき、最古の点が全他プレイヤーの過去光円錐の内側にある場合のみ削除。そうでなければ保持
- **Why**: 過去光円錐の交差計算で必要な点を早期に消さないため。プレイヤーの過去光円錐がまだ到達していない世界線上の点は将来の交差計算に必要
- **判定**: `diff = otherPos - oldest.pos`、`diff.t > 0 && lorentzDot(diff, diff) < 0` なら oldest は otherPos の過去光円錐の内側 → 削除 OK。それ以外は保持
- **安全弁**: `maxHistorySize * 2` を超えたら因果的判定を無視して強制削除（メモリ保護）
- **コスト**: O(P) per frame、P = 2-4。無視できる

### マテリアル管理: R3F 宣言的マテリアル

- **What**: `getMaterial` + モジュールレベルの `materialCache` を廃止し、R3F の宣言的マテリアル（`<meshStandardMaterial color={...} />`）に置き換え
- **Why**: マテリアルキャッシュのキーに色が含まれておらず、仮色 `hsl(0, 0%, 70%)` でキャッシュされたマテリアルが確定色に更新されないバグがあった。R3F の宣言的マテリアルなら色の変更を自動反映し、ライフサイクルも React が管理する
- **Tradeoff**: なし。プレイヤー数分（2-4個）のマテリアルにキャッシュのパフォーマンス効果はほぼゼロ

### Kill/Respawn: 世界線凍結 + isDead フラグ一元管理

- **What**: kill 時に空 WorldLine 作成 → 世界線凍結（`isDead` フラグ）に変更。死亡中はゴースト（不可視等速直線運動）。respawn で完全独立の新 WorldLine を追加（半直線延長なし）。`applyKill`/`applyRespawn` 純粋関数で状態更新をホスト/クライアント共通化
- **Why**: 旧実装の問題:
  1. 空 WorldLine 作成 → 遅延 phaseSpace 混入で世界線が繋がるバグ
  2. `deadUntilRef`（タイマー）と `isDead`（フラグ）の二重管理
  3. ホストと messageHandler で kill/respawn ロジックが重複・不一致
  4. 他プレイヤーから見て kill 即座にマーカー消失（相対論的に不正確）
- **新モデル**: kill → 凍結世界線が他プレイヤーの過去光円錐と交点を持つ間は可視（因果的に正しい「遅延された死亡」）。交点がなくなって初めて消える。リスポーン後も過去光円錐が新世界線に触れるまで不可視
- **Tradeoff**: `deadPlayersRef`（ホスト専用、同一フレーム二重キル防止）は残す（React の状態更新が非同期のため）

### 死亡時の描画哲学: 物理に任せる

- **What**: 死亡時の唯一の特別処理は「死んだ本人が自分のマーカーを見ない」のみ。世界線・デブリ・他プレイヤーのマーカー表示は通常通り
- **Why**: 死亡したプレイヤーの世界線は「それ以上追加されない」だけで、凍結された世界線は引き続き描画される。他プレイヤーからの可視性は過去光円錐交差で自然に決まる。デブリも同様で、過去光円錐と交差すればマーカーが出る、しなければ出ない。特別な条件分岐は不要
- **以前の問題**: `if (player.isDead) return null` で死亡プレイヤーの全マーカーを全観測者から非表示にしていたため、デブリの表示タイミングにも影響。`maxLambda < 0.5` の閾値も不要な待ち時間を生んでいた
- **教訓**: 相対論的ゲームでは、描画判定に「特殊ケース」を増やすのではなく、過去光円錐交差という統一的メカニズムに任せるべき

### 光円錐の奥行き知覚: FrontSide サーフェス

- **What**: 光円錐を DoubleSide ワイヤーフレームから FrontSide 半透明サーフェス（opacity 0.2）+ FrontSide ワイヤーフレーム（opacity 0.3）に変更
- **Why**: ワイヤーフレームの手前の辺と奥の辺が区別できない（Necker cube 的奥行き曖昧性）。FrontSide にすることでカメラに向いた面だけ描画され、手前/奥が自然に区別できる
- **不採用案**: fog（カメラ距離ベースなので、光円錐の手前と奥がカメラから等距離の場合に効果がない）、gridHelper（空間参照にはなるが手前/奥の区別には効かない）
- **Tradeoff**: メッシュ数が2倍（サーフェス+ワイヤーフレーム）だが、光円錐は自分のみ描画なので影響は小さい

### メッセージバリデーション

- **What**: `messageHandler.ts` で全メッセージタイプに `isFiniteNumber`/`isValidVector4`/`isValidVector3`/`isValidColor`/`isValidString` のランタイム検証を追加。全文字列フィールド（senderId, id, playerId, victimId, killerId）を型検証。laser range は `0 < range <= 100`（LASER_RANGE=20 の 5 倍をマージン）。score は全エントリの key/value を検証。ホストリレー（PeerProvider）でも `isRelayable()` で構造を検証してからブロードキャスト
- **Why**: `msg: any` で受け取ったネットワークメッセージの NaN/Infinity 注入防止、laser の color フィールドなど CSS 文字列で CSS インジェクション防止、文字列フィールドの型安全性確保、不正メッセージのリレー防止
- **注**: `playerColor` メッセージ型は 2026-04-06 に廃止。色は全ピアで `colorForPlayerId(id)` が決定的に算出するのでネットワーク経由で来ない（CSS インジェクション経路の一つが消えた）
- **Tradeoff**: 微小なオーバーヘッド。zod 等のスキーマライブラリは導入せず手書きで軽量に

### 因果律の守護者: 死亡プレイヤー除外

- **What**: 因果律チェック（他プレイヤーの未来光円錐内なら操作凍結）から `isDead` プレイヤーを除外
- **Why**: 死亡中のプレイヤーは phaseSpace をネットワーク送信しないため、座標が死亡時点で凍結される。生存プレイヤーの世界時が進むと、凍結された座標との lorentzDot が timelike（< 0）になり、因果律チェックに引っかかって観測者の時間進行が停止する。結果、デブリマーカーの maxLambda が固定され「出現後に動かない」バグとなっていた
- **修正**: `if (player.isDead) continue;` を因果律チェックのループに追加。死亡プレイヤーはゲーム世界から離脱しているので因果律の対象外
- **教訓**: 因果律の守護者は「ゲームに参加しているプレイヤー」に対してのみ有効。phaseSpace が更新されないオブジェクト（死亡、切断等）を含めると偽陽性で時間停止が起きる

### 世界オブジェクト分離: 死亡 = プレイヤーから世界への遷移

- **What**: 死亡イベントで生まれるオブジェクト（凍結世界線、デブリ、ゴースト軌跡）を `RelativisticPlayer` から分離し、独立した state として管理。`lives[]` と `debrisRecords[]` を廃止。プレイヤーは `worldLine` 1本のみ保持
- **Why**: レーザーは既に独立 state だったが、デブリと凍結世界線だけプレイヤーに紐づいていた。これらは発生した瞬間にプレイヤーと無関係な世界オブジェクトになる。紐づけが因果律の守護者バグの遠因となり、切断したプレイヤーの痕跡が消えるなどの副作用もあった
- **設計原理**: 世界に放たれた物理オブジェクト（レーザー、デブリ、凍結世界線）はプレイヤーとは独立に存在し続ける。プレイヤーが持つのは「今生きてるライフの世界線」だけ
- **ゴースト**: 死亡中の「プレイヤー」はカメラ + リスポーンタイマー。DeathEvent（pos + 4-velocity）から等速直線運動を決定論的に計算
- **Tradeoff**: state が増える（`frozenWorldLines[]`, `debrisRecords[]`, `myDeathEvent`）が、データフローが明確になり各 state の責務が単一に

### デブリ maxLambda: observer 非依存化

- **What**: デブリの過去光円錐交差計算で使う `maxLambda` を `observer.pos.t - death.t`（observer 依存）から固定値 `5` に変更
- **Why**: デブリ世界線は世界オブジェクトであり、死亡イベントから無限の未来に伸びる直線。過去光円錐との交差は純粋に幾何学的に決まる。`observer.t > intersection.t` の条件が既にカバーしているため、observer の時刻で世界線を切り詰める必要はない。observer 依存だとゴースト中に phaseSpace が止まるとマーカーも止まるバグを生んでいた
- **教訓**: 世界オブジェクトの計算に observer 固有の値を混入させない。過去光円錐交差の条件は幾何学に任せる

### リスポーン座標時刻: 全プレイヤー最大値

- **What**: リスポーン位置の座標時刻 t を、ホストの時刻ではなく全プレイヤーの `phaseSpace.pos.t` の最大値に設定
- **Why**: ホストの座標時刻でリスポーンすると、高速で飛んでいた他プレイヤーがリスポーン地点より未来にいる場合、リスポーン直後のプレイヤーが因果律の守護者に引っかかって操作不能になる。全プレイヤーの最大時刻なら、リスポーン後すぐに操作でき、因果律違反も起きない
- **Tradeoff**: リスポーン地点の座標時刻が「世界系でのゲーム経過時間」より未来にジャンプしうるが、全プレイヤーの相対関係としては整合的

### キル通知の因果律遅延

- **What**: キル通知（KILL テキスト、death flash）を即時表示から、キルイベントの時空点が観測者の過去光円錐に入った時点での表示に変更
- **Why**: 相対論的に、事象は光が届くまで観測できない。デブリや凍結世界線のマーカーは既に過去光円錐交差で可視性を制御していたが、UI 通知だけ即時だったのは一貫性に欠ける
- **実装**: `pendingKillEventsRef` に kill イベントを蓄積し、ゲームループ毎に `lorentzDot(hitPos - myPos) <= 0 && myPos.t > hitPos.t` で過去光円錐到達を判定。到達時に death flash / kill notification を発火
- **自分が死んだ場合**: 自分はキルイベントの時空点にいるので lorentzDot = 0 → 即座に条件成立、事実上即時
- **Tradeoff**: 遠距離キルほど通知が遅延する。ゲームプレイ上は「光速の遅れ」として自然

### 時間積分: Semi-implicit Euler

- **What**: `evolvePhaseSpace` で位置更新に加速 **後** の新しい速度 `newU` を使用（semi-implicit / symplectic Euler）
- **Why**: 標準の explicit Euler（旧速度で位置更新）よりエネルギー保存性が良く、相対論的運動での数値安定性が高い。特に摩擦を含む系で振動を抑制する
- **Tradeoff**: なし（同じ計算コストで精度向上）

### ゴースト 4-velocity: Vector3 → Vector4 変換

- **What**: DeathEvent の `u` フィールドに `phaseSpace.u`（Vector3）を直接保存していたのを `getVelocity4(phaseSpace.u)` で Vector4 に変換して保存
- **Why**: ゴースト移動で `de.u.t * tau` を計算するが、Vector3 には `.t` がなく `undefined * tau = NaN` になっていた。`getVelocity4` は γ = √(1 + u²) を計算して `(γ, u_x, u_y, u_z)` の 4-velocity を返す
- **教訓**: 型定義（`u: Vector4`）と実際の値（`phaseSpace.u: Vector3`）の不一致を TypeScript の構造的型付けが見逃す。Vector3 ⊂ Vector4 ではないが、代入時にエラーにならない

### ホスト権威メッセージの二重処理防止

- **What**: messageHandler で kill/respawn/score メッセージ受信時、`peerManager.getIsHost()` なら return（スキップ）
- **Why**: ホストはゲームループで kill 検出 → applyKill → ブロードキャスト。PeerManager.send は自分に送信しないが、安全策としてスキップ。従来は UI 副作用（setDeathFlash, setKillNotification の setTimeout）が二重発火していた
- **Tradeoff**: なし
