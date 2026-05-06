# Plan: NPC 非対称 causality + spawn formula 整備 + type-level kind 化

**起草**: 2026-05-06、 odakin 提案 (= LorentzArena session、 Bug 14 propagation race 議論からの分岐 + 構造整備の追加提案)
**Status**: ✅ **Closed** (= 2026-05-06 朝〜昼 implementation 完了、 263 test pass、 typecheck/lint clean、 wire format 不変。 Stage 6 production deploy + odakin 実機 verify 待ち)
**目的**: causality calc layer の入力 semantics を 3 軸で整備:
- **(I) class 軸**: NPC を human の causality calc 全 site で uniform に skip (= 既存 `checkCausalFreeze` の片肺 LH skip を完成)
- **(II''') 集約形式**: spawn 計算で `(min+max)/2` (midpoint) → `sum/N` (mean) に変更、 `excludeId` 撤廃で self も virtualPos で寄与
- **(III) type-level discriminator**: `RelativisticPlayer.kind: 'human' | 'npc'` で ID prefix runtime check の fragility 解消

副次効果として Bug 14 propagation race の **LH 経路を構造的に断つ**、 加えて mean formula で human runaway peer に対する partial robustness を獲得。

---

## §1 思想: 3 つの independent な structural 整備

### §1.1 plan の核心

本 plan は **「causality calc の入力 semantics を整備する」** という共通目的の下、 互いに直交する 3 軸で改善を行う:

| # | 軸 | 内容 | 対応する concern |
|---|---|---|---|
| **(I)** | class 軸 | NPC を human の causality calc 全 site で uniform に skip | gameplay semantics: 「NPC = subordinate、 human を制約しない」 |
| **(II''')** | 集約形式 | spawn 計算を midpoint→mean、 self 包含、 excludeId 撤廃 | 設計簡素化 + outlier robustness + structural elegance |
| **(III)** | 表現軸 | `RelativisticPlayer.kind` field で type-level discrimination | engineering: ID prefix runtime check の fragility 解消 |

3 つは **異なる problem を異なる mechanism で解決**する独立変更で、 偶然同じ code site (= `computeSpawnCoordTime` 周辺) を touch するため同 plan で実装するのが効率的。 「systematic な共通原理から導出」 という framing は採用しない (= 過去の plan 案で false premise に陥った経験から、 各変更を独立に正当化する形で記録)。

### §1.2 (I) NPC 非対称の motivation

5/2 plan §10.4 ✗「LH 特別扱い不要」 で「LH を Rule A/B 対称設計に組み込めば自動的に wall_clock-ish 値に収束、 特別扱い不要」 と結論された。 ところが 5/2 ~ 5/6 の間に **経緯不明の片肺 hotfix** が混入:

- [`checkCausalFreeze:592`](../src/components/game/gameLoop.ts) で `if (isLighthouse(id)) continue;` が docstring 無しで存在
- これは「NPC = subordinate、 human の Rule A 凍結対象外」 という gameplay semantics を局所的に表現

→ Rule A だけ 5/2 §10.4 から逸脱、 Rule B + spawn 計算は依然 §10.4 通りに「LH 一般 peer 扱い」。 **片肺 asymmetric を 4 site uniform に完成させる** のが (I)。

#### gameplay semantics としての NPC 非対称

物理的正当化:
- **NPC は「他者の inertial frame に対する優先 reference」 ではない、 シミュレーションの一部**
- human が LH を観測する (= past cone 交点) のは render の問題で、 human 自身の coord time advance を強制する根拠にならない
- 一方、 LH AI 側が「human を撃つために自分の coord time を catch up」 するのは LH = subordinate の必然 (= LH の Rule B は human を追う側として正当)

→ **「human → LH の causality 制約は valid (= LH AI の Rule B)、 LH → human の causality 制約は無効 (= 本 plan で削除)」** という非対称が gameplay semantics の core。

#### 5/2 plan §10.4 との直交性 (= 重要)

- **5/2 plan §10.4** は「LH 自身の advance ロジック」 (= LH が wall_clock-ish 値にどう追従するか) の議論
- **本 plan (I)** は「LH state が他者の causality 入力に入るか」 の議論 (= **LH の advance ロジックは不変**、 LH は依然 Rule B で human を追う)
- 両者 **完全直交**。 §10.4 の「LH 特別扱い不要」 結論は LH 自身の挙動について依然 valid、 本 plan は別軸の話

### §1.3 (II''') 集約形式変更の motivation

