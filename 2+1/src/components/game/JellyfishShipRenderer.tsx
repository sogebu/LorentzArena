import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  quatToYaw,
  type Quaternion,
  type Vector3,
  type Vector4,
} from "../../physics";
import { SHIP_HULL_RADIUS, SHIP_LIFT_Z, SHIP_MODEL_SCALE } from "./constants";
import { transformEventForDisplay } from "./displayTransform";
import type { lorentzBoost } from "../../physics";

// 機体モチーフ: ジャパクリップ「クラゲ」 (https://japaclip.com/jellyfish/)。
// 規約: https://japaclip.com/terms/ — 商用 OK / 改変 OK / クレジット任意。
// ただし「素材として配布禁止」。本リポは public なので元 PNG は commit せず、
// procedural な派生 3D コード (本ファイル) のみ含める。詳細: docs/references/README.md。

// Dome 寸法 (基準 = SHIP_HULL_RADIUS)。ぽっちゃり半球で底面開口。
const DOME_RADIUS = SHIP_HULL_RADIUS * 1.45;
const DOME_HEIGHT = SHIP_HULL_RADIUS * 1.0;

// 触手 5 本の基本仕様。武装触手 (index 0) のみ太く長く先端 bulb 大。
const TENTACLE_COUNT = 5;
const TENTACLE_LENGTH = SHIP_HULL_RADIUS * 2.4;
const TENTACLE_RADIUS = 0.045;

const ARMED_TENTACLE_LENGTH = SHIP_HULL_RADIUS * 3.2;
const ARMED_TENTACLE_RADIUS = 0.085;

// 武装触手末端: 二重構造。
// - 外殻 = 通常触手と同じ「tube radius と同径の半球 cap」(光は触手 material と同じで滲む)
// - 内核 = small sphere で player 色 emissive 発光、外殻 (半球) の中心 (= group 原点 =
//   tube 末端の disc 面中心) に置くことで対称的に内包される。
const ARMED_INNER_EMITTER_RADIUS = ARMED_TENTACLE_RADIUS * 0.65;
// 内核の周囲に貼る halo sphere (additive blending で「光の周りが滲む」コロナ感)。
// bloom post-fx 無し前提でも明確に光って見えるよう、内核より大きく、半透明 + 加算合成。
const ARMED_HALO_RADIUS = ARMED_TENTACLE_RADIUS * 1.4;

// 射撃時の砲指向: 機体水平面 (xy) から下方向 (-z = past time) に 45°。
// laser は観測者の過去光円錐上を流れるので「下 45°」が物理的に整合 (= heading 上に
// 持ち上げではなく、heading + 過去方向)。武装触手 (i=0、+x = heading 方向に取付) の
// 末端質点を rope local frame の (cos·length, 0, -sin·length) に kinematic 強制 →
// 中間質点は constraint 反復で滑らかに繋がる。
const ARMED_FIRING_PITCH = Math.PI / 4; // 45° (水平面からの傾き、向きは -z = 下)
const ARMED_FIRING_PITCH_COS = Math.cos(ARMED_FIRING_PITCH);
const ARMED_FIRING_PITCH_SIN = Math.sin(ARMED_FIRING_PITCH);

// 通常触手の先端 cap は「tube radius と同径の半球」で滑らかに閉じる。
// 半球 disc 面 (= sphere local +y 軸方向) を tube の最終 tangent 方向に向けることで
// 触手がそのまま丸く閉じる継ぎ目なしの形に。膨らみなし、material は tube と同一。
const TIP_HEMISPHERE_PHI_SEGS = 14;
const TIP_HEMISPHERE_THETA_SEGS = 8;

