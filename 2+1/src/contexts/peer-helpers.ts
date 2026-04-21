import type { PeerOptions } from "peerjs";
import { isLighthouse } from "../components/game/lighthouse";
import { PeerManager } from "../services/PeerManager";
import type { WsRelayManager } from "../services/WsRelayManager";
import { useGameStore } from "../stores/game-store";
import type { Message } from "../types";

/**
 * Top-level helpers for PeerProvider.
 *
 * `PeerProvider.tsx` 内で完結していた helper 群を抽出した file。全て self-contained
 * (component state に closure しない pure function) で、PeerManager / WsRelayManager /
 * game store のみに依存する。component は本ファイルから必要な helper を import する。
 *
 * 抽出方針 (2026-04-21):
 *   - 抽出: type guards / join registry / host relay / peer-order listener /
 *     LH ownership transfer / demotion / discovery probe + `NetworkManager` 型
 *   - 残留: component-specific types (`ActiveTransport` / `ConnectionPhase` /
 *     `PeerContextValue` 等)、timing constants (`HEARTBEAT_INTERVAL` 等 — policy
 *     として component の useEffect が使う)、`PeerProvider` 本体
 */

export type NetworkManager = PeerManager<Message> | WsRelayManager<Message>;

/**
 * Append peer IDs to joinRegistry (append-only, no duplicates).
 * Returns true if the registry changed.
 */
export const appendToJoinRegistry = (
  joinRegistryRef: { current: string[] },
  ids: string[],
  hostFirst?: string,
): boolean => {
  let changed = false;
  if (hostFirst && !joinRegistryRef.current.includes(hostFirst)) {
    joinRegistryRef.current.unshift(hostFirst);
    changed = true;
  }
  for (const id of ids) {
    if (!joinRegistryRef.current.includes(id)) {
      joinRegistryRef.current.push(id);
      changed = true;
    }
  }
  return changed;
};

/** Type guard: is this a valid redirect message with a hostId? */
export const isRedirectMessage = (
  msg: unknown,
): msg is { type: "redirect"; hostId: string } =>
  msg != null &&
  typeof msg === "object" &&
  (msg as { type?: string }).type === "redirect" &&
  typeof (msg as { hostId?: string }).hostId === "string";

/** Type guard: is this a ping (heartbeat) message? */
export const isPingMessage = (
  msg: unknown,
): msg is { type: "ping"; peerOrder?: string[] } =>
  msg != null &&
  typeof msg === "object" &&
  (msg as { type?: string }).type === "ping";

/** Basic validation before relaying messages to all peers. */
export const isRelayable = (msg: Message): boolean => {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string")
    return false;
  if (msg.type === "phaseSpace") {
    return (
      typeof msg.senderId === "string" &&
      msg.position != null &&
      msg.velocity != null
    );
  }
  if (msg.type === "laser") {
    return (
      typeof msg.id === "string" &&
      typeof msg.playerId === "string" &&
      msg.emissionPos != null &&
      msg.direction != null
    );
  }
  if (msg.type === "intro") {
    return (
      typeof msg.senderId === "string" &&
      msg.senderId.length > 0 &&
      typeof msg.displayName === "string" &&
      msg.displayName.length > 0 &&
      msg.displayName.length <= 20
    );
  }
  if (msg.type === "kill") {
    return (
      typeof msg.victimId === "string" &&
      typeof msg.killerId === "string" &&
      msg.hitPos != null
    );
  }
  if (msg.type === "respawn") {
    return typeof msg.playerId === "string" && msg.position != null;
  }
  return false;
};

/**
 * Register a listener that updates the peer order from peerList messages.
 * Used by clients to know who else is in the room (for migration election).
 */
export const registerPeerOrderListener = (
  pm: NetworkManager,
  peerOrderRef: { current: string[] },
  joinRegistryRef: { current: string[] },
  onRegistryChange: () => void,
) => {
  pm.onMessage("peerOrder", (_senderId, msg) => {
    if (
      msg &&
      typeof msg === "object" &&
      (msg as { type?: string }).type === "peerList"
    ) {
      const peers = (msg as { peers?: string[] }).peers;
      if (Array.isArray(peers)) {
        peerOrderRef.current = peers;
        // Host's joinRegistry is the canonical ordering — adopt it wholesale.
        // Merging (append) cannot fix ordering when the client already has entries
        // in a different order, so we REPLACE instead.
        const hostRegistry = (msg as { joinRegistry?: string[] }).joinRegistry;
        if (Array.isArray(hostRegistry) && hostRegistry.length > 0) {
          joinRegistryRef.current = [...hostRegistry];
          // Ensure our own ID is included (we may have just connected)
          const myId = pm.id();
          if (myId && !joinRegistryRef.current.includes(myId)) {
            joinRegistryRef.current.push(myId);
          }
          onRegistryChange();
        } else if (
          appendToJoinRegistry(
            joinRegistryRef,
            peers,
            pm.getBeaconHolderId() ?? undefined,
          )
        ) {
          onRegistryChange();
        }
      }
    }
  });
};