旧 (γ) `(min + max) / 2` は 5/2 plan §6 Stage 8 で 4 案 (α/β/γ/δ) から選ばれた中点 formula。 これを **(γ') `sum / N` (mean) + `excludeId` 撤廃 + self 包含** に変更する 3 つの利点:

#### 利点 1: outlier robustness

- midpoint は extremum 2 点 (= min と max) のみ参照、 outlier 1 つに full sensitivity
- mean は N 人の平均、 outlier は 1/N 重みで pull
- 通常 plays では cluster 内なので両者ほぼ同値、 runaway peer (= Bug 14 シナリオ) 等の outlier scenario で mean の方が robust

実例: cluster {10, 11, 12} + outlier {100}
- midpoint: (10 + 100) / 2 = **55** (= outlier full pull)
- mean: (10 + 11 + 12 + 100) / 4 = **33.25** (= 1/N 重み)

mean は Bug 14 propagation race の **partial defense** として副次的に効く (= NPC 経路は (I) で完全遮断、 alive human runaway 経路は L1 plausibility filter で main defense、 mean は補助)。

#### 利点 2: self 包含で fallback 構造が消える

旧 (γ) は self を `excludeId` で除外、 「自分の現状 pos を反映しない」 ([`respawnTime.ts docstring`](../src/components/game/respawnTime.ts) 抜粋) という意図。 結果、 solo human respawn (= self が dead で他 alive human 不在) で peers 配列が空になる corner case が発生し、 fallback `return 0` 経路で `pos.t = 0` 巻戻しになる潜在 bug があった。

(γ') では self も他 peer と対等に **virtualPos で寄与**、 dead 中の self は `lastSyncForDead(self_id, killLog)` を経由して inertial 延長された coord time が寄与:

```ts
// (γ') 後の self 寄与:
const lastSync = deadIds.has(self_id) ? lastSyncForDead(self_id, killLog) : nowWall;
const vp = virtualPos(self, lastSync, nowWall);
// vp.t = self.death.pos.t + γ_death × elapsed_dead_wall
```

→ solo respawn でも **peers 配列が常に non-empty** (= self_dead が必ず居る)、 fallback 経路が trigger されない。 corner case が **構造的に消滅**。

#### 利点 3: signature 簡素化

旧 (γ) では `excludeId?: string | null` 引数が必要、 caller 側で respawn 対象 player ID を渡す。 (γ') では excludeId 不要、 引数 1 つ削減:

```ts
// 旧 (γ):
computeSpawnCoordTime(players, killLog, lastUpdateTimes, nowWall, deadIds, excludeId)

// 新 (γ'):
computeSpawnCoordTime(players, killLog, lastUpdateTimes, nowWall, deadIds)
```

caller 側 ([`snapshot.ts:67`](../src/components/game/snapshot.ts) / [`useGameLoop.ts:888,954`](../src/hooks/useGameLoop.ts)) から excludeId 引数撤去。

#### dead を含めて寄与させる物理的根拠 (= 5/2 plan §4 維持)

(γ') は **5/2 plan §4 「死者の二本世界線モデル」 を causality calc でも維持**:
- dead を spawn 計算から除外すると、 alive 群が wall_dt で advance を続ける一方、 dead は寄与しない
- 多数死亡 + 復活が頻繁な場面で **時刻 split が systemic に広がる** リスク
- dead を virtualPos で寄与させれば、 死者の virtual continuation が cluster と一緒に drift し、 cluster 同期が維持される

dead の virtualPos drift は γ_death × elapsed_dead_wall で bounded (= γ_death ≤ 1.89 + RESPAWN_DELAY = 10 sec で最大 ≈ 18.9 sec)、 大幅な発散しない。

→ 5/2 plan §4 の elegance を causality calc layer で **温存**、 spawn 計算で dead を除外 / 死亡時点固定 する選択肢 (= 過去 plan 案の (II) / (II'')) は **撤回**。

### §1.4 (α) wall_clock anchor 案の不採用 (= 過去議論で混乱した点の整理)

5/2 plan §6 Stage 8 で「(α) `now wall_clock` 自分基準」 が plan 推奨案として挙げられていた。 本 plan で **明確に不採用**として記録、 理由は P1 設計柱との矛盾:

- LorentzArena の **P1 設計柱** ([`design/physics.md`](../design/physics.md) §pos.t の物理的意味): `pos.t = γ × wall_clock`、 動いた人ほど未来に進む
- (α) は「self 基準の wall_clock 値」 を spawn pos.t として使う、 つまり **wall_clock = coord time として扱う** 設計
- これは P1 と本質的に矛盾、 「動いた人ほど未来に進む」 game design 思想を破棄することになる
- 5/2 plan §10.1 ✗「pos.t = wall_clock 同期」 と同じ却下対象 (= [`design/physics.md`](../design/physics.md) で「Claude が複数回再発した誤った fix 提案」 と明記)

→ (α) は **design 上 valid な選択肢ではない**、 5/2 plan §6 Stage 8 で「plan 推奨」 と書かれていたが、 本 plan で明示的に却下 (§11.13)。

### §1.5 (III) type-level kind field の motivation

現状 `isLighthouse(id) = id.startsWith("lighthouse-")` は ID prefix の runtime check。 これは:

- **fragile**: ID 命名規約の drift で causality semantics が黙って動作変更
- **opaque**: 型から「これ NPC かもしれない」 が見えない、 全 caller が runtime check 必須
- **historical accident**: 5/2 以前の LH 実装で `lighthouse-N` ID convention が成立、 慣性で続いている

`RelativisticPlayer.kind: 'human' | 'npc'` field 追加で:
- **robust**: ID convention 変更時も `kind` は不変
- **explicit**: 型から「これ NPC か」 が見える、 typed predicate で TS narrowing も可能
- **future-proof**: 他 NPC 種 (= 隕石 / ボス) 追加時、 `kind` 値で discrimination

(III) は (I) を type-level に強化する改善で、 (I) と独立に valid だが同 plan 内で実装するのが cohesive。

### §1.6 探索過程 (= 2026-05-06 session 内の back-and-forth)

「なぜ (γ') に着地したか」 を後の reader が再現できるよう、 探索の back-and-forth を記録。 各案を一度提案して撤回した経緯が、 そのまま design rationale の core になっている。

**探索 0 (= 出発点)**: odakin 初期提案 「灯台は NPC なので人間を causally 引っ張らない、 灯台を Rule B で更新するだけにする」 → (I) NPC 非対称の core。 これは終始一貫して採用。

**探索 1 (= solo respawn fallback の発見、 (II) 提案)**: (I) を `computeSpawnCoordTime` に適用した場合、 solo human respawn (= self 死 + 他 alive human 不在) で peers 配列が空になる corner case が発覚。 私が「fallback `return 0` で `pos.t = 0` 巻戻し」 を見つけて、 修正案として (II) 「dead を `phaseSpace.pos.t` 直読み」 を提案。 framing は「**broadcast / store / render と integrate する**」 として layer alignment を主張。

**(II) の撤回**: render layer の実装を厳密に check した結果、 [`DeathMarker.tsx`](../src/components/game/DeathMarker.tsx) ring が `W_D(τ_0) = x_D + u_D·τ_0` で anchor、 [`DeadShipRenderer.tsx`](../src/components/game/DeadShipRenderer.tsx) も `pastLightConeIntersectionDeathWorldLine` 経由で W_D 使用、 [`deathWorldLine.ts`](../src/components/game/deathWorldLine.ts) docstring が「死亡 event は u_D での extrapolation として扱う」 と明記。 → **render layer も causality calc と一致して inertial extension を使っている**、 私の「broadcast / store / render は frozen、 causality calc だけ extension」 という framing は **完全な false premise**。 (II) の structural justification 崩壊。

**探索 2 (= dead-skip hotfix completion、 (II'') 提案)**: 5/2 dead-skip hotfix の direction (= 走行中 Rule A/B で dead 除外) を spawn 計算にも completing する案。 「**走行中で確立した dead 除外規則を spawn 計算でも uniform に適用**」 という framing。 (II) より honest だが、 走行中と spawn 計算で同じ skip 規則を適用することになり、 **dead を spawn anchor から完全除外** する効果を持つ。

**(II'') の撤回 (= odakin の structural insight)**: odakin の指摘「**死んだやつだけ取り残されるとプレイヤー間の時刻の split が広がっちゃうから、 死亡時のデータから予想される、 仮想的にいまいるであろう位置で判定、 というのは実はそれはそれで正しい気もしてきた**」 で根本的に方針転換。

論理: dead を spawn 計算から除外すると alive 群が wall_dt で advance を続ける一方、 dead は寄与しない → 多数死亡 / 復活サイクルで cluster と dead 群の時刻 split が systemic に広がる → spawn anchor が「現存 alive 群」 だけに依存し、 dead が "取り残される" 構造的問題。 dead を virtualPos で寄与させれば、 死者の virtual continuation が cluster と一緒に drift し、 cluster 同期維持される。

→ **5/2 plan §4 「死者の二本世界線モデル」 を causality calc layer で温存する方が正しい**。 (II'') 撤回。

**探索 3 (= odakin の (γ') 提案)**: odakin の最終提案 「**リスポーンの瞬間、 死んだやつは仮想位置で計算しつつ全プレイヤーの時刻の平均時刻にリスポーン (計算からは NPC は除外)**」 で着地。

要素分解:
- **dead を仮想位置で寄与** = 5/2 §4 維持 (= 探索 2 の撤回を反映)
- **NPC を計算から除外** = (I) (= 探索 0 から一貫)
- **平均時刻にリスポーン** = midpoint → mean への移行 (= 新規)
- **全プレイヤー** = self も含む = excludeId 撤去 (= 新規、 self は dead 中なら virtualPos で寄与)

これが (γ') の final form。

**(α) 案の永続却下**: 5/2 plan §6 Stage 8 で「(α) `now wall_clock` 自分基準」 が plan 推奨だったが、 odakin の指摘「**wall_clock はつねに固有時と同期。 世界時刻とは一切関係ない**」 で根本却下。 P1 設計柱との矛盾、 §1.4 + §11.13 で永続不採用記録。

**思想 trail の core**:

> **(γ') は 4 つの insight の合流点**:
> 1. NPC = subordinate (= class 軸の整理) — 探索 0 で確立
> 2. dead を spawn 計算から除外すると時刻 split が広がる (= 5/2 §4 を causality calc layer で温存) — 探索 2 で発覚
> 3. self を excludeId で除外する必要なく、 virtualPos で寄与させれば fallback 構造が消える (= 集約 formula の structural elegance) — 探索 3 で発覚
> 4. midpoint より mean が outlier robust (= 副次的 Bug 14 partial defense) — 探索 3 で確立
>
> 各 insight を独立に discovery する必要があり、 「systematic な共通原理」 から導出される ad-hoc な構造ではない。 **3 つの independent な軸 (= class / 集約形式 / type-level) で integrate された結果が (γ')**、 という framing が後の reader にとって再現可能な思想。

---

## §2 提案の要約

### §2.1 3 変更の同時実装

```ts
// (I) NPC 非対称: causality calc 全 4 site で:
if (isNpc(p)) continue;

// (III) typed predicate:
export const isNpc = (player: RelativisticPlayer): boolean =>
  player.kind === 'npc';

// (II''') computeSpawnCoordTime の formula 簡素化:
let sumT = 0;
let count = 0;
for (const [id, p] of players) {
  if (isNpc(p)) continue;  // (I)
  const lastSync = deadIds.has(id)
    ? (lastSyncForDead(id, killLog) ?? nowWall)
    : (lastUpdateTimes?.get(id) ?? nowWall);
  const vp = virtualPos(p, lastSync, nowWall);
  if (!Number.isFinite(vp.t)) continue;
  sumT += vp.t;
  count++;
}
return count > 0 ? sumT / count : 0;
```

### §2.2 期待される整合状態

| 観点 | 整合性 | 対称性 |
|---|---|---|
| **causality calc 内部** (= 4 site で NPC skip uniform) | ✓ | NPC = class 軸の uniform skip |
| **走行中 Rule A/B (dead skip) vs spawn 計算 (dead 寄与)** | ✓ (= 意図的 asymmetric) | dead = 走行中で active 計算除外 / spawn で anchor 寄与、 役割の違いから導出 |
| **render layer (= 5/2 §4 W_D extension)** | ✓ (= touch せず) | render は別 concern (= past-cone visualization)、 同じ virtualPos / W_D 構造を別 question で再利用 |

「class 軸 = 全 site uniform、 state 軸 = use case で正当化される asymmetric、 render = 独立 layer」 という三層構造で各々が consistency と対称性を持つ。

### §2.3 副次効果: Bug 14 propagation race の防御

Bug 14 (= [SESSION.md 既知の課題](../SESSION.md)) で議論した propagation race の伝染経路:

1. **runaway peer の `pos.t` が新 joiner の spawn 時刻 anchor になる** (= midpoint formula)
2. **runaway peer が self の Rule B target になる** (= self が runaway peer の過去 cone 内 → forward jump)

本 plan で:
- **runaway peer = LH の場合**: (I) で完全遮断 (= human の Rule B + spawn 計算で LH 除外)
- **runaway peer = alive human の場合**: (II''') の mean formula で **partial 防御** (= 1/N 重みで pull、 midpoint より robust)、 完全防御は別 plan の L1 plausibility filter

---

## §3 Scope: 実 touch site の完全列挙

### §3.1 (I) NPC 非対称 — 4 site

| site | 変更内容 |
|---|---|
| [`src/components/game/respawnTime.ts:73-82`](../src/components/game/respawnTime.ts) `computeSpawnCoordTime` peer iteration | `if (isNpc(p)) continue;` 追加 + (II''') の formula 変更も同 site で同時実装 |
| [`src/hooks/useGameLoop.ts:597-613`](../src/hooks/useGameLoop.ts) self Rule B `peerVirtualPositions` 構築 | `if (isNpc(p)) continue;` を `pId === myId` skip 直後に追加 |
| [`src/components/game/gameLoop.ts:592`](../src/components/game/gameLoop.ts) `checkCausalFreeze` peer iteration | `if (isLighthouse(id)) continue;` → `if (isNpc(p)) continue;` (= predicate 統一) |
| [`src/components/game/gameLoop.ts:310`](../src/components/game/gameLoop.ts) `processLighthouseAI` peer iteration | `if (isLighthouse(pId)) continue;` → `if (isNpc(p)) continue;` (= 同上) |

### §3.2 (II''') spawn formula 変更 — 1 site + caller signature

| site | 変更内容 |
|---|---|
| [`src/components/game/respawnTime.ts:57-87`](../src/components/game/respawnTime.ts) `computeSpawnCoordTime` 本体 | `(min+max)/2` (midpoint) → `sum/N` (mean)、 `excludeId` 引数撤去、 self 包含で fallback 経路自然消滅 |
| [`src/components/game/respawnTime.ts:93-105`](../src/components/game/respawnTime.ts) `createRespawnPosition` (= wrapper) | `excludeId` 引数撤去、 `computeSpawnCoordTime` への passthrough を更新 |
| [`src/components/game/snapshot.ts:67-74`](../src/components/game/snapshot.ts) `buildSnapshot` 内 hostTime 計算 | `excludeId: undefined` 引数を撤去 (= caller 側 signature 整合) |
| [`src/hooks/useGameLoop.ts:888-895`](../src/hooks/useGameLoop.ts) LH respawn setTimeout | `createRespawnPosition` 呼び出しから `victimId` (= excludeId) 引数撤去 |
| [`src/hooks/useGameLoop.ts:954-961`](../src/hooks/useGameLoop.ts) self respawn poll | `createRespawnPosition` 呼び出しから `victimId` 引数撤去 |

### §3.3 (III) type-level kind field — 5-7 site

| site | 変更内容 |
|---|---|
| [`src/components/game/types.ts`](../src/components/game/types.ts) `RelativisticPlayer` 型定義 | `kind: 'human' \| 'npc'` field 追加 + docstring |
| [`src/components/game/lighthouse.ts createLighthouse`](../src/components/game/lighthouse.ts) | return object に `kind: 'npc'` |
| [`src/components/game/lighthouse.ts isNpc`](../src/components/game/lighthouse.ts) | new export `isNpc(player) = player.kind === 'npc'` |
| [`src/stores/game-store.ts handleSpawn`](../src/stores/game-store.ts) | new player 生成時 `kind: isLighthouse(id) ? 'npc' : 'human'` で初期化 (= ID prefix から derive、 wire format 変更回避) |
| [`src/components/game/messageHandler.ts:212-218`](../src/components/game/messageHandler.ts) | phaseSpace 受信で new player 生成時、 同上 |
| [`src/components/game/snapshot.ts applySnapshot`](../src/components/game/snapshot.ts) | snapshot 受信で player 復元時、 同上 |

### §3.4 既存 `isLighthouse(id)` 呼出は **維持**

LH-specific 経路 (= 色 / hit radius / 名前 / render dispatch / score / kill notification 等 約 30 箇所) は `isLighthouse(id)` のまま。 `kind` field は **causality semantics 専用**、 LH-specific 経路に流出させない。 §11.1 で「`isLighthouse` を `isNpc` で全置換しないこと」 を明示。

### §3.5 wire format / protocol への影響

**ゼロ**:
- `kind` field は wire format に乗せない、 受信側が **id-prefix から derive** する (= [`messageHandler.ts`](../src/components/game/messageHandler.ts) / [`snapshot.ts applySnapshot`](../src/components/game/snapshot.ts) で `kind: isLighthouse(msg.playerId) ? 'npc' : 'human'`)
- 旧 client (= `kind` field 不在) との混在可能、 backward compat 完璧
- snapshot LH の `ownerId` rewrite (= [`snapshot.ts:124`](../src/components/game/snapshot.ts)) は `isLighthouse(p.id)` のまま (= LH-specific 経路、 §3.4 方針)

### §3.6 render layer は touch しない

[`DeathMarker.tsx`](../src/components/game/DeathMarker.tsx) / [`DeadShipRenderer.tsx`](../src/components/game/DeadShipRenderer.tsx) / [`deathWorldLine.ts`](../src/components/game/deathWorldLine.ts) / [`pastConeFallback.ts`](../src/components/game/pastConeFallback.ts) は **完全不変**。 5/2 plan §4 「死者の二本世界線モデル」 を render layer で温存。

---

## §4 思想の補足: dead 扱いの asymmetric を honest に説明する

### §4.1 5/2 plan §4 「死者の二本世界線モデル」 の射程

5/2 plan §4 は alive / stale / dead を `virtualPos = pos + u·τ` の uniform formula で計算する設計。 caller の lastSync 引数だけが状態別:
- alive: `lastSync = lastUpdateTimes.get(id)` (= 最後 broadcast time)
- stale: 同 alive (= broadcast 停止前の最後値から延長)
- dead: `lastSync = lastSyncForDead(id, killLog)` (= killLog の最新 wallTime)

この uniformity は本 plan でも **causality calc layer で完全温存**。 spawn 計算で dead を skip する案 (= 過去 plan 案の (II) / (II'')) は撤回、 dead は virtualPos で寄与する。

### §4.2 5/2 dead-skip hotfix と spawn 計算の asymmetric

5/2 dead-skip hotfix ([DESIGN.md §asymmetric 設計](../DESIGN.md)) で **走行中 Rule A/B から dead を除外**、 具体的な regression を解消:

**regression mechanism (= 5/2 plan v1 → v2 で発見)**:
- 5/2 plan v1 は §4.4 で alive/stale/dead を `virtualPos = pos + u·τ` で uniform 統一処理する設計
- 実機検証で「**dead-me の virtualPos が alive-other を不当に freeze させる**」 regression 発覚
- mechanism: dead-me (= 死亡時 inertial 延長で wall_dt 経過と共に未来へ drift) の virtualPos が alive-other の future cone 内に入る → alive-other 視点で「dead-me は自分の未来 timelike」 と判定 → Rule A (`checkCausalFreeze`) が `l < -threshold` で freeze trigger → alive-other が causally frozen 状態に
- gameplay 上 unacceptable (= 死んでる相手に生きてる自分が causally 凍結される)

**hotfix の対処**: 走行中 Rule A/B から dead を除外、 dead は走行中 causality reaction の対象外。 spawn 計算 (= 走行中 reaction ではなく anchor 計算) では dead を含めても同 regression が起きないため、 spawn 計算のみ dead 包含 を維持。

**asymmetric の整理**:

| 経路 | dead 扱い | 理由 |
|---|---|---|
| `checkCausalFreeze` (= 走行中 Rule A) | 除外 | 上記 regression 防止 (= dead-me virtualPos が alive-other の Rule A trigger となる) |
| `useGameLoop self Rule B` (= 走行中 self Rule B) | 除外 | 同上、 dead を Rule B target にすると不当 jump |
| `processLighthouseAI Rule B` (= LH の Rule B) | 除外 | LH が dead 追跡で aim / jump するのは gameplay 上 natural ではない |
| **`computeSpawnCoordTime`** (= spawn 計算) | **包含 (= virtualPos)** | spawn 計算は走行中 reaction ではなく anchor 計算、 regression mechanism が triggering せず、 dead 除外すると時刻 split が広がる demerit が大きい |

走行中と spawn 計算で dead 扱いが **正反対** だが、 これは **dead の役割の違い** から導出される必然:

- **走行中** = active causality reaction (= Rule A 凍結 / Rule B 跳躍は「観測される other に反応する」 行為)、 dead を含めると上記 regression が trigger
- **spawn 計算** = anchor 計算 (= cluster 中心の代表値)、 dead を含めても reaction が trigger せず、 むしろ cluster 同期維持で benefit

→ 「**走行中 では dead が active なら起こす不当 reaction を防ぐため除外、 spawn では dead が anchor として寄与する benefit を採るため包含**」 という意図的設計、 ad-hoc ではない。

### §4.3 render layer との関係

render (= [`DeathMarker.tsx`](../src/components/game/DeathMarker.tsx) ring + [`DeadShipRenderer.tsx`](../src/components/game/DeadShipRenderer.tsx) gate) は引き続き `W_D(τ_0) = x_D + u_D·τ_0` で past-cone parametric 描画を行う。 これは:

- **「観測者の past cone がいつ x_D に届くか + その visualization」** という幾何問題を解く mechanism
- W_D parametric は **数式 device** (= dead が動いてる訳ではない、 観測者の時間 advance に対する past-cone 交点の連続的 parametrization)
- underlying fact は「dead = x_D 単一時空点」、 render と causality calc は同じ underlying fact に基づく異なる concern

causality calc は「dead の coord time 寄与」 を欲しがる (= virtualPos 経由で得る)、 render は「past cone 交点の screen 上位置」 を欲しがる (= W_D 経由で得る)。 同じ math の異なる use。 layer separation。

### §4.4 ghost worldline (= 5/2 plan §4.5) との関係

5/2 plan §4.5 で導入された **(2) ghost worldline** (= 死者本人の自由飛行 camera 用 phaseSpace、 [`store.myDeathEvent.ghostPhaseSpace`](../src/stores/game-store.ts)) は本 plan の射程外:

- **概念的位置付け**: ghost = 死者本人専用の「視点用 entity」、 他 peer から observation 不能 (= broadcast されない、 自分以外見えない)
- **causality calc との関係**: ghost は他者の causality 入力に入らない (= 5/2 plan §4.5 で確立、 「ghost は自分専用の遊び」 と銘記)。 本 plan の (I) NPC 非対称 / (II''') mean formula も ghost に作用しない
- **ghost が涉及する code path**: [`useGameLoop self camera`](../src/hooks/useGameLoop.ts) の死後 free-fly 物理 (= myGhostPhaseSpace の自前 update)、 これは本 plan で touch する causality calc 4 site と独立

→ ghost は self 視点専用の構造、 本 plan の structural 整備は ghost に影響を与えず、 ghost も本 plan に影響を与えない。 完全直交。

---

## §5 Edge cases

### §5.1 各 caller における (γ') 挙動

(γ') 採用後、 各 caller の挙動を完全列挙:

#### Caller A: `buildSnapshot` (= host が新 joiner 用 hostTime 計算)

- 入力: aliveMap (= stale 除外済 players)、 host 自身を含む
- iterate: NPC skip + virtualPos 計算
- mean: alive humans + dead humans (via virtualPos) の coord time mean
- 結果: 新 joiner spawn `pos.t` = cluster 中心
- count = 0 になる条件: aliveMap が NPC のみ (= host 自身が居ない) — **理論上不可能** (= host は自分 stale にしない)

#### Caller B: LH respawn setTimeout

- 入力: setTimeout 実行時の players、 BH (= 自分) は player に居る
- iterate: LH 除外 (= isNpc) + 他 humans 寄与
- mean: humans の coord time mean (= 自分 + 他 humans + dead humans via virtualPos)
- 結果: LH 復活 `pos.t` = humans cluster 中心
- count = 0 になる条件: humans 不在 — **実質不可能** (= 自分が runner)

#### Caller C: self respawn poll

- 入力: poll 実行時の players、 自分 (= dead) は player に居る
- iterate: NPC skip、 self も含む (= dead self は virtualPos extension で寄与)
- mean: 全 humans (= self_dead + alive others) の coord time mean
- 結果: self 復活 `pos.t` = humans cluster 中心 + self virtual continuation 込み
- count = 0 になる条件: self が players Map に居ない — **不可能** (= dead でも保持される)

### §5.2 solo respawn の挙動 (= self_dead 単独)

solo play (= alive humans = 0 + LH 1) で self 死亡 → respawn:

- iterate: LH 除外 (= isNpc)、 他 humans 不在、 self_dead 寄与
- self.virtualPos = `death.pos.t + γ_death × elapsed_dead_wall`
- count = 1 (= self_dead のみ)
- mean = self.virtualPos.t (= 単一値の平均は値そのもの)
- 結果: respawn `pos.t` = self の死亡時 + γ_death × 10 sec

物理意味: 「死後 10 sec 慣性で漂ったら居たはずの coord time に復活」。 5/2 plan §4 「死者の二本世界線モデル」 の (1) 仮想世界線の終端値そのもの、 render の DeathMarker ring が DeathMarker 観測時に居る coord time とも一致。 worldLine 連続性 preserve。

### §5.3 mean vs midpoint の挙動差 (= 主要シナリオ別)

#### 通常 cluster (= 全 peer が close)

peers = {10, 11, 12} (= 3 alive humans)
- midpoint: (10 + 12) / 2 = 11
- mean: 33 / 3 = 11

→ **同値**、 通常 plays で挙動差なし。

#### 軽い spread (= γ heterogeneous)

peers = {10, 11, 15} (= 1 alive で γ=2 の peer 含む)
- midpoint: (10 + 15) / 2 = 12.5
- mean: 36 / 3 = 12.0

→ **微差**、 mean は cluster 多数に weighted、 0.5 程度の違い。

#### outlier (= 1 runaway peer)

peers = {10, 11, 12, 100}
- midpoint: (10 + 100) / 2 = 55
- mean: 133 / 4 = 33.25

→ **mean 有意に robust**、 runaway 1 outlier で midpoint は 55 まで pull、 mean は 33 まで。 Bug 14 partial defense として効果。

#### multiple dead (= 多数死亡シナリオ)

peers = {alive: 100, alive: 105, dead.vp: 110, dead.vp: 108} (= alive 2 + dead 2)
- midpoint: (100 + 110) / 2 = 105
- mean: 423 / 4 = 105.75

→ **微差**、 cluster 内 dead は midpoint と mean ほぼ一致。

→ **mean は midpoint の cluster 内挙動を維持しつつ outlier に robust**、 採用に regression なし。

### §5.4 Bug 9 (= 新 join 即凍結) 再発リスク check

Bug 9 は 5/2 plan §6 Stage 8 で解析:
- (β) `max(virtualPos)` 仕様時に新 joiner が全 peer の future、 全 peer から見て freeze 待ち → Bug 9 発火
- (γ) `(min+max)/2` 中点で軽減、 Rule B convergence で構造解消

(γ') mean は中点の延長線上、 outlier がない通常 plays で midpoint と同値。 outlier がある場合は midpoint より cluster 寄り (= max に引っ張られない)、 むしろ Bug 9 リスクが midpoint より低下。

→ **(γ') で Bug 9 再発リスクなし**。

### §5.5 multi-LH 将来案との互換性

5/2 plan §7.6 「現時点 1 LH 前提、 将来 multi-LH 時に再考」 を maintain:

- (I) `isNpc(p) = p.kind === 'npc'` は将来複数 NPC 種を kind 値で OR 拡張可能 (= `'human' | 'lighthouse' | 'asteroid' | 'boss'` 等への展開)
- multi-LH 時の挙動: human の causality は全 LH を skip、 LH 同士は既存通り skip ([`gameLoop.ts:310`](../src/components/game/gameLoop.ts) で他 LH skip 既存)、 LH AI は human のみ追う
- 1 LH 前提を破る PR は別議論

### §5.6 client 側で LH が stale 化するケース

非 BH client は host から LH 状態を受信、 host 切断中は LH の `lastUpdateTimes` 更新が止まり [`useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) の `STALE_WALL_THRESHOLD = 5000ms` 経過後に staleFrozenIds 投入:

- `buildSnapshot.aliveMap`: stale-skip + isNpc-skip の **両方**で除外 (= 重複だが副作用なし)
- `useGameLoop self Rule B`: stale-skip 不在 (= dead-skip + isNpc-skip のみ)、 stale LH は staleFrozenIds で extra protected されないが、 isNpc-skip で代替吸収
- `checkCausalFreeze`: 1.5s grace check + isNpc-skip の二重 skip
- `processLighthouseAI`: stale な human を peer に含めるかは別議論、 本 plan では touch しない

→ stale path に対する本 plan の影響は **冗長な skip が発生するだけで挙動同等**。

### §5.7 deploy 直後の transition

deploy 前: room の human と LH が 5/2 plan の対称設計通りに共進化、 LH は Rule B で human を追い、 human も Rule B で LH を追う。

deploy 直後:
- LH は引き続き human を追う (= LH の Rule B 不変、 (I) で touch しない)
- human は LH を追わなくなる (= (I) 新挙動)
- spawn formula が midpoint → mean に変わる (= (II'''))
- 既存 room state は preserve、 wire format 不変なので旧 client との混在も問題なし
- 通常 plays では visual 違和感なし (= 同 cluster で midpoint と mean ほぼ同値)

### §5.8 GitHub Pages cache の reload tax

(III) で `RelativisticPlayer` 型に `kind` field 追加:
- LocalStorage 系: 該当無し (= player state は LS に永続化されない)
- in-memory 系: 既存 client から受信する player message も id 由来で `kind` derive、 backward compat 完璧

→ HMR 反映後 hard reload (= Cmd+Shift+R) で fresh、 cached state の互換性問題なし。

### §5.9 dead human が長時間 alive humans から離れたら?

仮想 scenario: dead human が高 γ (≈ 1.89) で死亡、 alive humans が静止 (γ=1)。

- dead.virtualPos drift: γ_death × elapsed = 1.89 × elapsed_wall
- alive humans drift: 1 × elapsed_wall

毎秒 dead が alive より 0.89 sec 速く進む。 RESPAWN_DELAY = 10 sec 経過後、 dead は alive より ~9 sec 先。

mean に与える影響: alive 群 + dead が混在、 dead は alive より 9 sec 先。 mean = (alive_mean + dead_vp) / N、 dead 1 人なら 1/N 重み (= 通常 N=2-4 で 25-50% 重み)。

これは Bug 9 リスクを高める? いいえ — 9 sec の差は LIGHT_CONE_HEIGHT = 20 sec の半分以下、 Rule B convergence 範囲内。 mean が dead 寄りに pull されても、 spawn 後 Rule B が cluster に合流させる。

→ **問題なし**。

---

## §6 predicate 命名と signature

### §6.1 `isNpc(player: RelativisticPlayer): boolean` 新設

[`src/components/game/lighthouse.ts`](../src/components/game/lighthouse.ts) に追加:

```ts
/**
 * 「causality 計算で human player を制約しない entity」 の typed 判定。
 *
 * **設計原理 (= NPC 非対称、 plans/2026-05-06-npc-asymmetric-causality.md §1.2)**:
 * NPC は human の Rule A / Rule B / spawn 時刻 計算に入力として現れない。 逆に、
 * human の `pos.t` は NPC の causality 計算 (= NPC が human を追う側) に通常通り
 * 入力される。 物理的根拠: NPC は「他者の inertial frame に対する優先 reference」
 * ではなく、 シミュレーションの一部。
 *
 * **`isLighthouse(id)` との違い**:
 * - `isLighthouse(id)`: LH 固有 identity の判定 (= 色 / hit radius / 名前 /
 *   render dispatch / score 加算分岐)、 ID prefix 由来の string check
 * - `isNpc(p)`: causality semantics の判定、 `p.kind === 'npc'` 由来の typed check
 *
 * 現時点で NPC = LH のみのため両者は同値だが、 **意味的に別軸**。 一本化すると
 * 将来 NPC 種追加時 (= 隕石 / ボス) に LH-specific 経路に NPC 一般 ルールが流出する
 * risk あり (= §11.1 「やらないこと」)。
 *
 * **適用 site** (= §3.1):
 * - `checkCausalFreeze` peer iteration (= human の Rule A)
 * - `useGameLoop.ts` self の Rule B `peerVirtualPositions`
 * - `processLighthouseAI` peer iteration (= NPC 同士の Rule B 循環防止)
 * - `computeSpawnCoordTime` peer iteration (= spawn 時刻 anchor)
 *
 * **非適用 site**: LH-specific 挙動 (= 色 / hit radius / render dispatch / score) は
 * 引き続き `isLighthouse(id)` を使う。 一本化は §11.1 で禁止明記。
 */
export const isNpc = (player: RelativisticPlayer): boolean =>
  player.kind === 'npc';
```

### §6.2 `RelativisticPlayer.kind: 'human' | 'npc'` 追加

[`src/components/game/types.ts`](../src/components/game/types.ts):

```ts
export interface RelativisticPlayer {
  id: string;
  /**
   * NPC vs human の type-level discriminator。
   *
   * 'npc': causality 計算 (= human の Rule A / B / spawn) の入力に入らない class。
   *        `isNpc(player)` で判別される。 現時点で NPC = LH のみ。
   * 'human': human player、 通常 causality 入力に入る。
   *
   * 詳細: plans/2026-05-06-npc-asymmetric-causality.md §1.5
   */
  kind: 'human' | 'npc';
  ownerId: string;
  phaseSpace: PhaseSpace;
  worldLine: WorldLine;
  color: string;
  displayName?: string;
  energy: number;
}
```

### §6.3 wire format 不変、 受信側で derive

`kind` は wire format ([`message.ts`](../src/types/message.ts)) に乗せない。 受信側で id-prefix から derive (= §3.5)。

### §6.4 `computeSpawnCoordTime` signature 変更

```ts
// 旧:
computeSpawnCoordTime(
  players, killLog, lastUpdateTimes, nowWall, deadIds,
  excludeId?: string | null,  // ← 撤去
): number

// 新:
computeSpawnCoordTime(
  players, killLog, lastUpdateTimes, nowWall, deadIds,
): number
```

caller 側 ([`snapshot.ts buildSnapshot`](../src/components/game/snapshot.ts) / [`useGameLoop.ts respawn poll/setTimeout`](../src/hooks/useGameLoop.ts)) から `excludeId` 引数を撤去。

`createRespawnPosition` (= wrapper、 [`respawnTime.ts:93-105`](../src/components/game/respawnTime.ts)) も同様に signature 変更。

---

## §7 実装 Stage 分割

各 Stage は独立 commit + test。 全 Stage 完了で 1 deploy、 mid-deploy なし (= risk 低、 cohesion 重視)。

### Stage 1: `kind` field 追加 + `isNpc` typed predicate 新設

**目標**: 型システム拡張と新 predicate 導入、 既存挙動は変えない (= 純粋に type-level の追加)。

**変更 file**:
- [`src/components/game/types.ts`](../src/components/game/types.ts): `RelativisticPlayer` に `kind: 'human' | 'npc'` field 追加 + docstring
- [`src/components/game/lighthouse.ts`](../src/components/game/lighthouse.ts): `isNpc(player): boolean` 新規 export + docstring
- [`src/components/game/lighthouse.ts createLighthouse`](../src/components/game/lighthouse.ts): return object に `kind: 'npc'` 追加
- [`src/stores/game-store.ts handleSpawn`](../src/stores/game-store.ts): 新 player 生成箇所で `kind: isLighthouse(id) ? 'npc' : 'human'`
- [`src/components/game/messageHandler.ts:212-218`](../src/components/game/messageHandler.ts): phaseSpace 受信で new player 生成時、 同上
- [`src/components/game/snapshot.ts applySnapshot`](../src/components/game/snapshot.ts): snapshot 受信で player 復元時、 同上

**test**: `lighthouse.test.ts` 新規 (or 既存に追加):
- `createLighthouse(...)` の返値が `kind === 'npc'`
- `isNpc({kind: 'npc', ...}) === true`
- `isNpc({kind: 'human', ...}) === false`

既存 247-253 test 全 pass (= 既存挙動不変)。

**dependency**: なし。

### Stage 2: causality 経路 4 site で `isLighthouse(id)` → `isNpc(p)` 置換

**目標**: predicate 統一、 既存挙動同等、 semantics の意図明示。

**変更 file**:
- [`src/components/game/gameLoop.ts:592`](../src/components/game/gameLoop.ts) `checkCausalFreeze` peer iteration
- [`src/components/game/gameLoop.ts:310`](../src/components/game/gameLoop.ts) `processLighthouseAI` peer iteration

**変更内容**:
```ts
// 旧:
if (isLighthouse(id)) continue;

// 新:
if (isNpc(player)) continue;
```

(変数名 `id` / `pId` / `player` / `p` は site 別、 既存 loop の binding に従う)

**test**: 既存 [`checkCausalFreeze.test.ts`](../src/components/game/checkCausalFreeze.test.ts) + [`lighthouseRuleB.test.ts`](../src/components/game/lighthouseRuleB.test.ts) を pass。 test 内の `RelativisticPlayer` mock object に `kind` field を追加する update が必要。

**dependency**: Stage 1。

### Stage 3: self Rule B で NPC skip (= (I) の core)

**目標**: §3.1 の `useGameLoop.ts` self Rule B で NPC を peer set から除外。 これが本 plan の **新規挙動変更の core**。

**変更 file**: [`src/hooks/useGameLoop.ts:597-613`](../src/hooks/useGameLoop.ts)

**変更内容**:
```ts
const peerVirtualPositions: { pos: Vector4 }[] = [];
for (const [pId, p] of fresh.players) {
  if (pId === myId) continue;
  if (isNpc(p)) continue;  // *** NEW (§3.1, §1.2 NPC 非対称) ***
  if (ruleBDeadIds.has(pId)) continue;
  // ... 既存処理
}
```

**docstring 追加**: 既存の dead-skip コメント ([`useGameLoop.ts:599-603`](../src/hooks/useGameLoop.ts)) と同形で、 NPC skip の根拠を `plans/2026-05-06-npc-asymmetric-causality.md §1.2` 参照付きで記録。

**test**: 既存 [`causalityRules.test.ts`](../src/components/game/causalityRules.test.ts) はそのまま pass (= λ_exit 計算は peer set 構築と独立)。 useGameLoop level の挙動 test は infra 不在で defer (= [`plans/2026-05-05-network-split-rule-b-runaway.md` §8](2026-05-05-network-split-rule-b-runaway.md) 方針に従う)、 localhost 動作確認で代替。

**dependency**: Stage 1 + 2。

### Stage 4: `computeSpawnCoordTime` で NPC skip + mean formula + excludeId 撤去

**目標**: §3.1 + §3.2 を 1 site で同時実装。 (I) NPC skip + (II''') formula 変更 + signature 簡素化。

**変更 file**: [`src/components/game/respawnTime.ts:57-105`](../src/components/game/respawnTime.ts)

**変更内容**:
```ts
import { isNpc } from "./lighthouse";  // ← isNpc import 追加

export const computeSpawnCoordTime = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: ReadonlyMap<string, number> | undefined,
  nowWall: number,
  deadIds: ReadonlySet<string>,
  // *** excludeId 引数を撤去 (= self も virtualPos で寄与する設計) ***
): number => {
  let sumT = 0;
  let count = 0;
  for (const [id, p] of players) {
    if (isNpc(p)) continue;  // *** NEW (I) ***
    const lastSync = deadIds.has(id)
      ? (lastSyncForDead(id, killLog) ?? nowWall)
      : (lastUpdateTimes?.get(id) ?? nowWall);
    const vp = virtualPos(p, lastSync, nowWall);
    if (!Number.isFinite(vp.t)) continue;
    sumT += vp.t;
    count++;
  }
  return count > 0 ? sumT / count : 0;
};

export const createRespawnPosition = (
  players: Map<string, RelativisticPlayer>,
  killLog: readonly KillEventRecord[],
  lastUpdateTimes: ReadonlyMap<string, number> | undefined,
  nowWall: number,
  deadIds: ReadonlySet<string>,
  // *** excludeId 引数を撤去 ***
): { t: number; x: number; y: number; z: number } => ({
  t: computeSpawnCoordTime(players, killLog, lastUpdateTimes, nowWall, deadIds),
  x: (Math.random() - 0.5) * SPAWN_RANGE,
  y: (Math.random() - 0.5) * SPAWN_RANGE,
  z: 0,
});
```

**caller signature update**:
- [`snapshot.ts:67-74`](../src/components/game/snapshot.ts): `excludeId: undefined` 引数撤去
- [`useGameLoop.ts:888-895`](../src/hooks/useGameLoop.ts): `victimId` 引数撤去
- [`useGameLoop.ts:954-961`](../src/hooks/useGameLoop.ts): `victimId` 引数撤去

**docstring 全面 update**: 冒頭 docstring (= [`respawnTime.ts:9-56`](../src/components/game/respawnTime.ts)) を以下構造で書き直す:

1. **§Stage 8 仕様 (= 4/28 + 5/2 由来)**: (γ) `(min+max)/2` 採用経緯 + 本 plan で (γ') mean に移行
2. **§NPC 非対称 (= 2026-05-06)**: NPC を peer set から除外する根拠、 `plans/2026-05-06-npc-asymmetric-causality.md §1.2` 参照
3. **§(γ') mean formula (= 2026-05-06)**: midpoint→mean の移行理由 (= outlier robustness、 self 包含で fallback 構造消滅、 signature 簡素化)、 §1.3 参照
4. **§dead 扱い**: 5/2 plan §4 「死者の二本世界線モデル」 を causality calc layer で温存、 走行中 Rule A/B の dead-skip hotfix とは asymmetric (= dead の役割の違い、 §4.2)、 plan §4.2 参照
5. **§killLog 引数**: dead 経路で `lastSyncForDead` 経由で使用、 引数として保持
6. **§5/2 plan §6 Stage 8 (α) 案の不採用**: P1 設計柱と矛盾するため不採用、 §1.4 + §11.13 参照

**test 追加** ([`respawnTime.test.ts`](../src/components/game/respawnTime.test.ts)):
- **(I) NPC skip**:
  - `human 1 + LH 1` → human の `pos.t` のみで決まる (= LH 値を変えても結果不変)
  - `human 2 + LH 1` → human 2 人の mean のみ
- **(II''') mean formula**:
  - peers = {10, 11, 12} → 11 (= cluster 内 midpoint と一致)
  - peers = {10, 11, 12, 100} → 33.25 (= midpoint 55 と異なる、 outlier robustness 検証)
- **self 包含**:
  - `self_dead 1 (静止) + alive 1` → mean に self.virtualPos 寄与 (= 旧 excludeId 経由なら除外されていた)
  - solo `self_dead 1 のみ` → mean = self.virtualPos.t (= 単一値)
- **(III) typed predicate**: `isNpc(player)` で `kind` field を読む
- 既存 test (= LH 含めた `(min+max)/2` 検証等) は LH を non-NPC peer に置換するか、 NPC 含めた expected value を mean 形式に更新

**dependency**: Stage 1 + 2 + 3。

### Stage 5: docstring + DESIGN.md + plan close

**目標**: 設計判断を文書化、 5/2 plan + dead-skip hotfix との関係を明示、 future reader が混乱しないよう trail を残す。

**変更 file**:
- [`DESIGN.md §因果律対称化 + WebGL recovery`](../DESIGN.md): 新小節追加 「§NPC 非対称 + spawn formula 整備 (2026-05-06)」、 内容:
  - 5/2 plan §10.4 の対称設計と本 plan (I) との直交性 (= LH 自身の advance vs LH state の他者への流入)
  - 5/2 dead-skip hotfix の走行中 only と spawn 計算の dead 包含との asymmetric (= dead の役割の違い、 §4.2)
  - midpoint→mean 移行 + excludeId 撤去 + self 包含の structural elegance
  - type-level kind field の意義 (= ID prefix runtime check の fragility 解消)
- [`design/physics.md §pos.t の物理的意味`](../design/physics.md): 小注追加 「NPC の `pos.t` は human の causality に入力されない」 + 「(α) wall_clock anchor 案は P1 設計柱と矛盾、 不採用」
- [`SESSION.md`](../SESSION.md): 直近の作業要約に commit 群を記録、 Bug 14 propagation race との関係を §既知の課題で更新
- 本 plan ファイル冒頭の Status を `Closed` に更新、 §8 完了基準 check

**dependency**: Stage 1-4 (= 実装完了後に記録)。

### Stage 6: localhost verify + production deploy

**目標**: 全変更 deploy、 odakin 実機 verify。

1. `pnpm dev` 起動、 multi-tab で normal play 確認:
   - LH は通常通り human を追って撃ってくる (= LH の Rule B 不変)
   - human ↔ human の Rule B も動作 (= isNpc(p) が human で false を返すため)
   - 通常 plays では mean と midpoint の挙動差は visual 上不可視
2. console から LH `pos.t` を runaway 値に書き換え:
   ```js
   useGameStore.getState().players.get('lighthouse-0').phaseSpace.pos.t = 1e7;
   ```
   - human の `pos.t` が引っ張られないことを Speedometer / HUD で確認
   - LH は次 tick から「人間の遠い未来」 に飛んだ状態で漂流
3. solo human respawn 確認:
   - solo play で自分死亡 → 10 sec 後 respawn、 `pos.t = death.pos.t + γ × 10` 程度で復活、 worldLine 連続性確認
4. dead human が peer に居る spawn 計算挙動確認:
   - 2-tab で 1 tab 死亡中、 3rd tab 新 join → spawn `pos.t` が dead 含む mean になることを確認
5. `pnpm test` で既存 test pass + 新 test 全 pass
6. `pnpm run typecheck` clean (= `kind` field 型整合)
7. `pnpm run lint` clean
8. `pnpm run deploy`、 build 値取得、 odakin に production URL + build 値を提示
9. odakin 実機 verify (= スマホ + PC 両方)

**dependency**: Stage 1-5。

---

## §8 Test 戦略

### §8.1 Unit test

**新規追加**:
- `lighthouse.test.ts` (= 新規 or 既存 test ファイルの一節): `isNpc(player)` typed predicate、 `createLighthouse` の `kind: 'npc'` 確認
- `respawnTime.test.ts`: §7 Stage 4 の test 追加 (= NPC skip + mean formula + self 包含)

**既存 update**:
- `causalityRules.test.ts`: λ_exit 計算は peer set 構築と独立、 そのまま pass
- `checkCausalFreeze.test.ts`: predicate 形式変更 (= mock player object に `kind` field を追加)、 既存 LH skip case はそのまま pass
- `lighthouseRuleB.test.ts`: 同上
- `messageHandler.test.ts` / `snapshot.test.ts`: new player 生成箇所の `kind` 初期化 path 検証追加 (= LH ID prefix → `kind: 'npc'`、 human → `kind: 'human'`)
- 既存 `respawnTime.test.ts`: midpoint based の expected value を mean に書き直し、 `excludeId` 引数を全 caller から撤去

### §8.2 統合 test (= localhost 目視)

§7 Stage 6 の手順で:
1. **normal multi-tab play**: human ↔ human Rule B 動作、 LH AI が human 撃ち続ける、 全体 UX 不変
2. **LH artificial runaway**: console から LH `pos.t` を 1e7 に直接書き換え、 human が引っ張られないことを Speedometer / HUD で確認
3. **solo human respawn**: solo play で自分死亡 → 10 sec 後 respawn、 `pos.t = death.pos.t + γ × 10` 程度で復活、 worldLine 連続性確認
4. **新 join (= 別 tab) で dead 含む scenario**: 1 tab 死亡中に別 tab 新 join、 spawn `pos.t` が dead を含む mean に anchor

### §8.3 既存 247-253 test pass 維持

[`plans/2026-05-05-network-split-rule-b-runaway.md` §8](2026-05-05-network-split-rule-b-runaway.md) で 253 test (= 5/5 evening 時点) が pass。 本 plan の変更で新 test +6-10 件想定 + 既存 update +5-10 件、 全 pass を維持。

---

## §9 完了基準

- [ ] Stage 1 (`kind` field + `isNpc` typed predicate) commit
- [ ] Stage 2 (causality 経路 predicate 統一) commit
- [ ] Stage 3 (self Rule B で NPC skip) commit
- [ ] Stage 4 (`computeSpawnCoordTime` で NPC skip + mean formula + excludeId 撤去) commit
- [ ] Stage 5 (DESIGN.md + design/physics.md + SESSION.md + plan close 更新) commit
- [ ] 既存 test 全 pass + 新 test 追加分 pass
- [ ] `pnpm run typecheck` clean (= `kind` field 型整合)
- [ ] `pnpm run lint` clean
- [ ] localhost で normal multi-tab play 動作確認
- [ ] localhost で LH artificial runaway 試験で human 非追従確認
- [ ] localhost で solo human respawn の `pos.t = death.pos.t + γ × 10` 確認
- [ ] localhost で dead human が peer に居る場合の spawn 計算挙動確認
- [ ] production deploy + odakin 実機 verify (= スマホ + PC)
- [ ] SESSION.md update + 本 plan を Closed marker

---

## §10 5/2 plan + dead-skip hotfix との関係

### §10.1 plan の系譜 (= 本 plan までの設計遷移)

```
2026-05-02 plan §4.4: alive/stale/dead 統一処理、 「美しい」 と評価
2026-05-02 plan §10.4: LH 特別扱い不要 (= 対称設計に組み込めば自動収束)
       ↓
2026-05-02 dead-skip hotfix: 走行中 Rule A/B から dead を除外 (= §4.4 走行中破棄、 spawn 計算は維持)
       ↓
2026-05-02 ~ 5/6 (経緯不明): checkCausalFreeze に LH skip 混入 (= §10.4 部分破棄、 hotfix 残骸?)
       ↓
2026-05-06 odakin 提案 + 本 plan:
   - (I) NPC 非対称 完成 (= §10.4 残部分の整合化)
   - (II''') mean formula + excludeId 撤去 + self 包含 (= 集約 formula の structural 整備)
   - (III) type-level kind 化 (= ID prefix runtime check の fragility 解消)
```

### §10.2 5/2 plan §4.4 「alive/stale/dead 統一処理」 と本 plan の関係

**5/2 plan §4.4 主張**: alive / stale / dead を `virtualPos = pos + u·τ` の uniform formula で統一、 caller の lastSync 引数だけが状態別に変わる。

**5/2 dead-skip hotfix の影響**: 走行中 Rule A/B から dead を除外、 spawn 計算でのみ dead を inertial 延長で含める asymmetric を採用。 §4.4 uniformity は **走行中で破棄**、 spawn 計算でのみ温存。

**本 plan の選択**: spawn 計算で dead を **virtualPos 経由で寄与** (= 5/2 plan §4.4 を spawn 計算 layer で温存)。 過去 plan 案で「dead を spawn 計算でも skip / 死亡時点固定」 を提案したが、 odakin の 「dead を除外すると時刻 split が広がる」 指摘で撤回。

**残る dead 扱い**:
- alive: virtualPos (= 5/2 §4.4 のまま)
- stale: virtualPos (= 同上)
- dead 走行中: skip (= 5/2 dead-skip hotfix)
- **dead spawn 計算: virtualPos** (= 本 plan で温存)

→ 5/2 §4.4 の uniformity は **alive / stale + dead spawn 計算 限定**で温存、 走行中 Rule A/B のみ dead-skip。 走行中と spawn 計算の dead asymmetric は **dead の役割の違い** から導出される必然 (§4.2 docstring 参照)。

### §10.3 5/2 plan §10.4 「LH 特別扱い不要」 と (I) の関係

**5/2 plan §10.4 主張**: LH を Rule A/B 対称設計に組み込めば自動的に wall_clock-ish 値に収束、 「LH 特別扱い不要」。 LH の advance ロジック (= u=0 で λ_exit = max_P (P.t - dist) が wall_clock-ish) を議論。

**`checkCausalFreeze` LH skip 混入**: 5/2 ~ 5/6 の間に経緯不明の片肺 LH skip が混入、 LH を Rule A から除外。 §10.4 の対称性が **Rule A で破棄**、 但し Rule B + spawn では維持。

**本 plan (I) の追加**: Rule B + spawn でも LH skip を完成、 「NPC = causality 入力に入らない class」 を全 human 経路で整合。

**§10.4 との直交性 (= 重要)**:
- 5/2 §10.4 は **LH 自身の advance ロジック** (= LH が wall_clock にどう追従するか) の議論
- 本 plan (I) は **LH state が他者の causality 入力に入るか** の議論 (= **LH の advance ロジックは不変**、 LH は依然 Rule B で human を追う)
- 両者完全直交。 §10.4 の「LH 特別扱い不要」 結論は **LH 自身の挙動について正しいまま**、 本 plan は他者からの参照を filter する別軸の話

### §10.4 5/2 plan §6 Stage 8 (γ → γ') の連続性

5/2 plan §6 Stage 8 で 4 案 (α/β/γ/δ) から (γ) midpoint を選択した経緯:
- (α) `now wall_clock`: P1 設計柱と矛盾 (= §1.4 + §11.13)、 本 plan で明示却下
- (β) `max(virtualPos)`: Bug 9 旧仕様、 不採用
- (γ) `(min+max)/2` midpoint: 採用、 本 plan で (γ') mean に移行
- (δ) `min(virtualPos)`: 急ジャンプ、 不採用

(γ → γ') の移行は (γ) の延長線上、 cluster center 概念を midpoint から mean に refine。 通常 plays では同値、 outlier scenario で mean が robust。

### §10.5 (III) type-level kind field の独自正当化

(III) は 5/2 plan には対応する議論なし、 本 plan の独自提案:

- 5/2 plan は LH を ID prefix で識別する慣性の上に構築されていた
- ID prefix 識別は historical accident で、 「NPC 仕様」 を type level で表現していなかった
- 本 plan で causality calc semantics を整備するなら、 同 site で type level discriminator も整備するのが cohesive

(III) は (I) の **強化** (= runtime check の fragility 解消) で、 (I) と独立に valid だが同 plan 内で実装するのが最も効率的。

---

## §11 「やらないこと」 (= 過去議論での却下 / 本 plan 範囲外)

将来の自分が再提案しないよう明示。 各項目に **却下根拠 + 将来再開する場合の trigger** を記録。

### §11.1 ✗ `isLighthouse` を完全に `isNpc` で置換

**主張案**: 「現時点で `isNpc(player) = (player.kind === 'npc')` は LH を判別するから、 `isLighthouse(id)` を全廃して `isNpc` 一本にしよう、 単純化」。

**却下根拠 (= 半年後の隕石追加 scenario)**: 単純化に見えるが、 将来 NPC 種が増えた瞬間に **LH-specific 経路が NPC 一般経路に汚染される**。 例えば隕石 NPC を追加して `kind` 値を `'human' | 'lighthouse' | 'asteroid'` に拡張、 `isNpc` を OR 拡張すると:
- 隕石が `LIGHTHOUSE_HIT_RADIUS` で hit 判定 (= 多分隕石は別 radius が欲しい)
- 隕石を kill すると LH と同じ score 加算 (= 設計上同じとは限らない)
- snapshot で隕石の `ownerId` が BH に rewrite される (= 隕石は ownership 不要かも)
- → 「LH 専用」 だった挙動が **NPC 一般に拡張される副作用**

`isLighthouse` (= LH 固有 identity) と `isNpc` (= causality skip 対象 class) は **意味的に別軸**、 一本化すると将来 NPC 拡張時に両者が混ざる risk。

**将来再開する trigger**: NPC = LH のみが永続確定 (= 他 NPC 種を絶対追加しない) と decided な場合、 simplification で merge 可。 但し本 plan range 外 + 「絶対追加しない」 は予測困難。

### §11.2 ✗ LH 自身の Rule A 追加 (= LH の self-freeze)

**主張案**: LH も human と同型に Rule A を持ち、 human の future cone 内に居れば LH が frozen になる (= LH が `pos.t` advance を停止して human の catch up を待つ)。

**却下根拠**: user 言及「灯台自身を永遠に因果律凍結させ続けても誰も困らない」 は **「LH が frozen になっても困らない」 という許容** であって、 「LH に Rule A を追加しろ」 の要求ではない。 LH 現状動作 (= γ=1 で advance し続ける、 自己 freeze なし) で gameplay 上問題は出ていない。

**将来再開する trigger**:
- LH の `pos.t` が long-running session で float precision を圧迫する scale (= 数百年単位) になる事案
- LH を human の wall_clock に同期させたい新 game design 要件
- 上記いずれも現実的でない、 本 plan range で却下確定

### §11.3 ✗ NPC を rendering 経路からも除外

**主張案**: NPC は描画もしない / hit detection もしない (= 完全 ghost 化)、 因果律入力からの除外と一貫性を保つ。

**却下根拠**: 本 plan は **causality 計算 (Rule A/B/spawn) からの入力 filter のみ**。 NPC は依然として physics object として存在 (= human が観測する / kill する / interact する対象)。 「causality 入力」 と「物理 entity」 は別レイヤー、 本 plan は前者のみ介入。

**将来再開する trigger**: NPC の存在自体を消す game design 変更 (= 別 game の話)。

### §11.4 ✗ NPC の broadcast 停止

**主張案**: NPC state を broadcast / snapshot に乗せない、 各 peer が local で NPC を生成。

**却下根拠**: NPC は **shared world state**。 host が NPC AI を駆動し state を broadcast するのは Authority 解体 Stage F 以降の確立済アーキテクチャ。 NPC state を local 生成にすると determinism 維持 (= host migration / 新 joiner snapshot) が破綻、 設計 inversion。

**将来再開する trigger**: 帯域節約が critical になる large-scale multiplayer 化 (= 100+ peer)、 別 plan で検討。

### §11.5 ✗ NPC を kill / score 経路から除外

**主張案**: NPC は kill 不能 / kill されてもスコア加算なし (= 完全 environment 化)。

**却下根拠**: LH を kill する gameplay (= 現状の +N score 加算) は意図的 design。 user の「NPC は human の causality 入力に入らない」 は **causality semantics の話**で、 score / kill semantics とは別軸。

**将来再開する trigger**: NPC を non-targetable (= kill 不能) 化する game design 変更。 別 plan。

### §11.6 ✗ Rule B λ cap 導入 (= 別 plan 範囲)

**主張案**: Rule B の λ を per-tick cap (= `MAX_LAMBDA_PER_TICK = 100 ls` 等) で抑制、 catastrophic single-tick jump を防ぐ。

**却下根拠**: 5/2 plan §6 Stage 6 で「hidden 復帰時の convoy 合流は Rule B が 1 回の大 λ jump で完了」 が **意図的設計**。 λ cap は legitimate な hidden→visible 復帰 catchup を壊す。 本 plan で NPC 経路の伝染は構造的に断たれるため、 残る human ↔ human 軸の防衛は別 plan (= L0 dTau cap + L1 plausibility filter) で対処。

**将来再開する trigger**: human ↔ human 軸の伝染が L0 + L1 でも防げない事案、 最終手段として検討。

### §11.7 ✗ NPC の Rule B も撤廃 (= LH も human を追わない)

**主張案**: 「対称性」 を取り戻すため、 NPC を全 causality 計算から完全除外 (= LH も human の状態に依存しない、 LH は wall_clock-based に独立 advance のみ)。

**却下根拠**: user 提案「**因果律跳躍に関しては、 灯台を因果律跳躍させるのだけを実装すればいい**」 で明示的に **LH の Rule B (= human 追従) は維持する**と言われている。 LH が human を追わないと、 LH が wall_clock advance のみで human と離れて gameplay 不能 (= LH が遠い過去 / 未来に置き去り、 laser が届かない)。

**将来再開する trigger**: なし。 design intent と矛盾。

### §11.8 ✗ NPC を `staleFrozenIds` に自動投入 (= filter 経路の流用)

**主張案**: 既存の `staleFrozenIds` 機構を流用し、 NPC を session 開始時に staleFrozenIds に投入する。

**却下根拠**: semantics の混濁。 `staleFrozenIds` は「broadcast 受信が止まった peer の隔離」 という機能で、 ライフサイクル (= `markStale` / `recoverStale` / `cleanupPeer`) と密結合。 NPC を投入すると recoverStale が誤って NPC を通常 peer 化する race、 「stale だから skip」 と「NPC だから skip」 を区別できない、 等の問題。 predicate を 1 個追加するだけ (`isNpc`) のほうが疎結合 + semantics clean。

**将来再開する trigger**: なし。 設計違反。

### §11.9 ✗ NPC pos.t を observer の pos.t に強制 sync

**主張案**: NPC を observer から見て常に「現在の自分」 と同じ `pos.t` で render。

**却下根拠**: 物理的 incoherent。 NPC は light cone に従って observation される entity であり、 observer の now を強制 sync すると「光の速度を超えて NPC が観測される」 ことになり、 ゲームの relativity premise が破綻。

**将来再開する trigger**: relativity-free な game mode を別途追加する場合 (= 別 game)。

### §11.10 ✗ `isNpc` を config flag / runtime 切替に

**主張案**: `isNpc(player)` の動作を config / URL hash override で切り替え可能にする。

**却下根拠**: YAGNI。 「NPC 非対称」 は本 plan で固定 design として確立、 切り替え可能にすると test surface 倍増 + 設計史が混乱する。 必要なら revert で十分、 flag 化は無駄。

**将来再開する trigger**: A/B test で挙動を比較したい運用要件。 現状そのような要件なし。

### §11.11 ✗ NPC の Rule A も追加 (= NPC が自分の future cone に居る human で freeze)

**主張案**: §11.2 の延長で、 NPC にも Rule A を追加し、 human が NPC の future cone に居れば NPC を freeze。

**却下根拠**: §11.2 と同根。 LH 現状動作で gameplay 問題なし。 加えて、 LH Rule A を実装すると「LH が freeze するけど laser は撃てる?」 等の半端 state 設計が発生、 game design 上 unwanted complexity。

**将来再開する trigger**: §11.2 と同。

### §11.12 ✗ dead を spawn 計算から完全除外 / 死亡時点固定

**主張案**: 走行中 dead-skip hotfix の direction を spawn 計算にも完成させ、 dead を spawn 計算からも除外 (= α 案)、 もしくは死亡時点 `phaseSpace.pos.t` 固定 (= β 案 = 過去の (II'') 提案)。

**却下根拠**: odakin 議論で「**dead を除外すると alive と dead の時刻 split が systemic に広がる、 dead の virtualPos 寄与で cluster 同期維持される**」 と判明。 5/2 plan §4 「死者の二本世界線モデル」 を causality calc layer で温存し、 走行中と spawn 計算の dead asymmetric を **dead の役割の違い** から正当化する選択 (§4.2 docstring 参照)。

**将来再開する trigger**:
- 「dead を inertial 延長で扱う」 が gameplay 上 problematic な場面が発覚 (= 例: dead.γ = 1.89 が長時間続く長 session で systemic 問題)
- 別 design choice (= dead を死亡時点固定で render も含めて統一) を試す game mode

### §11.13 ✗ (α) wall_clock anchor 案 (= 5/2 plan §6 Stage 8 plan 推奨だった案)

**主張案**: 5/2 plan §6 Stage 8 で plan 推奨だった「(α) `now wall_clock` 自分基準」 を採用、 spawn pos.t は self の wall_clock 経過値とする。

**却下根拠**: P1 設計柱 ([`design/physics.md`](../design/physics.md) §pos.t の物理的意味、 「動いた人ほど `pos.t` が未来に進む」) と本質矛盾。 wall_clock は固有時と同期しているため、 self の wall_clock 値を spawn pos.t に流用すると proper time / coord time の混同になる。 5/2 plan §10.1 ✗「pos.t = wall_clock 同期」 と同じ却下対象 (= 「Claude が複数回再発した誤った fix 提案」 と physics.md で明記)。

**将来再開する trigger**: なし。 P1 設計柱を破棄する game design pivot がない限り、 (α) は永続的に invalid。

---

## §12 Bug 14 propagation race との関係

### §12.1 NPC 非対称 + mean formula で消える伝染経路

Bug 14 (= [SESSION.md 既知の課題](../SESSION.md)) で議論した propagation race の伝染経路:

1. **runaway peer の `pos.t` が新 joiner の spawn 時刻 anchor になる** (= midpoint formula で max に full pull)
2. **runaway peer が self の Rule B target になる** (= self が runaway peer の過去 cone 内 → forward jump)

本 plan で:
- **runaway peer = LH**: (I) で完全遮断 (= human の Rule B + spawn 計算で LH 除外)
- **runaway peer = alive human**: (II''') mean formula で **partial 防御** (= 1/N 重みで pull、 midpoint より robust だが完全防御ではない)

完全防御は別 plan の **L1 plausibility filter** (= human runaway 検出 + 隔離) で対処。

### §12.2 真因 isolation との関係

Bug 14 真因 (= 700x speedup の発生機構) は本 plan 完了後も未確定のまま残る。 本 plan は **「真因不明でも LH 経路の伝染遮断 + alive human runaway への partial defense」** という defense-in-depth の一部で、 Bug 14 root cause fix とは独立に着手可能。

優先順位 (= odakin 確認待ち):
1. **本 plan (= NPC + spawn formula 整備)** — 最も clean、 risk 低、 設計原理として永続価値あり
2. Bug 14 真因 isolation (= overnight repro 取得 + worldLine.history 解析)
3. L0 dTau cap + visibility listener (= 真因 isolation 後に focus 絞って実装)
4. L1 plausibility filter (= human runaway への defense、 真因不明でも有効)

---

## §13 References

- [`plans/2026-05-02-causality-symmetric-jump.md`](2026-05-02-causality-symmetric-jump.md) — 対称設計の正本、 §4.4 (alive/stale/dead 統一) と §10.4 (LH 特別扱い不要) と §6 Stage 8 ((α/β/γ/δ) 案検討) が本 plan との関係 §10
- [`plans/2026-05-05-network-split-rule-b-runaway.md`](2026-05-05-network-split-rule-b-runaway.md) — Rule B 暴走 RCA、 staleFrozenIds 拡張の前例、 hook test infra defer の方針
- [`DESIGN.md`](../DESIGN.md) §因果律対称化 + WebGL recovery + asymmetric 設計 (= dead-skip hotfix)
- [`design/physics.md`](../design/physics.md) §pos.t の物理的意味 (= P1 設計柱、 (α) 不採用根拠)
- [`SESSION.md`](../SESSION.md) Bug 14 (= NPC 非対称 + mean formula が射程内に持つ propagation race の遮断経路)
- [`src/components/game/lighthouse.ts`](../src/components/game/lighthouse.ts) — `isLighthouse` 既存、 `isNpc` 追加先
- [`src/components/game/types.ts`](../src/components/game/types.ts) — `RelativisticPlayer` 型、 `kind` field 追加先
- [`src/components/game/respawnTime.ts`](../src/components/game/respawnTime.ts) — spawn 時刻計算、 (I) NPC skip + (II''') mean formula + excludeId 撤去の中心 site
- [`src/components/game/virtualWorldLine.ts`](../src/components/game/virtualWorldLine.ts) — `virtualPos` + `lastSyncForDead`、 spawn 計算の dead 経路で引き続き使用
- [`src/hooks/useGameLoop.ts`](../src/hooks/useGameLoop.ts) — self の Rule B (= (I) site) + respawn caller signature 更新
- [`src/components/game/gameLoop.ts`](../src/components/game/gameLoop.ts) — `checkCausalFreeze` + `processLighthouseAI` (= predicate 統一 site)

---

## §14 odakin 確認結果 + 残課題

### §14.1 確認済 (= 2026-05-06 session)

1. ✅ **(I) NPC 非対称**: 元提案、 進める
2. ✅ **(II''') mean formula + excludeId 撤去 + self 包含**: midpoint→mean、 self を virtualPos で寄与、 fallback 構造が自然消滅。 dead は 5/2 plan §4 通り virtualPos 経由で寄与 (= 過去 plan 案の (II) / (II'') は撤回)
3. ✅ **(III) type-level kind field**: `RelativisticPlayer.kind: 'human' \| 'npc'` 追加、 wire format 不変で backward compat 完璧、 中規模 refactor (= 5-7 site touch) で本 plan に統合
4. ✅ **§11.1 `isLighthouse` 維持**: `isNpc` と意味的に別軸、 統合しないことを §11.1 で明示
5. ✅ **§11.13 (α) wall_clock anchor 不採用**: P1 設計柱と矛盾、 永続却下を §1.4 + §11.13 で記録
6. ✅ **Stage 順序**: §7 の 1→2→3→4→5→6 で進行。 mid-deploy なし
7. ✅ **render layer 不変**: DeathMarker / DeadShipRenderer / deathWorldLine.ts 等 touch せず、 5/2 plan §4 を render layer の正本として温存

### §14.2 着手前の self-check

実装着手時、 以下を順に確認:
- [ ] `design/physics.md §pos.t 物理的意味` (= P1 設計柱) を読み直し、 (α) 不採用根拠を内面化
- [ ] [DESIGN.md §asymmetric 設計](../DESIGN.md) の dead-skip hotfix 経緯を読み直し、 走行中 dead-skip と spawn 計算 dead 包含の asymmetric を理解
- [ ] 5/2 plan §10.4 (= LH 特別扱い不要) と本 plan §10.3 を読み返し、 直交性の議論で言葉を sloppy にしないこと
- [ ] 5/2 plan §4.4 (= alive/stale/dead 統一) と本 plan §10.2 を読み返し、 spawn 計算で dead を virtualPos 寄与させる根拠を再確認

### §14.3 implementation 中に判断保留する案件

- **§5.2 solo respawn UX**: solo play で死後 respawn 時 `pos.t = death.pos.t + γ × 10` で復活、 体感的に違和感あれば微調整検討。 localhost で確認、 違和感なければそのまま
- **§5.5 multi-LH 将来案**: 1 LH 前提を本 plan 内では維持、 multi-LH 化が必要になったら別 plan
- **`computeSpawnCoordTime` の `killLog` 引数**: dead 経路で `lastSyncForDead` 経由で使用、 引数として保持
- **`createRespawnPosition` の wrapper 削除検討**: signature が `computeSpawnCoordTime` と同じになるため wrapper の意味が薄れるが、 spatial random の責務分離として残す方針 (= 別 PR で merge 検討の余地)