// 触手物理 (Verlet rope) パラメータ。
// チューニング指針:
// - 重力 / 慣性が小さすぎると swing が始まらない、damping が高すぎると即停止する。
// - 質点数を多くすると同じ length に対して segment が短くなり、棒チェーン感が消えて
//   柔らかい紐っぽくなる。constraint iter も比例で上げないと chain が伸び始める。
// - 静止時は重力で垂れるだけだと棒立ちになるので、初期 perturb で position と初速を
//   入れて「ふわふわ自然減衰しないノイズ」を入れている。
const TENTACLE_NUM_POINTS = 14; // 質点数 (= curve control points)
const TENTACLE_GRAVITY = 1.5; // 機体 local -z 方向の重力 (穏やか)
const TENTACLE_DAMPING = 0.99; // 速度保持率 (1 で減衰なし、0 で即停止)
const ARMED_TENTACLE_DAMPING = 0.99;
const TENTACLE_INERTIA_SCALE = 5.0; // 機体加速度の慣性反作用係数
const TENTACLE_CONSTRAINT_ITER = 5; // Jakobsen 距離拘束の反復回数
// Turbulence kick (流体の揺らぎ): 強い慣性で全質点が一様に並進すると「剛体棒」化して
// たなびき感が消える → 各質点に時間相関ノイズを乗せ、tangent 垂直成分のみ残して
// 触手をバラけさせる。慣性 (5×0.8=4) に対し 10-15% で「ふらつき」程度に。
const TENTACLE_KICK_AMP = 0.5;
const TENTACLE_KICK_FREQ_A = 1.7;
const TENTACLE_KICK_FREQ_B = 3.1;

// 目: dome 前面 (+x 寄り)、左右対称。
const EYE_OFFSET_X = SHIP_HULL_RADIUS * 0.5;
const EYE_OFFSET_Y = SHIP_HULL_RADIUS * 0.32;
const EYE_OFFSET_Z = SHIP_HULL_RADIUS * 0.55;
const EYE_RADIUS = SHIP_HULL_RADIUS * 0.11;

// 頬: dome 表面上 (赤道より少し上、+x 側に左右対称) に貼り付ける。
// 球面 (DOME_RADIUS, DOME_HEIGHT の楕円体) 表面位置を緯度 θ=65° / 経度 φ=±25° で算出 →
// 中心が表面、半分が外側に露出する配置。dome 内側に埋めると半透明越しに裏側からの方が
// 強く見えてしまう ("裏からしか見えない") のを回避。
const CHEEK_LAT = (65 * Math.PI) / 180;
const CHEEK_LON = (25 * Math.PI) / 180;
const CHEEK_SURFACE_XY_R = DOME_RADIUS * Math.sin(CHEEK_LAT);
const CHEEK_OFFSET_X = CHEEK_SURFACE_XY_R * Math.cos(CHEEK_LON);
const CHEEK_OFFSET_Y = CHEEK_SURFACE_XY_R * Math.sin(CHEEK_LON);
const CHEEK_OFFSET_Z = DOME_HEIGHT * Math.cos(CHEEK_LAT);
const CHEEK_RADIUS = SHIP_HULL_RADIUS * 0.14;

// Color base: 元イラストの淡い水色を起点に、player 色を一定割合で混色して識別性を出す。
const DOME_BASE_COLOR = "#a8e3ff";
const TENTACLE_BASE_COLOR = "#88cef0";
const EYE_COLOR = "#0a0a10";
const CHEEK_COLOR = "#ffb5b5";

const DOME_TINT_RATIO = 0.35;
const TENTACLE_TINT_RATIO = 0.25;

/**
 * Verlet rope: 触手の質点 chain。
 *
 * - positions[0] は root で常に (0, 0, 0) に固定 (= 触手 group の origin)。
 * - 各 step で gravity + 慣性力を加算して Verlet integration、その後 Jakobsen の
 *   距離拘束を反復で満たす。これで「重力で垂れる」「機体加速で後流」「停止後に減衰」
 *   が物理的に出る。
 * - mesh は curve から rebuild するが、CatmullRomCurve3 の補間で滑らかに描画される。
 * - root 固定により、触手の取付位置は常に (0,0,0) → 触手 group の position が dome 底面
 *   円周上の取付点と一致 → 視覚的に一貫。
 */
class TentacleRope {
  positions: THREE.Vector3[];
  prevPositions: THREE.Vector3[];
  segmentLength: number;
  numPoints: number;
  damping: number;
  /** 各質点の turbulence kick noise 用 phase (xy 各 1 個 + 副 freq 用 1 個 = 3 個)。
   *  HMR でも touch ごとに同じ揺らぎ pattern を再現するため seed 由来で固定。 */
  kickPhases: Float32Array;

