# CLAUDE.md — LorentzArena

Claude Code 作業マニュアル。全リポ共通の規約は `CONVENTIONS.md`（claude-config の symlink）を参照。

## プロジェクト構成

2つの独立したフロントエンドアプリで構成（**メインは 2+1**）:

| ディレクトリ | 内容 | 時空次元 | CLAUDE.md |
|---|---|---|---|
| `/2+1/` | 2+1 時空図アリーナ (x-y-t)、three.js + R3F | 2+1 | `2+1/CLAUDE.md` |
| `/1+1/` | 1+1 時空図レンダラー (x-t)、legacy | 1+1 | （なし、ソースのみ） |

GitHub Pages デプロイは `2+1/` が本番。リポルートの `package.json` は薄い wrapper で、`pnpm run deploy` 等を `2+1/` に委譲する。
デプロイ後は必ずリンクを出力すること: https://sogebu.github.io/LorentzArena/

**作業の主戦場は `2+1/CLAUDE.md`。** このファイルはリポ全体の概観。

## コマンド（ルート wrapper → 2+1 に委譲）

```bash
pnpm dev                       # 2+1 の dev サーバー
pnpm run build                 # 2+1 ビルド (vite build のみ、型検査は含まない)
pnpm run typecheck             # 2+1 の tsc -b (deploy pipeline から分離、明示実行)
pnpm run deploy                # 2+1 を GitHub Pages へ
pnpm run test                  # 2+1 の Vitest
pnpm run lint                  # 2+1 の Biome linter
pnpm run format                # 2+1 の Biome formatter
```

`build` から `tsc -b` を分離している理由は `DESIGN.md` §build/typecheck 分離。

1+1 を触る時は `cd 1+1 && pnpm install && pnpm dev`。

## 参照ドキュメント

- `2+1/CLAUDE.md` — 2+1 アプリの詳細（アーキテクチャ、パラメータ、ビルド設定）
- `2+1/DESIGN.md` — 2+1 の設計判断
- `2+1/SESSION.md` — 2+1 の作業状態
- `CONVENTIONS.md` → `~/Claude/claude-config/CONVENTIONS.md`（symlink）
- `docs/NETWORKING.md` — ネットワーク設定の詳細
- `docs/ARCHITECTURE.md` — アーキテクチャ概要
