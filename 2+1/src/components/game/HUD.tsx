import { useEffect, useMemo, useRef, useState } from "react";
import { gamma, lengthVector3 } from "../../physics";
import { colorForPlayerId } from "./colors";
import { RESPAWN_DELAY } from "./constants";
import type { DeathEvent, RelativisticPlayer } from "./types";

declare const __BUILD_TIME__: string;

const isTouchDevice =
  "ontouchstart" in window || navigator.maxTouchPoints > 0;

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
        transition: "background-color 0.2s",
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

type HUDProps = {
  players: Map<string, RelativisticPlayer>;
  myId: string | null;
  scores: Record<string, number>;
  fps: number;
  showInRestFrame: boolean;
  setShowInRestFrame: (v: boolean) => void;
  useOrthographic: boolean;
  setUseOrthographic: (v: boolean) => void;
  energy: number;
  lastFireTime: number;
  deathFlash: boolean;
  killGlow: boolean;
  killNotification: { victimName: string; color: string } | null;
  myDeathEvent?: DeathEvent | null;
  ghostTau?: number;
};

const FIRE_FLASH_DURATION = 80; // ms per flash pulse

const FireFlash = ({ lastFireTime }: { lastFireTime: number }) => {
  const [opacity, setOpacity] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const animate = () => {
      const elapsed = Date.now() - lastFireTime;
      if (elapsed < FIRE_FLASH_DURATION) {
        setOpacity(0.5 * (1 - elapsed / FIRE_FLASH_DURATION));
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setOpacity(0);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [lastFireTime]);

  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 198,
        pointerEvents: "none",
        boxShadow: `inset 0 0 60px rgba(255, 160, 60, ${opacity}), inset 0 0 25px rgba(255, 160, 60, ${opacity * 0.7})`,
      }}
    />
  );
};

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

export const HUD = ({
  players,
  myId,
  scores,
  fps,
  showInRestFrame,
  setShowInRestFrame,
  useOrthographic,
  setUseOrthographic,
  energy,
  lastFireTime,
  deathFlash,
  killGlow,
  killNotification,
  myDeathEvent,
}: HUDProps) => {
  const sortedScores = useMemo(
    () => Object.entries(scores).sort(([, a], [, b]) => b - a),
    [scores],
  );
  return (
    <>
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
        <div>相対論的アリーナ (2+1次元 時空図)</div>
        {isTouchDevice ? (
          <>
            <div>スワイプ ←→: 方向転換</div>
            <div>スワイプ ↑: 前進 ↓: 後退</div>
            <div>ダブルタップ: レーザー発射</div>
          </>
        ) : (
          <>
            <div>W/S: 前進/後退</div>
            <div>←/→: カメラ水平回転</div>
            <div>↑/↓: カメラ上下回転</div>
            <div>Space: レーザー発射</div>
          </>
        )}
        <ToggleSwitch
          checked={showInRestFrame}
          onChange={setShowInRestFrame}
          labelLeft="静止系"
          labelRight="世界系"
        />
        <ToggleSwitch
          checked={useOrthographic}
          onChange={setUseOrthographic}
          labelLeft="正射影"
          labelRight="透視投影"
        />
        <div
          style={{ marginTop: "5px", color: fps < 30 ? "#ff6666" : "#66ff66" }}
        >
          FPS: {fps}
        </div>
        <div style={{ marginTop: "2px", fontSize: "13px", opacity: 0.6 }}>
          build: {__BUILD_TIME__}
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
                  color: players.get(id)?.color ?? colorForPlayerId(id),
                }}
              >
                {id === myId ? "You" : id.slice(0, 6)}: {kills}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 速度計 */}
      {(() => {
        const myPlayer = myId ? players.get(myId) : undefined;
        if (!myPlayer) return null;
        const v = lengthVector3(myPlayer.phaseSpace.u);
        const g = gamma(myPlayer.phaseSpace.u);

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
                      : "rgba(255, 160, 60, 0.8)",
                  borderRadius: "4px",
                  transition: "width 0.05s linear",
                }}
              />
            </div>
            <div>速度: {(v * 100).toFixed(1)}% c</div>
            <div>ガンマ因子: {g.toFixed(3)}</div>
            <div>固有時間: {myPlayer.phaseSpace.pos.t.toFixed(2)}s</div>
            <div>
              位置: ({myPlayer.phaseSpace.pos.x.toFixed(2)},{" "}
              {myPlayer.phaseSpace.pos.y.toFixed(2)})
            </div>
          </div>
        );
      })()}

      {/* 死亡カウントダウン */}
      {(() => {
        const myPlayer = myId ? players.get(myId) : undefined;
        if (!myPlayer?.isDead) return null;
        return <RespawnCountdown key={`respawn-${myDeathEvent?.pos.t ?? 0}`} />;
      })()}

      {/* ゴーストオーバーレイ */}
      {(() => {
        const myPlayer = myId ? players.get(myId) : undefined;
        if (!myPlayer?.isDead) return null;
        return (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(100, 130, 180, 0.15)",
              zIndex: 90,
              pointerEvents: "none",
            }}
          />
        );
      })()}

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

      {/* 射撃フラッシュ（発射に同期した点滅） */}
      {lastFireTime > 0 && (
        <FireFlash lastFireTime={lastFireTime} />
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
