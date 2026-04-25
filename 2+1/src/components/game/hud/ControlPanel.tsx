import { useMemo } from "react";
import { useI18n } from "../../../i18n";
import { useGameStore } from "../../../stores/game-store";
import { isLighthouse } from "../lighthouse";
import type { RelativisticPlayer } from "../types";
import { isTouchDevice } from "./utils";

declare const __BUILD_TIME__: string;

const ToggleSwitch = ({
  checked,
  onChange,
  labelLeft,
  labelRight,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  labelLeft: string;
  labelRight: string;
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    style={{
      display: "grid",
      gridColumn: "1 / -1",
      gridTemplateColumns: "subgrid",
      alignItems: "center",
      columnGap: "6px",
      cursor: "pointer",
      background: "none",
      border: "none",
      padding: 0,
      color: "inherit",
      font: "inherit",
    }}
  >
    <span style={{ opacity: checked ? 0.4 : 1, justifySelf: "end" }}>
      {labelLeft}
    </span>
    <div
      style={{
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        backgroundColor: checked
          ? "rgba(102, 255, 102, 0.35)"
          : "rgba(255, 255, 255, 0.25)",
        position: "relative",
        flexShrink: 0,
        transition: "background-color 0.2s",
      }}
    >
      <div
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          backgroundColor: "white",
          position: "absolute",
          top: "2px",
          left: checked ? "18px" : "2px",
          transition: "left 0.2s",
        }}
      />
    </div>
    <span style={{ opacity: checked ? 1 : 0.4 }}>{labelRight}</span>
  </button>
);

const ToggleGroup = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "max-content 36px max-content",
      rowGap: "6px",
      columnGap: "6px",
      marginTop: "6px",
      justifyContent: "start",
    }}
  >
    {children}
  </div>
);

type ControlPanelProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  scores: Record<string, number>;
  fps: number;
  showInRestFrame: boolean;
  setShowInRestFrame: (v: boolean) => void;
  useOrthographic: boolean;
  setUseOrthographic: (v: boolean) => void;
  killGlow: boolean;
  getPlayerColor: (peerId: string) => string;
};

export const ControlPanel = ({
  players,
  myId,
  scores,
  fps,
  showInRestFrame,
  setShowInRestFrame,
  useOrthographic,
  setUseOrthographic,
  killGlow,
  getPlayerColor,
}: ControlPanelProps) => {
  const { t } = useI18n();
  const displayNames = useGameStore((s) => s.displayNames);
  const killLog = useGameStore((s) => s.killLog);
  const viewMode = useGameStore((s) => s.viewMode);
  const setViewMode = useGameStore((s) => s.setViewMode);
  const sortedScores = useMemo(
    () => Object.entries(scores).sort(([, a], [, b]) => b - a),
    [scores],
  );
  const resolveName = (id: string): string => {
    const fromPlayer = players.get(id)?.displayName;
    if (fromPlayer) return fromPlayer;
    const fromDisplayNames = displayNames.get(id);
    if (fromDisplayNames) return fromDisplayNames;
    // killLog は victim の name しか持たないが、reconnection で消えた peer が
    // 過去に被撃墜されていれば逆引きできる。
    const fromVictim = killLog.find((e) => e.victimId === id)?.victimName;
    if (fromVictim) return fromVictim;
    return id.slice(0, 6);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: "10px",
        left: "10px",
        color: "white",
        fontSize: "14px",
        fontFamily: "monospace",
        zIndex: 100,
      }}
    >
      <div>{t("hud.title")}</div>
      {isTouchDevice ? (
        <>
          <div>{t("hud.controls.touch.heading")}</div>
          <div>{t("hud.controls.touch.thrust")}</div>
          <div>{t("hud.controls.touch.fire")}</div>
        </>
      ) : (
        <>
          <div>{t("hud.controls.forward")}</div>
          <div>{t("hud.controls.cameraH")}</div>
          <div>{t("hud.controls.cameraV")}</div>
          <div>{t("hud.controls.fire")}</div>
        </>
      )}
      <ToggleGroup>
        <ToggleSwitch
          checked={showInRestFrame}
          onChange={setShowInRestFrame}
          labelLeft={t("hud.worldFrame")}
          labelRight={t("hud.restFrame")}
        />
        <ToggleSwitch
          checked={!useOrthographic}
          onChange={(v) => setUseOrthographic(!v)}
          labelLeft={t("hud.orthographic")}
          labelRight={t("hud.perspective")}
        />
        <ToggleSwitch
          checked={viewMode === "shooter"}
          onChange={(v) => setViewMode(v ? "shooter" : "classic")}
          labelLeft={t("hud.viewMode.classic")}
          labelRight={t("hud.viewMode.shooter")}
        />
      </ToggleGroup>
      <div
        style={{ marginTop: "5px", color: fps < 30 ? "#ff6666" : "#66ff66" }}
      >
        FPS: {fps}
      </div>
      <div style={{ marginTop: "2px", fontSize: "13px", opacity: 0.6 }}>
        {t("hud.build")}: {__BUILD_TIME__} JST
      </div>
      {Object.keys(scores).length > 0 && (
        <div
          style={{
            marginTop: "8px",
            borderTop: "1px solid rgba(255,255,255,0.3)",
            paddingTop: "6px",
            transition: "transform 0.15s ease-out",
            transform: killGlow ? "scale(1.4)" : "scale(1)",
            transformOrigin: "top left",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "2px" }}>{t("hud.kills")}</div>
          {sortedScores.map(([id, kills]) => (
            <div
              key={id}
              style={{
                color: players.get(id)?.color ?? getPlayerColor(id),
              }}
            >
              {id === myId
                ? players.get(myId)?.displayName ?? t("hud.you")
                : isLighthouse(id)
                  ? t("hud.lighthouse")
                  : resolveName(id)}
              : {kills}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
