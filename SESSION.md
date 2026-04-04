# SESSION.md — LorentzArena

## 現在のステータス

2+1 アプリが対戦可能な状態。GitHub Pages にデプロイ済み。
https://sogebu.github.io/LorentzArena/

## 直近の作業（2026-04-04）

- 自動接続（PeerJS の unavailable-id 検出でホスト/クライアント自動判別）
- 即死 + 1秒後リスポーン（ホスト権威）
- キルスコア、キル通知エフェクト、死亡フラッシュ
- 永続デブリ（死亡イベントから飛散するパーティクルの世界線 + 過去光円錐交差マーカー）
- 世界線切断（kill 時に即座に pastWorldLines に退避）
- WorldLine 描画最適化（ローレンツ変換を THREE.js Matrix4 で適用、geometry 再生成不要）
- 正射影カメラ（角度保存、パースペクティブとトグル）
- 世界系カメラ固定（空間位置固定、時間のみ追尾 — デバッグ用）
- ホストによる色割り当て（playerColor メッセージ、pendingColorsRef で到着順問題解決）
- syncTime で新規クライアントの世界系 t をホストに同期
- setInterval(8ms) でタブ非アクティブ時もゲームループ継続
- アニメーション爆発を削除（永続デブリで代替）
- kill メッセージに hitPos（レーザー交差点）を追加
- dead code 整理（Explosion 型、ExplosionRenderer 等 143行削除）

## 既知の課題

- 色がホスト/クライアント間で完全一致しないケースがある（タイミング依存）
- 世界系カメラの固定位置 (15,15) はデバッグ用。本番では要調整
- デブリの `<line>` + `<bufferGeometry>` が毎レンダーで Float32Array を再生成（GC 圧力）

## 次にやること

- デブリの世界線表示の最適化（WorldLineRenderer と同じ行列最適化の適用）
- 3+1 次元への拡張検討（カスタム頂点シェーダーが必要、DESIGN.md に記載済み）
