# CLAUDE.md — LorentzArena 2+1

2+1 次元時空図アリーナ (x-y-t)。three.js + React Three Fiber。全リポ共通の規約は `CONVENTIONS.md` (リポルートの symlink) を参照。

**詳細アーキテクチャは [`docs/architecture.md`](docs/architecture.md) を参照** (file-by-file / store / message / Relay security / 主要機能)。設計 rationale は [`DESIGN.md`](DESIGN.md)、option space は [`EXPLORING.md`](EXPLORING.md)、現在の作業状態は [`SESSION.md`](SESSION.md)。

## コマンド

```bash
pnpm install && pnpm dev       # PeerJS モード（http://localhost:5173/LorentzArena/）
pnpm dev:wsrelay               # WS Relay モード（relay-server 同時起動）
pnpm run build                 # vite build のみ (typecheck は別 script、DESIGN.md §build と typecheck の分離)
pnpm run typecheck             # tsc -b (deploy pipeline 非ブロック、明示実行)
pnpm run deploy                # GitHub Pages デプロイ (build + gh-pages branch push)
pnpm run lint                  # Biome linter
pnpm run format                # Biome formatter
pnpm run test                  # Vitest (1 回実行)
pnpm run test:watch            # Vitest ウォッチモード
pnpm run analyze               # バンドルサイズ分析
```

## テスト (Vitest)

現有 test: `worldLine.test.ts` (光円錐交差 binary search regression 11 本)、`messageHandler.test.ts` (phaseSpace migration gap 4 本)、`snapshot.test.ts` (applySnapshot migration path 4 本 + buildSnapshot LH ownerId rewrite 1 本)、`LightConeRenderer.test.ts` (判別式 3 regime)。

物理コア (pure 関数) の TDD 運用 (旧実装 `*Linear` 残存 → test 先行 → 新実装切替) は DESIGN.md §worldLine.history サイズ + メタ原則 M15/M17。

## テスト・デプロイの使い分け

- **スマホ操作に関係しない変更** (エフェクト、ゲームロジック、HUD 等) は **localhost でテスト** → push/deploy。GitHub Pages キャッシュ反映遅いので毎回 deploy は非効率。視覚的・動作的に観察可能な変更は **deploy 前に odakin に localhost URL (`http://localhost:5173/LorentzArena/`) を提示して OK を得てから** push/deploy (規約: `claude-config/conventions/preview.md`)
- **スマホ実機テストが必要な変更** (タッチ、レスポンシブ、ジェスチャ等) は deploy して実機確認

## Deploy 後の報告ルール

`pnpm run deploy` 時は **ソースコードも commit + push すること** (deploy は gh-pages ブランチのみで main は自動 push されない)。

deploy 後に報告する項目:
- 本番 URL: https://sogebu.github.io/LorentzArena/
- build 値 (取得: `grep -oE '[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9:]+' dist/assets/index-*.js | head -1`)。odakin がスマホ HUD で表示される build 値と照合してキャッシュ更新を確認

## Deploy 前に dev server を `pkill` しないこと

**してはいけない**: `pkill -f "vite"` で background dev server を殺してから `pnpm run deploy`。
- `pnpm run deploy` (= `vite build` → `gh-pages`) は dev server に依存しない (port 5173 を使うのは dev 側だけ、build は別 process)
- `Bash(run_in_background: true)` で起動した dev server task が SIGTERM (exit 143) で死ぬと、harness は **「Background command 'Restart dev server' failed」通知を出す** (= 異常終了として report)
- 動作上は無害だが notification noise になる、odakin が「失敗した?」と惑う原因
- **正しい運用**: deploy 時は dev server に触らない。HMR が動いてれば preview URL もそのまま生きてるので、deploy 前後の動作確認は localhost で完結
- どうしても止めたい場合 (port 競合 etc.) は harness の task ID で stop すれば graceful 扱いになる可能性あり (`pkill` は harness を経由しないのが問題)

## 操作系・機体形状・境界モードの隠しオプション (URL hash override)

操作系 (`controlScheme`)・機体形状 (`viewMode`)・境界モード (`boundaryMode`) は直交軸として独立に持ち、 各軸の値すべてコードに保持。

