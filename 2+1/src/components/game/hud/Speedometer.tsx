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
      {/* 枯渇時 (energy < ε): バー拡大 (width 120 → 220, height 8 → 18) + 赤枠 + 点滅 +
          「燃料枯渇」大文字ラベル。低エネルギー (< 0.2): バー赤化。
          Ghost (死亡中) は燃料制約なしで常時フル加速できるためバー非表示。 */}
      {!player.isDead && (
        <div
          style={{
            position: "relative",
            width: energy < 0.001 ? "220px" : "120px",
            height: energy < 0.001 ? "52px" : "12px",
            marginBottom: "8px",
            marginLeft: "auto",
            transition: "width 0.2s ease, height 0.2s ease",
          }}
        >
          {energy < 0.001 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                fontSize: "22px",
                fontWeight: "bold",
                color: "rgba(255, 80, 80, 1)",
                letterSpacing: "3px",
                animation: "energy-empty-pulse 0.7s ease-in-out infinite",
                pointerEvents: "none",
                textShadow: "0 0 8px rgba(255, 80, 80, 0.8)",
                lineHeight: 1,
              }}
            >
              {t("hud.fuelEmpty")}
            </div>
          )}
          <div
            style={{
              width: "100%",
              height: energy < 0.001 ? "18px" : "8px",
              backgroundColor: "rgba(255, 255, 255, 0.15)",
              borderRadius: "4px",
              overflow: "hidden",
              position: "absolute",
              bottom: energy < 0.001 ? "0" : "auto",
              top: energy < 0.001 ? "auto" : "2px",
              left: 0,
              outline:
                energy < 0.001 ? "2px solid rgba(255, 80, 80, 0.9)" : "none",
              animation:
                energy < 0.001 ? "energy-empty-pulse 0.7s ease-in-out infinite" : "none",
              transition: "height 0.2s ease",
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
        </div>
      )}
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
