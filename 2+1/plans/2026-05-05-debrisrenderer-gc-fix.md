# Plan: DebrisRenderer 毎 render allocation の根治 (= Context Lost 単独 root cause)

**起草**: 2026-05-05
**Trigger**: Bug 10 final verify session で **単一 tab solo play 70 秒** 中に Context Lost × 2 を観察 (= peer 不在で Rule B 不発、 Bug 10 真因 chain と独立した経路で Context Lost が起きている)。 仮説の決定打。
**位置付け**: SESSION.md 「defer 中」 既登録項目の un-defer。 trigger は元 「setInterval Violation 累積」 → 5/5 観察「Context Lost が Rule B 不発でも起きる」 + 「LH flicker after hit」 + 「setInterval Violation 9 件 / 5 分」 で一気に達成。

---

## §1 観察 fact + 真因の絞り込み

### 5/5 verify session の観察 (= screenshot 群から抽出)

| Phase | 状況 | 観察 |
|---|---|---|
| Phase 1 (0-70s) | **単一 tab、 peer 0** | Bug 10 主症状 ✅ 出ない / **Context Lost × 2** / LH flicker 体感、 hit 後持続 |
| Phase 2 (70-233s) | 2 tab、 host migration 1 回経由 | 因果律跳躍 overlay × 2 同時 (= 後で Phase 4 で transient と判明) / LH worldline 縞 / setInterval Violation 9 件 / 撃破 LH 4 |
| Phase 3 (4+ peer cascade) | beacon ownership 5+ 回 flip | `GL_INVALID_OPERATION` × 3 / 一人の client から peer 不可視 |
| Phase 4 (今) | 安定 2 tab | **因果律跳躍 持続状態 再現せず** ← 仮説組み替えの決定打 |

### 真因絞り込み (= Phase 1 の決定的観察)

**Phase 1 = 単一 tab、 peer 0** で:
- Rule B 不発 (= peerVirtualPositions 空、 λ ≤ 0)
- LH Rule B 不発 (= 同上、 host 自身の LH は self-peer 関係不成立)
- frozenWorldLines への push なし
- mount storm 経路 不発

にも関わらず **Context Lost が 70 秒で 2 回**。

→ **Context Lost は Bug 10 真因 chain (= Rule B 暴走 → frozenWorldLines mount storm → rAF starve → GPU 圧) とは別 root cause で起きる**。 Bug 10 fix で `lastSync semantic 矛盾` / `LH Stage 4 gap` / `mount storm` / `1 点 worldLine flicker` / `myDeathEvent 二重管理` の 5 layer を撃滅したが、 **「単独で GPU 圧を生む別経路」** が手付かず。

この別経路の最有力候補が **DebrisRenderer の毎 render allocation** (= SESSION 「defer 中」 既登録、 仮説のみで未着手だった)。

### 過去の reasoning 反省 (= self-criticism、 §M26 application)

5/5 セッション中、 私は Phase 2-3 の chaos screenshot から **「Bug 10 第 6 層 = Fix B 2-sec cap × network split で両側 Rule B 永久発火」** という complex hypothesis を組み立て、 「Fix D plan」 まで提案する direction に進んでいた。 user 観察 Phase 4 「再現しない」 で deflate。

正しい simpler 仮説 (= DebrisRenderer GC pressure) は**既に SESSION defer に登録済**で、 Phase 1 の決定的観察 (= Rule B 不発でも Context Lost) は直接それを support していた。 私は登録済 simpler 仮説を確認せず complex 仮説に飛びついた。

**M26 / M27 application**: simpler 仮説 (= 既登録 defer) の re-check を skip して complex 仮説を組むのは絆創膏 sign の親類 (= problem を実態より複雑に framing して未着手にする drift)。 真因 audit の正しい順序は「観察 → simpler explanation 試行 → 駄目なら complex」。 この plan 自体が学習の記録。

---

## §2 真因 RCA (= Phase 1 観察に整合)

### `DebrisRenderer.tsx` の現状 allocation pattern

[`DebrisRenderer.tsx`](../src/components/game/DebrisRenderer.tsx) は **React 関数コンポーネントの本体** (= function body 直下、 `useEffect` / `useFrame` / `useMemo` 包まずに) で:

