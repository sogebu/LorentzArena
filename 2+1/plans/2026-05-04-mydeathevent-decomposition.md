# Plan: myDeathEvent の二重管理を分解 — 静的 meta は player.phaseSpace から derive、 動的 ghost のみ explicit

**起草**: 2026-05-04
**Trigger**: 5/4 user 実機 plays で「自機死亡中 stardust 凍結 (+ 世界線伸びる)」 を観察、 dev console 確認で **`myDeathEvent === undefined`** 状態を発見。 真因は「自機死亡 state が 2 箇所で二重管理 + 同期が経路依存」。

## §1 RCA — 二重管理の構造

### 観察の単一連鎖説明

「世界線伸びる + stardust 凍結」 は次の chain で完全説明:
1. 自機 death routing (例: snapshot 5 秒周期 / host migration / network race) で killLog merge → `selectIsDead(myId)` true
2. その間 `myDeathEvent` は **set されないまま** (= snapshot 経路には set 処理なし)
3. その後 kill message が届き `handleKill(myId, ...)` 呼ばれるが、 guard `if (selectIsDead(state, victimId)) return;` で early return → **myDeathEvent 永遠に未 set**
4. SceneContent fallback で `rawMyPlayer` (= 死亡時刻凍結 phaseSpace) を観測者に → observerPos.t freeze → **displayMatrix freeze**
5. stardust = world frame fixed event 集合、 固定 displayMatrix で transform → **visible 不変 (= 凍結観察)**
6. 他機 worldLine = broadcast で history 増、 各点を固定 displayMatrix で transform → **visible に伸びる**

### 真因 = 「自機死亡 state を 2 箇所で二重管理」

| state | 流入経路 | 同期方式 |
|---|---|---|
| `selectIsDead(myId)` | killLog vs respawnLog から **derive** | 全経路で自動同期 (= killLog 流入 = handleKill / snapshot / 何でも) |
| `myDeathEvent` | handleKill で **explicit set** | 経路依存 (= handleKill 通らない流入で set 漏れ) |

両者の同期が経路依存で取れない設計が真因。 effect ベースの同期 (= 「isDead && myDeathEvent null を検知して initialize」) は「同期不能の構造に対する貼り絆」 で、 流入経路が増えるたびに effect で fallback init を追加する **増殖構造**。

## §2 設計 — DeathEvent の分解 (= 静的 derive + 動的 explicit)

### 旧 DeathEvent の構造分析

```ts
export type DeathEvent = {
  readonly pos: Vector4;        // 死亡位置 (= fixed)
  readonly u: Vector4;          // 死亡時 4 元速度 (= fixed)
  readonly heading: Quaternion; // 死亡時姿勢 (= fixed)
  readonly ghostPhaseSpace: PhaseSpace;  // 動的 ghost (= 自機入力で update)
};
```

`pos / u / heading` は **死亡時の player phaseSpace で完全に決まる static info**。 `applyKill` (= killRespawn.ts) で player.phaseSpace は死亡時刻で凍結保持されるため、 これらは `players.get(myId).phaseSpace` から **完全 derive 可能**。

`ghostPhaseSpace` のみが動的 (= 自機 WASD 入力で processPlayerPhysics 流用 update、 他 peer に broadcast しないローカル状態)。

### 新設計

| 旧 | 新 | 同期方式 |
|---|---|---|
| `myDeathEvent.pos / u / heading` | `players.get(myId)?.phaseSpace` から derive | 自動 (= player state 経由、 流入経路非依存) |
| `myDeathEvent.ghostPhaseSpace` | `myGhostPhaseSpace: PhaseSpace \| null` 新 explicit field | useGameLoop dead branch で **lazy init** (null なら freshMe.phaseSpace で初期化) |
| `DeathEvent` type | **削除** (= 複合型解体、 type-level に二重管理を残さない) | — |

### 「set 漏れ」 が原理的に消える理由

- 静的 meta = player.phaseSpace から derive、 player は applyKill で確実に凍結 update される (= killLog / snapshot / 何でも経路で player.isDead 反映と同 path)
- 動的 ghost = useGameLoop dead branch 内で lazy init (= `if (myGhostPhaseSpace == null) initialize(freshMe.phaseSpace)`) で「null だった場合の補正」 を **設計の一部** に取り込む
- handleKill / snapshot / 他流入経路で「myGhostPhaseSpace を set し忘れ」 は **構造的に存在し得ない** (= initialize は useGameLoop の責任、 流入経路の責任ではない)

## §3 実装 stage

### Stage 1: 文書 (本 plan)

### Stage 2: atomic refactor (= mid-state を broken にしない 1 commit)

**store** (`game-store.ts`):
- field `myDeathEvent: DeathEvent | null` 削除
- action `setMyDeathEvent` 削除
- field `myGhostPhaseSpace: PhaseSpace | null` 追加 (default null)
- action `setMyGhostPhaseSpace(v)` 追加
- `handleKill` 内 myDeathEvent 初期化を `myGhostPhaseSpace: victim.phaseSpace` に置換
- `handleSpawn` 内 `myDeathEvent: null` reset を `myGhostPhaseSpace: null` reset に置換

