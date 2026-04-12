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
  const v = lengthVector3(player.phaseSpace.u);
  const g = gamma(player.phaseSpace.u);

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
      <div
        style={{
          width: "120px",
          height: "8px",
          backgroundColor: "rgba(255, 255, 255, 0.15)",
          borderRadius: "4px",
          marginBottom: "8px",
          marginLeft: "auto",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${energy * 100}%`,
            height: "100%",
            backgroundColor:
              energy < 0.2
                ? "rgba(255, 80, 80, 0.8)"
                : myLaserColor,
            borderRadius: "4px",
            transition: "width 0.05s linear",
          }}
        />
      </div>
      <div>{t("hud.speed")}: {(v * 100).toFixed(1)}% c</div>
      <div>{t("hud.gamma")}: {g.toFixed(3)}</div>
      <div>{t("hud.properTime")}: {player.phaseSpace.pos.t.toFixed(2)}s</div>
      <div>
        {t("hud.position")}: ({player.phaseSpace.pos.x.toFixed(2)},{" "}
        {player.phaseSpace.pos.y.toFixed(2)})
      </div>
    </div>
  );
};
