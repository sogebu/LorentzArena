# DESIGN.md — LorentzArena

## 設計判断の記録

### プロジェクト構成: 1+1 (legacy) と 2+1 (メイン) の分離

- **What**: `1+1/` に 1+1 時空図プロトタイプ (legacy)、`2+1/` に 2+1 時空図アリーナ (メイン) を独立したアプリとして配置。メインの `2+1/` は独自の CLAUDE.md / SESSION.md / DESIGN.md / EXPLORING.md を持ち、`1+1/` はソースのみでメンテ停止
- **Why**: 次元ごとに描画・操作・依存関係が異なり、共通化すると両方の制約で苦しむ。ドキュメントもアプリ固有情報はアプリ直下に置くことで、Claude Code がディレクトリ階層で CLAUDE.md を読む仕組みと整合する
- **Tradeoff**: GitHub Pages デプロイは 2+1 のみ。ルート `package.json` は `2+1/` に委譲する thin wrapper (`pnpm dev` 等が repo root で動くようにするため)

2+1 の設計判断は `2+1/DESIGN.md` + `2+1/design/*.md` を参照。

### build と typecheck の分離

- **What**: `2+1/package.json` の `build` を `vite build` のみとし、`tsc -b` は `typecheck` として別 script 化。root `package.json` にも `typecheck` 委譲を追加
- **Why**: `0a6ef36` の root 遺物削除時、`2+1/tsconfig.json` の `references` が削除された root `../tsconfig.*.json` を指したまま残り、`files: []` と合わさって `tsc -b` が silent no-op になっていた。参照を `./tsconfig.{app,node}.json` (新設) に直すと Authority 解体期のドリフト型エラーが多数出る状態が露呈。`build` に `tsc -b` を含めると deploy pipeline がブロックされるため、まず分離して「deploy は従来通り可能」「typecheck は明示 script で健全化する」二段構えにした
- **Tradeoff**: `pnpm run build` では型エラーを検出できない。CI 或いは手動で `pnpm run typecheck` を走らせる discipline が必要。将来 `typecheck` が green になったら `build` に再統合する判断はあり
