# Bug 14 live state capture (2026-05-06)

## 状況

スマホ (Pixel 7a, Android 16, Brave) で 2026-05-05 21:01 JST に開いた LorentzArena タブが **15.77 時間後の 5/6 12:47 JST** にも runaway 状態で生存中。 5/6 朝 user 報告 (= [SESSION.md Bug 14](../../SESSION.md)) と同 instance、 reload 前に Mac から ADB 経由 Chrome DevTools Protocol で **state 完全 dump 取得**。

接続経路:
- Pixel 7a (Android 16) ↔ MacBook Pro M1 Pro: WiFi ADB (= USB ケーブル data 通信不能のため WiFi 経路)
- `adb pair` + `adb connect <LAN-IP>:<port>` → `adb forward tcp:9222 localabstract:chrome_devtools_remote`
- `ws://localhost:9222/devtools/page/717` (= LorentzArena タブ) に CDP `Runtime.evaluate`
- Origin header workaround (= `--remote-allow-origins` 制約) 経由で実行

## 取得 file

- [`state-dump-1247jst.json`](state-dump-1247jst.json) (732 KB): `useGameStore.getState()` 完全 dump、 worldLine.history 2000 + 1000 entry、 logs 全部、 phaseSpace 全 player

## 観測 facts (= 12:47 JST timestamp)

### page meta
- `performance.timeOrigin = 1777982502526.6` ms (= 2026-05-05 21:01:42 JST、 タブ起動)
- `Date.now() = 1778039260804` ms (= 2026-05-06 12:47:40 JST)
- 経過 wall_clock: **56758 sec ≈ 15.77 時間**
- `performance.now() = 11692144.5` ms ≈ **3.25 時間** (= page 起動以来 active な execution 時間)
- → **15.77 - 3.25 = 12.52 時間が suspend 状態**だった (= mobile Brave background でタブが timer suspended)
- `documentVisibilityState: visible`, `documentHidden: false` (= 現在 foreground)
- build: `2026/05/05 20:01:05 JST` (= Stage 11 `ffd81b3` deploy 直後の version、 5/6 NPC 非対称 plan deploy より前)

### players state
| player | id | pos.t (sec) | pos.xy (ls) | u.xy | γ |
|---|---|---|---|---|---|
| **self (= odakin)** | `iznx325mc` | **20368343** (= 235.7 日) | **(-19153884, +6819977)** (= 17M ls SW) | (-7.4e-141, -6.3e-141) | 1.000 |
| **LH** | `lighthouse-0` | **57005** (= page age 15.83h、 normal) | (2.099, -1.171) (= 初期 spawn 付近) | (0, 0) | 1.000 |

→ **self だけが runaway**。 LH は終始 normal advance。

### worldLine.history pattern
| | self | LH |
|---|---|---|
| historyLen | 2000 (= MAX_WORLDLINE_HISTORY cap) | 1000 (= 別 cap?) |
| t range (last - first) | **26.5 秒** | **13.1 秒** |
| maxDiff (= 隣接 entry t 差分の最大) | **0.030 sec** (= 1 frame 程度) | **0.030 sec** |
| spatial 動 | 全 history 同位置 (= u≈0 で advance なし) | 全 history 同位置 (= u=0) |

→ **直近 26.5 秒は normal advance**、 巨大 jump 痕跡なし。 ring buffer GC で過去の事象は消失。

### log state
- `killLog.length = 0` (= GC 済、 でも `scores.iznx325mc = 28` / `scores.lighthouse-0 = 3` が HUD 撃破数と一致)
- `respawnLog.length = 2`:
  - self: t=308.27 で respawn (wallTime = 21:06:54 JST、 page 起動 5 分後の初回 spawn のみ)
  - LH: t=1173.35 で respawn (wallTime = 21:19:10 JST、 page 起動 17 分後)
