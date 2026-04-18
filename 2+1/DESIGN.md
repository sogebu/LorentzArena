# DESIGN.md — LorentzArena 2+1

設計判断の記録。分類原則は `claude-config/docs/convention-design-principles.md` §6。未決定の探索・代替案比較は [`EXPLORING.md`](./EXPLORING.md) へ。


## 目次 / domain 別分割構成 (2026-04-18 Level-3 split)

DESIGN.md は domain ごとに分割。本ファイルは **index + アーキ overview + Defer 判断** のみ保持。各 domain の detail は対応する sub-file を参照:

- **メタ原則 (M1-M19 横断的教訓)** → [`design/meta-principles.md`](design/meta-principles.md)
- **完了リファクタ (Authority 解体 + D pattern 化)** → [`design/authority-d-pattern.md`](design/authority-d-pattern.md)
- **ネットワーク + 通信・セキュリティ** → [`design/network.md`](design/network.md)
- **物理** → [`design/physics.md`](design/physics.md)
- **描画 (D pattern 適用 / アリーナ / 星屑 / Exhaust / time fade / 世界線 tube / 色)** → [`design/rendering.md`](design/rendering.md)
- **State 管理 + UI/入力** → [`design/state-ui.md`](design/state-ui.md)

分類原則は `claude-config/docs/convention-design-principles.md` §6。未決定の探索は [`EXPLORING.md`](./EXPLORING.md)。

**配置意図** (§10.10 CLAUDE.md chain + §10.12 Migration level 3 化): DESIGN.md 本体 1371 行 → sub-files に分解して **session ごとに関係 domain 1-2 ファイルだけ read される** 構造に。本 DESIGN.md は overview + Defer のみで毎 session auto-load しても軽い。

## § アーキテクチャ overview

全体を貫く設計原理。個別判断の前提になる。

### データ層と表現層の分離

全 peer が全プレイヤーの world line を常時共有する (データ層)。相対論的な光円錐遅延は「いつ UI に表示するか」の表現層だけで効かせる。データを光円錐で絞る必要はない。

**この原則を見失うと「各 peer は自分の光円錐内のデータしか持てない」と誤解し、設計が無駄に複雑化する** (Authority 解体の議論中盤に実際に一度そうなった)。

### 世界オブジェクト分離: 死亡 = プレイヤーから世界への遷移

死亡イベントで生まれるオブジェクト (凍結世界線、デブリ、ゴースト軌跡) は `RelativisticPlayer` から分離し、独立した state として管理 (`frozenWorldLines[]`, `debrisRecords[]`, `myDeathEvent`)。プレイヤーが持つのは「今生きてるライフの世界線」だけ。

設計原理: 世界に放たれた物理オブジェクト (レーザー、デブリ、凍結世界線) はプレイヤーとは独立に存在し続ける。

副次効果として切断プレイヤーの痕跡も残る。因果律の守護者バグの遠因 (紐付けによる座標時刻の不整合) も解消。

### 死亡時の描画哲学: 物理に任せる

死亡時の唯一の特別処理は「死んだ本人が自分のマーカーを見ない」のみ。世界線・デブリ・他プレイヤーのマーカー表示は通常通り。

凍結された世界線は他プレイヤーの過去光円錐と交点を持つ間は可視 (因果的に正しい「遅延された死亡」)。交点がなくなって初めて消える。リスポーン後も過去光円錐が新世界線に触れるまで不可視。デブリも同様。

以前の `if (player.isDead) return null` で死亡プレイヤーの全マーカーを全観測者から非表示にしていた実装はデブリ表示タイミングに波及していた。相対論的ゲームでは、描画判定に「特殊ケース」を増やすのではなく、過去光円錐交差という統一的メカニズムに任せるべき。

### 過去光円錐に基づく描画

プレイヤーは他オブジェクトの「現在位置」ではなく過去光円錐上の位置を見る。特殊相対論を正確に反映するゲームメカニクスの根幹。計算コストは増えるが、ゲームの存在意義そのもの。

### 物理エンジン: ファクトリパターン (クラス不使用)

イミュータブルな phase space オブジェクトとの相性がよく、テストしやすい。OOP 的な継承は物理演算には不要。

### game/ のファイル配置: flat vs subdirectory

基準: 共有ユーティリティがあるか、3 ファイル以上の密結合グループか → サブディレクトリ。独立モジュールの列挙 → flat。

- `game/` 直下 (flat): 独立した描画モジュールで相互参照がなく、SceneContent.tsx からのみ import される (WorldLineRenderer 等)
- `game/hud/` (subdir): 共有ユーティリティ (`utils.ts`) があり、テーマ的に密結合 (ControlPanel, Speedometer, Overlays, utils)

---

## § Defer 判断

### 残存する設計臭 (2026-04-06 監査 → 同日再評価で全件 defer)

