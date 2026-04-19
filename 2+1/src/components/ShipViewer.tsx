import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createVector3, createVector4, type Vector3 } from "../physics";
import { GameLights } from "./game/GameLights";
import { SelfShipRenderer } from "./game/SelfShipRenderer";

/**
 * 機体デザイン専用の standalone preview。ゲーム本体の context (PeerProvider /
 * GameStore / 光円錐 etc.) を一切起動せず、`SelfShipRenderer` のみを singular に
 * 表示。three.js 純正 OrbitControls で 360° 回転、auto-rotate ON、grid + axes 付き。
 *
 * URL: `#viewer` で起動 (App.tsx で hash 判定)。
 *
 * **drei を使わない理由**: AVG (& 一部のアンチウイルス) が `@react-three/drei` の
 * minified bundle を JS:Prontexi-Z と誤検知して即時隔離するため、Vite optimize の
 * .js が消えて import 失敗 → 真っ白になる事故あり (2026-04-19)。three.js 同梱の
 * `OrbitControls` を直接 useEffect で wire up することで drei bundle を生成させない。
 *
 * thrust 入力は UI ボタンで切り替え (静止 / 8 方向の WASD 相当) → 噴射炎・nozzle 反応
 * のチェックも単独で可能。cameraYaw は固定 0 (機体は常に +x 向き)、観測者 boost なし。
 */

const Orbit = ({ autoRotate }: { autoRotate: boolean }) => {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 0, 0);
    controls.minDistance = 1.5;
    controls.maxDistance = 20;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;
    let raf = 0;
    const tick = () => {
      controls.update();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
    };
  }, [camera, gl, autoRotate]);
  return null;
};

export const ShipViewer = () => {
  const thrustAccelRef = useRef<Vector3>(createVector3(0, 0, 0));
  const cameraYawRef = useRef<number>(0);

  const stubPlayer = useRef({
    id: "preview",
    phaseSpace: {
      pos: createVector4(0, 0, 0, 0),
      u: createVector3(0, 0, 0),
    },
    color: "#ffffff",
  }).current;

  type ThrustOption = {
    label: string;
    desc: string;
    vec: Vector3;
  };
  const PLAYER_ACCEL = 0.8;
  const sqrtHalf = PLAYER_ACCEL / Math.SQRT2;
  const thrustOptions: ThrustOption[] = [
    { label: "静止", desc: "noise なし", vec: createVector3(0, 0, 0) },
    { label: "W (前進)", desc: "後ろ 2 ノズル各 1/√2", vec: createVector3(PLAYER_ACCEL, 0, 0) },
    { label: "S (後退)", desc: "前 2 ノズル各 1/√2", vec: createVector3(-PLAYER_ACCEL, 0, 0) },
    { label: "A (左進)", desc: "右 2 ノズル各 1/√2", vec: createVector3(0, PLAYER_ACCEL, 0) },
    { label: "D (右進)", desc: "左 2 ノズル各 1/√2", vec: createVector3(0, -PLAYER_ACCEL, 0) },
    { label: "W+A (左前進)", desc: "後右ノズル単独 1.0", vec: createVector3(sqrtHalf, sqrtHalf, 0) },
    { label: "W+D (右前進)", desc: "後左ノズル単独 1.0", vec: createVector3(sqrtHalf, -sqrtHalf, 0) },
    { label: "S+A (左後退)", desc: "前右ノズル単独 1.0", vec: createVector3(-sqrtHalf, sqrtHalf, 0) },
    { label: "S+D (右後退)", desc: "前左ノズル単独 1.0", vec: createVector3(-sqrtHalf, -sqrtHalf, 0) },
  ];
  const [thrustIdx, setThrustIdx] = useState(0);
  const setThrust = (idx: number) => {
    setThrustIdx(idx);
    thrustAccelRef.current = thrustOptions[idx].vec;
  };

  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [bgColor, setBgColor] = useState("#0a0a0f");

  return (
    <div style={{ position: "fixed", inset: 0, background: bgColor }}>
      <Canvas camera={{ position: [4, -4, 3], up: [0, 0, 1], fov: 45 }}>
        <GameLights />

        {showGrid && (
          <gridHelper
            args={[10, 20, "#3a3a4a", "#1a1a26"]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        )}
        {showGrid && <axesHelper args={[2.5]} />}

        <SelfShipRenderer
          player={stubPlayer}
          thrustAccelRef={thrustAccelRef}
          cameraYawRef={cameraYawRef}
          observerPos={stubPlayer.phaseSpace.pos}
          observerBoost={null}
        />

        <Orbit autoRotate={autoRotate} />
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          color: "#ddd",
          fontFamily: "monospace",
          fontSize: 12,
          background: "rgba(0,0,0,0.6)",
          padding: "10px 14px",
          borderRadius: 6,
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: "bold", marginBottom: 6 }}>Ship Viewer</div>
        <div style={{ color: "#888", marginBottom: 8 }}>
          ドラッグ=回転 / スクロール=ズーム<br />
          軸: <span style={{ color: "#f44" }}>X</span>=前 /{" "}
          <span style={{ color: "#4f4" }}>Y</span>=左 /{" "}
          <span style={{ color: "#48f" }}>Z</span>=上
        </div>

        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={autoRotate}
            onChange={(e) => setAutoRotate(e.target.checked)}
          />
          {" 自動回転"}
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
          {" Grid + Axes"}
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          {"BG: "}
          <select
            value={bgColor}
            onChange={(e) => setBgColor(e.target.value)}
            style={{
              background: "#222",
              color: "#ddd",
              border: "1px solid #555",
              padding: "2px 6px",
            }}
          >
            <option value="#0a0a0f">dark space</option>
            <option value="#1a1a26">slightly lit</option>
            <option value="#444">mid gray</option>
            <option value="#aaa">light gray</option>
            <option value="#000">pure black</option>
          </select>
        </label>

        <div style={{ marginTop: 10, fontWeight: "bold" }}>Thrust 入力</div>
        <div style={{ color: "#888", fontSize: 11, marginBottom: 6 }}>
          {thrustOptions[thrustIdx].desc}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
          {thrustOptions.map((opt, i) => (
            <button
              type="button"
              key={opt.label}
              onClick={() => setThrust(i)}
              style={{
                background: i === thrustIdx ? "#3a6" : "#222",
                color: "#ddd",
                border: "1px solid #555",
                padding: "4px 6px",
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #333" }}>
          <a href="#" style={{ color: "#6cf" }}>← ゲームに戻る</a>
        </div>
      </div>
    </div>
  );
};
