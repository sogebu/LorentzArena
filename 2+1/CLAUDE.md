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

## ローカルプレビュー注意点

- **ルーム分離**: `#room=<名前>` で分離。本番 (sogebu.github.io) がルーム `default` を使うため localhost テストは `#room=test` 等別ルーム必須 (同名だと `la-default` ID 衝突)
- **preview_start 使用時**: launch.json の `lorentz-arena`、起動後は localhost URL をリンクで出力 (`~/Claude/CLAUDE.md` 規約)。**preview ブラウザは PeerJS ID `la-{roomName}` を取得してしまう** — マルチタブテストには使わず `pnpm dev` バックグラウンド起動のみ
- **HMR と module-level 定数**: `OFFSET = Date.now()/1000` のような定数変更後は**全タブ手動リロード** (HMR 反映後も評価済み値キャッシュあり)
- **HMR の Provider 再マウント副作用**: `physics/` / `stores/` 編集直後 PeerProvider / zustand store が再マウントされ自機マーカー・光円錐・世界線・Speedometer が全消えすることあり。コードバグ誤認に注意 — ハードリロード (Cmd+Shift+R) + 再 START で復帰するなら HMR 副作用 (DESIGN.md メタ原則 M15)
- **preview_eval で store 覗く quirk**: `await import('.../game-store.ts')` は別 fresh インスタンスが返る (Vite ESM registry がリクエスト経路で分かれる)。debug は HUD screenshot か `window.__store = useGameStore` を HMR 挿入
- **single-tab preview でカバーできる範囲**: beacon holder 自己 death/respawn、LH kill/respawn、scoring UI、handleKill / selector。**できない範囲**: snapshot 新規 join、relay 経由 kill/respawn、client↔client、beacon migration (multi-tab を odakin に検証依頼)
- **Claude Preview `document.hidden=true` 問題**: Claude Preview の headless ブラウザは `document.hidden` が常時 `true` を返し、`useGameLoop.ts` の visibilitychange ガード (§UI visibilitychange) が毎 tick 早期 return → **FPS 0 / プレイヤー停止 / LH 発射なし / kill / 被弾検出なし**。Speedometer HUD は 0 固定、`preview_screenshot` で見ても「止まった時空」が映るだけ。**帰結**: Claude Preview で動的ゲーム挙動 (damage, debris, hit detection, ghost 物理) の視覚検証は **不可能**。回避策: (a) `preview_eval` + `await import('.../pure-module')` で stateless 関数は unit-test 可能 (例: `debris.ts` の `generateHitParticles` は `victimU` と `laserDir` から決定論的に particle 方向を返すので `preview_eval` で平均 dx 等を assert できる。store は別 instance quirk で不可 — §preview_eval quirk 参照)、(b) stateful 挙動は localhost (`http://localhost:5173/LorentzArena/`) を odakin に渡して実機検証依頼。Phase C1 hit debris の scatter 方向は (a) で検証済 (stationary+laser → mean dx ≈ 0.693 ≈ 1/√2、u=(0,0.8)+laser(x) → (0.608, 0.480))、visual verification は odakin が localhost で実施

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
- `plans/` — 複数 Stage リファクタの計画書 (`2026-04-14-authority-dissolution.md` 完了、`2026-04-15-design-reorg.md` 完了、`2026-04-18-design-reorg.md` §7 retroactive、`2026-04-18-claude-md-delegation-level2.md` 本 migration の設計)
- `../CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md` (symlink)
- `../docs/NETWORKING.md` — ネットワーク設定の詳細
- `relay-deploy/README.md` — WS Relay 本番デプロイ手順
- `src/components/game/constants.ts` — ゲームパラメータ canonical
- `src/types/message.ts` — メッセージ型 canonical