- `frozenWorldLines.length = 0` (= 大 jump で frozen 痕跡もない、 GC 済 or 発火していない)
- `pendingSpawnEvents.length = 0`
- `causalityJumping: false`, `causallyFrozen: false` (= Rule A/B 不発、 通常 advance 中)
- `staleFrozenIds: []` (= 全 peer alive 認識、 stale なし)
- `lighthouseLastFireTime`: `2026-05-06 08:00:45` (= 4 時間前まで LH は laser fire していた)
- `lasers: 0`, `debrisRecords: 0` (= 現時点で lasers 不在)

### localStorage
- `la-highscores`: 現 session 含む過去 highscore 配列。 現 session entry:
  ```json
  {"name":"odakin","kills":28,"date":"2026-05-06T03:33:04.024Z",
   "duration":55880.259,"sessionId":"764eba1b-06ef-4eb1-9b4c-fa4f49c2f1de"}
  ```
  - duration 55880 sec (= 15.52h、 page 起動からほぼ全期間)
  - **date 2026-05-06 03:33:04 UTC = 12:33 JST** = **state dump の 14 分前** に highscore 登録された (= session が一度終了したような trigger?)
- `la-control-scheme: legacy_shooter`, `la-view-mode: jellyfish`, `la-lang: ja`, `la-playerName: odakin`, `la-tutorial-shown: 1`

## 解析: 真因仮説の評価

### 仮説 A: 1 tick で巨大 dTau の friction 内 advance (= 棄却)

self.pos.xy / pos.t 比から `β = √(x²+y²)/t = 20331834 / 20368343 ≈ 0.998` (= ほぼ光速)。 これに必要な γ ≈ **15.8**、 friction model の terminal γ_max = 1.89 を遥かに超える。 single tick で friction 内 advance では到達不可。

### 仮説 B: 数回の dTau jump 累積 (= 数値矛盾、 棄却)

phase A1 (= u_x=-1.6, dTau=D1) で pos.x -= 1.6 D1 + pos.t += 1.89 D1、 phase A2 (= u_y=+1.6, D2) で同。 観測値から:
- D1 = 19.15M / 1.6 = 11.97M sec
- D2 = 6.82M / 1.6 = 4.26M sec
- 期待 pos.t = 1.89 × (D1 + D2) = 30.68M、 観測 20.37M
- **計算超過、 整合せず**

### 仮説 C: state 直接 corruption (= broadcast / snapshot 経路の bug、 検証不能)

何らかの bug 経路で `phaseSpace.pos` が直接 set された可能性 (= e.g. message 受信で別 peer の値を copy)。 だが self は own broadcast を ignore する設計のため、 通常経路では発生しない。

### 仮説 D: setInterval suspend 中に何かが起きた (= 最有力、 引き続き調査)

`performance.now() = 3.25h` vs `wall_clock = 15.77h` で **12.5h が suspend 状態**。 この間:
- setInterval は fire しないはず → physics 更新されない
- visibility hidden → gameLoop の `if (document.hidden) return;` で skip
- でも何らかの bug 経路で advance 起きた可能性 (= e.g. PeerJS message 受信 handler が active で外部 message が phaseSpace を書き換えた、 等)

## 結論 + next steps

- 観測された self.pos.t / pos.xy は **friction model 内の通常 physics で発生不能**
- 何らかの **state corruption 経路** または **gameLoop 外の event 経路** で発生した可能性高い
- 12.5h suspend 中に何が起きたかが鍵、 直接観測経路は GC で消失
- **live repro が必要** (= 別 phone で overnight 放置、 console / network log を時系列 capture)

## next session で再現するための手順

1. スマホ Brave で `https://sogebu.github.io/LorentzArena/` を開く
2. game start、 30 分プレイ後 background に
3. **PC 側で WiFi ADB で接続維持** (= [本セッション adb 手順](../../../../../odakin-prefs/work-discipline.md))
4. 1 時間ごとに state dump、 worldLine.history を時系列 archive
5. runaway 検出時 (= self.pos.t が wall_clock × γ_max を超えた瞬間) immediate にスマホ wake → console log 確認

