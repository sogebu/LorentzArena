import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import { useGameStore } from "../../../stores/game-store";
import { LASER_PAST_CONE_MARKER_COLOR, RESPAWN_DELAY } from "../constants";
import { isLighthouse } from "../lighthouse";
import type { DeathEvent } from "../types";
import { hslToComponents } from "./utils";

// 「射撃中」text は past-cone marker と同じ silver で統一 (odakin 指定)。hslToComponents は
// "hue, sat%, light%" 成分形式を返し、textShadow の hsla() 式に挿入して使う。
const FIRING_TEXT_HSL = hslToComponents(LASER_PAST_CONE_MARKER_COLOR);

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

/**
 * 因果律凍結 overlay。 自機が他機の未来光円錐内に居る間、 画面中央に「因果律凍結」 と
 * サブテキスト「他機の未来光円錐内」 を半透明 overlay で表示。 freeze 中ずっと出続け
 * (= 状態通知)、 freeze off で即消える。 thrust が効かない理由を即座に示すための情報。
 *
 * z-index 220: HitFlash (201) より上、 RespawnCountdown (250) より下、 KillNotification
 * (300) より下 (= kill / respawn の決定的 event は上に重ねる)。
 */
const CausalFreezeOverlay = () => {
  const { t } = useI18n();
  const frozen = useGameStore((s) => s.causallyFrozen);
  if (!frozen) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 220,
        pointerEvents: "none",
        textAlign: "center",
        fontFamily: "monospace",
        padding: "16px 28px",
        backgroundColor: "rgba(20, 30, 60, 0.55)",
        border: "1px solid rgba(150, 180, 255, 0.5)",
        borderRadius: "6px",
      }}
    >
      <div
        style={{
          fontSize: "28px",
          fontWeight: "bold",
          color: "#aac8ff",
          textShadow: "0 0 12px rgba(120, 160, 255, 0.7)",
        }}
      >
        {t("hud.causalFreeze.title")}
      </div>
      <div
        style={{
          fontSize: "14px",
          color: "rgba(200, 215, 245, 0.85)",
          marginTop: "6px",
        }}
      >
        {t("hud.causalFreeze.sub")}
      </div>
    </div>
  );
};

/**
 * 因果律跳躍 overlay。 自機が Rule B fire 中 (= 自機が peer の過去光円錐内 → forward
 * jump 中、 `causalityJumping = true`) ずっと表示する continuous state 通知。
 *
 * 凍結 `CausalFreezeOverlay` と完全対称 (= 2026-05-04 user 指示):
 *   凍結 = 「他機の未来光円錐内」 で thrust が効かない理由を出し続ける
 *   跳躍 = 「他機の過去光円錐内 → 過去光円錐外へ」 forward jump 中ずっと出続ける
 * 旧設計 (= counter + 1.2s flash + isLargeJump 閾値) は instantaneous event 通知だったが、
 * 凍結 (continuous) と非対称で「凍結中に跳躍が起こらないように見える」 user 観察の
 * 原因になった。 boolean state subscribe に変更して完全対称化。
 *
 * z-index 221: 凍結 (220) の直上、 RespawnCountdown (250) より下、 KillNotification (300)
 * より下。 palette は凍結と同じ dark blue で視覚一貫性。 animation 不要 (= continuous)。
 */
const CausalityJumpOverlay = () => {
  const { t } = useI18n();
  const jumping = useGameStore((s) => s.causalityJumping);
  if (!jumping) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 221,
        pointerEvents: "none",
        textAlign: "center",
        fontFamily: "monospace",
        padding: "16px 28px",
        backgroundColor: "rgba(20, 30, 60, 0.55)",
        border: "1px solid rgba(150, 180, 255, 0.5)",
        borderRadius: "6px",
        whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          fontSize: "28px",
          fontWeight: "bold",
          color: "#aac8ff",
          textShadow: "0 0 12px rgba(120, 160, 255, 0.7)",
        }}
      >
        {t("hud.causalityJump.title")}
      </div>
      <div
        style={{
          fontSize: "14px",
          color: "rgba(200, 215, 245, 0.85)",
          marginTop: "6px",
        }}
      >
        {t("hud.causalityJump.sub")}
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
  killNotification,
  myDeathEvent,
}: OverlaysProps) => {
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

      {/* 因果律凍結 overlay (= 自機が他機の未来光円錐内に居て freeze 中の状態通知) */}
      <CausalFreezeOverlay />

      {/* 因果律跳躍 overlay (= Rule B 大ジャンプ発火時の brief flash 通知) */}
      <CausalityJumpOverlay />

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
              boxShadow: `inset 0 0 60px hsla(${FIRING_TEXT_HSL}, 0.5), inset 0 0 25px hsla(${FIRING_TEXT_HSL}, 0.35)`,
              animation: "firing-blink 100ms step-end infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "42%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 199,
              pointerEvents: "none",
              fontSize: "24px",
              fontWeight: "bold",
              fontFamily: "monospace",
              color: LASER_PAST_CONE_MARKER_COLOR,
              textShadow: `0 0 15px hsla(${FIRING_TEXT_HSL}, 0.8), 0 0 30px hsla(${FIRING_TEXT_HSL}, 0.4)`,
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
