/**
 * 右键坐标弹窗（上游坐标弹窗还原）。
 *
 * - 标题 "Coordinates"；数值 "x;y"（x=水平、y=自下而上，Math.round 整数——逆变换逐字实证）
 * - 复制按钮：clipboard 优先 + execCommand 兜底；成功显示勾选 2 秒（实测口径）
 * - 关闭钮；左键地图/弹窗外交互由画布点击处理关闭
 * - 位置：右键点（视口内绝对定位；Leaflet popup 锚定语义）
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fullResToPopup } from "./project";

export interface SandboxCoordinatePopupProps {
  /** 右键点（全分辨率坐标）。 */
  sx: number;
  sy: number;
  /** 弹窗锚点（画布容器内 CSS px）。 */
  screenX: number;
  screenY: number;
  onClose: () => void;
}

export function SandboxCoordinatePopup(props: SandboxCoordinatePopupProps) {
  const { sx, sy, screenX, screenY, onClose } = props;
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const popup = fullResToPopup({ sx, sy });
  const value = `${popup.x};${popup.y}`;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      return;
    } catch {
      // 落入兜底
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      setCopied(true);
    } catch {
      // 复制失败保持原状
    }
  };

  return (
    <div className="sandbox2d-coord-popup" style={{ left: screenX, top: screenY }} role="dialog">
      <div className="sandbox2d-coord-popup-title">{t("sandbox2d.coordinates")}</div>
      <div className="sandbox2d-coord-popup-value-wrapper">
        <span className="sandbox2d-coord-popup-value">{value}</span>
        <button
          type="button"
          className="sandbox2d-coord-popup-copy"
          onClick={() => void handleCopy()}
          aria-label={t("sandbox2d.copy")}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <button
        type="button"
        className="sandbox2d-coord-popup-close"
        onClick={onClose}
        aria-label={t("common.close")}
      >
        ✕
      </button>
    </div>
  );
}