```tsx
const writeInstanced = (mesh, segs) => {
  // ...
  const colorAttr = new Float32Array(totalInstances * 3);  // ← 毎 render
  // ... fill colorAttr ...
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);  // ← 毎 render
  mesh.instanceColor.needsUpdate = true;
};
writeInstanced(explosionMeshRef.current, explosionSegments);  // ← 毎 render
writeInstanced(hitMeshRef.current, hitSegments);  // ← 毎 render
```

### Re-render trigger

DebrisRenderer は `debrisRecords` (= store subscribed) と `myPlayer` (= 毎 tick phaseSpace 更新で変化) を props に受ける。 → **store の任意の変化と myPlayer 更新でこの component が re-render**。 実測上 ~60 FPS に近い rate で render される。

### 各 render の cost

`maxInstances = 20 (MAX_DEBRIS) × 30 (EXPLOSION_PARTICLE_COUNT) × cells.length (1 or 9)` = 最大 **5400 instances**:

- `Float32Array(maxInstances × 3)` × 2 calls (= explosion + hit) = **2 × 5400 × 3 × 4 bytes = 130 KB / render**
- 60 FPS で **130 KB × 60 = 7.8 MB/sec の short-lived allocation** (= CPU GC pressure)
- `new InstancedBufferAttribute(colorAttr, 3)` × 2 = **新 GPU buffer 2 個 / render**
- 60 FPS で **GPU buffer upload 圧 ~3.9 MB/sec**

### Context Lost との因果

GPU driver は **busy upload + buffer churn** が一定閾値超えると context を reclaim する判断をする (= macOS / Brave で観察された挙動)。 5/2 fix の Canvas auto-remount + watchdog は context lost を invisibly recover するが、 **元の GPU 圧そのものは消さない**。 Phase 1 の 70 秒で 2 回の Context Lost = ~35 秒に 1 回 reclaim。 hit 連発 (= debris 累積) で頻度が上がる構造。

### 二次症状の説明

1. **LH flicker after hit**: hit → debris 増 → GPU 圧上昇 → context lost → auto-remount cycle → remount 中の数 frame で LH の trio prop 適用が安定化する前の transient = **flicker 体感**
2. **setInterval Violation 累積**: GPU 圧 + Float32Array GC pressure → main thread saturation → `setInterval` callback の遅延 = Violation
3. **`GL_INVALID_OPERATION` texture race** (Phase 3): context recovery 中の texture mailbox sync 不整合 = GPU 状態の transient corruption

これらは **共通の root cause = DebrisRenderer GC/GPU pressure** で全部説明できる。 Bug 10 真因 chain と独立した別 layer。

### Phase 2-3 cascade chaos との関係

