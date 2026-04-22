import { lazy, Suspense, useState } from "react";
import "./App.css";
import Lobby from "./components/Lobby";
import { useI18n, type Lang } from "./i18n";

// 重い dep (three.js / R3F / peerjs) を含む subtree は lazy-load し、Lobby 画面の
// 初回描画でこれらを読み込まないようにする。GameSession は PeerProvider + Connect +
// RelativisticGame を束ねた wrapper、ShipViewer は named export なので default shape に変換。
const GameSession = lazy(() => import("./components/GameSession"));
const ShipViewer = lazy(() =>
  import("./components/ShipViewer").then((m) => ({ default: m.ShipViewer })),
);

// URL ハッシュからルーム名を取得: #room=physics101 → "physics101", なし → "default"
const getRoomName = (): string => {
  const hash = window.location.hash;
  const match = hash.match(/^#room=(.+)$/);
  return match ? match[1] : "default";
};

// `#viewer` で機体 design preview に切り替え。PeerProvider / GameStore 等は起動せず
// ShipViewer 単独で動作 (ゲーム本体と完全独立)。
const isViewerMode = (): boolean => window.location.hash.includes("viewer");

const STORAGE_KEY_NAME = "la-playerName";

/** First-visit language picker. Shown only when no language is stored in localStorage. */
const LangPicker = () => {
  const { setLang } = useI18n();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
        fontFamily: "monospace",
        color: "white",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(28px, 6vw, 48px)",
          fontWeight: "bold",
          margin: "0 0 40px 0",
          letterSpacing: "2px",
        }}
      >
        Lorentz Arena
      </h1>
      <div style={{ display: "flex", gap: "16px" }}>
        {(["ja", "en"] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            style={{
              padding: "16px 40px",
              fontSize: "18px",
              fontFamily: "monospace",
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "8px",
              color: "white",
              cursor: "pointer",
            }}
          >
            {l === "ja" ? "日本語" : "English"}
          </button>
        ))}
      </div>
    </div>
  );
};

const App = () => {
  // hooks は早期 return より前に呼ぶ (React rules-of-hooks)
  const { langChosen } = useI18n();
  const roomName = getRoomName();
  const [gameStarted, setGameStarted] = useState(false);
  const [displayName, setDisplayName] = useState(
    () => {
      try { return localStorage.getItem(STORAGE_KEY_NAME) || ""; }
      catch { return ""; }
    },
  );

  // Viewer mode: ゲーム/言語選択を bypass、ShipViewer 単独で起動
  if (isViewerMode()) {
    return (
      <Suspense fallback={null}>
        <ShipViewer />
      </Suspense>
    );
  }

  const handleStart = () => {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    try { localStorage.setItem(STORAGE_KEY_NAME, trimmed); }
    catch { /* ignore */ }
    setDisplayName(trimmed);
    setGameStarted(true);
  };

  if (!langChosen) {
    return <LangPicker />;
  }

  if (!gameStarted) {
    return (
      <Lobby
        displayName={displayName}
        setDisplayName={setDisplayName}
        onStart={handleStart}
      />
    );
  }

  return (
    <Suspense fallback={null}>
      <GameSession roomName={roomName} displayName={displayName} />
    </Suspense>
  );
};

export default App;