- **`controlScheme` / `viewMode`**: UI dropdown を Lobby (タイトル画面、ship preview と並ぶ) と HUD ControlPanel (in-arena 左上) の 2 ヶ所に復活 (2026-05-02)。 同時に URL hash override / LS 直接編集も従来通り併存。
- **`boundaryMode` / `arenaWallsVisible` / `openCylinderShape`**: UI 無し、 切替は **URL hash override** または LS 直接編集のみ (隠しオプションのまま)。

| 軸 | 値 | デフォルト | LS key |
|---|---|---|---|
| `controlScheme` | `legacy_classic` / `legacy_shooter` / `modern` | `legacy_classic` | `la-control-scheme` |
| `viewMode` | `classic` / `shooter` / `jellyfish` | `classic` | `la-view-mode` |
| `boundaryMode` | `torus` / `open_cylinder` | `open_cylinder` | `la-boundary-mode` |
| `arenaWallsVisible` (= torus 専用) | `walls=show` / `walls=hide` | `hide` (= 非表示) | `la-arena-walls-visible` (`"1"` / `"0"`) |
| `openCylinderShape` (= open_cylinder 専用) | `shape=square` / `shape=cylinder` | `square` (= 正四角柱) | `la-open-cylinder-shape` |

### URL hash 形式

`&` 区切りで `key=value` 併用可、値なしフラグ (例: `viewer`) も同居可。[`App.tsx:parseHash`](src/App.tsx) で起動時 1 回 store に適用、適用と同時に LS (`la-control-scheme` / `la-view-mode`) に persist → 次回 hash 無しでも維持。

```
#room=test                                   → デフォルト (legacy_classic × classic × open_cylinder × 正四角柱)
#room=test&controls=modern                   → 71e5788 の新統一操作系
#room=test&controls=legacy_shooter           → 旧 twin-stick
#room=test&ship=jellyfish                    → クラゲ機体
#room=test&boundary=torus                    → PBC torus アリーナ (= 物理的閉じ込め有り、 一旦 default から外した)
#room=test&boundary=torus&walls=show         → torus PBC + 正方形枠を表示
#room=test&shape=cylinder                    → open_cylinder mode の旧視覚円柱 (隠しオプション)
#room=test&controls=modern&ship=shooter&boundary=torus  → 全部 override
```

### デフォルトに戻す

LS を削除 + reload:
```js
localStorage.removeItem('la-control-scheme');
localStorage.removeItem('la-view-mode');
localStorage.removeItem('la-boundary-mode');
localStorage.removeItem('la-arena-walls-visible');
localStorage.removeItem('la-open-cylinder-shape');
location.reload();
```

### 維持の意図

新操作系 (modern) は 71e5788 で導入したが 2026-04-27 の実機テストで没入感が薄いと判断、デフォルトを旧 classic に戻した。**3 種すべてコード保持**して隠しオプション化していたが、2026-05-02 に 2 段 dropdown (操作系 / 機体形状) を Lobby + ControlPanel に復活 (= 事前想定通りの配置)。`game-store.ts` の `setControlScheme` / `setViewMode` setter にそのまま wire。背景の Lobby ShipPreview は `viewMode` 連動 (`shooter` ⇒ rocket hull / `jellyfish` ⇒ jellyfish renderer) で即時反映する。

### 各 controlScheme の挙動

**`legacy_classic` (default、 71e5788^ 旧 classic 復元)**:
- WASD = 機体相対 thrust (前後左右、 yaw 基底に投影)
- 矢印 ←/→ = `headingYawRef` 連続旋回 + camera 同期 (cameraYawRef = headingYawRef)、 矢印 ↑/↓ = camera pitch
- 機体本体 group が heading で回転、 cannonYawGroup は 0 (本体に固定)、 噴射方向は world thrust を local frame に inverse rotate
- aim 線 (HeadingMarkerRenderer) **非表示** (= 本体 hull が heading を示すため冗長)

**`legacy_shooter` (旧 twin-stick、 71e5788^ 旧 shooter 復元)**:
- WASD = camera basis での進みたい方向 → heading 即時スナップ + thrust
- 矢印 ←/→ = `cameraYawRef` 旋回 (camera が機体周りを回る、 heading は WASD で別途決定)
- 機体本体は heading で回転 (twin-stick 風)、 aim 線 表示 (opacity 0.22)

