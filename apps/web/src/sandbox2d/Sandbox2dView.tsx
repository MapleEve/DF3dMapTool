/**
 * 全页 2D 沙盘视图（设计 §1.1 布局；替换占位接线版）。
 *
 * 布局：左 411px 侧栏（过滤/搜索/分类清单 或 点位详情——上游为同一左槽互斥）+
 * 右瓦片画布（zoom 控件 + "3D Interactive Map" 入口按钮 top-10 right-5——位置对齐上游，
 * 行为由新开 tab 改为应用内切换，记录为单应用形态下的必然等价物）。
 *
 * 耦合契约（对 App 外壳，见 state/viewStore、state/viewCoupling、state/floorCoupling）：
 * - mapStore.mapId 变化 → 沙盘过滤/选中全量复位（不触发 2D→3D 同步）
 * - floorStore：加载后回填沙盘楼层值域（应用域 union）；楼层选择双向尽力同步
 * - viewCoupling：2D 勾选 → syncFromSandbox（组级）；3D 粗类变化 → 组级取消勾选；
 *   sandboxLocate（3D→2D 世界坐标定位请求）经 linkAffine 换算 flyTo
 * - poiStore.requestFlyTo + setView("3d")：详情面板 "3D 中定位"（区域级近似，UI 标注）
 * - viewStore.registerSandboxDismiss：Esc 逐层关闭（弹窗 → 详情 → 设置）
 * - 无 2D 数据的图（潮汐监狱）：空态画布 + 原始键标题直出（缺键回退行为，四语一致）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getMapById } from "@/map/registry";
import { useMapStore } from "@/state/mapStore";
import { useFloorStore } from "@/state/floorStore";
import { usePoiStore } from "@/state/poiStore";
import { useViewStore } from "@/state/viewStore";
import {
  appFloorToSiteFloor,
  sandboxFloorsToAppDomain,
  siteFloorToAppFloor,
} from "@/state/floorCoupling";
import { useSearchStore } from "@/state/searchStore";
import { SANDBOX_GROUP_IDS, useViewCoupling, type SandboxGroupId } from "@/state/viewCoupling";
import { useUiStore } from "@/state/uiStore";
import {
  resolveSandboxPointLabel,
  resolveSandboxPointTitle,
  resolveSandboxRegionName,
  TIDE_PRISON_FALLBACK_TITLE,
} from "@/i18n/sandboxNames";
import { loadSandbox2d, sandboxLoadErrorCode, type Sandbox2dPackage } from "./loadSandbox2d";
import { filterSandboxPoints } from "./filter";
import { regionToFullRes } from "./project";
import { useSandboxStore, setSandboxSelectionListener } from "./sandboxStore";
import { TileMapCanvas, type TileMapController } from "./TileMapCanvas";
import { SandboxSidebar } from "./SandboxSidebar";
import { SandboxDetailPanel } from "./SandboxDetailPanel";
import { SandboxCoordinatePopup } from "./SandboxCoordinatePopup";

/**
 * 共享楼层回放判定（模块级，跨 2D 卸载存活）：记录 2D 侧最后一次观测到的
 * {图, floorStore.floor}。挂载时仅在**同图**且「卸载期间共享楼层变化过」
 * （用户在 3D 改层/跨层传送）才回放同步；换图（floorStore 随数据包复位到新图
 * 默认层，非用户意图）与首次进入不回放——沙盘保持 All/持久化楼层，避免默认
 * 楼层映到无点位的站点楼层时图例/标记被过滤成空（az3 实测：app 1→site 0 无点位）。
 */
let lastSeenSharedFloor: { mapId: number; floor: number } | null = null;

