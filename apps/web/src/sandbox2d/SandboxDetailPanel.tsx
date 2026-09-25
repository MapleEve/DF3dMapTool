/**
 * 2D 沙盘点位详情面板（应用无路由，选中态即详情；URL 深链不做，记录为形态差异）。
 *
 * 面板结构按上游渲染 DOM 实测锚定：
 * - 头部：42px 图标盒（bgColor 底/白边/内边距）+ 标题 h1 = name||title（语言解析链）
 * - 关闭钮（上游为返回地图外链）
 * - Last updated :YYYY-MM-DD（updated_at 的日期部分）
 * - 分隔线 + 描述 + 用户截图（16:9 object-cover）
 * - 应用新增整合： "3D 中定位"（linkAffine 区域级近似定位 + UI 标注"近似位置"）
 * - 上游另有复制链接钮——应用无路由深链，形态差异不实现。
 */

import { useTranslation } from "react-i18next";
import type { Sandbox2dData, SandboxPoint } from "./types";
import { pointAxesToRegionAxes } from "./project";
import { resolveSandboxPointLabel } from "@/i18n/sandboxNames";
import { useUiStore } from "@/state/uiStore";

export interface SandboxDetailPanelProps {
  data: Sandbox2dData;
  point: SandboxPoint;
  /** 点位媒体 object URL（物品图）。 */
  mediaUrl: string | undefined;
  /** 用户截图 object URL。 */
  shotUrl: string | undefined;
  onClose: () => void;
  /** 3D 定位动作（世界坐标，区域级近似）。 */
  onLocate3d: (world: { x: number; y: number; z: number }) => void;
}

export function SandboxDetailPanel(props: SandboxDetailPanelProps) {
  const { data, point, mediaUrl, shotUrl, onClose, onLocate3d } = props;
  const { t } = useTranslation();
  const language = useUiStore((s) => s.language);
  const title = resolveSandboxPointLabel(point, language) ?? `#${point.id}`;
  const description = point.descEn ?? null;
  const hasLinkAffine = data.meta.linkAffine !== null && data.meta.linkAffine !== undefined;

  const handleLocate3d = () => {
    const affine = data.meta.linkAffine.siteToWorld;
    const regionAxes = pointAxesToRegionAxes(point.x, point.y);
    const worldX = affine.M[0][0] * regionAxes.x + affine.M[0][1] * regionAxes.y + affine.t[0];
    const worldZ = affine.M[1][0] * regionAxes.x + affine.M[1][1] * regionAxes.y + affine.t[1];
    onLocate3d({ x: worldX, y: 0, z: worldZ });
  };

  return (
    <div className="sandbox2d-detail">
      <div className="sandbox2d-detail-header">
        <span
          className="sandbox2d-detail-icon"
          style={point.bgColor !== null ? { backgroundColor: point.bgColor } : undefined}
        >
          {mediaUrl !== undefined ? <img src={mediaUrl} alt={title} /> : null}
        </span>
        <h1>{title}</h1>
        <button
          type="button"
          className="sandbox2d-detail-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          ✕
        </button>
      </div>
      {point.updatedAt !== null ? (
        <p className="sandbox2d-detail-updated">
          {t("sandbox2d.lastUpdated")} :{point.updatedAt}
        </p>
      ) : null}
      <div className="sandbox2d-detail-divider" />
      {description !== null ? <p className="sandbox2d-detail-desc">{description}</p> : null}
      {shotUrl !== undefined ? (
        <div className="sandbox2d-detail-shot">
          <img src={shotUrl} alt={title} />
        </div>
      ) : null}
      {hasLinkAffine ? (
        <div className="sandbox2d-detail-locate">
          <button type="button" onClick={handleLocate3d}>
            {t("sandbox2d.regionLocate3d")}
          </button>
          <span className="sandbox2d-detail-locate-note">{t("sandbox2d.approximate")}</span>
        </div>
      ) : null}
    </div>
  );
}