**`modern` (71e5788 で導入)**:
- WASD = world basis (cameraYaw=0 前提) thrust、 heading 不変
- 矢印 ←/→ = `headingYawRef` 旋回 (砲身/aim のみ)、 camera は固定
- 機体本体は world basis 固定 + 砲塔のみ heading 追従、 噴射方向は world thrust そのまま、 aim 線 表示 (opacity 0.22)
- 詳細: [`gameLoop.ts:processPlayerPhysics`](src/components/game/gameLoop.ts), [`useGameLoop.ts`](src/hooks/useGameLoop.ts), [`SceneContent.tsx`](src/components/game/SceneContent.tsx), [`SelfShipRenderer.tsx`](src/components/game/SelfShipRenderer.tsx) の controlScheme 分岐

### 機体形状 dispatch (SceneContent)

- **classic** ([`SelfShipRenderer`](src/components/game/SelfShipRenderer.tsx)): 六角プリズム + 4 RCS。 controlScheme で本体 group rotation を切替 (legacy 系で本体 heading 回転 + 噴射 yaw 変換、 modern で本体固定 + 砲塔のみ)
- **shooter** ([`RocketShipRenderer`](src/components/game/RocketShipRenderer.tsx)): ロケット teardrop body。 砲が無いので本体ごと heading 追従 (lerp tau=80ms)
- **jellyfish** ([`JellyfishShipRenderer`](src/components/game/JellyfishShipRenderer.tsx)): 半透明 dome + Verlet rope 触手 14 質点 + 武装触手 (= 砲) のみ heading 方向。 ジャパクリップ「クラゲ」 motif の procedural 派生

## ShipViewer ルート (`#viewer`)

`src/components/ShipViewer.tsx` はゲーム本体 (PeerProvider / GameStore / 光円錐 / network) を一切起動せず、自機 3D モデル (`SelfShipRenderer`) を 360° 回転 / thrust 9 方向ボタン / grid / BG 切替で preview する独立 scene。`http://localhost:5173/LorentzArena/#viewer` (本番も `https://sogebu.github.io/LorentzArena/#viewer`) で起動。`App.tsx` 冒頭で `window.location.hash === '#viewer'` 判定して分岐。

**用途**: 機体形状・色・スケールの design イテレートを高速に回す (ゲーム state 不要、HMR が即反映)。

**OrbitControls は `three/examples/jsm/controls/OrbitControls.js` から直 import** (drei 経由ではなく)。理由:
- 2026-04-19 に `@react-three/drei` minified bundle が AVG antivirus に `JS:Prontexi-Z [Trj]` 誤検知され Vite optimize 直後に bundle が quarantine 削除 → 真っ白事故
- ShipViewer は OrbitControls 1 機能しか drei から使っていなかった → three native 直 import で drei 依存ごと撤去
- 今後も drei 追加は「単機能のために重い meta-package を入れる」リスクとして警戒すること

詳細は `design/rendering.md` §自機 SelfShipRenderer。

## ローカルプレビュー注意点

