import { describe, expect, it } from "vitest";
import {
  filterRoomNameInput,
  generateRoomName,
  normalizeRoomName,
  ROOM_NAME_MAX_LENGTH,
  roomNameFromHashValue,
  roomShareUrl,
} from "./roomName";

// PeerJS (util.validateId) と同じ規則。 ビーコン ID は `la-{roomName}`。
const PEERJS_ID = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

describe("normalizeRoomName", () => {
  it("keeps names that are already valid", () => {
    expect(normalizeRoomName("default")).toBe("default");
    expect(normalizeRoomName("test")).toBe("test");
    expect(normalizeRoomName("Lab_42-x")).toBe("Lab_42-x");
  });

  it("turns spaces into dashes and drops other characters", () => {
    expect(normalizeRoomName("my room")).toBe("my-room");
    expect(normalizeRoomName("a.b/c?d")).toBe("abcd");
    expect(normalizeRoomName("部屋1")).toBe("1");
  });

  it("collapses and trims separators", () => {
    expect(normalizeRoomName("--a__-b--")).toBe("a_b");
    expect(normalizeRoomName("a - b")).toBe("a-b");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(normalizeRoomName("")).toBe("");
    expect(normalizeRoomName("  ")).toBe("");
    expect(normalizeRoomName("テスト")).toBe("");
    expect(normalizeRoomName("-_-")).toBe("");
  });

  it("caps the length", () => {
    expect(normalizeRoomName("x".repeat(100))).toHaveLength(
      ROOM_NAME_MAX_LENGTH,
    );
  });

  it("always yields a beacon ID that PeerJS accepts", () => {
    const samples = [
      "my room",
      "--a__-b--",
      "a - b",
      "Lab_42-x",
      "x".repeat(100),
      "a-".repeat(40),
      "日本語 room 2",
      " _-weird--__name-_ ",
    ];
    for (const s of samples) {
      const room = normalizeRoomName(s);
      expect(room).not.toBe("");
      expect(`la-${room}`).toMatch(PEERJS_ID);
    }
  });
});

describe("filterRoomNameInput", () => {
  it("keeps a trailing separator while typing", () => {
    expect(filterRoomNameInput("my-")).toBe("my-");
    expect(filterRoomNameInput("my ")).toBe("my-");
  });
});

describe("roomNameFromHashValue", () => {
  it("decodes percent-encoding before normalizing", () => {
    expect(roomNameFromHashValue("my%20room")).toBe("my-room");
    expect(roomNameFromHashValue("%E9%83%A8%E5%B1%8B")).toBe("");
    expect(roomNameFromHashValue("bad%E9")).toBe("badE9");
    expect(roomNameFromHashValue(undefined)).toBe("");
  });
});

describe("generateRoomName", () => {
  it("makes a 6-character name that PeerJS accepts", () => {
    for (let i = 0; i < 50; i++) {
      const room = generateRoomName();
      expect(room).toMatch(/^[a-z2-9]{6}$/);
      expect(normalizeRoomName(room)).toBe(room);
      expect(`la-${room}`).toMatch(PEERJS_ID);
    }
  });

  it("uses the supplied random source", () => {
    const zeros = (buf: Uint32Array) => buf.fill(0);
    expect(generateRoomName(zeros)).toBe("aaaaaa");
  });
});

describe("roomShareUrl", () => {
  it("carries only the room in the hash", () => {
    expect(
      roomShareUrl("k7m2qa", {
        origin: "https://sogebu.github.io",
        pathname: "/LorentzArena/",
      }),
    ).toBe("https://sogebu.github.io/LorentzArena/#room=k7m2qa");
  });
});