  constructor(numPoints: number, totalLength: number, damping: number) {
    this.numPoints = numPoints;
    this.segmentLength = totalLength / (numPoints - 1);
    this.damping = damping;
    this.positions = [];
    this.prevPositions = [];
    this.kickPhases = new Float32Array(numPoints * 3);
    for (let i = 0; i < numPoints; i++) {
      const z = -this.segmentLength * i;
      this.positions.push(new THREE.Vector3(0, 0, z));
      this.prevPositions.push(new THREE.Vector3(0, 0, z));
    }
  }

  /** 初期摂動: 各質点に微小な初速 (per-frame displacement) を注入する。
   *  Verlet では `cur - prev` が初速になるので、prev を cur からずらすだけで「ふわふわ
   *  動き続ける」ノイズが入る。位置 offset は入れない (constraint で straighten される
   *  + 「最初から曲がってる」見た目を避ける)。
   *  同時に kickPhases も seed-based に初期化する。 */
  injectInitialVelocity(rng: () => number, velMagnitude: number) {
    for (let k = 1; k < this.numPoints; k++) {
      this.prevPositions[k].x -= (rng() - 0.5) * velMagnitude;
      this.prevPositions[k].y -= (rng() - 0.5) * velMagnitude;
    }
    for (let k = 0; k < this.numPoints; k++) {
      this.kickPhases[k * 3 + 0] = rng() * Math.PI * 2;
      this.kickPhases[k * 3 + 1] = rng() * Math.PI * 2;
      this.kickPhases[k * 3 + 2] = rng() * Math.PI * 2;
    }
  }

  step(
    dt: number,
    ax: number,
    ay: number,
    az: number,
    t: number,
    kickAmp: number,
  ) {
    const dt2 = dt * dt;
    const damp = this.damping;
    const fA = TENTACLE_KICK_FREQ_A;
    const fB = TENTACLE_KICK_FREQ_B;
    for (let k = 1; k < this.numPoints; k++) {
      const cur = this.positions[k];
      const prev = this.prevPositions[k];
      const vx = (cur.x - prev.x) * damp;
      const vy = (cur.y - prev.y) * damp;
      const vz = (cur.z - prev.z) * damp;

      // Turbulence kick: 質点ごと独立な phase で時間相関ノイズを生成 (xy 平面のみ)、
      // touch 局所 tangent 方向成分を抜いて「軸に直交する横揺れ」だけを残す。
      // tangent は隣接質点の差分から (k=N-1 では k 自身を最後に使う、k>=1 なので k-1 OK)。
      const phx = this.kickPhases[k * 3 + 0];
      const phy = this.kickPhases[k * 3 + 1];
      const phs = this.kickPhases[k * 3 + 2];
      let nx =
        Math.sin(t * fA + phx) + 0.5 * Math.sin(t * fB + phs);
      let ny =
        Math.sin(t * fA + phy) + 0.5 * Math.sin(t * fB + phs * 1.31);
      // Tangent (世界座標、length 不問なので正規化のみ)。末端 (k=numPoints-1) では
      // 自身を 1 個ぶん前向き extension と見做す (= positions[k] - positions[k-1])。
      const nextK = k + 1 < this.numPoints ? k + 1 : k;
      const next = this.positions[nextK];
      const prevK = this.positions[k - 1];
      const tx = next.x - prevK.x;
      const ty = next.y - prevK.y;
      const tz = next.z - prevK.z;
      const tlen2 = tx * tx + ty * ty + tz * tz;
      let kx = 0;
      let ky = 0;
      let kz = 0;
      if (tlen2 > 1e-12) {
        const inv = 1 / Math.sqrt(tlen2);
        const txn = tx * inv;
        const tyn = ty * inv;
        const tzn = tz * inv;
        // n には z=0、tangent 方向成分を抜く: n_perp = n - (n·t̂) t̂
        const dot = nx * txn + ny * tyn; // nz=0
        kx = (nx - dot * txn) * kickAmp;
        ky = (ny - dot * tyn) * kickAmp;
        kz = -dot * tzn * kickAmp;
      }

      prev.copy(cur);
      cur.x += vx + (ax + kx) * dt2;
      cur.y += vy + (ay + ky) * dt2;
      cur.z += vz + (az + kz) * dt2;
    }
  }

