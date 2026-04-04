# SESSION.md — LorentzArena

## 現在のステータス

2+1 アプリ対戦可能。GitHub Pages デプロイ済み（2026-04-05）。
https://sogebu.github.io/LorentzArena/

## 直近の変更（2026-04-05、コミット 0b2c808）

4軸レビューで 16 件修正・デプロイ済み。主な変更:
- **Performance**: WorldLine.version + TubeGeometry スロットリング、DebrisRenderer geometry leak 修正
- **Validation**: 全メッセージの文字列フィールド検証、laser color/range/score 検証強化
- **Safety**: deadPlayersRef 切断時クリア、pendingKillEvents/processedLasersRef 上限追加、a≈0 除算ガード
- **Relay**: レート制限 60msg/s、16KB サイズ制限、接続上限 100、heartbeat 30s
- **PeerProvider**: isRelayable() でリレー前バリデーション
- **SPAWN_RANGE**: 10→30

詳細は `git show 0b2c808` 参照。

## 既知の課題

- pastLightConeIntersectionWorldLine の PhaseSpace 補間 TODO（worldLine.ts:289）
- Caddyfile にセキュリティヘッダー（X-Frame-Options, CSP）未設定
- Docker Compose にリソース制限（memory/CPU limits）未設定

## 次にやること

- マルチプレイヤーテスト（バリデーション・パフォーマンス確認）
- キル通知に「KILL」テキストを 3D 空間に出す
- 各プレイヤーに固有時刻を表示（時間の遅れの実感用）
- 3+1 次元への拡張検討
