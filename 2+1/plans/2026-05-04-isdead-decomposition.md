# Plan: player.isDead の二重管理を解消 — explicit field 削除 + selectIsDead derive 唯一

**起草**: 2026-05-04
**Status**: 🟡 Plan only、 着手予定なし (= 別 task として記録)
**動機**: 2026-05-04 myDeathEvent decomposition refactor の audit で発見した同 class の二重管理 (= meta-principles M25)。 真因 pattern は同じ「同じ事実を 2 箇所に持つ」 設計。

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

#### Broadcast 互換性

`message.ts` で `isDead` が phaseSpace message + snapshot にも含まれている。 broadcast プロトコルから削除すると旧 client 互換性影響。

選択肢:
- (A) field 削除 + protocol 維持 (= broadcast には書き込み続けるが ignore、 但し旧 client が誤動作する risk)
- (B) field 削除 + protocol 廃止 (= 新旧 protocol 互換性 break、 sentinel + version negotiation 等)
- (C) field は data field として維持 (= broadcast 用 wire format)、 但し internal state では derive 唯一

(C) が最 minimum invasive: broadcast 越境では isDead を含める (= wire format)、 受信側で merge 時に **無視** (= log だけ merge、 derive で再構築)、 internal RelativisticPlayer から `isDead` field を削除 (or `_legacy_isDead` 等で deprecation marker)。

但し旧 client は `RelativisticPlayer.isDead` を read 続けるので互換性問題。 → 段階移行:
1. 新 client は internal で derive、 wire format には依然送る (= 旧 client 互換)
2. 旧 client が消えたら wire format からも削除

## §3 Stage

| Stage | 内容 | 工数 |
|---|---|---|
| 1 (本 plan) | 文書 | done |
| 2 | grep で全 read 箇所列挙 + selectIsDead 化方針 (= helper 関数 / hook 経由 等) decision | 中 |
| 3 | 全 read 箇所 selectIsDead 化 (= component / utility 順次) | 大 |
| 4 | RelativisticPlayer.isDead field 削除 (= internal type のみ)、 wire format 維持 | 中 |
| 5 | snapshot.ts 強制同期 patch 撤去 + write 箇所削除 | 中 |
| 6 | 全 test 全 pass + user 実機検証 | 中 |

総工数 4-6 時間程度。 1 セッションで完了可能だが reach 大、 separate session で集中して進める。

## §4 注意点

### selectIsDead の cost

derive 関数は killLog / respawnLog を走査するため O(killLog + respawnLog)。 hot path (= gameLoop tick 内) で全 player 各 tick 呼ばれると累積 cost 増。 既存実装は player.isDead の O(1) read。

**対策**: 
- `selectIsDead` 内部で memoize (= killLog / respawnLog の version で cached)
- or hot path 用に「全 player の isDead を 1 回 derive して Map 化」 helper、 tick 内で複数回 read を 1 回に集約
- いずれにせよ性能設計が必要、 single read を hot path に複数挿入する naive impl は退化

### useGameLoop の selectIsDead 既存使用

useGameLoop.ts で既に `prevIsDeadRef = selectIsDead(store, myId)` を使っている (= 2026-05-04 myDeathEvent decomposition で導入)。 同 pattern を全 component に展開する。

### React render での再 derive

React component 内で `selectIsDead` を毎 render 呼ぶと、 killLog / respawnLog subscribe で re-render trigger。 これは既存挙動と同等 (= player.isDead が変わると Map の player object 新参照になり re-render)。 性能 neutral。

## §5 plan に含めなかった事項

- broadcast wire format からの isDead 削除 (= §2 (C) 段階移行の Phase 2、 別 plan)
- 関連する `selectInvincibleIds` / `selectDeadPlayerIds` 等 derive selector 群の整理 (= 既に derive 済、 audit 不要)

## §6 trigger 条件 (= un-defer)

- LorentzArena の active dev で「isDead drift 起因の bug」 が観察されたら priority up
- 大規模 protocol break refactor 機会があればまとめて
- 5 分以上の long plays で「isDead 関連の visible 不整合」 (= 死亡中の player が alive 描画される / 復活した player が dead 描画される 等) が観察されたら直ちに着手
