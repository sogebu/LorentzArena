import { beforeEach, describe, expect, it } from "vitest";
import {
  appendWorldLine,
  createPhaseSpace,
  createVector3,
  createVector4,
  createWorldLine,
} from "../physics";
import {
  ENERGY_MAX,
  HIT_DAMAGE,
  LIGHTHOUSE_ID_PREFIX,
  MAX_WORLDLINE_HISTORY,
  POST_HIT_IFRAME_MS,
} from "../components/game/constants";
import type { RelativisticPlayer } from "../components/game/types";
import {
  selectIsDead,
  selectPostHitUntil,
  useGameStore,
} from "./game-store";

const HIT_POS = { t: 0, x: 0, y: 0, z: 0 };
const LASER_DIR = createVector3(1, 0, 0);

function makePlayer(
  id: string,
  energy = ENERGY_MAX,
  isDead = false,
): RelativisticPlayer {
  const phaseSpace = createPhaseSpace(
    createVector4(0, 0, 0, 0),
    createVector3(0, 0, 0),
  );
  return {
    id,
    ownerId: id,
    phaseSpace,
    worldLine: appendWorldLine(createWorldLine(MAX_WORLDLINE_HISTORY), phaseSpace),
    color: "#fff",
    isDead,
    energy,
  };
}

function resetStore(players: Map<string, RelativisticPlayer>) {
  useGameStore.setState({
    players,
    frozenWorldLines: [],
    debrisRecords: [],
    lasers: [],
    scores: {},
    killLog: [],
    respawnLog: [],
    hitLog: [],
    myDeathEvent: null,
    pendingSpawnEvents: [],
  });
}

describe("handleDamage — non-lethal damage", () => {
  beforeEach(() => {
    resetStore(new Map([["victim", makePlayer("victim", ENERGY_MAX)]]));
  });

  it("energy を damage 分減らし、hitLog に entry を追加、kill しない", () => {
    const store = useGameStore.getState();
    store.handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");

    const s = useGameStore.getState();
    expect(s.players.get("victim")?.energy).toBeCloseTo(ENERGY_MAX - HIT_DAMAGE);
    expect(s.hitLog.length).toBe(1);
    expect(s.hitLog[0].victimId).toBe("victim");
    expect(s.hitLog[0].damage).toBe(HIT_DAMAGE);
    expect(s.killLog.length).toBe(0);
    expect(selectIsDead(s, "victim")).toBe(false);
  });
});

describe("handleDamage — lethal damage", () => {
  beforeEach(() => {
    resetStore(new Map([["victim", makePlayer("victim", HIT_DAMAGE / 2)]]));
  });

  it("energy < 0 で handleKill を連鎖させ killLog に entry、selectIsDead=true", () => {
    const store = useGameStore.getState();
    store.handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");

    const s = useGameStore.getState();
    expect(s.killLog.length).toBe(1);
    expect(s.killLog[0].victimId).toBe("victim");
    expect(s.hitLog.length).toBe(1);
    expect(selectIsDead(s, "victim")).toBe(true);
    // frozen world line も書かれるはず
    expect(s.frozenWorldLines.length).toBe(1);
  });
});

