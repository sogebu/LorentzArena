# Plan: staleFrozenIds 三重二重管理の構造的解消

**起草・実装**: 2026-05-04
**Status**: ✅ 完了 (= 1 セッションで起草 + 全 Stage 実装 + test 全 pass)
**動機**: 2026-05-04 myDeathEvent decomposition + isDead audit の流れで発見した同 class の二重管理 (= meta-principle M25)。 しかも単一場所に **3 つの違反が積層** していた。

## §1 発見の経緯

`player.isDead` 二重管理 plan 起草 (= [`2026-05-04-isdead-decomposition.md`](2026-05-04-isdead-decomposition.md)) の audit pass で「 `staleFrozenIds` も二重管理候補」 として発見。 当初は「ref ↔ store mirror は M14 pattern (= hot path 性能のための正当な複製) で正当化済」 と判定して defer に登録予定だったが、 user 指示で深掘りした結果 **絆創膏 sign が 2 箇所 (= isDead より多い)** あり、 構造として M25 違反と再認定。

## §2 三層に積層していた違反

### 違反 1: ref ↔ store mirror の二重保持 (= 主因)

- **正本**: `useStaleDetection.staleFrozenRef: Set<string>` (= hot path で tick 毎読み)
- **mirror**: `useGameStore.staleFrozenIds: ReadonlySet<string>` (= `buildSnapshot` 等の zustand-only コンテキストから読むため)
- **絆創膏 sign**: [`useStaleDetection.ts:106-121`](../src/hooks/useStaleDetection.ts) で「毎 tick stored ↔ cur を size + 全 id 比較、 drift してたら syncStoreMirror() 呼ぶ」 = M26 「症状検知 → 別 path で吸収」 の典型
- **drift 源**: 5 箇所 ad-hoc `staleFrozenRef.current.delete(id)` (= [`messageHandler.ts:148, 327, 351`](../src/components/game/messageHandler.ts) + [`RelativisticGame.tsx:122`](../src/components/RelativisticGame.tsx) + [`useGameLoop.ts:834`](../src/hooks/useGameLoop.ts)) が mirror sync を skip → 毎 tick checkStale で self-heal、 という暗黙契約
- **真因**: 「mutation 経路が ad-hoc + 同期非同期」 という設計バランスの破綻

### 違反 2: `staleFrozenRef` (Set) と `staleFrozenAtRef` (Map) の内部 dual

- 同 hook 内で 2 ref が **同じキー集合** を保持義務:
  - `staleFrozenRef: Set<string>` (= 「stale か」 を表現)
  - `staleFrozenAtRef: Map<string, number>` (= 「いつ stale 化したか」、 GC 閾値判定用)
- **絆創膏 sign**: [`useStaleDetection.ts:55-61`](../src/hooks/useStaleDetection.ts) で「毎 tick `if (Map.size > Set.size) drift prune`」 (= 外部 ad-hoc delete が Set だけ消して Map を残す事故の self-heal)
- **構造的冗長**: `staleFrozenAtRef` (Map) のキー集合だけで `staleFrozenRef` (Set) を表現可能。 後者は完全に冗長

### 違反 3: ad-hoc delete の散在 (= 違反 1+2 の帰結)

- 5 箇所が `staleFrozenRef.current.delete(id)` を直呼び。 各箇所で「ref のみ触り mirror 同期は checkStale 任せ、 staleFrozenAtRef は drift prune 任せ」 という暗黙契約を 3 文書に分散して理解する必要 = 設計負債

## §3 修正設計

### Step 1 (違反 2 解消): `staleFrozenRef` 廃止、 Map 単独化

- `staleFrozenAtRef: Map<string, number>` を **単一 source of truth** に
- キー集合 = 「stale な peer 集合」、 値 = 「frozenAt wallTime」
- `.has(id)` で stale 判定、 `.get(id)` で時刻取得、 `.set(id, time)` で追加、 `.delete(id)` で削除
- drift prune ループ撤廃 (= 内部 dual 自体が消えるため不要)

### Step 2 (違反 1 解消): mutation 即 sync で drift 不可避化

- `recoverStale` / `cleanupPeer` / `checkStale` の各 mutation 経路で `syncStoreMirror()` を即呼び
- `if (had) syncStoreMirror()` で「実際に変更があった場合のみ sync」 (= 非 stale peer に対する recoverStale 呼び出しは no-op)
- `checkStale` 内では「本 tick で何かを add した場合のみ最後に 1 回 sync」 (= mutation を bool flag で集約)
- drift detection patch 撤廃 (= 原理的に drift が起きない)

