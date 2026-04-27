import { lazy, Suspense, useEffect, useState } from "react";
import "./App.css";
import Lobby from "./components/Lobby";
import { useI18n, type Lang } from "./i18n";
import {
  useGameStore,
  type ControlScheme,
  type ViewMode,
} from "./stores/game-store";

// 重い dep (three.js / R3F / peerjs) を含む subtree は lazy-load し、Lobby 画面の
// 初回描画でこれらを読み込まないようにする。GameSession は PeerProvider + Connect +
// RelativisticGame を束ねた wrapper、ShipViewer は named export なので default shape に変換。
const GameSession = lazy(() => import("./components/GameSession"));
const ShipViewer = lazy(() =>
  import("./components/ShipViewer").then((m) => ({ default: m.ShipViewer })),
);

// URL hash を `&` 区切りで `key=value` 形式 + 値なしフラグ (`viewer` 等) を扱う。
// 例: `#room=test&controls=modern&ship=jellyfish`、`#viewer`、`#room=test&viewer`。
const parseHash = (): { params: Record<string, string>; flags: Set<string> } => {
  const hash = window.location.hash.replace(/^#/, "");
  const params: Record<string, string> = {};
  const flags = new Set<string>();
  if (!hash) return { params, flags };
  for (const part of hash.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) {
      flags.add(part);
    } else {
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (k) params[k] = v;
    }
  }
  return { params, flags };
};

const getRoomName = (): string => parseHash().params.room ?? "default";

// `#viewer` で機体 design preview に切り替え。PeerProvider / GameStore 等は起動せず
// ShipViewer 単独で動作 (ゲーム本体と完全独立)。
const isViewerMode = (): boolean => parseHash().flags.has("viewer");

const VIEW_MODE_VALUES: readonly ViewMode[] = ["classic", "shooter", "jellyfish"];
const CONTROL_SCHEME_VALUES: readonly ControlScheme[] = [
  "legacy_classic",
  "legacy_shooter",
  "modern",
];

/**
 * 起動時 1 回、URL hash の `#controls=` / `#ship=` を読んで store に override 適用。
 * UI dropdown は撤去済 (隠しオプション) なので、これが唯一の切替経路 (LS 直接編集を除く)。
 * 適用後は LS にも書かれるため、F5 後も維持される (URL hash を消した場合も保持)。
 */
const useUrlHashOverrides = () => {
  const setViewMode = useGameStore((s) => s.setViewMode);
  const setControlScheme = useGameStore((s) => s.setControlScheme);
  useEffect(() => {
    const { params } = parseHash();
    const ship = params.ship;
    if (ship && (VIEW_MODE_VALUES as readonly string[]).includes(ship)) {
      setViewMode(ship as ViewMode);
    }
    const controls = params.controls;
    if (
      controls &&
      (CONTROL_SCHEME_VALUES as readonly string[]).includes(controls)
    ) {
      setControlScheme(controls as ControlScheme);
    }
  }, [setViewMode, setControlScheme]);
};

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
  useUrlHashOverrides();
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
