import { useTranslation } from "react-i18next";
import type { MapLoadErrorCode } from "@/data";
import { getMapById } from "@/map";
import { useFloorStore } from "@/state/floorStore";
import { useMapDataStore } from "@/state/mapDataStore";
import { useMapStore } from "@/state/mapStore";
import { useUiStore } from "@/state/uiStore";

function errorMessageKey(errorCode: MapLoadErrorCode) {
  switch (errorCode) {
    case "unavailable":
      return "errors.unavailable" as const;
    case "corrupt":
      return "errors.corrupt" as const;
    case "unknown":
      return "errors.unknown" as const;
  }
}

/** 底部 HUD：地图/楼层/摆放规模/世界坐标/指北/截图/加载状态。 */
export function StatusBar() {
  const { t } = useTranslation();
  const mapId = useMapStore((state) => state.mapId);
  const status = useMapStore((state) => state.status);
  const errorCode = useMapStore((state) => state.errorCode);
  const floor = useFloorStore((state) => state.floor);
  const instanceCount = useMapDataStore((state) => state.bundle?.manifest.counts.instances ?? null);
  const cameraHud = useUiStore((state) => state.cameraHud);
  const screenshotHandler = useUiStore((state) => state.screenshotHandler);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const definition = getMapById(mapId);

  const statusText =
    status === "ready"
      ? t("status.ready")
      : status === "loading"
        ? t("status.loading")
        : status === "error"
          ? t(errorMessageKey(errorCode ?? "unknown"))
          : t("status.idle");

  return (
    <footer className="status-bar">
      <span>{definition === undefined ? mapId : t(definition.nameKey)}</span>
      <span>
        {floor < 0
          ? t("floor.basement", { floor: Math.abs(floor) })
          : t("floor.floorName", { floor })}
      </span>
      {instanceCount !== null ? (
        <span>{t("status.placements", { count: instanceCount })}</span>
      ) : definition?.knownPlacementCount !== undefined ? (
        <span>{t("status.placements", { count: definition.knownPlacementCount })}</span>
      ) : null}
      {cameraHud !== null ? (
        <span className="status-coords">
          <span className="status-compass" aria-hidden="true">
            N↑
          </span>
          {t("hud.worldCoords")}:{" "}
          {`${cameraHud.position.x.toFixed(1)}, ${cameraHud.position.y.toFixed(1)}, ${cameraHud.position.z.toFixed(1)}`}
        </span>
      ) : null}
      <span className={status === "error" ? "status-text status-error" : "status-text"}>
        {statusText}
      </span>
      <div className="status-actions">
        <button
          type="button"
          disabled={screenshotHandler === null}
          onClick={() => screenshotHandler?.()}
        >
          {t("hud.screenshot")}
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          {t("settings.title")}
        </button>
      </div>
    </footer>
  );
}