- **ルーム分離**: `#room=<名前>` で分離。本番 (sogebu.github.io) がルーム `default` を使うため localhost テストは `#room=test` 等別ルーム必須 (同名だと `la-default` ID 衝突)
- **preview_start 使用時**: launch.json の `lorentz-arena`、起動後は localhost URL をリンクで出力 (`~/Claude/CLAUDE.md` 規約)。**preview ブラウザは PeerJS ID `la-{roomName}` を取得してしまう** — マルチタブテストには使わず `pnpm dev` バックグラウンド起動のみ
- **HMR と module-level 定数**: `OFFSET = Date.now()/1000` のような定数変更後は**全タブ手動リロード** (HMR 反映後も評価済み値キャッシュあり)
- **HMR の Provider 再マウント副作用**: `physics/` / `stores/` 編集直後 PeerProvider / zustand store が再マウントされ自機マーカー・光円錐・世界線・Speedometer が全消えすることあり。コードバグ誤認に注意 — ハードリロード (Cmd+Shift+R) + 再 START で復帰するなら HMR 副作用 (DESIGN.md メタ原則 M15)。**特殊ケース: PeerProvider re-mount で `localIdRef` が再生成され myId が変わるが zustand store は singleton で残存** → 自分が host で残ったまま LH.ownerId が旧 myId に固着し LH AI 沈黙、ということがあり得る。assumeHostRole 経由しないため (Phase 1 = `setAsBeaconHolder` 直呼び)、init effect 側の LH rewrite を 2026-04-19 に削除した影響でこの dev-only 経路は救済されない。production では `localIdRef` が tab grace 復帰で同じ ID を維持するため発生しない。Cmd+Shift+R で zustand リセットして解消
- **preview_eval で store 覗く quirk**: `await import('.../game-store.ts')` は別 fresh インスタンスが返る (Vite ESM registry がリクエスト経路で分かれる)。debug は HUD screenshot か `window.__store = useGameStore` を HMR 挿入
- **single-tab preview でカバーできる範囲**: beacon holder 自己 death/respawn、LH kill/respawn、scoring UI、handleKill / selector。**できない範囲**: snapshot 新規 join、relay 経由 kill/respawn、client↔client、beacon migration (multi-tab を odakin に検証依頼)
- **Claude Preview 動的挙動検証不能問題**: Claude Preview の headless Chrome は rAF / timer を強制 throttle するため、**game loop が走らず FPS 0**。death routing / hit 検出 / ghost 物理等の動的挙動は視覚検証不可能。一般機構・実測値・回避策は [`claude-config/conventions/preview.md §Claude Preview の headless throttling 制約`](../../claude-config/conventions/preview.md)。
  - LorentzArena 固有の影響範囲: damage / debris / hit / 死亡 routing / ghost 物理の検証は**全て実ブラウザ (`http://localhost:5173/LorentzArena/` multi-tab、または本番) を odakin に依頼**。単独 tab で完結する初期レンダ (ShipViewer の静止 preview 等) のみ `preview_screenshot` で撮れる。Pure 関数 (`debris.ts` 等) の入出力 assert は `preview_eval` + `await import('.../pure-module')` で可 (store は別 instance quirk で不可、§preview_eval quirk 参照)。Phase C1 hit debris 例: `generateHitParticles` の scatter 方向を stationary + laser → mean dx ≈ 0.693 ≈ 1/√2、u=(0,0.8) + laser(x) → (0.608, 0.480) で検証済。

## R3F 落とし穴 (2026-05-02 知見、 詳細は DESIGN.md §因果律対称化 + WebGL recovery)

- **`<Canvas onCreated>` / `useThree` 経由の listener attach は信頼できない**: HMR / Fast Refresh の干渉で fire しないケースが実機検証で発生。 確実に attach したい listener (= `webglcontextlost` 等の rare event) は **`useEffect` + `setInterval(200ms)` で `document.querySelectorAll('canvas')` を polling して DOM 直 attach** に倒す。 重複防止は `__webglLostAttached` 等の flag で管理。 LorentzArena 実装は `RelativisticGame.tsx` の useEffect。
- **`useMemo` deps に毎 tick 変わる object 参照を入れると throttle が死ぬ**: `appendWorldLine` 等の immutable update で毎 tick 新 object 参照になる state を `useMemo` deps に直接含めると、 `Math.floor(version/N)` のような量子化 throttle 値があっても **dep 配列のいずれかが変わる時点で memo 再計算** される (= `wl` が毎 tick 変わる以上 `geoVersion` の変化を待たずに再計算)。 修正: `useRef` で latest 参照を保持 (`refX.current = obj` を毎 render)、 `useMemo` body 内で `refX.current` を読む、 deps から object 自体を撤去する。 `WorldLineRenderer.tsx` の wlRef pattern が実装例。 これを怠ると重 rebuild が毎 tick 走り main thread saturation → setInterval Violation 累積 → rAF starve → 全世界凍結 → GPU 圧で WebGL Context Lost、 という連鎖を起こす (= 5/2 観測 Bug 10)。
- **WebGL Context Lost は invisible recovery 設計が現実的**: GPU/OS は外部要因 (= macOS の background tab 解放、 driver reset、 power saving 等) で context を reclaim するため「起こさない」 は不可能。 「起きても気付かない」 設計に倒す: store に `canvasGeneration: number` を持ち、 polling listener で `webglcontextlost` 検知時 `incrementCanvasGeneration()` → `<Canvas key="...-gen{N}">` が変化 → React unmount + remount → R3F が新 WebGL context 作成 → scene tree 再構築 (= zustand store は preserve、 user は 1-2 frame の flash で済む)。 連続 loss (= 1.5s 以内 2 回目) のみ catastrophic とみなして escape hatch overlay (= `WebGLLostOverlay`) で「再読込」 UI を出す 2 段構成。

