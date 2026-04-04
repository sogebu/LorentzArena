# SESSION.md — LorentzArena

## 現在のステータス

2+1 アプリが対戦可能な状態。GitHub Pages にデプロイ済み。
https://sogebu.github.io/LorentzArena/

## 直近の作業（2026-04-04）

- RelativisticGame.tsx ファイル分割リファクタ（1992→749行、`game/` に11ファイル）
- **Kill/Respawn メカニクス刷新**:
  - kill → 世界線凍結（`isDead` フラグ）、空 WorldLine 作成を廃止
  - 凍結世界線は他プレイヤーの過去光円錐と交点がある間は可視
  - 死亡中はゴースト（等速直線運動、不可視、カメラ回転可、光円錐表示）
  - respawn → 完全に独立した新 WorldLine（半直線延長なし）
  - `applyKill`/`applyRespawn` 純粋関数（`killRespawn.ts`）でホスト/クライアント共通化
  - `deadUntilRef`（タイマー）を削除、`isDead` フラグに一元化
- デブリ世界線: `<bufferAttribute>` 宣言的記法 → imperatively created `BufferGeometry`（R3F v9 互換）
- 初期配置範囲: テスト用に 30→10 に縮小中

## 既知の課題

- デブリの GC 圧力（毎フレーム BufferGeometry 再生成、observer 位置依存で不可避）
- 初期配置範囲がテスト値（10）のまま — 本番は 30 に戻す

## 次にやること

- マルチプレイヤーテストで kill/respawn の動作確認
- 初期配置範囲を本番値に戻す
- 3+1 次元への拡張検討（カスタム頂点シェーダーが必要、DESIGN.md に記載済み）