**useGameLoop** (`useGameLoop.ts`):
- transition watcher: `prevMyDeathEventRef` を `prevMyGhostPhaseSpaceRef` (or 同等の dead transition watcher) に書き換え
- dead branch:
  ```ts
  // 旧:
  const de = fresh.myDeathEvent;
  if (de && freshMe) {
    const ghostMe = { ...freshMe, phaseSpace: de.ghostPhaseSpace };
    // ...evolve...
    fresh.setMyDeathEvent({ ...de, ghostPhaseSpace: ghostPs });
  }
  // 新 (= lazy init):
  const ghostPS = fresh.myGhostPhaseSpace ?? freshMe?.phaseSpace ?? null;
  if (ghostPS && freshMe) {
    const ghostMe = { ...freshMe, phaseSpace: ghostPS };
    // ...evolve...
    fresh.setMyGhostPhaseSpace(physics.newPhaseSpace);
  }
  ```

**UI components**:
- `HUD.tsx`: subscribe を `myGhostPhaseSpace` に変更、 myPlayer swap で fallback も `rawMyPlayer.phaseSpace` (= 死亡凍結) で OK (= 1 tick 後 lazy init で myGhostPhaseSpace 反映)
- `SceneContent.tsx`: 同上
- `CenterCompass.tsx`: 同上
- `Overlays.tsx`: `myDeathEvent?.pos.t` を `rawMyPlayer?.phaseSpace.pos.t` 経由 (or RespawnCountdown key を別 key 構築) に変更、 props signature 整理

**type**:
- `types.ts` `DeathEvent` type 削除
- 全 import 撤去

**docstring sweep**:
- `virtualWorldLine.ts` / `DeadShipRenderer.tsx` の myDeathEvent 言及 comment を更新 (= 「myGhostPhaseSpace + player.phaseSpace の組合せ」 に書き換え)

### Stage 3: typecheck + 既存 test 全 pass + commit

中規模 refactor なので 1 atomic commit (= partial commit で broken state を残さない)。

### Stage 4: user 実機検証

死亡時 stardust 流れる + 「世界線伸びる + stardust 凍結」 の症状解消を verify。

## §4 影響 file 一覧

| file | 修正内容 |
|---|---|
| `src/stores/game-store.ts` | field/action 置換 + handleKill / handleSpawn 修正 |
| `src/hooks/useGameLoop.ts` | transition watcher + dead branch lazy init |
| `src/components/game/types.ts` | DeathEvent type 削除 |
| `src/components/game/SceneContent.tsx` | swap subscribe 置換 |
| `src/components/game/HUD.tsx` | swap subscribe 置換 + Overlays props |
| `src/components/game/hud/CenterCompass.tsx` | swap subscribe 置換 |
| `src/components/game/hud/Overlays.tsx` | RespawnCountdown key 経由整理 + DeathEvent import 削除 + props signature |
| `src/components/game/DeadShipRenderer.tsx` | docstring 更新 (= 動作変更なし、 文字のみ) |
| `src/components/game/virtualWorldLine.ts` | docstring 更新 (= 動作変更なし) |

## §5 検証戦略

### automated
- typecheck pass (= 全 import 整合)
- 既存 248 test 全 pass (= regression 無し、 store field rename + ghost lazy init の挙動が test に直接 dep 無いことを confirm)

### user 実機検証
- localhost (= [http://localhost:5173/LorentzArena/#room=test](http://localhost:5173/LorentzArena/#room=test)) で plays
- 自機死亡時 **stardust が visible に流れ続ける** (= ghost.pos.t advance で displayMatrix update)
- 「世界線伸びる + stardust 凍結」 症状解消
- dev console で `__game.getState().myGhostPhaseSpace?.pos?.t` を死亡中 1 秒間隔で確認、 advance してる
- ghost camera WASD 動かして visible に scene 動く

## §6 Rollback / abort 戦略

- atomic 1 commit、 git revert 1 回で完全復元
- 万一 ghost lazy init で別 race (= snapshot 受信直後 ghost が wrong phase で start 等) が出たら revert
- 設計上 lazy init は freshMe.phaseSpace で初期化、 これは死亡時刻凍結値 = handleKill で初期化していた値と等価、 race risk 低い

## §7 plan に含めなかった事項

- DebrisRenderer GC pressure fix (= 別 task、 setInterval Violation 累積の真因仮説、 stardust 凍結とは別 layer)
- frozenWorldLines mount storm fix は既に別 commit (`18adb8b` stable id) で done
- WebGL Context Lost listener fire failure (= 5/2 設計の外部要因対応、 polling 直 check は別 task で再検討)

これらは本 plan の真因 (= 二重管理 → ghost set 漏れ) 解消後、 改めて優先度評価。
