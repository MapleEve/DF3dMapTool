import { useTranslation } from "react-i18next";
import type { PoiCategory, PoiDefinition } from "@/poi/types";
import { useNavStore } from "@/state/navStore";

export interface PoiBubbleProps {
  poi: PoiDefinition;
  category?: PoiCategory;
  iconUrl?: string;
  onClose: () => void;
  onLocate: () => void;
}

/** POI 详情气泡：图标/名称/楼层/分类/描述 + 定位 + 寻路。 */
export function PoiBubble({ poi, category, iconUrl, onClose, onLocate }: PoiBubbleProps) {
  const { t } = useTranslation();
  const requestPath = useNavStore((state) => state.requestPath);
  // 数据包派生分类的 labelKey 不在静态 i18n 键表内，运行时按字符串查表并回退 label。
  const categoryLabel =
    category?.labelKey !== undefined
      ? t(category.labelKey as never, { defaultValue: category.label ?? "" })
      : category?.label;
  const floorLabel =
    poi.floor === 0 ? t("poi.allFloors") : t("floor.floorName", { floor: poi.floor });

  return (
    <div className="poi-bubble" role="dialog" aria-label={poi.displayName}>
      <header className="poi-bubble-header">
        {iconUrl !== undefined ? (
          <img className="poi-bubble-icon" src={iconUrl} alt="" />
        ) : (
          <span
            className="poi-bubble-icon poi-bubble-icon-fallback"
            style={{ backgroundColor: category?.color }}
          />
        )}
        <div className="poi-bubble-titles">
          <strong>{poi.displayName}</strong>
          <span className="poi-bubble-meta">
            {categoryLabel !== undefined ? (
              <em style={{ color: category?.color }}>{categoryLabel}</em>
            ) : null}
            <span>{floorLabel}</span>
          </span>
        </div>
        <button
          type="button"
          className="poi-bubble-close"
          onClick={onClose}
          aria-label={t("poi.close")}
        >
          ×
        </button>
      </header>
      {poi.description !== undefined ? (
        <p className="poi-bubble-description">{poi.description}</p>
      ) : (
        <p className="poi-bubble-description poi-bubble-description-empty">
          {t("poi.noDescription")}
        </p>
      )}
      <footer className="poi-bubble-actions">
        <button type="button" onClick={onLocate}>
          {t("poi.locate")}
        </button>
        <button
          type="button"
          onClick={() => {
            requestPath(poi.position, poi.displayName);
          }}
        >
          {t("poi.navigate")}
        </button>
      </footer>
    </div>
  );
}