describe("handleDamage — デブリ配色 (hit=撃った人の色、explosion=死んだ人の色)", () => {
  const victimColor = "#ff0000";
  const killerColor = "#00ff00";

  function victimWith(energy: number): RelativisticPlayer {
    return { ...makePlayer("victim", energy), color: victimColor };
  }
  function killer(): RelativisticPlayer {
    return { ...makePlayer("killer", ENERGY_MAX), color: killerColor };
  }

  it("non-lethal: hit デブリ 1 個が撃った人の色で append される", () => {
    resetStore(
      new Map<string, RelativisticPlayer>([
        ["victim", victimWith(ENERGY_MAX)],
        ["killer", killer()],
      ]),
    );
    useGameStore
      .getState()
      .handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");

    const s = useGameStore.getState();
    expect(s.debrisRecords.length).toBe(1);
    expect(s.debrisRecords[0].type).toBe("hit");
    expect(s.debrisRecords[0].color).toBe(killerColor);
  });

  it("lethal: hit (撃った人色) + explosion (死んだ人色) の 2 層が入る", () => {
    resetStore(
      new Map<string, RelativisticPlayer>([
        ["victim", victimWith(HIT_DAMAGE / 2)],
        ["killer", killer()],
      ]),
    );
    useGameStore
      .getState()
      .handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");

    const s = useGameStore.getState();
    expect(s.debrisRecords.length).toBe(2);
    // 追加順: hit → explosion
    expect(s.debrisRecords[0].type).toBe("hit");
    expect(s.debrisRecords[0].color).toBe(killerColor);
    expect(s.debrisRecords[1].type).toBe("explosion");
    expect(s.debrisRecords[1].color).toBe(victimColor);
  });

  it("killer が players 未登録なら hit debris は victim 色にフォールバック", () => {
    resetStore(new Map<string, RelativisticPlayer>([["victim", victimWith(ENERGY_MAX)]]));
    useGameStore
      .getState()
      .handleDamage("victim", "ghostKiller", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");

    const s = useGameStore.getState();
    expect(s.debrisRecords.length).toBe(1);
    expect(s.debrisRecords[0].type).toBe("hit");
    expect(s.debrisRecords[0].color).toBe(victimColor);
  });
});

describe("handleDamage — post-hit i-frame", () => {
  beforeEach(() => {
    resetStore(new Map([["victim", makePlayer("victim", ENERGY_MAX)]]));
  });

  it("直近 hit から POST_HIT_IFRAME_MS 未満の第 2 発は damage 適用されない", () => {
    const store = useGameStore.getState();
    // 第 1 発: 通常通り energy が減る
    store.handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    const mid = useGameStore.getState();
    const energyAfterFirst = mid.players.get("victim")?.energy;
    expect(energyAfterFirst).toBeCloseTo(ENERGY_MAX - HIT_DAMAGE);

    // 第 2 発 (同 tick、wall-time 差は ≈ 0 なので i-frame 内)
    store.handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    const after = useGameStore.getState();
    expect(after.players.get("victim")?.energy).toBe(energyAfterFirst);
    // hitLog も増えない (i-frame が延長する動作を避ける)
    expect(after.hitLog.length).toBe(1);
  });

  it("selectPostHitUntil は latest hit wallTime + POST_HIT_IFRAME_MS", () => {
    const store = useGameStore.getState();
    store.handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    const s = useGameStore.getState();
    const latestHit = s.hitLog[s.hitLog.length - 1];
    expect(selectPostHitUntil(s, "victim")).toBe(
      latestHit.wallTime + POST_HIT_IFRAME_MS,
    );
  });
});

describe("handleDamage — Lighthouse 2 発で死 (回復なし)", () => {
  const lhId = `${LIGHTHOUSE_ID_PREFIX}test`;

  beforeEach(() => {
    // LH 初期 energy を HIT_DAMAGE * 1.5 (= 0.75) に設定。1 発目で 0.25 残り、
    // i-frame 経過後の 2 発目で -0.25 となり < 0 で死。LH に energy 回復ロジックが
    // 無いことを間接的に確認 (回復があれば 2 発目前に 0.25 → >HIT_DAMAGE に戻り死なない)。
    resetStore(new Map([[lhId, makePlayer(lhId, HIT_DAMAGE * 1.5)]]));
  });

  it("1 発目は non-lethal、2 発目は i-frame 経過後に lethal", () => {
    const store = useGameStore.getState();
    store.handleDamage(lhId, "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    expect(selectIsDead(useGameStore.getState(), lhId)).toBe(false);

    // 1 発目の直後 hitLog.wallTime を書き換えて i-frame を擬似的に超過させる
    // (実ゲームでは > 500ms 経過した状況を再現)
    useGameStore.setState((s) => ({
      hitLog: s.hitLog.map((e) => ({
        ...e,
        wallTime: e.wallTime - POST_HIT_IFRAME_MS - 100,
      })),
    }));

    store.handleDamage(lhId, "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    const s = useGameStore.getState();
    expect(selectIsDead(s, lhId)).toBe(true);
    expect(s.frozenWorldLines.length).toBe(1);
  });
});

describe("handleDamage — 既死 / 無敵 guard", () => {
  it("selectIsDead=true なら何もしない", () => {
    resetStore(new Map([["victim", makePlayer("victim", ENERGY_MAX)]]));
    // 既に kill 済
    useGameStore.setState({
      killLog: [
        {
          victimId: "victim",
          killerId: "killer",
          hitPos: HIT_POS,
          wallTime: Date.now(),
          victimName: "v",
          victimColor: "#fff",
          firedForUi: false,
        },
      ],
    });

    useGameStore
      .getState()
      .handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    const s = useGameStore.getState();
    expect(s.hitLog.length).toBe(0);
    expect(s.players.get("victim")?.energy).toBe(ENERGY_MAX); // unchanged
  });

  it("respawn invincibility 内なら damage 無視", () => {
    resetStore(new Map([["victim", makePlayer("victim", ENERGY_MAX)]]));
    useGameStore.setState({
      respawnLog: [
        {
          playerId: "victim",
          position: HIT_POS,
          wallTime: Date.now(), // 今スポーン = 無敵中
        },
      ],
    });

    useGameStore
      .getState()
      .handleDamage("victim", "killer", HIT_POS, HIT_DAMAGE, LASER_DIR, "me");
    const s = useGameStore.getState();
    expect(s.hitLog.length).toBe(0);
    expect(s.players.get("victim")?.energy).toBe(ENERGY_MAX);
  });
});
