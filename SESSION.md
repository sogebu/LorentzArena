# SESSION.md — LorentzArena

## 現在のステータス

2+1 アプリが対戦可能な状態。GitHub Pages にデプロイ済み。
https://sogebu.github.io/LorentzArena/

## 直近の作業（2026-04-04）

- マテリアルキャッシュ廃止 → R3F 宣言的マテリアル（仮色バグ修正）
- 世界系カメラをプレイヤー追随に変更（世界線の曲がりは摩擦が原因と判明）
- `worldLine` + `pastWorldLines` → `lives[]` 統合リファクタ
- 世界線の過去延長（origin + 半直線 + 因果的 trimming）実装
- ビーム opacity 0.8 → 0.4
- 因果律の守護者が実装済みであることを確認

## 既知の課題

- **リスポーンで世界線が繋がる**: respawn では完全に独立な世界線を0から作り直し、その最も過去のデータ（origin）を過去側に半直線として外装する。現状は kill〜respawn 間の遅延 phaseSpace が新 life に混入して繋がっている
- **デブリの世界線が表示されない**: `<line>` + `<bufferGeometry>` の描画パスが壊れている（原因未調査）
- デブリの GC 圧力（毎レンダーで Float32Array 再生成）

## 次にやること

- リスポーン世界線分離バグ修正
- デブリ世界線表示バグ修正
- RelativisticGame.tsx のファイル分割リファクタ（2000行→複数ファイル）
- 3+1 次元への拡張検討（カスタム頂点シェーダーが必要、DESIGN.md に記載済み）
