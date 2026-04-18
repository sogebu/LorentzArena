import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { useGameStore } from "../../../stores/game-store";
import { RESPAWN_DELAY } from "../constants";
import { isLighthouse } from "../lighthouse";
import type { DeathEvent } from "../types";
import { hslToComponents } from "./utils";

const RespawnCountdown = () => {
  const { t } = useI18n();
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
        {t("hud.dead")}
      </div>
      <div style={{ fontSize: "24px", color: "white", marginTop: "8px" }}>
        {remaining}
      </div>
    </div>
  );
};

type OverlaysProps = {
  myId: string | null;
  isDead: boolean;
  deathFlash: boolean;
  killGlow: boolean;
  isFiring: boolean;
  myLaserColor: string;
  killNotification: { victimId: string; victimName: string; color: string } | null;
  myDeathEvent?: DeathEvent | null;
};

/**
 * Phase C1: 自機が被弾したとき 1 回だけオレンジのフラッシュを出す。
 * hitLog の自機 victim 件数を subscribe し、増加時に 300ms だけ表示。
 * 増加検知は stale-closure を避けるため useRef で。
 */
const HitFlash = ({ myId }: { myId: string | null }) => {
  const hitLog = useGameStore((s) => s.hitLog);
  const [flash, setFlash] = useState(false);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!myId) return;
    let count = 0;
    for (const e of hitLog) {
      if (e.victimId === myId && e.damage > 0) count++;
    }
    if (count > prevCountRef.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 300);
      prevCountRef.current = count;
      return () => clearTimeout(t);
    }
    prevCountRef.current = count;
  }, [hitLog, myId]);

  if (!flash) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 201,
        pointerEvents: "none",
        boxShadow:
          "inset 0 0 100px rgba(255,140,0,0.55), inset 0 0 40px rgba(255,180,40,0.4)",
        animation: "hit-flash-fade 0.3s ease-out forwards",
      }}
    />
  );
};

export const Overlays = ({
  myId,
  isDead,
  deathFlash,
  killGlow,
  isFiring,
  myLaserColor,
  killNotification,
  myDeathEvent,
}: OverlaysProps) => {
  const laserHsl = hslToComponents(myLaserColor);
  const { t } = useI18n();
  const displayVictimName = killNotification
    ? isLighthouse(killNotification.victimId)
      ? t("hud.lighthouse")
      : killNotification.victimName
    : null;

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

      {/* 被弾フラッシュ (Phase C1) */}
      <HitFlash myId={myId} />

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
            {t("hud.firing")}
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
            {t("hud.kill")}
          </div>
          <div
            style={{
              fontSize: "20px",
              color: killNotification.color,
              opacity: 0.9,
            }}
          >
            {displayVictimName}
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
        @keyframes energy-empty-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes hit-flash-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
};
