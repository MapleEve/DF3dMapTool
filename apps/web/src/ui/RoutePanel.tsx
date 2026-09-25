import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePoiStore } from "@/state/poiStore";
import {
  customRouteFromExport,
  customRouteToExport,
  useRouteStore,
  type RuntimeRoute,
  type StoredCustomRoute,
} from "@/state/routeStore";
import type { Vec3 } from "@/common/geometry";

/**
 * 路线面板（Q）：热门推荐线路列表 / 路线详情 / 自录入口。
 *
 * 结构口径上游实测锚定：
 * - 面板 440x500，锚点左下 (40,40)；
 * - 列表 400x436（顶部 64px 起），标题 20px；行距 67px：
 *   路线名 + 「9374m 00:59」+ 标记数「03」+ 开始导航按钮（16px 绿字）；
 * - 详情 440x500：「返回路线列表」20px + 标注点列表
 *   （「标注点」20px + 传送按钮）+ 开始/结束导航 344x44（16px：开始绿字/结束黑字）；
 * - 空态「鼠鼠努力更新中，敬请期待！」20px。
 * 内容组件（RouteListView/RouteDetailView）为受控形态，SSR 冒烟与实装共用。
 */

/** 距离显示（整数米）。 */
function formatDistance(meters: number): string {
  return `${Math.round(meters)}m`;
}

/** 时长显示 mm:ss。 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** 标记数显示（两位补零）。 */
function formatMarkerCount(count: number): string {
  return String(Math.min(99, Math.max(0, count))).padStart(2, "0");
}

/** 路线显示名：跟随语言（en 用数据内英文名；ja/ko 无源数据回退 zh 明文）。 */
function routeDisplayName(route: RuntimeRoute, language: string): string {
  if (language === "en" && route.nameEn !== null) {
    return route.nameEn;
  }
  return route.name;
}

export function RoutePanel() {
  const panelOpen = useRouteStore((state) => state.panelOpen);
  if (!panelOpen) {
    return null;
  }
  return <RoutePanelBody />;
}

function RoutePanelBody() {
  const { t, i18n } = useTranslation();
  const mode = useRouteStore((state) => state.mode);
  const status = useRouteStore((state) => state.status);
  const builtin = useRouteStore((state) => state.builtin);
  const custom = useRouteStore((state) => state.custom);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const followRouteId = useRouteStore((state) => state.followRouteId);
  const setPanelOpen = useRouteStore((state) => state.setPanelOpen);
  const routes = useMemo(() => [...custom, ...builtin], [custom, builtin]);
  const selectedRoute = useSelectedRoute(selectedRouteId);
  const language = i18n.language;

  return (
    <section className="route-panel" role="dialog" aria-label={t("route.title")}>
      <button
        type="button"
        className="route-panel-close"
        aria-label={t("common.close")}
        onClick={() => setPanelOpen(false)}
      >
        ×
      </button>
      {mode === "list" ? (
        <RouteListView routes={routes} status={status} language={language} />
      ) : (
        <RouteDetailView
          language={language}
          route={selectedRoute}
          following={selectedRoute !== null && followRouteId === selectedRoute.id}
        />
      )}
    </section>
  );
}

/** 列表视图：标题 + 路线行（名称/距离/时长/标记数/开始导航）+ 自录入口。 */
export function RouteListView({
  routes,
  status,
  language,
}: {
  routes: readonly RuntimeRoute[];
  status: string;
  language: string;
}) {
  const { t } = useTranslation();
  const showDetail = useRouteStore((state) => state.showDetail);
  const requestFollow = useRouteStore((state) => state.requestFollow);
  const setPanelOpen = useRouteStore((state) => state.setPanelOpen);
  const startRecord = useRouteStore((state) => state.startRecord);
  const deleteCustomRoute = useRouteStore((state) => state.deleteCustomRoute);
  const importCustomRoute = useRouteStore((state) => state.importCustomRoute);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState(false);

  const handleStartNav = (route: RuntimeRoute) => {
    requestFollow(route.id);
    setPanelOpen(false);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const route = customRouteFromExport(text);
      importCustomRoute(route);
      setImportError(false);
    } catch {
      setImportError(true);
    }
  };

  return (
    <div className="route-panel-inner">
      <h3 className="route-panel-title">{t("route.title")}</h3>
      <div className="route-list" role="list">
        {status === "loading" ? null : routes.length === 0 ? (
          <div className="route-empty">
            <span>{t("route.emptyTip")}</span>
          </div>
        ) : (
          routes.map((route) => (
            <div key={route.id} className="route-item" role="listitem">
              <button
                type="button"
                className="route-item-name"
                title={routeDisplayName(route, language)}
                onClick={() => showDetail(route.id)}
              >
                <span className="route-item-title">{routeDisplayName(route, language)}</span>
                <span className="route-item-stats">
                  {formatDistance(route.lengthMeters)} {formatDuration(route.durationSeconds)}{" "}
                  {formatMarkerCount(route.markers.length)}
                </span>
              </button>
              {route.custom ? (
                <span className="route-item-tools">
                  <button
                    type="button"
                    className="route-tool"
                    onClick={() => downloadRouteExport(route)}
                  >
                    {t("route.exportRoute")}
                  </button>
                  <button
                    type="button"
                    className="route-tool"
                    onClick={() => deleteCustomRoute(route.id)}
                  >
                    {t("route.deleteRoute")}
                  </button>
                </span>
              ) : null}
              <button
                type="button"
                className="route-item-nav"
                onClick={() => handleStartNav(route)}
              >
                {t("route.startNav")}
              </button>
            </div>
          ))
        )}
      </div>
      <div className="route-panel-footer">
        <button type="button" className="route-footer-button" onClick={startRecord}>
          {t("route.recordMode")}
        </button>
        <button
          type="button"
          className="route-footer-button"
          onClick={() => fileInputRef.current?.click()}
        >
          {t("route.importRoute")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="route-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              void handleImportFile(file);
            }
            event.target.value = "";
          }}
        />
        {importError ? <span className="route-import-error">{t("route.importFailed")}</span> : null}
      </div>
    </div>
  );
}