### Step 3 (違反 3 解消): API 統一

- `MessageHandlerDeps.staleFrozenRef: MutableRefObject<Set<string>>` → `recoverStale: (id: string) => void` に変更
- 5 callsite の生 `delete()` を全部 `stale.recoverStale(id)` 経由に
- `recoverStale` は冪等 (= 非 stale peer に対しては no-op + sync skip) なので `.has()` guard 不要

### 副次効果: lastCoordTimeRef も整合的に reset

- 旧 ad-hoc delete は `staleFrozenRef` のみ消し、 `lastCoordTimeRef` (= rate-based 再判定 baseline) は残していた
- 新経路は `recoverStale` 経由で `lastCoordTimeRef` も clear (= S-4 reset)、 stale 復帰時の「即座再 stale 判定」 をより堅牢に
- 影響 5 site で behavioral diff 検証済:
  - msgHandler:148 (stale 復帰): line 182 で即座再 set されるため net no-op
  - msgHandler:327 (respawn): peer fresh start なので clear 望ましい
  - msgHandler:351 / useGameLoop:834 (kill): victim は dead で stale 対象外なので無関係
  - RelativisticGame:122 (LH init): LH は stale 対象外 (`isLighthouse(id)` skip) で無関係

## §4 影響範囲

| file | 変更内容 |
|---|---|
| [`useStaleDetection.ts`](../src/hooks/useStaleDetection.ts) | 全面 rewrite: Map 単独化 + mutation 即 sync + drift prune / drift detection 撤廃 |
| [`messageHandler.ts`](../src/components/game/messageHandler.ts) | deps 型 + 3 callsite を `recoverStale` 経由に |
| [`messageHandler.test.ts`](../src/components/game/messageHandler.test.ts) | mock を `recoverStale: vi.fn()` に |
| [`RelativisticGame.tsx`](../src/components/RelativisticGame.tsx) | LH init delete + messageHandler deps 渡しを `recoverStale` 経由に |
| [`useGameLoop.ts`](../src/hooks/useGameLoop.ts) | self-kill 経路の delete を `recoverStale` 経由に |
| [`game-store.ts`](../src/stores/game-store.ts) | `staleFrozenIds` docstring を新 architecture に update |

合計 6 file、 atomic refactor。 Wire format 影響無し (= 完全に internal state)。

## §5 検証

- typecheck: pass
- 既存 248 test 全 pass (= 新規 test 追加無し、 構造的 refactor で behavioral 等価のため)
- 実機検証: multi-tab で「stale 化 → 復帰」 のサイクルを確認 (= 5+ 分 1 tab を hidden、 復帰時に通常 phaseSpace 経路で stale 解除されるか)。 dev server / deploy 後

## §6 抽出される一般原則 (= meta-principle 確認)

1. **M25 application 反復**: 当 commit は myDeathEvent decomposition の同 class 違反、 同 session 内で 2 件目。 「audit pass で発見 → 重複の絆創膏 sign 数で severity 判定 → 即修正」 の cycle が固まりつつある
2. **ref ↔ store mirror の正当性は弱い**: M14 pattern として「hot path 性能のため」 と docstring で正当化されがちだが、 mutation 経路が散在すると drift 不可避。 「mutation 経路を 1 関数に集約 + その関数で sync 呼び出し」 が単純解
3. **絆創膏 sign 数 = severity**: 単一二重管理に絆創膏 sign が複数積層していたら、 reach が小さくても優先度高 (= 「設計負債が積み上がっている sign」)。 `isDead` (1 sign / 30 callsite) と `staleFrozenIds` (2 sign / 5 callsite) で reach は逆だが、 構造的負債は staleFrozenIds の方が高かった

## §7 次の audit 候補 (= 本 plan で発見)

audit 中に見つけた、 **二重管理ではないが構造的に紛らわしい cache** を memo (= 別 task で再評価の候補):

- `scores` explicit cache: 「observer-relative 加算」 のため derive 不可能、 設計 intended ([`game-store.ts:277-279`](../src/stores/game-store.ts) に rationale 既設)、 二重管理ではない
- LH `lastSync`: 5/4 Fix A で「単一 source の管理 bug」 と認定済 (= 二重管理ではなく semantic 矛盾)、 解消済
