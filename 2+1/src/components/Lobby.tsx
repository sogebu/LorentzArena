import { type FormEvent, useEffect, useMemo, useRef } from "react";
import { useI18n, type Lang } from "../i18n";
import { usePeer } from "../hooks/usePeer";
import { getTopScores } from "../services/highScores";

type LobbyProps = {
  displayName: string;
  setDisplayName: (name: string) => void;
  onStart: () => void;
};

const Lobby = ({ displayName, setDisplayName, onStart }: LobbyProps) => {
  const { t, lang, setLang } = useI18n();
  const { connectionPhase } = usePeer();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isConnected = connectionPhase === "connected";
  const highScores = useMemo(() => getTopScores(5), []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (displayName.trim()) {
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
              backgroundColor: lang === l ? "rgba(255,255,255,0.15)" : "transparent",
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
          margin: "0 0 40px 0",
        }}
      >
        {t("lobby.subtitle")}
      </p>

      {/* Name input */}
      <form onSubmit={handleSubmit} style={{ textAlign: "center", width: "min(280px, 80vw)" }}>
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
        <p
          style={{
            fontSize: "12px",
            opacity: 0.4,
            marginTop: "12px",
          }}
        >
          {isConnected ? "●" : "○"} {isConnected ? "" : t("lobby.connecting")}
        </p>
      </form>

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
                {i + 1}. {entry.name}
              </span>
              <span>
                {entry.kills} {t("lobby.kills")} / {Math.floor(entry.duration / 60)}:{String(Math.floor(entry.duration) % 60).padStart(2, "0")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Lobby;
