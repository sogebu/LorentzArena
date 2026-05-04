import {
  type FormEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOrientation } from "../hooks/useOrientation";
import { type Lang, useI18n } from "../i18n";
import { getTopScores, type HighScoreEntry } from "../services/highScores";
import { fetchLeaderboard } from "../services/leaderboard";
import {
  type ControlScheme,
  useGameStore,
  type ViewMode,
} from "../stores/game-store";
import { LIGHTHOUSE_DISPLAY_NAME } from "./game/lighthouse";

// ViewMode (game-store) → ShipPreview hullStyle: shooter ⇒ rocket。 in-arena は
// SceneContent で同じ dispatch をしている (3 way: classic / shooter→Rocket /
// jellyfish)。 lobby preview でも揃える。
const viewModeToHullStyle = (
  v: ViewMode,
): "classic" | "rocket" | "jellyfish" =>
  v === "shooter" ? "rocket" : v === "jellyfish" ? "jellyfish" : "classic";

// ShipPreview (R3F + three.js、重い dep を引き込む) を lazy-load。Lobby のテキスト UI を
// 先に描画し、3D ship 背景は three chunk 取得後に fade-in する。初期ロード payload から
// ~738 KB (three) + ~36 KB (fiber) を外せる。
const ShipPreview = lazy(() =>
  import("./ShipPreview").then((m) => ({ default: m.ShipPreview })),
);

declare const __BUILD_TIME__: string;

type LobbyProps = {
  displayName: string;
  setDisplayName: (name: string) => void;
  onStart: () => void;
};

