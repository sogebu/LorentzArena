# 2026-04-22: 自機 DeathMarker / DeadShipRenderer 発火しない症状の切り分け

## 症状

odakin 報告 (2026-04-22 午後): **自機が死亡したときに 3D 死亡 marker (sphere + ring) と DeadShip (凍結機体) が出てこない**。他機死亡の場合は発火する挙動は未確認だが、少なくとも自機が出ないのは regression。

## 設計意図 (既に確認済、コード上正しい)

自機幽霊の過去光円錐 × 死亡世界線分 W_D(τ) = x_D + u_D·τ の交点 τ_0 で on/off 判定する、となっている。経路:

1. `SceneContent.tsx:144-150` — 自機死亡中は `myPlayer` を `{ ...rawMyPlayer, phaseSpace: myDeathEvent.ghostPhaseSpace }` に swap し、`observerPos = myPlayer.phaseSpace.pos` = ghost.pos を `DisplayFrameProvider` に投入。
2. `useGameLoop.ts:374-415` — 死亡中は毎 tick `processPlayerPhysics` で ghost phaseSpace を前進させ `setMyDeathEvent` で commit。`store.players[myId].phaseSpace` は **touch しない** (= 死亡時刻で凍結)。
3. `SceneContent.tsx:384-405` — `playerList.flatMap` の `if (player.isDead)` 分岐で `xD = player.phaseSpace.pos` (凍結死亡時空点) を `DeathMarker` / `DeadShipRenderer` に渡す。
4. `DeathMarker.tsx:50` — `useDisplayFrame()` の `observerPos` (ghost) で `pastLightConeIntersectionDeathWorldLine(xD, uD, observerPos)` を計算、`τ_0 ∈ [0, DEATH_TAU_EFFECT_MAX=2]` で on/off。
5. `DeadShipRenderer.tsx:52` — 同じ τ_0 計算、`[0, DEATH_TAU_MAX=3]` で on/off、`fadeAlpha = (τ_max − τ_0) / τ_max`。

## 汚染経路の静的排除 (すべて否定済)

| 疑い | 確認結果 |
|---|---|
| shallow copy で `store.players[myId].phaseSpace.pos` が ghost 値に上書きされる | `evolvePhaseSpace` ([mechanics.ts:84](../src/physics/mechanics.ts#L84)) は新 PhaseSpace を `createPhaseSpace(newPos, ...)` で返す pure 関数。mutate なし → 否定 |
| messageHandler が relay 経由で自機 phaseSpace を上書きする | [messageHandler.ts:139](../src/components/game/messageHandler.ts#L139) で `if (playerId === myId) return`、[:314](../src/components/game/messageHandler.ts#L314) で `victim?.ownerId === myId` の hit も return → 否定 |
| snapshot apply が自機 phaseSpace を上書きする | [snapshot.ts:210-212](../src/components/game/snapshot.ts#L210) で `isMigrationPath` 時 `existingMine` 優先 (local 保持) → 否定 |
| snapshot apply が自機以外の dead player を上書き (他機 regression) | [:218-222](../src/components/game/snapshot.ts#L218) で `local.phaseSpace.pos.t >= snapshotPlayer.pos.t` なら local 保持。dead は同一値のはずだが、**host 側で dead player phaseSpace を live 更新している可能性** が残る → 自機症状とは別軸、後続で要検証 |

つまり自機分については静的読みだけでは xD の汚染経路が見つからない。**動的な何か** (myDeathEvent が set されない、ghost.pos.t が前進しない、どこかで null return、など) が真因。

## Debug log を仕込んだ (この plan と同時コミット)

3 層で console.debug を出す。500ms スロットル。prefix `[SELF-DEATH]`。症状特定後に全削除する (各ファイルに `DEBUG-SELF-DEATH-MARKER` コメント)。

- **[SceneContent.tsx](../src/components/game/SceneContent.tsx)** (myPlayer swap + isDead+isMe 分岐 entry):
  - `sc-swap`: `rawMyPlayer.isDead` / `myDeathEvent set or null` / `raw.t` / `ghost.t` / `xD.t`
  - `sc-self-dead`: DeadShipRenderer + DeathMarker を push したか + xD.t / observer.t
- **[DeadShipRenderer.tsx](../src/components/game/DeadShipRenderer.tsx)**:
  - `dsr-<pid>`: observer.t / xD.t / τ_0 / fadeAlpha (window [0,3])
- **[DeathMarker.tsx](../src/components/game/DeathMarker.tsx)**:
  - `dm-noobs-<xD.t>`: observerPos=null の早期 return
  - `dm-<xD.t>`: observer.t / xD.t / dt / uD / τ_0 (window [0,2])
  - `dm-oow-<xD.t>`: τ_0 が窓外で早期 return

## 検証手順 (odakin)

1. `pnpm dev` で localhost 起動、DevTools Console を開く
2. `#room=test` でマルチタブ 2 枚用意、片方の灯台に特攻して自機を殺す
3. 自機死亡後、Console で `[SELF-DEATH]` ログを観察:
   - `sc-swap` 出る? → myPlayer swap 経路通過確認
     - `myDeathEvent=null` なら **handleKill で setMyDeathEvent が走っていない** (handleKill 引数 myId 経路問題 or victimId !== myId 経路)
   - `sc-self-dead` 出る? → DeadShipRenderer + DeathMarker の React tree 配置確認
     - 出ない場合は isDead false or isMe false
   - `dsr-<pid>` / `dm-<xD.t>` 出る? → 各 component mount 確認
     - `fadeAlpha=null (return null)` なら τ_0 窓外が確定
     - `tau0=null` なら discriminant < 0 (uD が timelike でない疑い、getVelocity4 返り値を要確認)
     - `observer.t` が時間前進しない → ghost が動いていない (useGameLoop ghost 分岐が回っていない)
     - `xD.t` が時間前進する → store.players[myId].phaseSpace 汚染 (静的排除失敗、別経路)
4. 最初に observed する早期 return 理由を確定したら、その直上の原因を git log で追跡

## 追加仮説 (debug log 結果次第で再評価)

- **H1: ghost.pos.t が前進しない**: useGameLoop:374 `if (freshDead)` 分岐の `if (de && freshMe)` gate (line 380) で `de = null` になっていて `setMyDeathEvent` に入っていない。handleKill の line 249-259 の `victimId === myId` 判定が何らかの理由で false → myDeathEvent 永久 null。
- **H2: ghost が死亡時空点に張り付く**: ghost.pos.t は進むが、**死亡時刻 (x_D.t) との差が常に ~0** に見える。これは `DEATH_TAU_EFFECT_MAX=2` / `DEATH_TAU_MAX=3` の窓を超える時間感覚 (~数秒) と整合しないので不自然。
- **H3: カメラ yaw が undefined で processPlayerPhysics が NaN を返す**: ghost.pos が NaN 化 → past-cone 交点計算で discriminant < 0 → `null` return → `dm-noobs` ではなく `tau0=null` の `dm-oow` で出る。
- **H4: myDeathEvent は set されているが isDead=true になるタイミングが遅れる**: kill message が relay 経由でしか来ない race で一時的に isDead=false + myDeathEvent=set、逆も。これは SceneContent の myPlayer swap ロジック (`rawMyPlayer?.isDead && myDeathEvent ? swap : raw`) では swap されないケースを生む。

## 症状特定後の対応

1. debug log をすべて削除 (grep `DEBUG-SELF-DEATH-MARKER` で全件ヒット)
2. 真因を修正
3. unit test / integration test 追加で regression 防止
4. この plan に post-mortem を追記して closed としてマーク
