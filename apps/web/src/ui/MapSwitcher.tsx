import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MapId } from "@/map";
import { MAPS } from "@/map";
import { useMapStore } from "@/state/mapStore";

type ProbeState = "unknown" | "available" | "preparing";

/** 探测结果按会话缓存（仅缓存成功判定），避免重复请求。 */
const probeCache = new Map<MapId, Promise<ProbeState>>();

async function probeBundle(url: string): Promise<ProbeState> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    // SPA 回退会把缺失资源兜底成 index.html（200 + text/html），需按类型剔除。
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || contentType.includes("text/html")) {
      return "preparing";
    }
    return "available";
  } catch {
    return "preparing";
  }
}

function probeMap(mapId: MapId, url: string): Promise<ProbeState> {
  let cached = probeCache.get(mapId);
  if (cached === undefined) {
    cached = probeBundle(url);
    probeCache.set(mapId, cached);
    // 失败判定（资源缺失/网络不可达）不长期缓存：settle 后即失效，
    // 网络恢复后再点同一图位会重新探测，无需依赖提示条里的「重试」。
    void cached.then((state) => {
      if (state !== "available") {
        probeCache.delete(mapId);
      }
    });
  }
  return cached;
}

/**
 * 顶部地图切换器：6 个图位。
 * 当前地图高亮；未随应用分发的图位点击后提示“数据包准备中”（支持重试），
 * 已就绪的图位切换后由视口加载数据包；当前图位加载失败后再点即原位重试。
 */
export function MapSwitcher() {
  const { t } = useTranslation();
  const mapId = useMapStore((state) => state.mapId);
  const status = useMapStore((state) => state.status);
  const setMap = useMapStore((state) => state.setMap);
  const unavailableMapId = useMapStore((state) => state.unavailableMapId);
  const notifyUnavailable = useMapStore((state) => state.notifyUnavailable);
  const [probes, setProbes] = useState<ReadonlyMap<MapId, ProbeState>>(new Map());
  const probingRef = useRef<Set<MapId>>(new Set());

  const markProbe = useCallback((id: MapId, state: ProbeState) => {
    setProbes((previous) => {
      const next = new Map(previous);
      next.set(id, state);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: MapId, url: string) => {
      // 同图位重选仅在加载失败时放行（原位重试：setMap 递增 loadSeq）；
      // 健康态下点当前图位保持 no-op。
      if (id === mapId && status !== "error") {
        return;
      }
      void probeMap(id, url).then((state) => {
        markProbe(id, state);
        if (state === "available") {
          setMap(id);
        } else {
          notifyUnavailable(id);
        }
      });
    },
    [mapId, status, markProbe, notifyUnavailable, setMap],
  );

  const handleRetry = useCallback(
    (id: MapId) => {
      const definition = MAPS.find((entry) => entry.id === id);
      if (definition === undefined) {
        return;
      }
      if (probingRef.current.has(id)) {
        return;
      }
      probingRef.current.add(id);
      notifyUnavailable(null);
      probeCache.delete(id);
      void probeMap(id, definition.bundleUrl).finally(() => {
        probingRef.current.delete(id);
      });
    },
    [notifyUnavailable],
  );

  const unavailableDefinition =
    unavailableMapId !== null ? MAPS.find((entry) => entry.id === unavailableMapId) : undefined;

  return (
    <div className="map-switcher" role="tablist" aria-label={t("toolbar.mapSelect")}>
      {MAPS.map((definition) => {
        const active = definition.id === mapId;
        const state =
          definition.id === mapId ? "available" : (probes.get(definition.id) ?? "unknown");
        return (
          <button
            key={definition.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={state === "preparing" ? t("switcher.preparing") : t(definition.nameKey)}
            className={`map-switcher-chip ${active ? "active" : ""} ${state === "preparing" ? "preparing" : ""}`}
            onClick={() => handleSelect(definition.id, definition.bundleUrl)}
          >
            <span className="map-switcher-id">{definition.id}</span>
            <span>{t(definition.nameKey)}</span>
          </button>
        );
      })}
      {unavailableDefinition !== undefined ? (
        <span className="map-switcher-notice" role="status">
          {t("switcher.preparingNotice", { map: t(unavailableDefinition.nameKey) })}
          <button type="button" onClick={() => handleRetry(unavailableDefinition.id)}>
            {t("switcher.retry")}
          </button>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => notifyUnavailable(null)}
          >
            ×
          </button>
        </span>
      ) : null}
    </div>
  );
}
