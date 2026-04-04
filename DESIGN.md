# DESIGN.md — LorentzArena

## 設計判断の記録

### プロジェクト構成: ルート (1+1) と 2+1 の分離

- **What**: ルートに 1+1 時空図、`2+1/` に 2+1 時空図アリーナを独立したアプリとして配置。各アプリに独自の CLAUDE.md / SESSION.md / DESIGN.md を持つ
- **Why**: 次元ごとに描画・操作・依存関係が大きく異なる（1+1 は 2D Canvas、2+1 は three.js + R3F）。ドキュメントもアプリ固有の情報はアプリ直下に置くことで、Claude Code がディレクトリ階層で CLAUDE.md を読む仕組みと整合する
- **Tradeoff**: GitHub Pages デプロイが一方のみ（現在は 2+1）。共通の物理エンジンが重複

2+1 の設計判断は `2+1/DESIGN.md` を参照。
