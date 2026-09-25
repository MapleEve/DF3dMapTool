import { useTranslation } from "react-i18next";
import { useRouteStore } from "@/state/routeStore";
import { useInteractStore, type InteractTarget } from "@/state/interactStore";
import type { RouteMarker } from "@/data/routes";

/**
 * 路线 HUD（左中提示列）+ F 键交互提示（上游实测口径）。
 *
 * - Q 键提示「显示线路面板」12px 白 + 键位图标；
 * - 跟跑中「长按结束导航」12px 白；
 * - 跟跑标注提示：途经标注点名称/描述（marker 按 pointIndex 挂载）；
 * - F 键近旁提示：「使用」32px 白@0.698 + 物件类型名（梯子/绳索/滑索/物资点名 25px@0.698）。
 * 内容组件（RouteHudContent）为受控形态，SSR 冒烟与实装共用。
 */
export function RouteHud() {
  const panelOpen = useRouteStore((state) => state.panelOpen);
  const followRouteId = useRouteStore((state) => state.followRouteId);
  const activeMarker = useRouteStore((state) => state.activeMarker);
  const nearby = useInteractStore((state) => state.nearby);
  return (
    <RouteHudContent
      panelOpen={panelOpen}
      followActive={followRouteId !== null}
      activeMarker={activeMarker}
      nearby={nearby}
    />
  );
}

export function RouteHudContent({
  panelOpen,
  followActive,
  activeMarker,
  nearby,
}: {
  panelOpen: boolean;
  followActive: boolean;
  activeMarker: RouteMarker | null;
  nearby: InteractTarget | null;
}) {
  const { t } = useTranslation();
  const label =
    nearby === null
      ? null
      : nearby.kind === "poi"
        ? (nearby.poiName ?? null)
        : nearby.kind === "ladder"
          ? t("interact.ladder")
          : nearby.kind === "rope"
            ? t("interact.rope")
            : t("interact.zipline");

  return (
    <div className="route-hud">
      {!panelOpen && !followActive ? (
        <div className="route-hud-tip">
          <span className="route-hud-key">Q</span>
          <span className="route-hud-tip-text">{t("route.showPanel")}</span>
        </div>
      ) : null}
      {followActive ? (
        <div className="route-hud-tip">
          <span className="route-hud-tip-text route-hud-nav">{t("route.holdToEnd")}</span>
        </div>
      ) : null}
      {activeMarker !== null ? (
        <div className="route-hud-marker">
          <span className="route-hud-marker-name">{activeMarker.name}</span>
          {activeMarker.desc !== "" ? (
            <span className="route-hud-marker-desc">{activeMarker.desc}</span>
          ) : null}
        </div>
      ) : null}
      {nearby !== null && label !== null ? (
        <div className="interact-tip" role="status">
          <span className="interact-tip-type">{label}</span>
          <span className="interact-tip-use">
            <span className="interact-tip-key">F</span>
            {t("interact.use")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
