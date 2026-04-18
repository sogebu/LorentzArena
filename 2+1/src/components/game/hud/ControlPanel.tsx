import { useMemo } from "react";
import { useI18n } from "../../../i18n";
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
      display: "flex",
      alignItems: "center",
      gap: "6px",
      cursor: "pointer",
      marginTop: "6px",
      background: "none",
      border: "none",
      padding: 0,
      color: "inherit",
      font: "inherit",
    }}
  >
    <span style={{ opacity: checked ? 1 : 0.4 }}>{labelLeft}</span>
    <div
      style={{
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        backgroundColor: "rgba(255, 255, 255, 0.25)",
        position: "relative",
        flexShrink: 0,
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
          left: checked ? "2px" : "18px",
          transition: "left 0.2s",
        }}
      />
    </div>
    <span style={{ opacity: checked ? 0.4 : 1 }}>{labelRight}</span>
  </button>
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
  const sortedScores = useMemo(
    () => Object.entries(scores).sort(([, a], [, b]) => b - a),
    [scores],
  );

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
      <ToggleSwitch
        checked={showInRestFrame}
        onChange={setShowInRestFrame}
        labelLeft={t("hud.restFrame")}
        labelRight={t("hud.worldFrame")}
      />
      <ToggleSwitch
        checked={useOrthographic}
        onChange={setUseOrthographic}
        labelLeft={t("hud.orthographic")}
        labelRight={t("hud.perspective")}
      />
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
          <div style={{ fontWeight: "bold", marginBottom: "2px" }}>Kill</div>
          {sortedScores.map(([id, kills]) => (
            <div
              key={id}
              style={{
                color: players.get(id)?.color ?? getPlayerColor(id),
              }}
            >
              {id === myId ? t("hud.you") : isLighthouse(id) ? t("hud.lighthouse") : players.get(id)?.displayName ?? id.slice(0, 6)}: {kills}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
