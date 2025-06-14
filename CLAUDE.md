# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際のClaude Code (claude.ai/code) へのガイダンスを提供します。

## プロジェクト概要

Lorentz Arenaは特殊相対性理論の効果を持つマルチプレイヤー対戦ゲームで、React、TypeScript、PeerJSを使用したピアツーピアネットワーキングで構築されています。

## コマンド

### 開発
- `npm run dev` - Viteで開発サーバーを起動
- `npm run build` - TypeScriptプロジェクトをビルドし、Viteでバンドル
- `npm run preview` - プロダクションビルドをプレビュー

### コード品質
- `npm run lint` - Biomeリンターを自動修正付きで実行
- `npm run format` - Biomeフォーマッターを自動修正付きで実行

### デプロイ
- `npm run deploy` - ビルドしてGitHub Pagesにデプロイ

## アーキテクチャ

### ピアツーピア通信
アプリケーションはプレイヤー間のWebRTC接続を確立するためにPeerJSを使用：
- `PeerManager` (src/PeerManager.ts) - ピア接続、メッセージハンドリング、接続状態を管理するコアクラス
- `PeerProvider` (src/PeerProvider.tsx) - PeerManagerをインスタンス化し、コンポーネントに提供するReactコンテキストプロバイダー
- メッセージタイプはPeerProviderでユニオン型として定義され、現在はテキストメッセージと位置更新をサポート

### コンポーネント構造
- `App.tsx` - 他のすべてをPeerProviderでラップするルートコンポーネント
- `Connect.tsx` - ピア接続UIを処理
- `Game.tsx` - プレイヤーの移動（矢印キー）とレンダリングを行うメインゲームアリーナ
- `Chat.tsx` - 接続されたピア間のテキストチャット機能

### ビルド設定
- ViteはGitHub Pagesデプロイ用にベースパス `/LorentzArena/` で設定
- TypeScript設定はアプリとノードコンテキスト用にプロジェクト参照を使用
- Biomeはダブルクォートと2スペースインデントでリンティングとフォーマッティングに使用
