# Plan: player.isDead の二重管理を解消 — explicit field 削除 + selectIsDead derive 唯一

**起草**: 2026-05-04 (v1)
**v2 update**: 2026-05-04 同 session で実装着手前に refresh — 同 session 内 staleFrozenIds 解消で得た methodology を反映、 性能 (a) / wire (C) / Stage 細分の 3 軸を確定。
**Status**: 🟢 v2 確定、 同 session で実装着手
**動機**: 2026-05-04 myDeathEvent decomposition refactor の audit で発見した同 class の二重管理 (= meta-principles M25)。 真因 pattern は同じ「同じ事実を 2 箇所に持つ」 設計。 同 session 内で staleFrozenIds の三重二重管理も解消済 (= [`2026-05-04-stalefrozen-decomposition.md`](2026-05-04-stalefrozen-decomposition.md))、 本 plan は M25 application の **3 件目**。

## §1 現状の二重管理

### explicit field (= drift 源)

`src/components/game/types.ts`:
```ts
export interface RelativisticPlayer {
  // ...
  isDead: boolean;  // explicit field
  // ...
}
```

### derive (= source of truth)

`src/stores/game-store.ts`:
```ts
export const selectIsDead = (state: LogState, playerId: string): boolean => {
  // killLog の最新 victim 時刻 > respawnLog の最新 player 時刻 なら true
  // ...
};
```

### 流入経路で個別 set される箇所

| 場所 | set 文 |
|---|---|
| `killRespawn.ts:14` | `next.set(victimId, { ...victim, isDead: true })` (= applyKill) |
| `lighthouse.ts:58` | `isDead: false` (= LH 初期化) |
| `messageHandler.ts:220` | `isDead: false` (= player 受信時) |
| `snapshot.ts:218` | `isDead: sp.isDead` (= snapshot から copy) |
| `snapshot.ts:327` | `if (derivedDead !== p.isDead) override` (= **強制同期 patch、 二重管理の貼り絆 sign**) |
| `game-store.ts:563, 572` | `isDead: false` (= handleSpawn 等) |

### 真因の証拠 (= 強制同期 patch の存在)

`snapshot.ts:322-330`:
```ts
const lastKillByVictim = new Map<string, number>();
// ...
const lastRespawnByPlayer = new Map<string, number>();
// ...
for (const [id, p] of nextPlayers) {
  const kTime = lastKillByVictim.get(id);
  const derivedDead =
    kTime !== undefined &&
    kTime > (lastRespawnByPlayer.get(id) ?? -Infinity);
  if (derivedDead !== p.isDead) {
    nextPlayers.set(id, { ...p, isDead: derivedDead });  // ← 強制同期
  }
}
```

これは「explicit field が drift しても derive を真とみなして上書き」 = derive が真の source of truth だが、 explicit field が cache 役で残されている **二重管理の典型**。

## §2 真の根本治療 (= meta-principle M25 application)

### 設計

- `RelativisticPlayer.isDead` field を **削除**
- 全 read 箇所 (= 25+ 箇所) を `selectIsDead(state, player.id)` 経由に書き換え
- snapshot.ts の強制同期 patch 撤去 (= 不要)
- 各 set 文も削除 (= explicit field なくなるので)

### 影響範囲 (= grep で発見済)

#### 読み込み箇所 (= 25+ 箇所)

- `gameLoop.ts:316, 373, 592` (= Rule A/B / processOtherPlayerPhysics の dead skip)
- `useGameLoop.ts:559` (= dead-skip hotfix)
- `LighthouseRenderer.tsx:142, 163, 405` (= LH dead routing)
- `SceneContent.tsx:187, 312, 459, 474, 616, 716` (= ship rendering / past-cone gate)
- `HUD.tsx:58, 64, 106` (= HUD swap + Speedometer gate)
- `worldLineGap.ts:58` (= pushFrozenWorldLine guard)
- `Speedometer.tsx:39` (= 死亡中表示 hide)
- `respawnTime.ts:68` (= virtualPos lastSync routing)
- `messageHandler.ts:166, 199` (= worldLine reset guard)
- 他

#### 書き込み箇所 (= 削除対象)