  satisfyConstraints(iterations: number) {
    for (let it = 0; it < iterations; it++) {
      // root を毎反復先頭で固定 (Jakobsen の standard)
      this.positions[0].set(0, 0, 0);
      for (let i = 0; i < this.numPoints - 1; i++) {
        const a = this.positions[i];
        const b = this.positions[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 1e-9) continue;
        const diff = (dist - this.segmentLength) / dist;
        if (i === 0) {
          // a (root) は固定 → b を full diff だけ動かす
          b.x -= dx * diff;
          b.y -= dy * diff;
          b.z -= dz * diff;
        } else {
          const half = diff * 0.5;
          a.x += dx * half;
          a.y += dy * half;
          a.z += dz * half;
          b.x -= dx * half;
          b.y -= dy * half;
          b.z -= dz * half;
        }
      }
    }
  }
}

/**
 * Shooter mode 用 3 機目: クラゲ機体。RocketShipRenderer (mech) との対比で organic。
 *
 * 設計要点:
 *   1. Dome は world up 固定 (= +z)、yaw 回転は group level でのみ。武装触手 (+x の触手)
 *      が heading を指す。「縦に置く」。
 *   2. Player 色は dome/触手の base color に lerp で混色 (透明感は MeshPhysicalMaterial
 *      の transmission を維持)。
 *   3. 武装触手 (index 0) は太く長く、先端 bulb は player 色 + emissive で発光。
 *      → 後続で laser cannon の照射点として接続する想定。
 *   4. 触手は Verlet rope で物理シミュレート。重力で垂れ、機体加速度の反作用で後流、
 *      停止後は damping で減衰する。形は seed-based jitter ではなく物理が決める。
 *      静止時の個性は初期摂動 (位置微小 offset) のみで、減衰しても完全停止しない緩い
 *      ノイズとして残す。
 *
 * 後段で追加予定:
 *   - Laser cannon 機能の武装触手 bulb への接続 (LaserCannonRenderer 連携)
 *   - 加速度矢印 (RocketShipRenderer と同等の sibling mesh)
 *   - 噴射相当の表現 (触手後流 particle? thrust 駆動)
 */
