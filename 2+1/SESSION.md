# SESSION.md — LorentzArena 2+1

## 現在のステータス

**未デプロイ**: `8c02c0f` (2026-04-28 push) + 後続 fix。 本番デプロイ済は `e6c17cc` (build `2026/04/27 15:15:46 JST`、 https://sogebu.github.io/LorentzArena/)。 実機 multi-tab 検証で 2026-04-28 fix 群の動作確認待ち、 OK なら deploy。

**PBC torus は default から外し、 隠しオプション化** (= `#boundary=torus` で有効化、 default = `open_cylinder` の旧視覚円柱に戻した、 2026-04-28)。 PBC は新 client 永遠凍結等の派生 bug + 視覚的不整合が複数残っており、 一旦保留。 関連 fix (causalEvents observer-centered wrap, ballistic catchup, lighthouse γ² bug, 共変表現徹底) は default open_cylinder 環境でも有効なので残す。

### 2026-04-28 セッション (2 commit、 詳細は git log)

**[`cb9fa10`](https://github.com/sogebu/LorentzArena/commit/cb9fa10) PBC 跨ぎ越し bug 群治癒 + 共変表現徹底**:
- [`causalEvents.ts`](src/components/game/causalEvents.ts) を **observer-centered wrap pattern** に書き換え (= 観測者本人 cell が常に primary、 跨ぎ越し問題が原理的に消える)。 「他セル死亡 deathFlash 不発」 「他セル他機 spawn ring 不発」 解消
- [`gameLoop.ts:checkCausalFreeze`](src/components/game/gameLoop.ts) を (0,0) cell wrap で再設計 + 1.5s grace で stale 認定前の落ちてる相手の誤発動を skip → 「跨ぎ後燃料消費 0」 解消
- [`messageHandler.ts:323`](src/components/game/messageHandler.ts) self respawn echo guard で「同セル内に次々リスポーンエフェクト」 解消
- [`lighthouse.ts:computeInterceptDirection`](src/components/game/lighthouse.ts) の **二重 γ bug** (= `enemyU` (= γv) に更に γ で `γ²v` 扱い) → quadratic 係数破綻で高速 player に弾が当たらない経年バグ修正
- [`DESIGN.md §「共変表現の徹底」`](DESIGN.md) 銘記 + [`debris.ts`](src/components/game/debris.ts) particles を u_sp 化
- Causal Freeze overlay UI (i18n: 因果律凍結 / Causal Freeze + サブ「他機の未来光円錐内」)
- 新 test 19 本 ([causalEvents.test.ts](src/components/game/causalEvents.test.ts) + [checkCausalFreeze.test.ts](src/components/game/checkCausalFreeze.test.ts))

**[`8c02c0f`](https://github.com/sogebu/LorentzArena/commit/8c02c0f) stale 復帰 ballistic catchup self-authoritative**:
- [`ballisticCatchupPhaseSpace`](src/components/game/gameLoop.ts) を thrust + friction + energy 込みに拡張 (= odakin (c) 案、 通常 tick 物理を sub-step 再生)。 「最後 thrust」 は `phaseSpace.alpha` (= 既存 broadcast 内の pure thrust 4-加速度) を `lorentzBoost(u)` で rest 系に逆変換して継続適用、 燃料切れで自動停止 → 暴走防止 + terminal velocity 達
- 旧仕様 (= friction のみ sub-step loop) は名前に反して u が指数減衰 → 復帰時速度 0 戻り bug の根因
- [`messageHandler.ts`](src/components/game/messageHandler.ts) stale 復帰経路の host 側 ballistic 計算撤去 → staleFrozen 解除のみ + self-authoritative phaseSpace 経路に流す
- 復帰 `state.pos` を `displayPos(_, ORIGIN, L)` で (0,0) cell wrap (= cell 跨ぎ後 broadcast でも他 peer 整合)

### 設計思想 (永続化、 別 task でも参照)

- **共変表現の徹底**: 内部表現は共変量 (`phaseSpace.u: Vector3` = γv が正本)、 ut=γ は必要時のみ `sqrt(1+|u|²)` で給与。 詳細 [`DESIGN.md §「共変表現の徹底」`](DESIGN.md)
- **「実体は (0,0) cell に閉じる」**: PBC torus universe で全ての物理量は (0,0) cell 内、 universal cover の他 image cells は描画コピー。 observer-centered minimum image folding で距離 / past cone 判定
- **self-authoritative pattern**: state 計算 (= ballistic 復帰位置) は本人 client が行い broadcast、 host 側で再計算しない (= Authority 解体 architecture と整合)

## 既知の課題

### defer 中
- DESIGN.md 残存する設計臭 #2 (PeerProvider Phase 1 effect コールバックネスト)
- snapshot に `frozenWorldLines` / `debrisRecords` 同梱 — un-defer: リスポーン世界線連続観測時
- host migration の LH 時刻 anchor 見直し
- 色調をポップで明るく (方向性未定)
- スマホ横画面 (fullscreen 表示) 対応
- **ballistic 軌跡 frozenWorldLines 描画** — 死から復帰までの世界線連続性、 odakin defer 判断 2026-04-28

### マルチプレイ state バグ 5 点 (全修正済 → 再発監視のみ)
詳細 [`plans/2026-04-20-multiplayer-state-bugs.md`](plans/2026-04-20-multiplayer-state-bugs.md)

### パフォーマンス
- `appendWorldLine` O(n) → ring buffer
- useMemo 毎フレーム再計算 → カリング
- `MAX_WORLDLINE_HISTORY` 1000 → 5000 復帰

## 次にやること

### 最優先: 2026-04-28 fix 群の実機検証 + deploy

http://localhost:5174/LorentzArena/?fresh=N#room=test を 3+ tabs で:

1. 撃破イベント (deathFlash + kill notification + score) が **他 cell 位置でも** trigger
2. spawn ring: 他機 (人 / 灯台) で出る + 自機 spawn が連発しない
3. 燃料消費: 跨ぎ後も正常、 LH AI が高速 player に当たる
4. **stale catchup**: 静止 / 漂流 / thrust 押しっぱ + 燃料切れ + 暴走なし、 復帰 pos が (0,0) cell wrap、 速度継承
5. Causal Freeze overlay 表示 / 解除タイミング正しい (i18n 切替も)
6. debris visual 大幅崩れなし

OK 出れば `pnpm run deploy` + main push、 build 値報告 (= odakin スマホ HUD で照合)。

### Phase 2 議論 (別 task、 実機 OK 後)

universal cover refactor の他 phase (ship / worldLine / debris / laser renderer) も今回の **observer-centered minimum image folding** pattern で統一するか議論。 現状 causalEvents だけ新仕様、 他 phase は既存 obsCell 入り dx。 視覚的不整合 (= event は (0,0) cell 来るが ship は raw cell に居る) が出るかは実機確認後判断。

### Appendix D 残タスク (詳細 [`plans/2026-04-27-pbc-torus.md`](plans/2026-04-27-pbc-torus.md))

- Phase D (b) 残り: 補助 marker 4 種 (DeathMarker / HeadingMarkerRenderer / AntennaBeaconRenderer / レーザー emission marker) の 9 image 化
- 因果律ガード設計の続き (= 今回 (0,0) wrap + 1.5s grace で短期治癒、 長期 hysteresis 議論残)
- innerHide dispatch (b-1/b-2/b-3) odakin visual 判断
- timeFade に spatial fade 追加 (任意)
- 過去光円錐 ∩ 正方形枠 交線描画 (低優先 nice-to-have)
