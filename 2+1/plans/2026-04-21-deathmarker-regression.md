# 2026-04-21: DeathMarker regression 調査メモ (未解決、次セッション引継ぎ)

## 問題

odakin 報告: **DeathMarker が出ないことがある** + **sphere の sinking 設計通りに働かなくなった (regression)**。

## 設計の意図 (確認済)

[`DeathMarker.tsx`](../src/components/game/DeathMarker.tsx) の anchor 分離は意図的:

- **Sphere**: world event 位置 (= 時空点 deathT で fixed、`transformEventForDisplay(deathEventPos, ...)`)
  → 観測者進行で display.z = `deathEventPos.t − observer.t` が減少、**sink する** (= 過去側へ沈む)。
  「死亡 event がどこ・いつ起きたか」を時空内に literal に示す不動の点。
- **Ring**: 過去光円錐 surface 上 (`{...deathEventPos, t: observer.t − ρ}`)
  → 観測者進行で anchorT も `+Δt` 分だけ進み、display.t = −ρ で固定 (静止観測者なら「沈まない」)。
  「死亡の光子が届く球面が時間と共に広がる、その球面が死亡 event の spatial 位置と交わる点」。

odakin 確認: この 2 つ anchor 設計は **意図通り**。sphere が「実際の過去光円錐交点より過去側に出る」のは **正常挙動** (そのために両者 anchor を分けている)。

## 誤った commit (revert 済)

`f494986` で「sphere の sinking を past-cone anchor に統一」と odakin 意図を誤読して ring と同じ anchor に変更した。`43a33b6` で revert して旧挙動に戻した。

## 「出ないことがある」の確認済みコードパス

- [`pastConeDisplay.ts`](../src/components/game/pastConeDisplay.ts) の死亡 branch:
  ```ts
  if (elapsedPastDeath > DEBRIS_MAX_LAMBDA) {
    visible = false;  // 2.5s fade 完了で body/marker 全消滅
  } else {
    ...
    if (elapsedPastDeath >= 0) deathMarkerAlpha = alpha;
    // 光未到達 (elapsedPastDeath < 0) では deathMarkerAlpha = null のまま
  }
  ```
- [`OtherPlayerRenderer.tsx`](../src/components/game/OtherPlayerRenderer.tsx) 死亡 branch で `if (!state.visible) return null;` → 全消滅時に body / DeathMarker 共に消える。
- `DeathMarker.tsx` の早期 return: `if (alpha == null || alpha <= 0) return null;` → 光未到達時 & fade 完了後に消える。

これらは**設計通り**で、以下の 2 ケースで marker が消える:

1. **光未到達期間** (`pastConeT < deathT`、= 観測者過去光円錐がまだ death event に届いていない)
2. **fade 完了後** (`pastConeT > deathT + DEBRIS_MAX_LAMBDA`、= 2.5 coord sec 経過)

## regression の疑わしい領域 (未特定)

私の commit で DeathMarker rendering path を直接いじった覚えはないが、以下を検証する必要がある:

### 仮説 1: `myDeathEvent.pos` が更新される

useGameLoop ghost branch (`fadedf3` で追加) で `setMyDeathEvent({ ...de, ghostPhaseSpace: ghostPs })` を毎 tick 呼び出している。`{ ...de, ghostPhaseSpace: ghostPs }` は pos を保持するはずだが、ghost 中に pos が ghost.pos に accidentally 上書きされると sphere が sink せず ghost と一緒に動く。

**検証方法**: 自機死亡後、console で `useGameStore.getState().myDeathEvent.pos` を time sample して t が変化しないか確認。

### 仮説 2: snapshot apply が dead player の phaseSpace を上書き

`snapshot.ts applySnapshot` は dead/alive 問わず `player.phaseSpace = fromPhaseSpaceWire(sp.phaseSpace)` で上書きする。host 側が dead player の phaseSpace を stale に保持していて、それを雨のように降らせて各 peer の dead player pos を振動させる可能性。