色バグ掃除直後の 4 軸レビューで残存の匂い (単一情報源違反・派生可能 state・外部イベントの React 化・dual entry) を #1〜#4 として棚卸し、同日再評価で全件 defer 決定。後日: #1 は setPlayers ラッパーで実質解決 (`172b600`) / #3 は Authority 解体 Stage B/C/D / #4 は Stage F-1/H で自然消滅 / **#2 のみ現行 DEFER**。#1/#3/#4 の当時詳細分析は git log (このファイル 2026-04-15 以前) 参照、下記は現行 DEFER のみ。

#### 残存臭 #2: connections useEffect で外部イベントを React state 経由で diff している

**場所**: `RelativisticGame.tsx:227-266` (特に `:229` の `prevConnectionIdsRef` 宣言と `:236-244` の比較ループ)

**現状** (Authority 解体後、2026-04-19 で `store.players.has` 既存 peer ガード追加):
```ts
const prevConnectionIdsRef = useRef<Set<string>>(new Set());
useEffect(() => {
  if (peerManager?.getIsBeaconHolder()) {
    for (const conn of connections) {
      if (!conn.open) continue;
      if (prevConnectionIdsRef.current.has(conn.id)) continue;
      if (store.players.has(conn.id)) continue; // migration 経路で再接続した既存 peer を弾く
      peerManager.sendTo(conn.id, buildSnapshot(myId));
    }
  }
  prevConnectionIdsRef.current = new Set(connections.filter((c) => c.open).map((c) => c.id));
}, [connections, myId, peerManager]);
```

**なぜ smell か**: `dc.on('open')` の **その瞬間** に PeerManager は「これは新規接続だ」と分かっている。それをわざわざ `setConnections` で React state に昇格させ、再レンダーを起こし、前回の ref と diff を取って「新規」を復元している。情報の流れが「イベント → スナップショット → diff 検出」と遠回り。

**色との類似**: 色の `playerColor` ブロードキャスト (host → 新クライアントに対して既存プレイヤーの色を送り直す) と同じクラス。**外部の事象 (接続開始、色決定) を、同期機構 (React useEffect / ネットワークメッセージ) に載せて復元している**。

**解消方向**:
- PeerManager に `onNewPeerOpen(cb: (peerId: string) => void)` を足す
- `dc.on('open', () => { cb(dc.peer); notifyConnectionChange(); })` で即時コールバック
- RelativisticGame は useEffect ではなく一度だけ購読:
  ```ts
  useEffect(() => {
    if (!peerManager) return;
    return peerManager.onNewPeerOpen((peerId) => {
      if (peerManager.getIsBeaconHolder()) {
        // snapshot 送信
      }
    });
  }, [peerManager, myId]);
  ```
- `prevConnectionIdsRef` を削除
- 注意: `connections` state は UI (接続インジケータ) で使っているので削除せず、diffing ロジックだけ消す

**優先度**: 高 (コード量削減・バグ温床除去)、難易度: 中 (PeerManager + PeerProvider + RelativisticGame の 3 ファイル変更)

**現状判断 (2026-04-06 再評価)**: **defer**。
- 実コード読み直しで、変更範囲が監査時見積より広いことを確認: PeerManager だけでなく `WsRelayManager.ts` にも同じ callback API を足す必要がある
- diffing は動いている。現時点で実害ゼロ
- 節約される行は 20 行前後、得られるのは「ライフサイクルイベント型の API」という美学
- **un-defer トリガー**: (a) 接続ライフサイクルに絡む実バグ観測、(b) snapshot / sync ハンドシェイクを別設計に差し替える機会、(c) PeerProvider に `reconnecting` 等の phase 概念が必要な機能を足すとき (#4 と合流)

---

### 再評価の教訓 (2026-04-06、4 件を全件 defer に決めた日)

監査時の優先順 (#2 → #1 → #4 → #3) はコード内在的な美学の並びで、「なぜ今これをやるのか」に耐えなかった。

- **色バグとの「アナロジー」を疑う**: 色バグは「guard なしで distributed race していた」(本番実害 5 パッチ)、4 件は「guard ありで動いているが見た目が冗長」。同じクラスではない
- **ROI で並べ直す**: 4 件すべて実害ゼロ・preemptive fix トリガーなし・コスト非ゼロ。物理デモの価値 (時空図を触って体験) を 1 mm も前進させない
- **「束ねる論法」の破綻**: #2 と #4 を「接続ライフサイクル refactor で束ねれば節約」と考えたが、「どのみちやる」前提に依存した節約論で、やる価値自体を疑うと節約効果 0 × 2 = 0

**再 un-defer の共通チェック**:

- [ ] 具体的な bug 観測 or 具体的な機能トリガーがあるか? (「なんとなく気になる」ではない)
- [ ] 現時点で物理デモとして価値のあるタスク (チュートリアル・固有時刻表示・スマホ UI 等) がこれより優先されないか?
- [ ] 修正による regression リスク (特に race / timing 系) は受容可能か?
- [ ] lint + tsc + preview 2 タブテストで検証可能な単位で 1 コミットに収まるか?
