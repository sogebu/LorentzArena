export const ja = {
  // HUD - title & controls
  "hud.title": "相対論的アリーナ (2+1次元 時空図)",
  "hud.controls.forward": "WASD: 前後左右 (機体相対)",
  "hud.controls.cameraH": "←/→: 機体回転",
  "hud.controls.cameraV": "↑/↓: カメラ上下回転",
  "hud.controls.fire": "スペースキー: レーザー発射",
  "hud.controls.touch.heading": "スワイプ ←→: 方向転換",
  "hud.controls.touch.thrust": "スワイプ ↑: 前進 ↓: 後退",
  "hud.controls.touch.fire": "ダブルタップ+ホールドで連射",
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
  // classic: 旧挙動 (camera は heading 追従、機体本体が回る、WASD は機体相対 thrust)
  // shooter: twin-stick 風 (camera 固定、機体 hull 固定、砲だけ入力方向に向く、heading 線も砲方向)
  "hud.viewMode.classic": "従来",
  "hud.viewMode.shooter": "シューター",
  // PLC スライスモード (PR #2): 時空図 ↔ PLC slice (= 過去光円錐 spatial slice の x-y 平面)
  "hud.spacetime": "時空図",
  "hud.plcSlice": "PLCスライス",
  // HUD - stats
  "hud.speed": "速さ",
  "hud.gamma": "ガンマ因子",
  "hud.properTime": "固有時間",
  "hud.position": "位置",
  "hud.energy": "エネルギー",
  "hud.fuelEmpty": "燃料枯渇",
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
  "connect.peerOpen": "接続中",
  "connect.peerClosed": "接続準備中/失敗",
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
