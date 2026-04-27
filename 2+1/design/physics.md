# design/physics.md — LorentzArena 2+1 物理

DESIGN.md から分離。時間積分 / 因果律 / Lighthouse AI / スポーン時刻 / 光円錐交差など。

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

`computeSpawnCoordTime(players, excludeId?)` (`game/respawnTime.ts`): excludeId を除いた全プレイヤー (生存/死亡/LH 問わず) の `phaseSpace.pos.t` 最大値。初回スポーン・リスポーン・新 joiner スポーンの 3 経路で共通。

**2 つの原則**:

1. **自機除外 (excludeId)**: 自機 ghost の自己 respawn で自分の ghost.pos.t 参照を防ぐ。ghost は thrust 自由 + energy 消費で生存時と同じ物理、自由加速で `pos.t` が γ に比例先走るため自己参照を排除。初回スポーン・新 joiner 経路では自機が未登録で渡さなくても結果同じだが、意味論統一のため呼び分けは呼び出し元責務。

2. **死亡プレイヤー (LH 含む) は死亡時刻で固定される placeholder**: 死亡中の entity は tick されず `pos.t` は死亡時刻で固定、`players` Map に残り max 計算参加。他人間 ghost は死亡中 phaseSpace 非送信で自然に固定、LH ghost は `useGameLoop` が `if (lh.isDead) continue;` で tick skip。対称扱い。alive entity が 1 人でもいれば進行中 `pos.t` が max に勝ち死亡時刻は背景化、全員死亡では「最後に死んだ event 時刻」で respawn (coord time 巻き戻るが wall clock 10s DELAY は回る)。

**将来耐性**: 原則 2 の「他人間 ghost 死亡時刻固定」は「死亡中 phaseSpace 非送信」というネットワーク仕様依存。変更時は `computeSpawnCoordTime` に明示 `isDead` フィルタが必要 (LH は tick skip 担保で影響なし)。respawnTime.ts 冒頭コメントで依存明示。

**fallback 0 は形式保険のみ** (空 players map の一瞬、LH 登録で通常は有限)。**LH alive 時の役割**: 常に `pos.t` 進行している構成員、solo でも maxT 確保、wall clock 依存が完全消失して peer 合意だけで閉じた coord-time モデル。**buildSnapshot 統一**: `snapshot.hostTime` も `computeSpawnCoordTime(players)` で算出 (旧 `me?.phaseSpace.pos.t` は beacon holder が γ で遅れた/ghost 中で新 joiner が過去 spawn する bug)。

**History**: ホスト時刻 → maxT 全 → (minT+maxT)/2 (`36abf67`) → maxT 生存のみ → maxT 全 (2026-04-16) → **maxT 自機除外 + 死亡者 LH 含め placeholder** (2026-04-17、ghost thrust 自由化対応)。

**なぜ対称設計か**: 自機除外なし → ghost 自機 respawn が遠未来暴走 / LH 幽霊化 (死亡中も tick) → 非対称 + tick コスト + 肥大 / LH 除外 → solo で fallback 要で複雑化 → **自機除外 + 死亡者 placeholder** が対称・実装・エッジケースすべてで最シンプル。全員死亡の視点巻き戻りは許容。

`createRespawnPosition(players, excludeId?)`: 座標時間 + ランダム空間位置 (`[0, SPAWN_RANGE]²`) もここに抽出。

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

**UI 強調**: `energy < 0.001` で `hud.energy` 赤ラベル (ja: 「エネルギー」/ en: `ENERGY`) + バー点滅 (`energy-empty-pulse` 0.7s cycle)。`energy < 0.2` で赤色化 (従来継続)。枯渇瞬間のフラッシュは過剰と判断し採用せず。

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

パラメータ: kick 幅 0〜0.8 (γv 単位)。高速移動中の撃破ではデブリが進行方向に偏る (baseU = victim の固有速度)。

### 被弾デブリ (non-lethal hit、Phase C1)

`generateHitParticles(victimU, laserDir)` は非致命 hit の「煙」を生成。爆発デブリと同じ proper-velocity 加算ソルバーを使うが、**scatter 中心 baseU を時空 4 元ベクトル和 `k^μ + u^μ` の空間成分に取る**:

- k^μ (null laser): `(1, dx_L, dy_L, 0)` — null なので `|k_spatial|=1`
- u^μ (victim): `(γ, u_x, u_y, 0)`
- baseU = spatial(k+u) = `(dx_L + u_x, dy_L + u_y)` を proper velocity として扱う

その後 explosion と同じく `ut = √(1 + |baseU+kick|²)` で正規化し 3速度 `v = u/ut` に落とす。

**物理的意味 (単位検証済)**:
- 静止 victim + x 方向 laser → baseU=(1,0) → mean v ≈ (1/√2, 0) ≈ (0.71, 0) — scatter が laser 下流に偏る
- u=(0,0.8) で動く victim + x 方向 laser → baseU=(1, 0.8) → 3 速度 (0.608, 0.480) — laser 推進 + victim 運動の合成
- 「ぶつかった運動量が煙に transfer される」という直感と一致

