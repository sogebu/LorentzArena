# DESIGN.md — LorentzArena

## 設計判断の記録

### プロジェクト構成: 1+1 (legacy) と 2+1 (メイン) の分離

- **What**: `1+1/` に 1+1 時空図プロトタイプ (legacy)、`2+1/` に 2+1 時空図アリーナ (メイン) を独立したアプリとして配置。メインの `2+1/` は独自の CLAUDE.md / SESSION.md / DESIGN.md / EXPLORING.md を持ち、`1+1/` はソースのみでメンテ停止
- **Why**: 次元ごとに描画・操作・依存関係が異なり、共通化すると両方の制約で苦しむ。ドキュメントもアプリ固有情報はアプリ直下に置くことで、Claude Code がディレクトリ階層で CLAUDE.md を読む仕組みと整合する
- **Tradeoff**: GitHub Pages デプロイは 2+1 のみ。ルート `package.json` は `2+1/` に委譲する thin wrapper (`pnpm dev` 等が repo root で動くようにするため)

2+1 の設計判断は `2+1/DESIGN.md` + `2+1/design/*.md` を参照。