/**
 * LH の駆動権 (= `lh.ownerId`) を新しい所有者に移譲する。useGameLoop §462 の LH AI は
 * `lh.ownerId === myId` で gate されているため、この field が「誰が LH を駆動するか」
 * の single source of truth。
 *
 * 対称操作 (思想):
 *   - BH 就任時 (`assumeHostRole`): newOwnerId = self (駆動権取得)
 *   - BH 降格時 (`performDemotion`): newOwnerId = realHostId (駆動権放出)
 *
 * idempotent (ownerId が既に一致すれば no-op)。変更があれば setPlayers で
 * immutable に更新し次 RAF tick に反映。
 */
export const transferLighthouseOwnership = (newOwnerId: string) => {
  useGameStore.getState().setPlayers((prev) => {
    let changed = false;
    const next = new Map(prev);
    for (const [id, player] of next) {
      if (isLighthouse(id) && player.ownerId !== newOwnerId) {
        next.set(id, { ...player, ownerId: newOwnerId });
        changed = true;
      }
    }
    return changed ? next : prev;
  });
};

/**
 * Finalize host demotion once the real BH is known.
 * Shared by:
 *   (a) beacon-acquire effect の `demoteToClient` (discovery probe 経由で realHostId 取得後)
 *   (b) Stage 2 host self-verification probe (visibility / backup timer 経由で split 検出後)
 *
 * 手順 (対称操作として `assumeHostRole` と対):
 *   assumeHostRole    | performDemotion
 *   ------------------|-----------------------------------
 *   clearBH           | broadcast redirect (clients 通知)
 *   setAsBH (self)    | clearBH + setBHId(realHostId) + connect
 *   transferLHOwner(self) | transferLHOwner(realHostId)
 *   roleVersion bump  | roleVersion bump
 *
 * beaconRef.current の destroy は beacon-acquire effect の cleanup に委譲する
 * (既存 `demoteToClient` と同じパターン — `clearBeaconHolder()` + `setRoleVersion`
 *  で effect 再実行、早期 return により前 run cleanup で beacon が destroy される)。
 *
 * Self-demote guard: (b) は callsite で `realHostId !== myId` check 済だが、(a) の
 * demoteToClient は check していない (自身の stale 登録に routing される rare race で
 * self-redirect を受ける余地あり)。helper 側で吸収して両 path 共通の防御とする。
 */
export const performDemotion = (
  pm: NetworkManager,
  realHostId: string,
  onRoleChange: () => void,
) => {
  if (realHostId === pm.id()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[PeerProvider] performDemotion called with self-id, ignoring",
    );
    return;
  }
  pm.broadcast({ type: "redirect", hostId: realHostId } as Message);
  pm.clearBeaconHolder();
  pm.setBeaconHolderId(realHostId);
  pm.connect(realHostId);
  transferLighthouseOwnership(realHostId);
  onRoleChange();
};

/**
 * 使い捨て probe PeerManager で la-{roomName} に接続、beacon からの redirect を
 * 受信して「現時点で誰が BH か」を発見する。beacon 関連の 2 つの probe を統合:
 *   - beacon-acquire の `demoteToClient` (claim 失敗後、真の BH を発見して demote)
 *   - Stage 2 self-verification probe (BH と信じているが split していないか検証)
 *
 * 内部 `done` flag で callback の one-shot semantics を保証 (PeerJS の destroy が
 * JS event loop 上の queued event を即 cancel しないため、late callback が発火
 * しても動作済の状態は変わらない)。返値の cleanup 関数で外部から cancel 可能。
 *
 * `onResult` は redirect 受信時、`onInconclusive` は timeout or error 時に呼ぶ。
 * どちらか一方のみ、最初の 1 回だけ呼ばれる。
 */
export const discoverBeaconHolder = (params: {
  roomPeerId: string;
  options: PeerOptions;
  timeoutMs: number;
  probeIdPrefix?: string;
  onResult: (realHostId: string) => void;
  onInconclusive: () => void;
}): (() => void) => {
  const probeId =
    (params.probeIdPrefix ?? "") + Math.random().toString(36).substring(2, 11);
  const pm = new PeerManager<Message>(probeId, params.options);
  let done = false;

  const finish = (deliver: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    pm.destroy();
    deliver();
  };

  const timeout = setTimeout(
    () => finish(params.onInconclusive),
    params.timeoutMs,
  );

  pm.onPeerStatusChange((status) => {
    if (done) return;
    if (status.status === "open") {
      pm.connect(params.roomPeerId);
    } else if (status.status === "error") {
      finish(params.onInconclusive);
    }
  });

  pm.onMessage("discovery", (_senderId, msg) => {
    if (done) return;
    if (!isRedirectMessage(msg)) return;
    finish(() => params.onResult(msg.hostId));
  });

  // 外部 cancel: 結果 deliver 無しで destroy。内部で既に finish 済なら no-op。
  return () => finish(() => {});
};

/** Register standard host relay handlers on a PeerManager. */
export const registerHostRelay = (pm: NetworkManager) => {
  pm.onMessage("host", (senderId, msg) => {
    if (!pm.getIsBeaconHolder()) return;

    if (
      (msg.type === "phaseSpace" ||
        msg.type === "laser" ||
        msg.type === "intro" ||
        msg.type === "kill" ||
        msg.type === "respawn") &&
      isRelayable(msg)
    ) {
      pm.broadcast(msg, senderId);
    }
  });
};