- `killRespawn.ts:14` (= applyKill)
- `messageHandler.ts:220` (= 新 player init)
- `lighthouse.ts:58` (= LH init)
- `snapshot.ts:218, 327` (= snapshot apply)
- `game-store.ts:563, 572` (= handleSpawn 等)
- `types.ts:141` (= field 定義)
- `message.ts:185` + `snapshot.ts:82` (= broadcast / type 定義)

#### Broadcast 互換性 (v2 確定: 選択 (C))

**事実確認**: wire format で isDead を含むのは **snapshot message のみ** ([`message.ts:185`](../src/types/message.ts))。 phaseSpace message には isDead 無し ([`message.ts:24-34`](../src/types/message.ts))。 影響範囲は snapshot 越境の 1 経路のみ。

**選択肢**:
- (A) field 削除 + protocol 維持 (= broadcast には書き込み続けるが ignore、 但し旧 client が誤動作する risk)
- (B) field 削除 + protocol 廃止 (= 新旧 protocol 互換性 break、 sentinel + version negotiation 等)
- (C) **field は wire format として維持、 但し internal state では derive 唯一** ← **採用**

**(C) の具体動作**:
- **buildSnapshot 送信時**: `isDead: p.isDead` (= [snapshot.ts:125](../src/components/game/snapshot.ts) の現状) → `isDead: selectIsDead(s, p.id)` に変更 (= 送信値は derive で確定値、 旧 client は normal に処理)
- **applySnapshot 受信時**: `isDead: sp.isDead` (= [snapshot.ts:218](../src/components/game/snapshot.ts) の現状) → 行を削除 (= internal RelativisticPlayer に field 無し、 wire 受信値は ignore)、 isDead は merged killLog / respawnLog から自動 derive
- **強制同期 patch** ([snapshot.ts:322-330](../src/components/game/snapshot.ts)): 完全撤去 (= 二重管理消滅で原理的に drift 不可能)

旧 client は wire の isDead を従来通り使う、 新 client は wire の isDead を ignore してログから derive — **両者が同じ source (= killLog/respawnLog) を merge する** 限り isDead 結論は一致するため、 protocol 互換性問題は発生しない。 段階移行不要。

## §3 Stage (v2 確定: atomic refactor、 staleFrozenIds と同 pattern)

staleFrozenIds が 1 commit atomic で完了したのと同様、 isDead も atomic refactor 推奨。 中間状態 (= 一部 derive / 一部 explicit) は 二重管理が並存する不安定 state。 stage 分割は review 単位として、 commit 単位は atomic。

| Stage | 内容 |
|---|---|
| 1 (本 plan v1+v2) | 文書 ✅ |
| A | 全 read site (≈ 32) を `selectIsDead(state, id)` または `deadIds.has(id)` (= per-tick 集約) に書き換え (= read API 統一、 まだ field 削除しない) |
| B | `RelativisticPlayer.isDead` field 削除 + 全 write site (`isDead: ...` 7 箇所) 削除 + snapshot.ts 強制同期 patch (322-330) 撤去 + buildSnapshot で `selectIsDead` 経由送信 + applySnapshot で wire isDead を ignore |
| C | typecheck + 全 test pass + SESSION update + atomic commit + push |
| D | 実機検証 (= 5+ 分 multi-tab plays、 死亡 / 復活 / snapshot 経由 join / migration) → 問題無ければ deploy |

**工数 v2 見積り**: Stage A-C で 1-2 h (= staleFrozenIds が 30 分で完了したことから補正、 v1 の 4-6h は read 30+ 箇所を順次 stage 化する想定だった、 atomic だと grep + sed-like edits で済む)。

## §4 性能設計 (v2 確定: (a) per-tick `deadIds: Set<string>` 採用)

### selectIsDead の cost

derive 関数は killLog / respawnLog を走査するため O(killLog + respawnLog)。 既存制限: `MAX_KILL_LOG = 1000` + `MAX_RESPAWN_LOG = 500`、 worst case 1500 entry 走査 (= [`constants.ts:281-282`](../src/components/game/constants.ts))。

**選択肢**:
- (a) hot path 用に **`selectDeadPlayerIds(state): Set<string>` を tick 開始時に 1 回 evaluate** + 関数末尾まで使い回す — single read を Set membership check に変換
- (b) `selectIsDead` 内部で memoize (= log version 比較 cache)