const Lobby = ({ displayName, setDisplayName, onStart }: LobbyProps) => {
  const { t, lang, setLang } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const viewMode = useGameStore((s) => s.viewMode);
  const setViewMode = useGameStore((s) => s.setViewMode);
  const controlScheme = useGameStore((s) => s.controlScheme);
  const setControlScheme = useGameStore((s) => s.setControlScheme);
  const orientation = useOrientation();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const highScores = useMemo(() => getTopScores(5), []);
  const [globalScores, setGlobalScores] = useState<HighScoreEntry[]>([]);

  const displayEntryName = (name: string): string =>
    name === LIGHTHOUSE_DISPLAY_NAME ? t("hud.lighthouse") : name;

  useEffect(() => {
    const leaderboardUrl = import.meta.env.VITE_LEADERBOARD_URL;
    if (!leaderboardUrl) return;
    fetchLeaderboard(leaderboardUrl, 10).then(setGlobalScores);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (displayName.trim()) {
      // 開始ボタンの user gesture 文脈で fullscreen 化を試みる (= browser security 制約上、
      // user gesture 中でしか requestFullscreen は呼べない)。 失敗 (= iOS 16.4 未満 / 拒否) は
      // silent 扱い、 通常 browser 表示で fall back。 orientation lock はしない (= portrait /
      // landscape どちらでも遊べる、 user の好きな向きで rotate 自由)。
      // PWA standalone (= Add to Home Screen) で起動済の iOS では fullscreenElement が既に
      // 立っているケースがあるため、 既に fullscreen なら no-op で進む。
      const root = document.documentElement;
      if (
        root.requestFullscreen &&
        !document.fullscreenElement
      ) {
        root.requestFullscreen().catch(() => {
          // silent: iOS 16.4 未満 / user denied / unsupported 等
        });
      }
      onStart();
    }
  };

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
        zIndex: 2000,
        fontFamily: "monospace",
        color: "white",
      }}
    >
      {/* 背景: 自機 3D preview (くるくる auto-rotate)、フルスクリーン。pointerEvents は
          ShipPreview 側で none、UI の input / button をブロックしない。zIndex 0 で背景層、
          UI コンテンツは下の wrapper で zIndex 1 に持ち上げる。 */}
      {/* container を `top: -25vh` で viewport 上にはみ出させると、canvas の幾何中央
          (= 船がレンダされる位置) が実 viewport の ~25vh (= title より上) に来る。
          camera / target は default のまま = ship はサイズ不変で orbit 挙動も自然。 */}
      <div
        style={{
          position: "absolute",
          top: "-22vh",
          left: 0,
          right: 0,
          height: "100vh",
          zIndex: 0,
        }}
      >
        <Suspense fallback={null}>
          <ShipPreview
            bgColor="transparent"
            cannonStyle="laser"
            hullStyle={viewModeToHullStyle(viewMode)}
          />
        </Suspense>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          width: "100%",
          height: "100%",
          // 縦持ち: 40vh で ship preview を上半分に配置 + title〜form を下半分に展開する
          // hero layout (= original)。 ハイスコアは画面下に出るが overflowY: auto で scroll
          // 可能、 「title page」 視覚を温存する判断 (= 2026-05-04 user feedback で 18vh 案
          // 撤回、 ship との重なりを避ける aesthetic 重視に戻した)。
          // 横持ち (landscape): 12vh、 5vh では title が画面最上段に張り付いて窮屈に見える
          // (= 2026-05-04 user feedback)。 12vh で title 上に breathing room を確保 + 2-col
          // layout (= form 左 / hi-scores 右) で hi-scores 同時可視。 mobile landscape の
          // ~375px 高さでも form column の最下段 (= 操作系 dropdown) が viewport に収まる。
          paddingTop: orientation === "landscape" ? "12vh" : "40vh",
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        {/* Language toggle */}
        <div
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            display: "flex",
            gap: "8px",
          }}
        >
          {(["ja", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              style={{
                padding: "4px 12px",
                fontSize: "13px",
                backgroundColor:
                  lang === l ? "rgba(255,255,255,0.15)" : "transparent",
                border: `1px solid ${lang === l ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)"}`,
                color: lang === l ? "white" : "rgba(255,255,255,0.5)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {l === "ja" ? "日本語" : "English"}
            </button>
          ))}
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "clamp(28px, 6vw, 48px)",
            fontWeight: "bold",
            margin: "0 0 8px 0",
            letterSpacing: "2px",
          }}
        >
          {t("lobby.title")}
        </h1>
        <p
          style={{
            fontSize: "clamp(12px, 2.5vw, 16px)",
            opacity: 0.6,
            // 旧 40px では mobile portrait の縦余白を大きく食ってハイスコアが画面下に
            // はみ出していた (= 2026-05-04 user feedback)、 16px に圧縮。
            margin: "0 0 16px 0",
          }}
        >
          {t("lobby.subtitle")}
        </p>

        {/* lower content: form + dropdowns + hi-scores + global leaderboard。
            portrait: 単一縦列 (= 既存 layout)。
            landscape: 2 列 (左 = form + dropdowns、 右 = hi-scores + global) で
            横画面の幅を活用 + hi-scores が画面下に押し出されないようにする。 */}
        <div
          style={{
            display: "flex",
            flexDirection: orientation === "landscape" ? "row" : "column",
            alignItems: orientation === "landscape" ? "flex-start" : "center",
            gap: orientation === "landscape" ? "32px" : "0px",
            width: "100%",
            justifyContent: "center",
          }}
        >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
        {/* Name input */}
        <form
          onSubmit={handleSubmit}
          style={{ textAlign: "center", width: "min(280px, 80vw)" }}
        >
          <label
            htmlFor="player-name"
            style={{
              display: "block",
              fontSize: "13px",
              opacity: 0.7,
              marginBottom: "8px",
              textAlign: "left",
            }}
          >
            {t("lobby.nameLabel")}
          </label>
          <input
            ref={inputRef}
            id="player-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("lobby.namePlaceholder")}
            maxLength={20}
            style={{
              width: "100%",
              padding: "10px 14px",
              fontSize: "16px",
              fontFamily: "monospace",
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "6px",
              color: "white",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            disabled={!displayName.trim()}
            style={{
              width: "100%",
              marginTop: "16px",
              padding: "12px",
              fontSize: "18px",
              fontWeight: "bold",
              fontFamily: "monospace",
              letterSpacing: "4px",
              backgroundColor: displayName.trim()
                ? "rgba(255,255,255,0.12)"
                : "rgba(255,255,255,0.04)",
              border: `1px solid ${displayName.trim() ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: "6px",
              color: displayName.trim() ? "white" : "rgba(255,255,255,0.3)",
              cursor: displayName.trim() ? "pointer" : "default",
            }}
          >
            {t("lobby.start")}
          </button>
        </form>

        {/* 機体形状 (見た目) と 操作系 を直交軸で選択。 game start 前に試せるよう Lobby
          にも置き、 背景の ShipPreview が viewMode 連動で即時更新される。 in-arena では
          ControlPanel に同じ 2 段 dropdown あり。 */}
        <div
          style={{
            marginTop: "20px",
            display: "grid",
            gridTemplateColumns: "max-content max-content",
            rowGap: "6px",
            columnGap: "8px",
            alignItems: "center",
            fontSize: "13px",
            opacity: 0.85,
            width: "min(280px, 80vw)",
          }}
        >
          <label htmlFor="lobby-view-mode" style={{ textAlign: "right" }}>
            {t("hud.viewMode.label")}:
          </label>
          <select
            id="lobby-view-mode"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "4px",
              padding: "4px 8px",
              fontFamily: "monospace",
              fontSize: "13px",
            }}
          >
            <option value="classic">{t("hud.viewMode.classic")}</option>
            <option value="shooter">{t("hud.viewMode.shooter")}</option>
            <option value="jellyfish">{t("hud.viewMode.jellyfish")}</option>
          </select>
          <label htmlFor="lobby-control-scheme" style={{ textAlign: "right" }}>
            {t("hud.controlScheme.label")}:
          </label>
          <select
            id="lobby-control-scheme"
            value={controlScheme}
            onChange={(e) => setControlScheme(e.target.value as ControlScheme)}
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "4px",
              padding: "4px 8px",
              fontFamily: "monospace",
              fontSize: "13px",
            }}
          >
            <option value="legacy_classic">
              {t("hud.controlScheme.legacy_classic")}
            </option>
            <option value="legacy_shooter">
              {t("hud.controlScheme.legacy_shooter")}
            </option>
            <option value="modern">{t("hud.controlScheme.modern")}</option>
          </select>
        </div>
        </div>
        {/* right column (= landscape) / 続き (= portrait): hi-scores + global */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >

        {/* High scores */}
        {highScores.length > 0 && (
          <div
            style={{
              marginTop: "32px",
              width: "min(280px, 80vw)",
              fontSize: "13px",
              opacity: 0.6,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
              {t("lobby.highScores")}
            </div>
            {highScores.map((entry, i) => (
              <div
                key={`${entry.name}-${entry.date}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "3px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span>
                  {i + 1}. {displayEntryName(entry.name)}
                </span>
                <span>
                  {entry.kills} {t("lobby.kills")} /{" "}
                  {Math.floor(entry.duration / 60)}:
                  {String(Math.floor(entry.duration) % 60).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Build version (top-left、HUD ControlPanel と同じ配置で視線コストを下げる) */}
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            fontSize: "11px",
            opacity: 0.4,
          }}
        >
          {t("hud.build")}: {__BUILD_TIME__} JST
        </div>

        {/* Global leaderboard */}
        {globalScores.length > 0 && (
          <div
            style={{
              marginTop: "24px",
              width: "min(280px, 80vw)",
              fontSize: "13px",
              opacity: 0.6,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
              {t("lobby.globalLeaderboard")}
            </div>
            {globalScores.map((entry, i) => (
              <div
                key={`g-${entry.name}-${entry.date}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "3px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span>
                  {i + 1}. {displayEntryName(entry.name)}
                </span>
                <span>
                  {entry.kills} {t("lobby.kills")} /{" "}
                  {Math.floor(entry.duration / 60)}:
                  {String(Math.floor(entry.duration) % 60).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>
        )}
        </div>
        </div>
      </div>
    </div>
  );
};

export default Lobby;