export function Sandbox2dView() {
  const { t } = useTranslation();
  const mapId = useMapStore((s) => s.mapId);
  const loadSeq = useMapStore((s) => s.loadSeq);
  const language = useUiStore((s) => s.language);
  const setView = useViewStore((s) => s.setView);
  const registerSandboxDismiss = useViewStore((s) => s.registerSandboxDismiss);

  const [loaded, setLoaded] = useState<{ mapId: number; pkg: Sandbox2dPackage } | null>(null);
  const [failed, setFailed] = useState<{ mapId: number; code: string; attempt: number } | null>(
    null,
  );

  const difficulty = useSandboxStore((s) => s.difficulty);
  const floor = useSandboxStore((s) => s.floor);
  const searchTarget = useSandboxStore((s) => s.searchTarget);
  const selectedItems = useSandboxStore((s) => s.selectedItems);
  const selectedPointId = useSandboxStore((s) => s.selectedPointId);
  const selectedRegionId = useSandboxStore((s) => s.selectedRegionId);
  const coordinatePopup = useSandboxStore((s) => s.coordinatePopup);
  const selectPoint = useSandboxStore((s) => s.selectPoint);
  const selectRegion = useSandboxStore((s) => s.selectRegion);
  const setCoordinatePopup = useSandboxStore((s) => s.setCoordinatePopup);

  const setFloorStoreFloor = useFloorStore((s) => s.setFloor);
  const requestFlyTo = usePoiStore((s) => s.requestFlyTo);

  const controllerRef = useRef<TileMapController | null>(null);
  const flyTokenRef = useRef(0);

  const definition = getMapById(mapId) ?? null;
  // 按图隔离的加载结果（换图瞬间旧包/旧错误自然失效，无需同步清态）
  const pkg = loaded !== null && loaded.mapId === mapId ? loaded.pkg : null;
  const errorCode = failed !== null && failed.mapId === mapId ? failed.code : null;
  const data = pkg?.data ?? null;
  const status: "unavailable" | "ready" | "error" | "loading" =
    definition === null || definition.sandbox2dUrl === undefined
      ? "unavailable"
      : pkg !== null
        ? "ready"
        : errorCode !== null
          ? "error"
          : "loading";

  // ---- 数据加载（进入 2D 视图才拉；换图/重试重载；状态只在异步回调写入）----
  useEffect(() => {
    let cancelled = false;
    if (definition === null || definition.sandbox2dUrl === undefined) {
      // 潮汐监狱：上游 catch-all 空页，无 2D 数据——空态由渲染层按 sandbox2dUrl 缺失判定
      return;
    }
    const seq = loadSeq; // 本次加载序号（mapStore.setMap 自增驱动同图位重试）
    loadSandbox2d(definition)
      .then((result) => {
        if (!cancelled) {
          setLoaded({ mapId: definition.id, pkg: result });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailed({ mapId: definition.id, code: sandboxLoadErrorCode(error), attempt: seq + 1 });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [definition, loadSeq]);

  // ---- 换图复位（仅真实换图触发；同图重挂载——3D↔2D 切换/重载恢复——保留过滤态）----
  useEffect(() => {
    const store = useSandboxStore.getState();
    if (store.filtersMapId !== mapId) {
      // 图章与当前图不符 = 换图（或首次进入）：全量复位并改章；
      // 同图重挂载时图章一致，持久化过滤态直接存活（设计 §1.3 #2「仅换图复位」）。
      store.resetForMap(mapId);
    }
  }, [mapId]);

  // ---- 楼层值域回填（应用域 union；数据就绪后）----
  useEffect(() => {
    if (data === null) {
      return;
    }
    useFloorStore
      .getState()
      .setSandboxFloors(sandboxFloorsToAppDomain(data.meta.siteFloors, data.meta.floorMap));
  }, [data]);

  // ---- 共享楼层 → 2D 侧站点域映射（变化订阅 + 卸载期间变化的挂载回放；域外保持）----
  useEffect(() => {
    if (data === null) {
      return;
    }
    const syncFromShared = (appFloor: number) => {
      const site = appFloorToSiteFloor(appFloor, data.meta.floorMap);
      if (data.meta.siteFloors.includes(site)) {
        useSandboxStore.getState().setFloor(String(site));
      }
      // 域外值：保持上一有效渲染（设计 §2.2 "部分耦合"的诚实语义）
    };
    // 挂载回放：仅同图且卸载期间共享楼层变化过（TopBar 改层/跨层传送）时补同步
    //（zustand subscribe 不回放初值）；换图复位/首次进入不回放，沙盘楼层保持原态。
    const sharedFloor = useFloorStore.getState().floor;
    const lastSeen = lastSeenSharedFloor;
    const sameMap = lastSeen !== null && lastSeen.mapId === mapId;
    if (sameMap && lastSeen !== null && sharedFloor !== lastSeen.floor) {
      syncFromShared(sharedFloor);
    }
    lastSeenSharedFloor = { mapId, floor: sharedFloor };
    return useFloorStore.subscribe((state, prev) => {
      if (state.floor === prev.floor) {
        return;
      }
      lastSeenSharedFloor = { mapId, floor: state.floor };
      syncFromShared(state.floor);
    });
  }, [data, mapId]);

  // ---- 2D 勾选 → 3D 粗类（组级；用户意图动作经监听器，换图复位不触发）----
  useEffect(() => {
    if (data === null) {
      return;
    }
    const itemIdToGroup = new Map(data.legend.map((item) => [item.id, item.group]));
    const listener = (selected: readonly string[]) => {
      const groupVisible = {} as Record<SandboxGroupId, boolean>;
      for (const group of SANDBOX_GROUP_IDS) {
        groupVisible[group] = selected.some((id) => itemIdToGroup.get(id) === group);
      }
      useViewCoupling.getState().syncFromSandbox(groupVisible);
    };
    setSandboxSelectionListener(listener);
    return () => {
      setSandboxSelectionListener(null);
    };
  }, [data]);

  // ---- 3D 粗类变化 → 2D 组级取消勾选（粗类隐藏 → 该组全部取消）----
  useEffect(() => {
    if (data === null) {
      return;
    }
    const groupItems = new Map<SandboxGroupId, string[]>();
    for (const item of data.legend) {
      const list = groupItems.get(item.group) ?? [];
      list.push(item.id);
      groupItems.set(item.group, list);
    }
    return useViewCoupling.subscribe((state, prev) => {
      if (state.lastSource !== "poiFilter" || state.groupVisible === prev.groupVisible) {
        return;
      }
      const current = useSandboxStore.getState().selectedItems;
      let next: string[] | null = null;
      for (const group of SANDBOX_GROUP_IDS) {
        if (state.groupVisible[group]) {
          continue;
        }
        const items = groupItems.get(group) ?? [];
        if (next === null) {
          next = [...current];
        }
        next = next.filter((id) => !items.includes(id));
      }
      if (next !== null) {
        useSandboxStore.getState().setItems(next);
      }
    });
  }, [data]);

  // ---- 3D→2D 定位请求（世界 → linkAffine → flyTo；区域级近似）----
  useEffect(() => {
    if (data === null) {
      return;
    }
    const consumeLocate = (world: { x: number; y: number; z: number }) => {
      const affine = data.meta.linkAffine.worldToSite;
      const siteX = affine.M[0][0] * world.x + affine.M[0][1] * world.z + affine.t[0];
      const siteY = affine.M[1][0] * world.x + affine.M[1][1] * world.z + affine.t[1];
      const full = regionToFullRes(siteX, siteY);
      flyTokenRef.current += 1;
      controllerRef.current?.flyTo(full.sx, full.sy, 3);
      useViewCoupling.getState().consumeSandboxLocate();
    };
    // 挂载回放：请求可能在本视图挂载前（或数据就绪前）写入——PoiBubble 先
    // requestSandboxLocate 再 setView("2d")，而 zustand subscribe 不回放初值，
    // 不补这一步则请求永远错过（写入时消费方尚未注册）。
    const pending = useViewCoupling.getState().sandboxLocate;
    if (pending !== null) {
      consumeLocate(pending.world);
    }
    return useViewCoupling.subscribe((state, prev) => {
      if (state.sandboxLocate === null || state.sandboxLocate === prev.sandboxLocate) {
        return;
      }
      consumeLocate(state.sandboxLocate.world);
    });
  }, [data]);

  // ---- Esc 逐层关闭（弹窗 → 详情）----
  useEffect(() => {
    registerSandboxDismiss(() => {
      const state = useSandboxStore.getState();
      if (state.coordinatePopup !== null) {
        state.setCoordinatePopup(null);
        return true;
      }
      if (state.selectedPointId !== null) {
        state.selectPoint(null);
        return true;
      }
      return false;
    });
    return () => registerSandboxDismiss(null);
  }, [registerSandboxDismiss]);

  // ---- 派生数据 ----
  const siteFloor = useMemo(() => {
    if (data === null) {
      return undefined;
    }
    return floor === "all" ? undefined : Number.parseInt(floor, 10);
  }, [data, floor]);

  const filteredPoints = useMemo(() => {
    if (data === null) {
      return [];
    }
    return filterSandboxPoints(
      data.points,
      { difficulty, floor, location: searchTarget, selectedItems },
      false,
    );
  }, [data, difficulty, floor, searchTarget, selectedItems]);

  const namedPoints = useMemo(() => {
    if (data === null) {
      return [];
    }
    // 下拉仅列具名位（name 非空）；trigger 类不入下拉（按图实例：18=20−2）
    return data.points.filter((p) => p.nameEn !== null && p.item !== "trigger");
  }, [data]);

  const regionNames = useMemo(() => {
    const names = new Map<string, string>();
    if (data !== null) {
      for (const region of data.regions) {
        const name = resolveSandboxRegionName(region, language);
        if (name !== null) {
          names.set(region.id, name);
        }
      }
    }
    return names;
  }, [data, language]);

  const pointLabel = useCallback(
    (point: { nameEn: string | null; titleEn: string | null; titleZh: string | null }) =>
      resolveSandboxPointLabel(point, language),
    [language],
  );

  const namedLabel = useCallback(
    (point: {
      nameEn: string | null;
      titleEn: string | null;
      titleZh: string | null;
      item: string;
    }) => {
      // 下拉文案 `${name} (${title ?? item_id})`：括号内为物品名语言链
      //（resolveSandboxPointTitle：zh→titleZh、en→titleEn），两字段均缺回退 item_id；
      // 具名位 name 不进括号（否则「X (X)」自重复）。
      const title = resolveSandboxPointTitle(point, language) ?? point.item;
      return point.nameEn !== null ? `${point.nameEn} (${title})` : title;
    },
    [language],
  );

  const iconUrls = useMemo(() => {
    const urls = new Map<string, string>();
    if (pkg !== null) {
      for (const [itemId, icon] of Object.entries(pkg.iconIndex)) {
        const url = pkg.getObjectUrl(icon.file);
        if (url !== undefined) {
          urls.set(itemId, url);
        }
      }
    }
    return urls;
  }, [pkg]);

  const selectedPoint = useMemo(
    () => data?.points.find((p) => p.id === selectedPointId) ?? null,
    [data, selectedPointId],
  );

  // ---- 交互处理器 ----
  const handleSelectPoint = useCallback(
    (pointId: number | null) => {
      selectPoint(pointId);
    },
    [selectPoint],
  );

  const handleSelectRegion = useCallback(
    (regionId: string | null) => {
      selectRegion(regionId);
      // 区域标签点击 → flyTo(该点, zoom 3, 0.5s)
      if (regionId !== null && data !== null) {
        const region = data.regions.find((r) => r.id === regionId);
        if (region !== undefined) {
          const full = regionToFullRes(region.x, region.y);
          controllerRef.current?.flyTo(full.sx, full.sy, 3);
        }
      }
    },
    [data, selectRegion],
  );

  // 空白左键 → 清空搜索/选中（具名点位下拉、共享搜索文本、点位/区域选中）；
  // 坐标弹窗由画布回调自行关闭（设计 §1.3 #10）。
  const handleBlankClick = useCallback(() => {
    const sandbox = useSandboxStore.getState();
    sandbox.setSearchTarget(null);
    sandbox.setSubmittedSearch("");
    sandbox.selectPoint(null);
    sandbox.selectRegion(null);
    useSearchStore.getState().clearQuery();
  }, []);

  const handleSiteFloorChange = useCallback(
    (siteFloorValue: number | undefined) => {
      if (data === null || siteFloorValue === undefined) {
        return;
      }
      setFloorStoreFloor(siteFloorToAppFloor(siteFloorValue, data.meta.floorMap));
    },
    [data, setFloorStoreFloor],
  );

  const handleLocate3d = useCallback(
    (world: { x: number; y: number; z: number }) => {
      requestFlyTo(world);
      setView("3d");
    },
    [requestFlyTo, setView],
  );

  const handleRetry = useCallback(() => {
    // 复用 mapStore 重试通道（loadSeq 自增触发重载）
    useMapStore.getState().setMap(mapId);
  }, [mapId]);

  // ---- 渲染 ----
  const showEmptyState = status === "unavailable"; // 无 2D 数据（潮汐监狱）
  const mapName = definition !== null ? t(definition.nameKey) : "";
  const errorText =
    errorCode === "unavailable"
      ? t("errors.unavailable")
      : errorCode === "corrupt"
        ? t("errors.corrupt")
        : t("errors.unknown");

  return (
    <div className="sandbox2d-view" role="region" aria-label={t("sandbox2d.title")}>
      <aside className="sandbox2d-panel">
        {selectedPoint !== null && pkg !== null && data !== null ? (
          <SandboxDetailPanel
            data={data}
            point={selectedPoint}
            mediaUrl={
              selectedPoint.media !== null ? pkg.getObjectUrl(selectedPoint.media) : undefined
            }
            shotUrl={selectedPoint.shot !== null ? pkg.getObjectUrl(selectedPoint.shot) : undefined}
            onClose={() => selectPoint(null)}
            onLocate3d={handleLocate3d}
          />
        ) : data !== null ? (
          <SandboxSidebar
            data={data}
            iconUrls={iconUrls}
            namedPoints={namedPoints}
            namedLabel={namedLabel}
            onSiteFloorChange={handleSiteFloorChange}
          />
        ) : (
          <div className="sandbox2d-panel-state">
            {status === "loading" ? (
              <p>{t("sandbox2d.preparing")}</p>
            ) : status === "error" ? (
              <div>
                <p>{errorText}</p>
                <button type="button" onClick={handleRetry}>
                  {t("sandbox2d.retry")}
                </button>
              </div>
            ) : (
              <p>{t("switcher.preparingNotice", { map: mapName })}</p>
            )}
          </div>
        )}
      </aside>
      <div className="sandbox2d-map">
        {showEmptyState ? (
          // catch-all 空页：空容器照常挂载 + 标题直出原始键（缺键回退行为，四语一致）
          <div className="sandbox2d-empty-map">
            <p className="sandbox2d-empty-map-title">{TIDE_PRISON_FALLBACK_TITLE}</p>
            <p className="sandbox2d-empty-map-note">{t("sandbox2d.noData")}</p>
          </div>
        ) : (
          <>
            <TileMapCanvas
              pkg={pkg}
              data={data}
              viewKey={mapId}
              siteFloor={siteFloor}
              points={filteredPoints}
              selectedPointId={selectedPointId}
              searchTarget={searchTarget}
              selectedRegionId={selectedRegionId}
              regionNames={regionNames}
              pointLabel={pointLabel}
              onSelectPoint={handleSelectPoint}
              onSelectRegion={handleSelectRegion}
              onBlankClick={handleBlankClick}
              onCoordinatePopup={setCoordinatePopup}
              controllerRef={controllerRef}
            />
            <div className="sandbox2d-zoom">
              <button type="button" onClick={() => controllerRef.current?.zoomIn()} aria-label="+">
                +
              </button>
              <button type="button" onClick={() => controllerRef.current?.zoomOut()} aria-label="−">
                −
              </button>
            </div>
            <button
              type="button"
              className="sandbox2d-entry3d"
              onClick={() => setView("3d")}
              title={t("sandbox2d.switchTo3d")}
            >
              {t("sandbox2d.switchTo3d")}
            </button>
            {coordinatePopup !== null ? (
              <SandboxCoordinatePopup
                sx={coordinatePopup.sx}
                sy={coordinatePopup.sy}
                screenX={coordinatePopup.screenX}
                screenY={coordinatePopup.screenY}
                onClose={() => setCoordinatePopup(null)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