## ネットワーク設定

`.env.local` (この `2+1/` 直下) で設定:

```bash
VITE_TURN_CREDENTIAL_URL=      # Cloudflare Worker URL (動的 TURN credential 発行)
VITE_NETWORK_TRANSPORT=auto    # peerjs | wsrelay | auto
VITE_WS_RELAY_URL=             # WS Relay 用 URL
VITE_PEERJS_HOST=0.peerjs.com  # PeerServer ホスト
VITE_WEBRTC_ICE_SERVERS=       # JSON 配列 (RTCIceServer[])。TURN_CREDENTIAL_URL 未設定時の静的フォールバック
VITE_WEBRTC_ICE_TRANSPORT_POLICY=  # "all" | "relay"
```

学校・企業 NW で P2P が塞がれる場合は `VITE_TURN_CREDENTIAL_URL` に Cloudflare TURN Worker URL を設定。本番は `.env.production` に設定済。Worker ソースは `turn-worker/`。

ICE servers 優先順位: dynamic (Worker fetch) > static (`VITE_WEBRTC_ICE_SERVERS`) > PeerJS defaults。

詳細: `../docs/NETWORKING.ja.md`、`turn-worker/wrangler.toml`、`relay-deploy/README.md`

## アーキテクチャ超要約

session 冒頭の orientation 用。各項目の詳細は [`docs/architecture.md`](docs/architecture.md):

- **描画**: D pattern (world 座標 + per-vertex Lorentz 変換、`DisplayFrameContext` + `buildMeshMatrix`) で全物理オブジェクトを統一、3+1 化時は boost matrix 差し替えのみ。**例外 (C pattern)**: 球ジオメトリ (γ 楕円化回避のため display 並進のみ) + 自機 Exhaust v0 (他機対応で D pattern 化予定)
- **物理**: c = 1、ファクトリパターン、`src/physics/` に純関数群 (vector / matrix / mechanics / worldLine、交差計算は binary search O(log N+K))
- **ネットワーク**: PeerJS/WebRTC + WS Relay fallback。beacon pattern (`la-{roomName}` で host discovery + redirect、ハートビート 1s/2.5s)。**Authority 解体 Stage A〜H 完了**: target-authoritative (phaseSpace/laser/kill/respawn は owner 発信)、beacon holder は relay hub + LH owner 兼任 + snapshot 送信
- **State**: zustand `game-store.ts`、event log (`killLog` / `respawnLog`) が source of truth、selectors で derive (`selectIsDead` / `selectInvincibleUntil` 等)
- **Message**: discriminated union、canonical は `src/types/message.ts` (phaseSpace / peerList / laser / kill / hit / respawn / ping / intro / redirect / snapshot / snapshotRequest)。validation + handler は `src/components/game/messageHandler.ts`
- **ゲームパラメータ**: `src/components/game/constants.ts` が canonical (値 + JSDoc + section コメント分類)。CLAUDE.md / docs 側に table 重複を置かず、code が single source of truth

## ビルド設定

- Vite + React 19 + TypeScript 5.8 + three.js + R3F
- Biome (linter/formatter): ダブルクォート、2 スペースインデント
- `__BUILD_TIME__` — Vite define でビルド時刻埋め込み (HUD 表示用)
- base path: `/LorentzArena/` (GitHub Pages)

## 参照ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — アーキテクチャ詳細 (file-by-file / store / messages / 主要機能 / Relay security)
- [`DESIGN.md`](DESIGN.md) — 設計判断の記録
- [`EXPLORING.md`](EXPLORING.md) — option space 探索
- [`SESSION.md`](SESSION.md) — 現在の作業状態
- `plans/` — 複数 Stage リファクタの計画書 (`2026-04-14-authority-dissolution.md` 完了、`2026-04-15-design-reorg.md` 完了、`2026-04-18-design-reorg.md` §7 retroactive、`2026-04-18-claude-md-delegation-level2.md` 本 migration の設計、`2026-04-19-host-migration-symmetry.md` host migration 5 点修正の post-mortem)
- `../CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md` (symlink)
- `../docs/NETWORKING.md` — ネットワーク設定の詳細
- `relay-deploy/README.md` — WS Relay 本番デプロイ手順
- `src/components/game/constants.ts` — ゲームパラメータ canonical
- `src/types/message.ts` — メッセージ型 canonical