**パラメータ** (現在):
- `HIT_DEBRIS_PARTICLE_COUNT = 15` (explosion 30 の **半分**)
- `HIT_DEBRIS_KICK = 0.8` (= explosion、2026-04-18 夜 統一)
- size: `0.2 + 0.4 * random` (= explosion、2026-04-18 夜 統一)
- opacity: `HIT_DEBRIS_WORLDLINE_OPACITY = 0.05` / `HIT_DEBRIS_MARKER_OPACITY = 0.35` (explosion の 0.1 / 0.7 の **半分**)
- 世界線長さ: `HIT_DEBRIS_MAX_LAMBDA = 2.5` (= explosion、2026-04-18 夜 LH 3D 塔 work 時に統一)
- 色: **撃った人 (killer) の色** (2026-04-18 odakin 指定、第 2 次改訂)。killer が `players` Map に不在 (切断・ID 不整合) の fallback は victim 色 (少なくとも描画が可視になる保険)。「被弾は誰に撃たれたかが重要な情報」という視覚意味論 — explosion が死者側の記念碑なのに対し、hit は攻撃側のパルスとして読ませる

**設計コンセプトの変遷**: Phase C1 着地時は「全パラメータ爆発の半分」コンセプトだったが、2026-04-18 夜に「広さ・粒・1 粒の派手さは爆発と同じ、個数 + opacity だけ半分にして density を控えめに」に再定義。半減が残るのは `count` (15 vs 30) と opacity (0.05/0.35 vs 0.1/0.7) のみ、size / kick / max_lambda は同値。視覚効果としては「爆発のような派手な飛散だが密度はまばら」になる。

**lethal hit は 2 層 (hit + explosion)**: 致命 hit でも hit デブリ (killer 色) を生成し、その上に `handleKill` が explosion デブリ (victim 色) を重ねる (追加順 `hit → explosion`)。単発 hit でも同じ流れなので「かすった」と「墜ちた」の視覚差は「explosion が来るか/来ないか」で出る (2 層目の有無)。

**renderer 実装注意**: `DebrisRenderer.tsx` は hit と explosion を別 InstancedMesh に分離 (MeshBasicMaterial の opacity は per-instance 制御不可能な uniform 一律値のため)。両 mesh は同じ `debrisCylinderGeo` と shader (`applyTimeFadeShader`) を共有、material の `opacity` 値だけ違う。marker (球) は個別 `<mesh>` なので `getHitDebrisMaterial(color)` に切り替えるだけで per-record opacity が出せる。GC 閾値 (`deathPos.t + max_lambda >= cutoff` in `useGameLoop.ts`) も type 分岐で hit の短い lambda を使う。

**なぜ proper-velocity sum / Lorentz boost 合成ではないか**: Lorentz boost 合成は laser null vector (光速) を含む合成で degenerate。時空ベクトル和 `k+u` の空間成分は null + timelike でも well-defined、proper velocity 空間で再解釈するだけで `|v|<1` 自動保証 + 単位整合 (explosion と同じソルバーに流せる)。物理的厳密性より「laser 方向と victim 運動の自然な中間」という視覚効果優先の判断。

**target-authoritative 維持**: `hit` メッセージに `laserDir: Vector3` を追加 (`messageHandler.ts` で `isValidVector3` validation、`gameLoop.ts` が `laser.direction` を `HitDetectionResult` に乗せて `useGameLoop.ts` が message と `handleDamage` 両方に配る)。各 peer が独立に `generateHitParticles` を走らせて hit debris を独自生成 (random kick は peer 間で微差が出るが視覚 cosmetic、要同期性質なし)。

### キル通知・スポーンエフェクトの因果律遅延

キル通知 (KILL テキスト、death flash) とスポーンエフェクト (リング + 光柱) を、事象の時空点が観測者の過去光円錐に入った時点で発火。

**実装**: `killLog` の `firedForUi: false` entry を毎 tick スキャンし `isInPastLightCone(hitPos, myPos)` で判定。到達時に死亡フラッシュ / kill notification 発火 + `firedForUi = true` 更新。スポーンは `pendingSpawnEvents` に蓄積、同様の判定で発火、fired をバッチ化して 1 フレーム 1 回の `setSpawns` 呼び出し。

**自分が死んだ場合**: 自分はキルイベントの時空点にいるので lorentzDot = 0 → 即座成立、事実上即時。

**自分のリスポーン**: 即時 (自分の位置と spawnPos が同一)。他プレイヤーのリスポーンのみ遅延。

**教訓**: setInterval 8ms ループ内で `setSpawns` をイベント毎に個別呼び出しするとクラッシュする。fired を配列にまとめてバッチ化する必要がある。

### ゴースト 4-velocity: Vector3 → Vector4 変換

DeathEvent の `u` フィールドに `getVelocity4(phaseSpace.u)` で Vector4 に変換して保存 (→ メタ原則 M11)。ゴースト移動は `de.u.t * tau` で等速直線運動を計算。

---


## phaseSpace.alpha は thrust only

[`gameLoop.ts`](../src/components/game/gameLoop.ts) で friction を抜いた thrust 4-加速度を world frame に boost し直して `phaseSpace.alpha` に上書き。 alpha は **表示専用** (= 噴射炎 / 加速度矢印 / 他者 broadcast)、 物理進行には不使用。 friction による減速は別 path で処理されるので、 alpha = thrust だけ持つことで「噴射してる方向」 を pure に表現できる (= exhaust visual の整合)。

## 維持事項 (= short reference)

- **死亡 event 統一アルゴリズム**: `(x_D, u_D, τ_0)` ベース、 `DeathMarker` / `DeadShipRenderer` / `LH` が一元駆動 (詳細: [`plans/死亡イベント.md`](../plans/死亡イベント.md) + [`design/meta-principles.md §M21`](meta-principles.md))
- **加速度表示**: フレーム整合化済 (噴射炎 = 被観測者 rest frame proper acc、 加速度矢印 = 観測者 rest frame 4-vector の時空矢印)
- **LH 光源**: 観測者視点で死亡観測済なら消灯
- **射撃 UI**: silver 統一
