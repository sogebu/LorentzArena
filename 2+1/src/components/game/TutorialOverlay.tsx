import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { isTouchDevice } from "./hud/utils";

/**
 * Mobile-only 初回チュートリアル。START 直後に 4 秒間の半透明 overlay で主要操作を表示し、
 * タップか自動タイムアウトで閉じる。`la-tutorial-shown = "1"` を localStorage に保存して
 * 同ブラウザでは再表示しない (言語切替や version bump での再発要件が出たら key を進める)。
 *
 * mount 時判定なので、START → Lobby 戻る → 再 START でも表示されない (flag は常駐)。
 * PC / touch 非対応端末では一切描画しない。
 */

const STORAGE_KEY = "la-tutorial-shown";
const DURATION_MS = 4000;

const shouldShowInitially = (): boolean => {
  if (typeof window === "undefined") return false;
  if (!isTouchDevice) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
};

const markShown = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable; overlay will simply re-show on the next launch
  }
};

export const TutorialOverlay = () => {
  const { t } = useI18n();
  const [visible, setVisible] = useState<boolean>(shouldShowInitially);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setVisible(false);
      markShown();
    }, DURATION_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    markShown();
  };

  return (
    <button
      type="button"
      onClick={dismiss}
      aria-label={t("tutorial.dismissHint")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 24,
        background: "rgba(0, 0, 0, 0.72)",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        textAlign: "center",
        fontSize: 16,
        // reset <button> defaults for a screen-filling overlay
        font: "inherit",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>
        {t("tutorial.title")}
      </div>
      <div>{t("tutorial.swipeHorizontal")}</div>
      <div>{t("tutorial.swipeVertical")}</div>
      <div style={{ fontWeight: 600 }}>{t("tutorial.fire")}</div>
      <div style={{ fontSize: 13, opacity: 0.55, marginTop: 14 }}>
        {t("tutorial.dismissHint")}
      </div>
    </button>
  );
};