**v2 採択: (a)**。 理由:
- `selectDeadPlayerIds` は **既に存在** ([`game-store.ts:782`](../src/stores/game-store.ts))、 [`useGameLoop.ts:776`](../src/hooks/useGameLoop.ts) の hit detection で **既に同 pattern が確立**
- (b) memoize は cache invalidation の複雑性を持ち込む割に payoff が小、 (a) で十分
- React component / 単発 check (= 自機の isDead を 1 回 read) では `selectIsDead(state, id)` 直呼び O(1500) で安、 60Hz × 1 read = 90 KOps/sec で問題無し

### read API 使い分け

| 状況 | API |
|---|---|
| hot path tick 内 全 player ループ (例: gameLoop processOtherPlayerPhysics) | tick 開始時 `const deadIds = selectDeadPlayerIds(state)`、 ループ内 `deadIds.has(player.id)` |
| 単発 check (例: 自機 dead 判定 1 回) | `selectIsDead(state, myId)` 直呼び |
| React component render (例: SceneContent / HUD) | `useGameStore((s) => selectIsDead(s, playerId))` で reactive subscribe (= 既存 player object 監視と同等の re-render 頻度) |
| event handler 内 (例: handleKill internal guard) | `selectIsDead(state, victimId)` 直呼び (= 既存 game-store.ts:477 等で確立済 pattern) |

### useGameLoop の既存 pattern

useGameLoop.ts で既に `currentIsDead = selectIsDead(store, myId)` ([line 195](../src/hooks/useGameLoop.ts:195)) を使っている (= 2026-05-04 myDeathEvent decomposition で導入)。 同 pattern を全 component に展開、 加えて hot path では `selectDeadPlayerIds` の 1 tick 1 derive pattern を採用。

### React render での再 derive

React component 内で `selectIsDead` を毎 render 呼ぶと、 killLog / respawnLog subscribe で re-render trigger。 これは既存挙動と同等 (= player.isDead が変わると Map の player object 新参照になり re-render)。 性能 neutral。

## §5 plan に含めなかった事項 (v2 で再 audit 済)

- **broadcast wire format からの isDead 削除**: §2 (C) で wire 維持を確定したため、 削除は不要 (= 旧 client 互換性が保たれ、 段階移行 Phase 2 も発動しない)
- **関連 derive selector 群**: `selectInvincibleIds` / `selectDeadPlayerIds` / `selectInvincibleUntil` / `selectPostHitUntil` を再 audit (v2)。 全て **derive 唯一** で explicit field の並存無し (= grep で `RelativisticPlayer.invincibleUntil` 等の field 存在確認、 結果 0 件)。 hedge 表現「audit 不要」 を撤去、 **verified 済** と明記

## §6 staleFrozenIds との関係 (v2 追加)

同 session 内で同 class の二重管理を 2 件解消 (= myDeathEvent → staleFrozenIds → 本 plan = isDead)、 M25 application の累積実例。 staleFrozenIds で得た sub-原則を本 plan に転用:

- **絆創膏 sign 数 = severity** (= [meta-principles.md M26 サブ原則](../design/meta-principles.md)): isDead は sign 1 (= snapshot.ts L327 強制同期 patch)、 reach 30+ で工数 / reach トレードオフが立つ。 staleFrozenIds (= sign 2 / reach 5) を先に処理した判断が正しかった
- **explicit duplication の正当性チェックリスト** (= [meta-principles.md M25 サブ原則](../design/meta-principles.md)): 本 plan の対象 (isDead) は **derive 可能** なため explicit duplication ではなく、 純粋に M25 本則 (= derive 唯一化) で解消する。 staleFrozenIds は derive 不能 (= ref ↔ store mirror) で sub-原則の 3 条件 (mutation 集約 / drift detection 不在 / ad-hoc 散在無し) を pass する設計に refactor したのと対照的
- **mutation centralization が drift 防止の鍵**: isDead では `applyKill` / `handleSpawn` 等の log 操作関数が log を mutate、 isDead は log から 100% derive のため log の mutation centralization で十分 (= 既に gcLogs / firePendingKillEvents 等で集約)

## §7 trigger 条件 (= un-defer、 v2 で activated)

v1 で 「LorentzArena の active dev で観察されたら priority up」 と書いたが、 v2 で **同 session 内 active dev** が成立 (= myDeathEvent + staleFrozenIds を同 session で解消、 isDead は同 class M25 違反の累積 3 件目)。 trigger 条件 satisfied、 即着手。
