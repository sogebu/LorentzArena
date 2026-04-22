import { useRef, useState } from "react";
import { createVector3, createVector4, type Vector3 } from "../physics";
import { ShipPreview } from "./ShipPreview";

/**
 * 機体デザイン専用の standalone preview。ゲーム本体の context (PeerProvider /
 * GameStore / 光円錐 etc.) を一切起動せず、`ShipPreview` (Canvas + SelfShipRenderer)
 * に UI を重ねた iterate 用ビュー。three.js 純正 OrbitControls で 360° 回転、
 * auto-rotate ON、grid + axes、thrust 入力、BG 切替を UI で操作可能。
 *
 * URL: `#viewer` で起動 (App.tsx で hash 判定)。
 *
 * **drei を使わない理由**: AVG (& 一部のアンチウイルス) が `@react-three/drei` の
 * minified bundle を JS:Prontexi-Z と誤検知して即時隔離するため、Vite optimize の
 * .js が消えて import 失敗 → 真っ白になる事故あり (2026-04-19)。three.js 同梱の
 * `OrbitControls` を直接 useEffect で wire up することで drei bundle を生成させない
 * (`ShipPreview` 内で対応)。
 */

export const ShipViewer = () => {
  const thrustAccelRef = useRef<Vector3>(createVector3(0, 0, 0));
  const cameraYawRef = useRef<number>(0);

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
  const [cannonStyle, setCannonStyle] = useState<"gun" | "laser">("laser");
  // Laser cannon の glow を player 識別色で着色する実機プレビュー用。"default" は従来の
  // cyan glow (ShipPreview の stubPlayer.color="#ffffff" fallback と同等)。
  const playerColorOptions: { label: string; value: string }[] = [
    { label: "default (cyan)", value: "" },
    { label: "red", value: "hsl(0, 85%, 55%)" },
    { label: "orange", value: "hsl(30, 85%, 55%)" },
    { label: "yellow", value: "hsl(60, 85%, 55%)" },
    { label: "green", value: "hsl(120, 85%, 55%)" },
    { label: "teal", value: "hsl(170, 85%, 55%)" },
    { label: "blue", value: "hsl(220, 85%, 55%)" },
    { label: "purple", value: "hsl(275, 85%, 55%)" },
    { label: "magenta", value: "hsl(320, 85%, 55%)" },
  ];
  const [playerColor, setPlayerColor] = useState<string>("");

  // Preview は u=0 固定 (静止 stub player) なので α_world = (0, thrust.x, thrust.y, 0)。
  // α_obs = α_world (observerBoost=null) で spatial 矢印として表示される。
  const currentThrust = thrustOptions[thrustIdx].vec;
  const alpha4Preview = createVector4(
    0,
    currentThrust.x,
    currentThrust.y,
    0,
  );

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <ShipPreview
        autoRotate={autoRotate}
        showGrid={showGrid}
        bgColor={bgColor}
        interactive
        thrustAccelRef={thrustAccelRef}
        cameraYawRef={cameraYawRef}
        cannonStyle={cannonStyle}
        playerColor={playerColor || undefined}
        alpha4={alpha4Preview}
      />

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
        <label style={{ display: "block", marginBottom: 8 }}>
          {"Cannon: "}
          <select
            value={cannonStyle}
            onChange={(e) => setCannonStyle(e.target.value as "gun" | "laser")}
            style={{
              background: "#222",
              color: "#ddd",
              border: "1px solid #555",
              padding: "2px 6px",
            }}
          >
            <option value="gun">gun (古典大砲)</option>
            <option value="laser">laser (エネルギー兵器)</option>
          </select>
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          {"Player color (glow): "}
          <select
            value={playerColor}
            onChange={(e) => setPlayerColor(e.target.value)}
            style={{
              background: "#222",
              color: "#ddd",
              border: "1px solid #555",
              padding: "2px 6px",
            }}
          >
            {playerColorOptions.map((opt) => (
              <option key={opt.label} value={opt.value}>
                {opt.label}
              </option>
            ))}
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
