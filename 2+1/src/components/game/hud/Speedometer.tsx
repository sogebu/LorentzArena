import type { TranslationKey } from "../../../i18n/translations/ja";
import { gamma, lengthVector3 } from "../../../physics";
import type { RelativisticPlayer } from "../types";

type SpeedometerProps = {
  player: RelativisticPlayer;
  energy: number;
  myLaserColor: string;
  t: (key: TranslationKey) => string;
};

export const Speedometer = ({
  player,
  energy,
  myLaserColor,
  t,
}: SpeedometerProps) => {
  const uMag = lengthVector3(player.phaseSpace.u);
  const g = gamma(player.phaseSpace.u);
  const speed = uMag / g; // 3-speed: v = |u| / γ = |u| / √(1 + |u|²)

  return (
    <div
      style={{
        position: "absolute",
        bottom: "10px",
        right: "10px",
        color: "white",
        fontSize: "14px",
        fontFamily: "monospace",
        textAlign: "right",
        zIndex: 100,
      }}
    >
      {/* エネルギーゲージ */}
      {/* 枯渇時 (energy < ε): ENERGY ラベル表示。低エネルギー (< 0.2): バー赤化。
          枯渇時はバー + ラベル共に点滅 (pulse) して強調。 */}
      <div
        style={{
          position: "relative",
          width: "120px",
          height: "12px",
          marginBottom: "8px",
          marginLeft: "auto",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "rgba(255, 255, 255, 0.15)",
            borderRadius: "4px",
            overflow: "hidden",
            position: "absolute",
            top: "2px",
            left: 0,
            outline:
              energy < 0.001 ? "1px solid rgba(255, 80, 80, 0.9)" : "none",
            animation:
              energy < 0.001 ? "energy-empty-pulse 0.7s ease-in-out infinite" : "none",
          }}
        >
          <div
            style={{
              width: `${energy * 100}%`,
              height: "100%",
              backgroundColor:
                energy < 0.2 ? "rgba(255, 80, 80, 0.8)" : myLaserColor,
              borderRadius: "4px",
              transition: "width 0.05s linear",
            }}
          />
        </div>
        {energy < 0.001 && (
          <div
            style={{
              position: "absolute",
              top: "-2px",
              right: 0,
              fontSize: "10px",
              fontWeight: "bold",
              color: "rgba(255, 80, 80, 1)",
              letterSpacing: "1px",
              animation: "energy-empty-pulse 0.7s ease-in-out infinite",
              pointerEvents: "none",
            }}
          >
            {t("hud.energy")}
          </div>
        )}
      </div>
      <div>{t("hud.speed")}: {(speed * 100).toFixed(1)}% c</div>
      <div>{t("hud.gamma")}: {g.toFixed(3)}</div>
      <div>{t("hud.properTime")}: {player.phaseSpace.pos.t.toFixed(2)}s</div>
      <div>
        {t("hud.position")}: ({player.phaseSpace.pos.x.toFixed(2)},{" "}
        {player.phaseSpace.pos.y.toFixed(2)})
      </div>
    </div>
  );
};
