export const ja = {
  // HUD - title & controls
  "hud.title": "相対論的アリーナ (2+1次元 時空図)",
  // ControlPanel.tsx で controlScheme 別に出し分け (= 移動 / 旋回 軸の意味が異なる)。
  // ↑/↓ (camera pitch) と Space (fire) は scheme 共通。
  // WASD 方向基準は 3 つ: 機体相対 (= 機体の前後左右) / 画面相対 (= camera の上下左右) /
  // 絶対方向 (= world basis 固定軸)。 旧 "画面基底" / "世界基底" は math jargon で UI に硬い
  // ため 2026-05-07 に統一名称に改名。
  "hud.controls.legacy_classic.move": "WASD: 前後左右 (機体相対)",
  "hud.controls.legacy_classic.heading": "←/→: 機体回転",
  "hud.controls.legacy_shooter.move": "WASD: 移動 (画面相対)",
  "hud.controls.legacy_shooter.heading": "←/→: 砲身旋回",
  "hud.controls.legacy_shooter.cameraRotate": "Shift+←/→: カメラ旋回",
  "hud.controls.modern.move": "WASD: 移動 (絶対方向)",
  "hud.controls.modern.heading": "←/→: 砲塔旋回",
  "hud.controls.cameraV": "↑/↓: カメラ上下回転",
  "hud.controls.fire": "スペースキー: レーザー発射",
  "hud.controls.touch.heading": "スワイプ ←→: 方向転換",
  "hud.controls.touch.thrust": "スワイプ ↑: 前進 ↓: 後退",
  "hud.controls.touch.fire": "ダブルタップ+ホールドで連射",
  // WebGL context loss overlay
  "webglLost.title": "描画 (WebGL) が一時停止しました",
  "webglLost.body":
    "ブラウザが GPU リソースを解放しました。 物理計算は内部で進んでいますが画面が固まって見えます。 「再読込」 で復帰できます。",
  "webglLost.reloadButton": "再読込",
  // Signaling layer (PeerJS WebSocket) lost overlay
  "signalingLost.title": "ネットワーク接続が失われました",
  "signalingLost.body":
    "PC のスリープや回線断で接続が切れたまま復帰できなくなりました。 「再読込」 で接続をやり直してください。",
  "signalingLost.reloadButton": "再読込",
  // Tutorial overlay (mobile only, shown once per browser)
  "tutorial.title": "操作方法",
  "tutorial.swipeHorizontal": "左右スワイプ：方向転換",
  "tutorial.swipeVertical": "上下スワイプ：前進・後退",
  "tutorial.fire": "ダブルタップ+ホールド：連射",
  "tutorial.dismissHint": "画面をタップして閉じる",
  // HUD - toggles
  "hud.restFrame": "静止系",
  "hud.worldFrame": "世界系",
  "hud.orthographic": "正射影",
  "hud.perspective": "透視投影",
  // 視点・操作系切替 (plans/2026-04-25-viewpoint-controls.md)
  // viewMode label = 機体形状 (= controlScheme と直交軸)。 値は形状ベース統一 (2026-05-07
  // odakin 指示「『従来』 じゃ意味分からん」 を受けて「ガンシップ / ロケット / クラゲ」 に統一)。
  // 内部 ID (classic / shooter / jellyfish) は LS / URL hash の後方互換性のため変更しない。
  // - ガンシップ (classic): 八角プリズム hull + 4 RCS + 懸架大砲 (旧 SelfShipRenderer)
  // - ロケット (shooter):   LatheGeometry teardrop body (RocketShipRenderer)
  // - クラゲ (jellyfish):   半透明 dome + Verlet 触手 (JellyfishShipRenderer)
  "hud.viewMode.classic": "ガンシップ",
  "hud.viewMode.shooter": "ロケット",
  "hud.viewMode.jellyfish": "クラゲ",
  "hud.viewMode.label": "機体",
  // 距離表示の単位 (= 内部は c=1 自然単位 = 光秒)。 CenterCompass 等で使う。
  "hud.distanceUnit": "光秒",
  "hud.center": "中心",
  // 操作系 (controlScheme = viewMode と直交軸、game-store.ts §ControlScheme)
  // label は機能を反映 (= 内部 ID legacy_classic / legacy_shooter / modern と decoupled、
  // 内部 ID は LS / URL hash の後方互換性のため変更しない):
  // - 機体追従: camera が機体の heading に追従して 1 軸で回る (= legacy_classic)
  // - ツインスティック: 移動 / aim / camera が独立 (= legacy_shooter、 Shift+矢印 で camera)
  // - カメラ固定: camera は world basis 固定、 砲塔のみ aim 追従 (= modern)
  "hud.controlScheme.label": "操作系",
  "hud.controlScheme.legacy_classic": "機体追従",
  "hud.controlScheme.legacy_shooter": "ツインスティック",
  "hud.controlScheme.modern": "カメラ固定",
  // PLC スライスモード (PR #2): 時空図 ↔ PLC slice (= 過去光円錐 spatial slice の x-y 平面)
  "hud.spacetime": "時空図",
  "hud.plcSlice": "PLCスライス",
  // HUD - stats
  "hud.speed": "速さ",
  "hud.gamma": "ガンマ因子",
  "hud.coordTime": "世界時刻",
  "hud.position": "位置",
  "hud.energy": "エネルギー",
  // エネルギー pool 枯渇表示 (Speedometer 内、 fire/thrust/damage 共用 pool)。 旧 "燃料枯渇"
  // (= 燃料は thrust 専用というニュアンス) は実体 (= energy 共用 pool) と齟齬があったので
  // 2026-05-07 に "エネルギー切れ" に改名し、 hud.energy "エネルギー" と語彙統一。
  "hud.fuelEmpty": "エネルギー切れ",
  // HUD - scoreboard
  "hud.kills": "撃破数",
  "hud.you": "自機",
  "hud.lighthouse": "灯台",
  // HUD - overlays (in-game state text)
  "hud.firing": "射撃中",
  "hud.kill": "撃破",
  "hud.dead": "被撃墜",
  "hud.causalFreeze.title": "因果律凍結",
  "hud.causalFreeze.sub": "他機の未来光円錐内",
  "hud.causalityJump.title": "因果律跳躍",
  "hud.causalityJump.sub": "他機の過去光円錐外へ",
  "hud.build": "ビルド",
  // Connect panel
  "connect.title": "接続設定",
  "connect.minimize": "最小化",
  "connect.expand": "展開",
  "connect.signaling.ok": "シグナリング: 接続OK",
  "connect.signaling.connecting": "シグナリング: 接続中...",
  "connect.signaling.disconnected": "シグナリング: 切断",
  "connect.signaling.error": "シグナリング: エラー",
  "connect.signaling.unknown": "シグナリング: 状態不明",
  "connect.transport": "通信方式",
  "connect.yourId": "あなたのID",
  "connect.generating": "生成中...",
  "connect.phase.tryingHost": "に接続中...（ホスト試行）",
  "connect.phase.connectingClient": "に接続中...（クライアント）",
  "connect.phase.host": "ホスト",
  "connect.phase.client": "クライアント",
  "connect.phase.manual": "手動接続モード",
  "connect.room": "ルーム",
  "connect.networkHelp":
    "学校/社内ネットワークだと WebRTC が塞がれて接続できないことがあります。",
  "connect.peers": "接続中の相手",
  // peer 接続状態 (Connect.tsx の 3 値)。 conn.open && !stale = peerOpen (= 接続確立 + 応答有)、
  // conn.open && stale = peerStale (= 接続は open だが応答が時間内に来ていない)、
  // !conn.open = peerClosed (= 接続が確立してない or 切れた)。
  // 2026-05-07: "接続中" は signaling phase の "接続中..." と紛らわしいので "接続済" に。
  // "接続準備中/失敗" は "/" 二重意味で曖昧なので "未接続" に。
  "connect.peerOpen": "接続済",
  "connect.peerStale": "応答なし",
  "connect.peerClosed": "未接続",
  "connect.networkSettings": "ネットワーク設定(env)",
  // Lobby
  "lobby.title": "Lorentz Arena",
  "lobby.subtitle": "相対論的マルチプレイヤー対戦アリーナ",
  "lobby.nameLabel": "プレイヤー名",
  "lobby.namePlaceholder": "名前を入力",
  "lobby.start": "開始",
  "lobby.highScores": "ハイスコア",
  "lobby.noScores": "まだ記録がありません",
  "lobby.kills": "撃破",
  "lobby.duration": "時間",
  "lobby.globalLeaderboard": "グローバルランキング",
  "lobby.loading": "読み込み中...",
} as const;

export type TranslationKey = keyof typeof ja;
