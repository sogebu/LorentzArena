import { useEffect, useState } from "react";
import { RESPAWN_DELAY } from "../constants";
import type { DeathEvent } from "../types";
import { hslToComponents } from "./utils";

const RespawnCountdown = () => {
  const [remaining, setRemaining] = useState(RESPAWN_DELAY / 1000);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, (RESPAWN_DELAY - elapsed) / 1000);
      setRemaining(Math.ceil(left));
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 250,
        pointerEvents: "none",
        textAlign: "center",
        fontFamily: "monospace",
      }}
    >
      <div style={{ fontSize: "36px", fontWeight: "bold", color: "#ff4444" }}>
        DEAD
      </div>
      <div style={{ fontSize: "24px", color: "white", marginTop: "8px" }}>
        {remaining}
      </div>
    </div>
  );
};

type OverlaysProps = {
  isDead: boolean;
  deathFlash: boolean;
  killGlow: boolean;
  isFiring: boolean;
  myLaserColor: string;
  killNotification: { victimName: string; color: string } | null;
  myDeathEvent?: DeathEvent | null;
};

export const Overlays = ({
  isDead,
  deathFlash,
  killGlow,
  isFiring,
  myLaserColor,
  killNotification,
  myDeathEvent,
}: OverlaysProps) => {
  const laserHsl = hslToComponents(myLaserColor);

  return (
    <>
      {/* 死亡カウントダウン */}
      {isDead && (
        <RespawnCountdown key={`respawn-${myDeathEvent?.pos.t ?? 0}`} />
      )}

      {/* ゴーストオーバーレイ */}
      {isDead && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(100, 130, 180, 0.15)",
            zIndex: 90,
            pointerEvents: "none",
          }}
        />
      )}

      {/* 死亡フラッシュ */}
      {deathFlash && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(255, 50, 50, 0.6)",
            zIndex: 200,
            pointerEvents: "none",
            animation: "flash-fade 0.6s ease-out forwards",
          }}
        />
      )}

      {/* 金色ボーダーグロー（キル時） */}
      {killGlow && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 199,
            pointerEvents: "none",
            boxShadow:
              "inset 0 0 80px rgba(255,215,0,0.5), inset 0 0 30px rgba(255,215,0,0.3)",
            animation: "kill-glow 1.5s ease-out forwards",
          }}
        />
      )}

      {/* 射撃中グロー + FIRING テキスト（10Hz 点滅） */}
      {isFiring && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 198,
              pointerEvents: "none",
              boxShadow: `inset 0 0 60px hsla(${laserHsl}, 0.5), inset 0 0 25px hsla(${laserHsl}, 0.35)`,
              animation: "firing-blink 100ms step-end infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "46%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 199,
              pointerEvents: "none",
              fontSize: "24px",
              fontWeight: "bold",
              fontFamily: "monospace",
              color: myLaserColor,
              textShadow: `0 0 15px hsla(${laserHsl}, 0.8), 0 0 30px hsla(${laserHsl}, 0.4)`,
              animation: "firing-blink 100ms step-end infinite",
            }}
          >
            FIRING
          </div>
        </>
      )}

      {/* KILL テキスト（キラーの過去光円錐が hitPos に到達した瞬間に発火）*/}
      {killNotification && (
        <div
          key={`kill-${killNotification.victimName}-${killNotification.color}`}
          style={{
            position: "absolute",
            top: "30%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 300,
            pointerEvents: "none",
            textAlign: "center",
            animation: "kill-notify 1.5s ease-out forwards",
          }}
        >
          <div
            style={{
              fontSize: "48px",
              fontWeight: "bold",
              fontFamily: "monospace",
              color: killNotification.color,
              textShadow:
                "0 0 20px rgba(255,215,0,0.8), 0 0 40px rgba(255,215,0,0.4)",
            }}
          >
            KILL
          </div>
          <div
            style={{
              fontSize: "20px",
              color: killNotification.color,
              opacity: 0.9,
            }}
          >
            {killNotification.victimName}
          </div>
        </div>
      )}

      <style>{`
        @keyframes firing-blink {
          0% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes flash-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes kill-notify {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
          30% { transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -60%) scale(1); }
        }
        @keyframes kill-glow {
          0% { opacity: 0; }
          15% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
};
