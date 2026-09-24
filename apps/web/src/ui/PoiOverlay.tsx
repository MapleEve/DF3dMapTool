import { useEffect, useMemo, useRef } from "react";
import type { Vec3 } from "@/common/geometry";
import { getIconObjectUrl } from "@/data";
import type { ScreenAnchor } from "@/engine";
import { filterPois } from "@/poi/filter";
import type { PoiDefinition } from "@/poi/types";
import { useFloorStore } from "@/state/floorStore";
import { useMapDataStore } from "@/state/mapDataStore";
import { usePoiFilterStore } from "@/state/poiFilterStore";
import { usePoiStore } from "@/state/poiStore";
import { PoiBubble } from "./PoiBubble";

const BUBBLE_WIDTH_PX = 264;
const BUBBLE_HEIGHT_PX = 200;
const BUBBLE_MARGIN_PX = 8;

/**
 * 投影回调：由视口注入（引擎侧 projectToScreen 与渲染视口绑定），
 * 返回 CSS 像素锚点；null 表示视口尚未就绪。
 */
export type PoiProjector = ((world: Vec3) => ScreenAnchor | null) | null;

export interface PoiOverlayProps {
  projector: PoiProjector;
}

/**
 * 3D 场景 POI 标注层：将可见 POI 的世界锚点逐帧投影到屏幕坐标，
 * DOM 节点做位移动画（不经 React 重渲染），点击弹出详情气泡。
 */
export function PoiOverlay({ projector }: PoiOverlayProps) {
  const poiData = useMapDataStore((state) => state.poiData);
  const hiddenCategories = usePoiFilterStore((state) => state.hiddenCategories);
  const floor = useFloorStore((state) => state.floor);
  const selectedPoiId = usePoiStore((state) => state.selectedPoiId);
  const selectPoi = usePoiStore((state) => state.selectPoi);
  const requestFlyTo = usePoiStore((state) => state.requestFlyTo);

  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const bubbleRef = useRef<HTMLDivElement>(null);
  const screenPositions = useRef(new Map<string, { x: number; y: number } | null>());

  // 当前楼层/筛选下的可见 POI（楼层 0 = 全楼层，恒可见）。
  const visiblePois = useMemo(() => {
    if (poiData === null) {
      return [];
    }
    return filterPois(poiData.pois, { hiddenCategories, floor });
  }, [poiData, hiddenCategories, floor]);

  const selectedPoi = useMemo(() => {
    if (poiData === null || selectedPoiId === null) {
      return null;
    }
    return poiData.pois.find((poi) => poi.id === selectedPoiId) ?? null;
  }, [poiData, selectedPoiId]);

  const selectedCategory = useMemo(() => {
    if (selectedPoi === null || poiData === null) {
      return undefined;
    }
    return poiData.categories.find((category) => category.id === selectedPoi.categoryId);
  }, [poiData, selectedPoi]);

  // 图标 object URL（按 iconFile 缓存在数据层）。
  const iconUrls = useMemo(() => {
    const urls = new Map<string, string>();
    if (poiData === null) {
      return urls;
    }
    // zustand 的 getState 是 store 对象的静态读取（非 hook 调用），渲染期合法。
    // oxlint-disable-next-line react/hooks
    const pkg = useMapDataStore.getState().bundle?.pkg ?? null;
    if (pkg === null) {
      return urls;
    }
    for (const poi of visiblePois) {
      if (poi.iconFile !== undefined && !urls.has(poi.iconFile)) {
        const url = getIconObjectUrl(pkg, poi.iconFile);
        if (url !== undefined) {
          urls.set(poi.iconFile, url);
        }
      }
    }
    return urls;
  }, [poiData, visiblePois]);

  useEffect(() => {
    if (projector === null) {
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      for (const poi of visiblePois) {
        const node = itemRefs.current.get(poi.id);
        if (node === undefined) {
          continue;
        }
        const anchor = projector(poi.position);
        if (anchor === null || !anchor.visible) {
          node.style.display = "none";
          screenPositions.current.set(
            poi.id,
            anchor === null ? null : { x: anchor.x, y: anchor.y },
          );
          continue;
        }
        node.style.display = "";
        node.style.transform = `translate(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px)`;
        screenPositions.current.set(poi.id, { x: anchor.x, y: anchor.y });
      }

      // 详情气泡跟随选中锚点，位置夹取在视口内。
      const bubble = bubbleRef.current;
      if (bubble !== null) {
        const host = bubble.parentElement;
        const maxWidth = host?.clientWidth ?? 0;
        const maxHeight = host?.clientHeight ?? 0;
        const anchor =
          selectedPoiId !== null ? screenPositions.current.get(selectedPoiId) : undefined;
        if (anchor === null || anchor === undefined) {
          bubble.style.display = "none";
        } else {
          const x = Math.min(
            Math.max(BUBBLE_MARGIN_PX, anchor.x),
            Math.max(BUBBLE_MARGIN_PX, maxWidth - BUBBLE_WIDTH_PX - BUBBLE_MARGIN_PX),
          );
          const y = Math.min(
            Math.max(BUBBLE_MARGIN_PX, anchor.y),
            Math.max(BUBBLE_MARGIN_PX, maxHeight - BUBBLE_HEIGHT_PX),
          );
          bubble.style.display = "";
          bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [projector, visiblePois, selectedPoiId]);

  if (projector === null || poiData === null || visiblePois.length === 0) {
    return null;
  }

  return (
    <div className="poi-overlay" aria-label="POI">
      {visiblePois.map((poi: PoiDefinition) => {
        const category = poiData.categories.find((entry) => entry.id === poi.categoryId);
        const iconUrl = poi.iconFile !== undefined ? iconUrls.get(poi.iconFile) : undefined;
        return (
          <button
            key={poi.id}
            ref={(node) => {
              if (node === null) {
                itemRefs.current.delete(poi.id);
              } else {
                itemRefs.current.set(poi.id, node);
              }
            }}
            type="button"
            className={poi.id === selectedPoiId ? "poi-marker selected" : "poi-marker"}
            title={poi.displayName}
            onClick={() => selectPoi(poi.id === selectedPoiId ? null : poi.id)}
          >
            {iconUrl !== undefined ? (
              <img src={iconUrl} alt="" draggable={false} />
            ) : (
              <span style={{ backgroundColor: category?.color ?? "#8fa3b8" }} />
            )}
          </button>
        );
      })}
      <div ref={bubbleRef} className="poi-bubble-anchor" style={{ display: "none" }}>
        {selectedPoi !== null ? (
          <PoiBubble
            poi={selectedPoi}
            category={selectedCategory}
            iconUrl={
              selectedPoi.iconFile !== undefined ? iconUrls.get(selectedPoi.iconFile) : undefined
            }
            onClose={() => selectPoi(null)}
            onLocate={() => {
              requestFlyTo(selectedPoi.position);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
