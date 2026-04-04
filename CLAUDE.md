# CLAUDE.md — LorentzArena

Claude Code 作業マニュアル。全リポ共通の規約は `CONVENTIONS.md`（claude-config の symlink）を参照。

## プロジェクト構成

2つの独立したフロントエンドアプリで構成:

| ディレクトリ | 内容 | 時空次元 | CLAUDE.md |
|---|---|---|---|
| `/` (root) | 1+1 時空図レンダラー (x-t) | 1+1 | このファイル |
| `/2+1/` | 2+1 時空図アリーナ (x-y-t)、three.js + R3F | 2+1 | `2+1/CLAUDE.md` |

GitHub Pages デプロイは `2+1/` が本番（`cd 2+1 && pnpm run deploy`）。
デプロイ後は必ずリンクを出力すること: https://sogebu.github.io/LorentzArena/

**2+1 の作業は `2+1/CLAUDE.md` を参照。** このファイルはリポ全体の概観と 1+1 アプリ用。

## コマンド（ルート / 1+1）

```bash
pnpm install && pnpm dev       # 開発サーバー
pnpm run build                 # ビルド
```

## 参照ドキュメント

- `2+1/CLAUDE.md` — 2+1 アプリの詳細（アーキテクチャ、パラメータ、ビルド設定）
- `2+1/DESIGN.md` — 2+1 の設計判断
- `2+1/SESSION.md` — 2+1 の作業状態
- `CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md`（symlink）
- `docs/NETWORKING.md` — ネットワーク設定の詳細
- `docs/ARCHITECTURE.md` — アーキテクチャ概要