Phase 2 で観察した「両側 因果律跳躍 同時」 / 「LH worldline 縞」 は cascade transient phase の symptom で、 **別 hypothesis** (= network split 下の Fix B cap の interaction)。 これは Phase 4 で再現しないため reliable repro を待って別 plan で扱う (= SESSION 新 ledger 行 #11)。

**今 plan の scope は Context Lost 単独 root cause = DebrisRenderer GC pressure のみ**。

---

## §3 修正方針

### 設計目標

**「毎 render の allocation を ref 経由で reuse、 GPU buffer 1 個 / mesh を component lifetime 中固定」** に倒す。 既存の挙動 (= debris の見た目 / fade / image cell 配置) は完全保存。

### 実装パターン

```tsx
// Refs for in-place GPU buffer reuse (= component lifetime 中保持)
const explosionColorBufferRef = useRef<Float32Array | null>(null);
const explosionColorAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
const hitColorBufferRef = useRef<Float32Array | null>(null);
const hitColorAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

// Helper: ensure buffer is large enough + attached to mesh
const ensureColorAttr = (
  mesh: THREE.InstancedMesh,
  bufferRef: React.MutableRefObject<Float32Array | null>,
  attrRef: React.MutableRefObject<THREE.InstancedBufferAttribute | null>,
  requiredSize: number,
): Float32Array => {
  // (1) Buffer が無い OR cells.length 増加で足りない: realloc
  if (!bufferRef.current || bufferRef.current.length < requiredSize) {
    bufferRef.current = new Float32Array(requiredSize);
    attrRef.current = new THREE.InstancedBufferAttribute(bufferRef.current, 3);
  }
  // (2) mesh の instanceColor が attrRef と異なる (= 初回 / Canvas auto-remount 後): re-attach
  if (mesh.instanceColor !== attrRef.current) {
    mesh.instanceColor = attrRef.current;
  }
  return bufferRef.current;
};

// In writeInstanced:
const colorAttr = ensureColorAttr(mesh, bufferRef, attrRef, totalInstances * 3);
// ... fill colorAttr in-place ...
attrRef.current!.needsUpdate = true;  // ← 既存 GPU buffer の next render upload を trigger
mesh.instanceMatrix.needsUpdate = true;  // ← 既存と同じ
```

### 重要な edge case と対処

1. **初回 render**: `bufferRef.current === null` → 新規 allocation + mesh attach。 = 1 度だけ走る初期化。
2. **cells.length 変化** (= boundary mode 切替で torus ↔ open_cylinder): `bufferRef.current.length < requiredSize` で grow。 縮む時は再 alloc 不要 (= 既存 buffer の前方部分のみ使い、 `mesh.count` で gate)。
3. **Canvas auto-remount** (= Context Lost 後): 新 InstancedMesh が ref に入る、 `mesh.instanceColor !== attrRef.current` → re-attach。 buffer / attr 自体は持続、 GPU 側は `needsUpdate = true` で次 render upload。
4. **mesh.count gating**: GPU は最初の `mesh.count` instances のみ描画。 buffer の後ろ側に古いデータが残っても rendered されない。 既存の `mesh.count = totalInstances` で OK。

### 期待効果

- **GPU buffer upload 7.8 MB/sec → 0** (= 既存 buffer の `needsUpdate` flag 経由で同 GPU buffer に in-place upload、 buffer reallocation 不要)
- Float32Array allocation **130 KB/render → 0** (initial 1 回のみ)
- InstancedBufferAttribute allocation **2 個/render → 0** (initial 2 個のみ)
- Context Lost 頻度低下 (= GPU 圧 root 軽減)、 setInterval Violation 累積低下、 LH flicker after hit 消失見込み

### scope 外 (= 別 plan / defer)

- `explosionSegments` / `hitSegments` 配列の毎 render 再生成 (= ~80 KB/render の CPU GC pressure、 GPU 圧の root ではないので follow-up 候補)
- `markerElements` の React JSX 再生成 (= React render の natural、 fix 困難)
- Phase 2-3 cascade chaos の真因 (= reliable repro 待ち)
- 他 renderer (LaserBatchRenderer / 他) の同 pattern audit (= follow-up plan candidate)

---

## §4 実装手順

### Stage A: ref 追加 + helper 関数導入

[`DebrisRenderer.tsx`](../src/components/game/DebrisRenderer.tsx) に:

1. `explosionColorBufferRef` / `explosionColorAttrRef` / `hitColorBufferRef` / `hitColorAttrRef` の 4 つの `useRef<...>(null)`
2. `ensureColorAttr` helper を component scope 内 (= `writeInstanced` の上) に追加 — refs を closure で参照、 helper 内で realloc / attach 判定

### Stage B: writeInstanced 改修

`writeInstanced` の signature に bufferRef / attrRef を追加 (= caller が渡す)、 内部で `ensureColorAttr` 呼び出し:

```tsx
const writeInstanced = (
  mesh: THREE.InstancedMesh | null,
  segs: DebrisSegment[],
  bufferRef: React.MutableRefObject<Float32Array | null>,
  attrRef: React.MutableRefObject<THREE.InstancedBufferAttribute | null>,
) => {
  if (!mesh) return;
  // ...
  const totalInstances = segs.length * cells.length;
  const colorAttr = ensureColorAttr(mesh, bufferRef, attrRef, totalInstances * 3);
  // ... fill colorAttr in-place (既存 loop 流用) ...
  mesh.count = totalInstances;
  mesh.instanceMatrix.needsUpdate = true;
  attrRef.current!.needsUpdate = true;  // ← `mesh.instanceColor.needsUpdate = true` を置換
};

writeInstanced(explosionMeshRef.current, explosionSegments, explosionColorBufferRef, explosionColorAttrRef);
writeInstanced(hitMeshRef.current, hitSegments, hitColorBufferRef, hitColorAttrRef);
```

### Stage C: 検証 → deploy

1. `pnpm run typecheck` pass
2. `pnpm run lint` pass (既存 warning 32 件以下を維持)
3. `pnpm run test` pass (= 既存 test に DebrisRenderer 直接 test なし、 整合性確認のみ)
4. preview localhost で render 動作確認 (= debris 描画が変わらないか visual check)
5. commit + push + deploy
6. 本番で Context Lost 頻度低下 + LH flicker 消失を user verify

---

## §5 影響範囲 + リスク

### 影響 file
- `src/components/game/DebrisRenderer.tsx` のみ (= 他 file 変更なし)

### Wire format 影響
- なし (= rendering only、 broadcast / store / state 構造に手を入れない)

### 旧 client 互換性
- 完全互換 (= 内部 rendering 改修のみ)

### test 影響
- 既存 test は pass のまま (= DebrisRenderer 直接 test なし、 logic も保存)
- 視覚 regression test 無いため、 deploy 後の user 視覚 verification が必要

### リスク評価

| リスク | 確度 | 緩和策 |
|---|---|---|
| **buffer 再 attach が race で間違える** | 低 | `mesh.instanceColor !== attrRef.current` の 1 比較で覆う、 every render check |
| **cells.length 動的 grow で buffer underflow** | 低 | `if (bufferRef.current.length < requiredSize) realloc` で gate |
| **Canvas auto-remount で buffer disposed** | 低 | three.js の `BufferAttribute` は CPU 側 wrapper、 GPU buffer は `needsUpdate=true` で次 render に再 upload |
| **既存 visual と微妙に異なる挙動** | 低 | logic 不変 (= colorAttr の値書き込みは同一)、 buffer の identity だけが変わる |
| **buffer の古い領域に stale data が残る** | 低 | `mesh.count = totalInstances` で GPU 側が gating、 後方データは描画されない |

### Worst case 想定

- 万一 visual に regression 出たら revert は 1 commit、 5 分 work
- typecheck / lint で catch されるなら deploy 前に発覚

---

## §6 検証方針

### 自動 (= 私が走らせる)
- `pnpm run typecheck` clean
- `pnpm run lint` 既存 warning 32 件以下維持
- `pnpm run test` 全 pass

### 手動 visual (= localhost preview)
- `preview_start lorentz-arena` → `http://localhost:5174/LorentzArena/#room=test`
- debris が **見えるべき場面で見える** (= LH 撃破時の爆発 + hit debris)
- debris の**色 / 位置 / 透明度 / fade rate が変わらない**
- LH 撃破後 **flicker 観察** (= preview headless では throttle で再現困難、 user 実機で本番後 verify)

### 本番 deploy 後 (= user 実機 verify)
- 5+ 分 plays、 LH 撃破連打 (= Phase 1 reproduce)
- DevTools Console:
  - **Context Lost 頻度**: Phase 1 = 70s で 2 回 → 0 回 / 5 分 が target
  - **setInterval Violation**: Phase 2 = 233s で 9 件 → 0-3 件 / 5 分 が target
  - **GL_INVALID_OPERATION**: 0 件 (= context recovery 起きないので texture race も発生しない見込み)
- 視覚:
  - **LH flicker after hit が消失** (主目的)
  - debris の見た目 unchanged

### 失敗判定
- LH flicker が依然発生 → 別 root cause (= Bug 10 第 6 層別 path) を疑う、 次 RCA
- Context Lost 頻度が変わらない → DebrisRenderer 仮説は誤、 別 path を audit (= LaserBatchRenderer / その他 renderer の毎 render allocation)

---

## §7 メタ原則 link + 学習記録

### M25 (state 単一化) との関係
- 直接の application ではない (= state 構造の重複ではなく、 GPU resource lifetime の問題)
- 但し **「buffer 1 個を component lifetime で持つ」** は state 単一化の精神に近い (= 毎 render 別 buffer = 「同じ目的のための buffer が複数生成される」 で M25 違反気味)

### M26 (絆創膏 vs 根本治療) との関係
- 5/5 セッション中の「complex hypothesis (= Fix B cap × network split)」 → 「simpler hypothesis (= DebrisRenderer GC) 既登録 defer の un-defer」 への切り替えが M26 の精神に該当
- 「自分の hypothesis を絆創膏 sign で self-audit」 を skip して複雑化に流れた → user 観察 Phase 4 で deflate
- **学習**: 既登録 defer の re-check を真因 audit の最初に入れる (= 「過去の自分が defer した仮説」 は新観察で活性化する余地が常にある)

### M27 (多層 RCA: 症状の出る layer ≠ 真因の layer) との関係
- Bug 10 真因 chain (5/4 で 5 layer fix) は **「Rule B → mount storm → rAF starve → 全世界凍結 + Context Lost」** の chain だった
- 5/5 の Phase 1 観察で **「Rule B 不発でも Context Lost が起きる」** = chain の終点 (= GPU 圧 / Context Lost) に **別の上流 root** が存在することを発見
- これは「症状再発」 ではなく「**並列 root**」: Bug 10 chain は撃滅したが、 同じ症状の **別 root** が残っていた
- 5 layer fix の各層は依然有効 (= mount storm 経路はもう来ない)、 並列 root を撃滅すれば「同じ症状の出方」 を網羅的に対処できる

### M28 (暗黙 trio / triad の踏み外し) との関係
- 直接 関係なし (= rendering pattern の trio ではない)
- 但し**「render-side allocation を ref reuse pattern で囲む」** は M28 的に **「allocation pattern の踏み外し防止」** という再利用可能なアイデア。 follow-up plan で「全 renderer の allocation audit」 を起こす場合、 ref pattern を共通 helper module に切り出す候補

---

## §8 deploy 後 SESSION 更新項目

### Bug 10 ledger 行 → ✅ 格上げ
> Bug 10 真因 chain ✅ 撃滅 (5/4 main + 5/5 並列 root = DebrisRenderer GC fix で網羅)。 user 5/5 verify で主症状全項目 pass、 並列 root の Context Lost 頻度低下を verify 後 fully ✅。

### 新 ledger 行 #11 (= cascade chaos)
> 4+ tab beacon cascade chaos: 「両側 因果律跳躍 同時」 / 「一人の client から peer 不可視」 / `GL_INVALID_OPERATION` / 「LH worldline 縞」 が 5/5 verify session の Phase 2-3 で観察。 安定 2-tab state では再現せず、 reliable repro 無し。 仮説: Fix B 2-sec cap × network split で peer virtualPos が frozen → 両側 Rule B fire (transient)。 un-defer trigger: 「stable state でも再発」 or 「reliable repro 手順が見つかる」。 暫定対処: なし。

### defer 中 から削除
- 「DebrisRenderer 毎 render allocation の GC pressure 仮説」 を完了化

### `design/meta-principles.md` 追記候補 (= 別 commit)
- M27 application: 「症状再発 vs 並列 root」 の区別 — 同じ症状 layer に上流が複数ある場合、 既知 chain の fix が完了しても同症状再発は「並列 root の発見」 trigger
- M26 application: 「自分の hypothesis を絆創膏 sign で self-audit」 を **「過去の自分が defer した simpler 仮説の re-check」** にも拡張

---

## §9 完了基準

- [ ] code 修正 deploy 済 (= main / origin sync 済、 build 値 HUD 表示確認)
- [ ] user 実機 5+ 分 plays + LH 撃破連打で:
  - [ ] Context Lost 0-1 件 / 5 分 (= Phase 1 比 70s で 2 回 → 改善)
  - [ ] setInterval Violation 0-3 件 / 5 分 (= Phase 2 比 233s で 9 件 → 改善)
  - [ ] LH flicker after hit が visual に消失
  - [ ] debris の見た目 unchanged (= 色 / 位置 / 透明度 / fade rate)
- [ ] SESSION.md ledger 更新済