**検証方法**: 他機死亡後 5s 周期 snapshot が来るたび `player.phaseSpace.pos` をログ。変化するなら原因。対策は `applySnapshot` で dead player の phaseSpace 更新スキップ。

### 仮説 3: `computePastConeDisplayState` の `visible` 判定が厳しすぎる

`DEBRIS_MAX_LAMBDA = 2.5` は debris smoke の寿命と共用。DeathMarker の表示窓も 2.5 coord sec しかなく、高速観測者 / 遠距離 kill で窓を通過しやすい。

**対策案**: `DEATH_MARKER_LAMBDA` を新規導入 (7〜10 coord sec) して marker の窓を body fade と独立に長くする。副次効果で「出ないことがある」は体感減るはず (physics-correct ではなく UX)。

### 仮説 4: B-3/B-4/past-cone fix で OtherPlayerRenderer 生存/死亡 routing に副作用

`3d1831d` で OtherPlayerRenderer は死亡専用に縮小、alive 他機は OtherShipRenderer に routing。生存→死亡の React re-render タイミングで OtherShipRenderer が古い player 参照を保持したままになると、死亡 frame で OtherPlayerRenderer と併存して視覚混線する可能性。

**検証方法**: 他機死亡瞬間に React devtools でコンポーネントツリーを観察。

## 次セッション での優先順位 (推奨)

1. **実機再現**: localhost multi-tab で死亡を繰り返し、console 観察。仮説 1 (myDeathEvent.pos 不変) を最初に eliminate。
2. **仮説 3 を軽く fix** (視認性改善目的): `DEATH_MARKER_LAMBDA = 7〜10` を導入。「出ないことがある」の UX 緩和。regression かどうかはこれで判定しやすくなる。
3. **仮説 2 を要検証**: snapshot が dead player を上書きするの、ロジック上は「dead の phaseSpace は freeze」前提だが apply 側で条件漏れの疑い。コード監査 + test 追加で verify。

## 関連 commit タイムライン

| commit | 内容 |
|---|---|
| `abb1cf4` (2026-04-20) | 死亡 past-cone 共通化、DeathMarker / pastConeDisplay / OtherPlayerRenderer 初版 |
| `8ce595f` (2026-04-20) | 死亡 spawnT を respawnLog 経由に (gap-reset 耐性) |
| `0865859` (2026-04-21) | OtherPlayerRenderer に nose indicator (生存中) |
| `4a026d7` (2026-04-21) | OtherPlayerRenderer に alpha arrow (生存中) |
| `b204295` (2026-04-21) | nose/arrow を past-cone 交点に (生存中) |
| `3d1831d` (2026-04-21) | OtherShipRenderer 新設、OtherPlayerRenderer を死亡専用に縮小 |
| `5fae0be` / `cf5b262` (2026-04-21) | debris / laser past-cone marker 色を universal に (logic 変更無し) |
| `f494986` (2026-04-21) | **誤った sphere anchor 修正** (odakin 意図誤読) |
| `43a33b6` (2026-04-21) | **上記 revert**、旧挙動に復帰 |

## コード review で見た OtherPlayerRenderer 死亡 branch (変更無し)

```ts
if (player.isDead) {
  const deathEventPos = deathEventOverride ?? wp;  // self: myDeathEvent.pos / other: frozen phaseSpace.pos
  const spawnT = getLatestSpawnT(respawnLog, player);
  const state = computePastConeDisplayState(deathEventPos, spawnT, true, observerPos);
  if (!state.visible) return null;  // ← 全消滅ルート
  renderPos = state.anchorPos;       // body (sphere+glow) の anchor
  deathAlpha = state.alpha;
  deathEventPosForMarker = deathEventPos;  // DeathMarker に渡す死亡 event 位置
  deathMarkerAlpha = state.deathMarkerAlpha;  // null なら marker 消える
}
```

旧 (0865859 pre) の同 branch と**文字単位で一致**を確認済。ロジック変更なし。