/** 详情视图：返回 + 标注点列表（传送）+ 开始/结束导航（受控形态）。 */
export function RouteDetailView({
  language,
  route,
  following,
}: {
  language: string;
  route: RuntimeRoute | null;
  following: boolean;
}) {
  const { t } = useTranslation();
  const backToList = useRouteStore((state) => state.backToList);
  const requestFollow = useRouteStore((state) => state.requestFollow);
  const stopFollow = useRouteStore((state) => state.stopFollow);
  const setPanelOpen = useRouteStore((state) => state.setPanelOpen);
  const requestFlyTo = usePoiStore((state) => state.requestFlyTo);

  // 详情呈现的 3D 主线由 MapViewport 订阅 detailRoute 驱动（store 持有）。
  useEffect(() => {
    useRouteStore.setState({ detailRoute: route });
    return () => {
      useRouteStore.setState({ detailRoute: null });
    };
  }, [route]);

  if (route === null) {
    return (
      <div className="route-panel-inner">
        <div className="route-empty">
          <span>{t("route.emptyTip")}</span>
        </div>
      </div>
    );
  }

  const handleNavToggle = () => {
    if (following) {
      stopFollow();
    } else {
      requestFollow(route.id);
      setPanelOpen(false);
    }
  };

  return (
    <div className="route-panel-inner">
      <button type="button" className="route-back" onClick={backToList}>
        <span className="route-back-icon" aria-hidden="true">
          ‹
        </span>
        {t("route.backToList")}
      </button>
      <div className="route-detail-name" title={routeDisplayName(route, language)}>
        {routeDisplayName(route, language)}
      </div>
      <div className="route-detail-stats">
        {formatDistance(route.lengthMeters)} · {formatDuration(route.durationSeconds)} ·{" "}
        {t("route.marker")}
        {formatMarkerCount(route.markers.length)}
      </div>
      <div className="route-marker-list" role="list">
        {route.markers.length === 0 ? (
          <div className="route-marker-empty">{t("route.noMarkerInfo")}</div>
        ) : (
          route.markers.map((marker, index) => (
            <div
              key={`${marker.pointIndex}-${index}`}
              className="route-marker-item"
              role="listitem"
            >
              <span className="route-marker-name" title={marker.name}>
                {marker.name}
              </span>
              <button
                type="button"
                className="route-marker-teleport"
                onClick={() => requestFlyTo(marker.worldPos)}
              >
                {t("route.teleport")}
              </button>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        className={following ? "route-nav-button end" : "route-nav-button"}
        onClick={handleNavToggle}
      >
        {following ? t("route.endNav") : t("route.startNav")}
      </button>
    </div>
  );
}

/** 导出（仅自录路线）：下载 df3d-route-user/1 JSON。 */
function downloadRouteExport(route: RuntimeRoute): void {
  // 导出仅对自录路线开放（热门路线随数据包分发）。
  if (!route.custom) {
    return;
  }
  const draft = customRouteFromRuntime(route);
  const blob = new Blob([customRouteToExport(draft)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${draft.name || draft.id}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** RuntimeRoute（自录）→ 存储形态（导出用）。 */
function customRouteFromRuntime(route: RuntimeRoute): StoredCustomRoute {
  const points: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < route.pointCount; i += 1) {
    const base = i * 3;
    points.push({
      x: route.points[base] ?? 0,
      y: route.points[base + 1] ?? 0,
      z: route.points[base + 2] ?? 0,
    });
  }
  return {
    id: route.id,
    name: route.name,
    description: route.description ?? "",
    durationSeconds: route.durationSeconds,
    lengthMeters: route.lengthMeters,
    recordedAt: new Date().toISOString(),
    points,
    markers: route.markers.map((marker) => ({ name: marker.name, worldPos: marker.worldPos })),
  };
}

/** 详情路由解析（RoutePanelBody 内的 store → 受控 props 桥）。 */
export function useSelectedRoute(selectedRouteId: string | null) {
  const builtin = useRouteStore((state) => state.builtin);
  const custom = useRouteStore((state) => state.custom);
  return useMemo(() => {
    const all = [...custom, ...builtin];
    return all.find((entry) => entry.id === selectedRouteId) ?? null;
  }, [custom, builtin, selectedRouteId]);
}

/** 点位序列展开（视口/详情共用）。 */
export function routePointsOf(route: RuntimeRoute): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < route.pointCount; i += 1) {
    const base = i * 3;
    points.push({
      x: route.points[base] ?? 0,
      y: route.points[base + 1] ?? 0,
      z: route.points[base + 2] ?? 0,
    });
  }
  return points;
}
