import { describe, expect, it } from "vitest";
import { extractPeerIdFromError } from "./PeerManager";

/**
 * PeerJS v1.5.5 の peer-unavailable error message format に対する pure helper test。
 *
 * 思想 doc: `design/network-recovery.md` 軸 2 (signaling layer 独立 fault detector)。
 * Bug 11 plan §3 (a) layer 別 markStale 経路の signaling layer 経路で使用。
 *
 * format 変動を test で固定化、 PeerJS バージョン更新時は test failure で気付ける。
 */
describe("extractPeerIdFromError", () => {
  it("PeerJS v1.x 標準 format から alphanumeric peerId を抽出", () => {
    const id = extractPeerIdFromError("Could not connect to peer abc123def");
    expect(id).toBe("abc123def");
  });

  it("LorentzArena local peerId (= Math.random().toString(36) 由来 9 文字) を抽出", () => {
    const id = extractPeerIdFromError("Could not connect to peer 1lnqafvxo");
    expect(id).toBe("1lnqafvxo");
  });

  it("hyphen を含む helper ID (= la-{roomName} 形式) も抽出", () => {
    const id = extractPeerIdFromError("Could not connect to peer la-test");
    expect(id).toBe("la-test");
  });

  it("末尾 punctuation は peerId 文字種で stop", () => {
    // peerId 文字種 = [a-z0-9_-]、 句読点は含まれない
    const id = extractPeerIdFromError("Could not connect to peer abc123.");
    expect(id).toBe("abc123");
  });

  it("マッチしない error message は null", () => {
    expect(extractPeerIdFromError("Some other error")).toBeNull();
    expect(extractPeerIdFromError("WebSocket disconnected")).toBeNull();
    expect(extractPeerIdFromError("")).toBeNull();
  });

  it("case insensitive (= 大文字混入でも抽出)", () => {
    // PeerJS は通常 lowercase だが defensive に case-insensitive で match
    const id = extractPeerIdFromError("could not connect to peer XYZ789");
    expect(id).toBe("XYZ789");
  });
});