export const JellyfishShipRenderer = ({
  player,
  thrustAccelRef,
  observerPos,
  observerBoost,
  cameraYawRef,
  firingRef,
}: {
  player: {
    id: string;
    phaseSpace: { pos: Vector4; heading: Quaternion };
    color: string;
  };
  thrustAccelRef: React.RefObject<Vector3>;
  observerPos: Vector4 | null;
  observerBoost: ReturnType<typeof lorentzBoost> | null;
  cameraYawRef?: React.RefObject<number>;
  alpha4?: Vector4;
  /** 射撃中フラグ (= laser 引き金中)。true の間、武装触手末端を「heading 上 45°」に
   *  kinematic 強制し、中間質点は constraint 反復で適応 → 触手が砲身として上向きに伸びる。
   *  未指定は常に false 扱い (本番ゲームの未接続時 / 通常 preview)。 */
  firingRef?: React.RefObject<boolean>;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  // 各触手の mesh ref (per-frame で TubeGeometry を rebuild → 入れ替えのため保持)。
  const tentacleMeshRefs = useRef<Array<THREE.Mesh | null>>([]);
  // 武装触手は外殻 + 内核 の 2 mesh を group で囲って group 単位で position/rotation 追従、
  // 通常触手は単一 mesh。union 型として Object3D で保持。
  const bulbMeshRefs = useRef<Array<THREE.Object3D | null>>([]);
  // 半球 cap の rotation 計算用 reusable scratch (allocate を毎フレーム避ける)。
  const tangentVec = useMemo(() => new THREE.Vector3(), []);
  const yAxisVec = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tipQuat = useMemo(() => new THREE.Quaternion(), []);
  // 物理 step に渡す累積時刻 (turbulence kick の sin 引数に使う)。
  const physicsTimeRef = useRef(0);

  // Dome geometry: 半球 + 下端を少しフリル状に外側へ広げ、開口は閉じない (内部見える)。
  // LatheGeometry default は Y 軸回転 → 後で rotation.x = π/2 で Z up world に合わせる。
  const domeGeometry = useMemo(() => {
    const points: THREE.Vector2[] = [];
    const segments = 18;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * Math.PI * 0.55; // 半球より少し横広 (mantle 形状)
      const r = DOME_RADIUS * Math.sin(angle);
      const h = DOME_HEIGHT * Math.cos(angle);
      points.push(new THREE.Vector2(r, h));
    }
    // 下端フリル (外に少し広がってから内に戻る)。
    points.push(new THREE.Vector2(DOME_RADIUS * 1.04, -DOME_HEIGHT * 0.05));
    points.push(new THREE.Vector2(DOME_RADIUS * 0.94, -DOME_HEIGHT * 0.12));
    return new THREE.LatheGeometry(points, 32);
  }, []);

  // 触手 rope を初期化 (touch ごとに微小な perturb で個性、HMR でも形状一定)。
  const tentacleRopes = useMemo(() => {
    const seedRand = (seed: number) => {
      let x = (seed * 0x9e3779b9 + 0x12345) | 0;
      return () => {
        x = (Math.imul(x, 0x6c078965) + 1) | 0;
        return ((x >>> 0) / 0x100000000);
      };
    };
    const ropes: TentacleRope[] = [];
    for (let i = 0; i < TENTACLE_COUNT; i++) {
      const armed = i === 0;
      const length = armed ? ARMED_TENTACLE_LENGTH : TENTACLE_LENGTH;
      const damping = armed ? ARMED_TENTACLE_DAMPING : TENTACLE_DAMPING;
      const rope = new TentacleRope(TENTACLE_NUM_POINTS, length, damping);
      const rng = seedRand(i * 1009 + 11);
      // 初期摂動は初速のみ (位置 offset は無し)。武装は控えめ。
      rope.injectInitialVelocity(rng, armed ? 0.003 : 0.008);
      ropes.push(rope);
    }
    return ropes;
  }, []);

  // 初期 (まっすぐ垂れた) tube geometry。frame 0 では rope.positions と一致するので
  // 視覚的に整合。frame 1 以降は useFrame で rebuild。
  const tentacleInitialGeometries = useMemo(() => {
    const geos: THREE.TubeGeometry[] = [];
    for (let i = 0; i < TENTACLE_COUNT; i++) {
      const armed = i === 0;
      const radius = armed ? ARMED_TENTACLE_RADIUS : TENTACLE_RADIUS;
      const tubularSegs = armed ? 32 : 28;
      const radialSegs = armed ? 8 : 6;
      const curve = new THREE.CatmullRomCurve3(
        tentacleRopes[i].positions.map((p) => p.clone()),
      );
      geos.push(
        new THREE.TubeGeometry(curve, tubularSegs, radius, radialSegs, false),
      );
    }
    return geos;
  }, [tentacleRopes]);

  // Player 色を base に lerp で混色。透明感は material 側の transmission/opacity で維持。
  const domeColor = useMemo(() => {
    const base = new THREE.Color(DOME_BASE_COLOR);
    const tint = new THREE.Color(player.color);
    return base.clone().lerp(tint, DOME_TINT_RATIO);
  }, [player.color]);

  const tentacleColor = useMemo(() => {
    const base = new THREE.Color(TENTACLE_BASE_COLOR);
    const tint = new THREE.Color(player.color);
    return base.clone().lerp(tint, TENTACLE_TINT_RATIO);
  }, [player.color]);

  // 触手の円周配置: 武装触手 (i=0) を +x 方向、残り 4 本を 72° 等間隔で配置。
  const tentacleLayout = useMemo(() => {
    const out: Array<{ angle: number; armed: boolean }> = [];
    for (let i = 0; i < TENTACLE_COUNT; i++) {
      const angle = (i / TENTACLE_COUNT) * Math.PI * 2;
      out.push({ angle, armed: i === 0 });
    }
    return out;
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const dp = transformEventForDisplay(
      player.phaseSpace.pos,
      observerPos,
      observerBoost,
    );
    group.position.set(dp.x, dp.y, dp.t);

    // group は z 軸 yaw のみ回転 (roll/pitch なし = 縦に置く)。lerp で武装触手が
    // heading 方向 (= +x、player 入力方向) を指す。dome は円対称で見た目不変。
    const targetYaw = cameraYawRef
      ? cameraYawRef.current
      : quatToYaw(player.phaseSpace.heading);
    const cur = group.rotation.z;
    let diff = targetYaw - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const tau = 0.12;
    const alpha = 1 - Math.exp(-Math.min(0.1, delta) / tau);
    group.rotation.z = cur + diff * alpha;

    // 触手物理 step。
    // - 重力: 機体 local -z (= dome 下方向) 方向に穏やかに。
    // - 慣性反作用: 機体加速度 (thrustAccelRef、player local frame) の逆方向。
    //   dome group の yaw 回転は parent 側で適用済 → 触手 local frame は player local
    //   frame と一致するため、thrustAccelRef.x/y をそのまま符号反転で使える。
    const dt = Math.min(0.033, Math.max(0.001, delta)); // tab 復帰時の暴れ防止
    physicsTimeRef.current += dt;
    const t = physicsTimeRef.current;
    const accel = thrustAccelRef.current;
    const inertX = -accel.x * TENTACLE_INERTIA_SCALE;
    const inertY = -accel.y * TENTACLE_INERTIA_SCALE;
    const inertZ = -TENTACLE_GRAVITY;

    const firing = firingRef ? firingRef.current : false;
    // 武装触手 (i=0) の射撃時 tip target (rope local frame): heading +x に cos45·L、
    // 上方向 -z に sin45·L (機体水平から下 45°)。
    const armedFireTipX = ARMED_TENTACLE_LENGTH * ARMED_FIRING_PITCH_COS;
    const armedFireTipZ = -ARMED_TENTACLE_LENGTH * ARMED_FIRING_PITCH_SIN;

    for (let i = 0; i < TENTACLE_COUNT; i++) {
      const rope = tentacleRopes[i];
      rope.step(dt, inertX, inertY, inertZ, t, TENTACLE_KICK_AMP);
      // 武装触手 (i=0) 射撃時: 末端を target 位置に kinematic 強制 → constraint 反復で
      // 中間質点が滑らかに繋がる (root 固定 + 末端固定の double-pinned chain になる)。
      if (firing && i === 0) {
        const tip = rope.positions[TENTACLE_NUM_POINTS - 1];
        const prev = rope.prevPositions[TENTACLE_NUM_POINTS - 1];
        tip.set(armedFireTipX, 0, armedFireTipZ);
        prev.copy(tip); // 0 速度に reset (跳ね返り防止)
      }
      rope.satisfyConstraints(TENTACLE_CONSTRAINT_ITER);
      // satisfyConstraints は root 固定だが末端は free → 上で set した末端が反復中に
      // ズレることがある。射撃時は反復後にもう一度末端を強制 set。
      if (firing && i === 0) {
        const tip = rope.positions[TENTACLE_NUM_POINTS - 1];
        tip.set(armedFireTipX, 0, armedFireTipZ);
      }

      // TubeGeometry を rope.positions から rebuild。
      const armed = i === 0;
      const radius = armed ? ARMED_TENTACLE_RADIUS : TENTACLE_RADIUS;
      const tubularSegs = armed ? 32 : 28;
      const radialSegs = armed ? 8 : 6;
      const curve = new THREE.CatmullRomCurve3(rope.positions);
      const newGeo = new THREE.TubeGeometry(
        curve,
        tubularSegs,
        radius,
        radialSegs,
        false,
      );
      const mesh = tentacleMeshRefs.current[i];
      if (mesh) {
        const oldGeo = mesh.geometry;
        mesh.geometry = newGeo;
        oldGeo.dispose();
      }

      // 先端 cap: 最終質点に追従、向きは tube 最終 tangent (= positions[N-1] - positions[N-2]) に
      // 合わせて、半球 disc 面 (sphere local +y 軸) と tube 末端の cross-section が一致する
      // ように rotation 設定。武装触手は emitter sphere なので向き不要 (球は対称) だが
      // 同じロジックを通しても問題ないため共通化。
      const bulb = bulbMeshRefs.current[i];
      if (bulb) {
        const tip = rope.positions[TENTACLE_NUM_POINTS - 1];
        const prevPt = rope.positions[TENTACLE_NUM_POINTS - 2];
        bulb.position.set(tip.x, tip.y, tip.z);
        const dx = tip.x - prevPt.x;
        const dy = tip.y - prevPt.y;
        const dz = tip.z - prevPt.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 1e-6) {
          tangentVec.set(dx / len, dy / len, dz / len);
          tipQuat.setFromUnitVectors(yAxisVec, tangentVec);
          bulb.quaternion.copy(tipQuat);
        }
      }
    }
  });

  return (
    <group ref={groupRef} scale={SHIP_MODEL_SCALE}>
      <group position={[0, 0, SHIP_LIFT_Z]}>
        {/* Dome: ぷよぷよ半透明ゼリー。LatheGeometry default Y-up を Z-up world に合わせる。 */}
        <mesh geometry={domeGeometry} rotation={[Math.PI / 2, 0, 0]}>
          <meshPhysicalMaterial
            color={domeColor}
            transparent
            opacity={0.7}
            transmission={0.55}
            thickness={0.3}
            roughness={0.18}
            metalness={0.0}
            clearcoat={0.6}
            clearcoatRoughness={0.25}
            ior={1.33}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Eyes */}
        <mesh position={[EYE_OFFSET_X, EYE_OFFSET_Y, EYE_OFFSET_Z]}>
          <sphereGeometry args={[EYE_RADIUS, 14, 14]} />
          <meshStandardMaterial color={EYE_COLOR} roughness={0.35} />
        </mesh>
        <mesh position={[EYE_OFFSET_X, -EYE_OFFSET_Y, EYE_OFFSET_Z]}>
          <sphereGeometry args={[EYE_RADIUS, 14, 14]} />
          <meshStandardMaterial color={EYE_COLOR} roughness={0.35} />
        </mesh>

        {/* Cheeks: 「血色がうっすら透けている」感を狙う。物質感を消すため:
            - opacity 低め (0.4) で透けを強く
            - depthWrite=false で奥のものを遮らない
            - 弱い emissive で内側からのほんのり発光 (頬の血色)
            - z 方向 scale 圧縮で扁平化 → 球感を消して dome 表面の「染み」っぽく
            - roughness=1.0 で specular を抑え物体感を消す */}
        <mesh
          position={[CHEEK_OFFSET_X, CHEEK_OFFSET_Y, CHEEK_OFFSET_Z]}
          scale={[1, 1, 0.45]}
        >
          <sphereGeometry args={[CHEEK_RADIUS, 14, 14]} />
          <meshStandardMaterial
            color={CHEEK_COLOR}
            emissive={CHEEK_COLOR}
            emissiveIntensity={0.35}
            transparent
            opacity={0.4}
            roughness={1.0}
            metalness={0.0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh
          position={[CHEEK_OFFSET_X, -CHEEK_OFFSET_Y, CHEEK_OFFSET_Z]}
          scale={[1, 1, 0.45]}
        >
          <sphereGeometry args={[CHEEK_RADIUS, 14, 14]} />
          <meshStandardMaterial
            color={CHEEK_COLOR}
            emissive={CHEEK_COLOR}
            emissiveIntensity={0.35}
            transparent
            opacity={0.4}
            roughness={1.0}
            metalness={0.0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Tentacles: dome 底面 (z=0) 円周に 5 本。i=0 は武装触手 (+x = heading 方向)。
            mesh / bulb は ref で保持し、useFrame で物理 rope の状態に追従更新。 */}
        {tentacleLayout.map((tp, i) => {
          const baseR = DOME_RADIUS * 0.82;
          const x = baseR * Math.cos(tp.angle);
          const y = baseR * Math.sin(tp.angle);
          const tentacleKey = `tentacle-${i}`;
          return (
            <group key={tentacleKey} position={[x, y, 0]}>
              <mesh
                geometry={tentacleInitialGeometries[i]}
                ref={(el) => {
                  tentacleMeshRefs.current[i] = el;
                }}
              >
                <meshPhysicalMaterial
                  color={tentacleColor}
                  transparent
                  opacity={0.7}
                  transmission={0.3}
                  thickness={0.15}
                  roughness={0.35}
                  metalness={0.0}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* 先端 cap: 物理 rope の最終質点に追従。
                  - 武装触手 (=laser emitter): player 色 + emissive、目立つ球。
                  - 通常触手: tube material と完全同一の半透明水色。tube radius と同径 sphere
                    を xy で広げ z 方向に圧縮して扁平化することで、触手末端で「ぷくっと丸く
                    閉じる滴」の輪郭にし球感を消す。 */}
              {tp.armed ? (
                // 武装触手末端: 外殻 (通常触手と同じ touch material の半球 cap) + 内核
                // (player 色 emissive sphere)。group の position/rotation を rope tip に
                // 追従させると、外殻 disc 面が tube 末端と継ぎ目なし接続、内核は外殻 dome
                // 内に内包されて「内側からゆらぐ光るゼリー先端」の見え方になる。
                <group
                  ref={(el) => {
                    bulbMeshRefs.current[i] = el;
                  }}
                >
                  {/* 外殻: tube radius と同径の半球、touch material と完全同一。 */}
                  <mesh>
                    <sphereGeometry
                      args={[
                        ARMED_TENTACLE_RADIUS,
                        TIP_HEMISPHERE_PHI_SEGS,
                        TIP_HEMISPHERE_THETA_SEGS,
                        0,
                        Math.PI * 2,
                        0,
                        Math.PI / 2,
                      ]}
                    />
                    <meshPhysicalMaterial
                      color={tentacleColor}
                      transparent
                      opacity={0.7}
                      transmission={0.3}
                      thickness={0.15}
                      roughness={0.35}
                      metalness={0.0}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  {/* 内核 emitter: 外殻 (半球) の中心 = group 原点 = tube 末端の disc 面中心。
                      emissive を HDR 値 (>1) に上げ、toneMapped=false で tone mapping を
                      スキップ → 真っ白に飽和するくらい強く光る。 */}
                  <mesh>
                    <sphereGeometry args={[ARMED_INNER_EMITTER_RADIUS, 14, 14]} />
                    <meshPhysicalMaterial
                      color={new THREE.Color(player.color)}
                      emissive={new THREE.Color(player.color)}
                      emissiveIntensity={3.0}
                      roughness={0.4}
                      metalness={0.0}
                      toneMapped={false}
                    />
                  </mesh>
                  {/* Halo: 内核より大きい sphere に additive blending を掛けて「光の周りに
                      コロナが広がる」見た目を作る。bloom 無しでも輝いて見えるためのフェイク。
                      depthWrite=false で他のオブジェクトを遮らず、touch 越しでも滲み出る。 */}
                  <mesh>
                    <sphereGeometry args={[ARMED_HALO_RADIUS, 16, 16]} />
                    <meshBasicMaterial
                      color={new THREE.Color(player.color)}
                      transparent
                      opacity={0.35}
                      depthWrite={false}
                      blending={THREE.AdditiveBlending}
                      toneMapped={false}
                    />
                  </mesh>
                </group>
              ) : (
                <mesh
                  ref={(el) => {
                    bulbMeshRefs.current[i] = el;
                  }}
                >
                  {/* 半球 (上半分のみ): tube radius と同径、disc 面が tube 末端と接続。
                      thetaStart=0, thetaLength=π/2 で「+y 側 (北極) 半球」。useFrame で
                      rotation を tangent 方向に合わせるので、disc 法線が tube tangent と
                      一致 → 継ぎ目なく丸く閉じる。 */}
                  <sphereGeometry
                    args={[
                      TENTACLE_RADIUS,
                      TIP_HEMISPHERE_PHI_SEGS,
                      TIP_HEMISPHERE_THETA_SEGS,
                      0,
                      Math.PI * 2,
                      0,
                      Math.PI / 2,
                    ]}
                  />
                  <meshPhysicalMaterial
                    color={tentacleColor}
                    transparent
                    opacity={0.7}
                    transmission={0.3}
                    thickness={0.15}
                    roughness={0.35}
                    metalness={0.0}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              )}
            </group>
          );
        })}
      </group>
    </group>
  );
};
