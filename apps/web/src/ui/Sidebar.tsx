import type { ChangeEvent } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { POI_CATEGORIES } from '@/poi';
import type { PoiCategory, PoiDefinition } from '@/poi/types';
import { searchPois } from '@/poi/search';
import { useFloorStore } from '@/state/floorStore';
import { useMapDataStore } from '@/state/mapDataStore';
import { useMapStore } from '@/state/mapStore';
import { usePoiFilterStore } from '@/state/poiFilterStore';
import { usePoiStore } from '@/state/poiStore';
import { useSearchStore } from '@/state/searchStore';
import { useUiStore } from '@/state/uiStore';

/**
 * 左侧栏：POI 检索（名称/关键字 + 飞入定位）、分类筛选、楼层联动结果列表。
 * 分类与结果列表均来自数据包派生数据；数据包未加载时展示内置分类与占位提示。
 */
export function Sidebar() {
  const { t } = useTranslation();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const status = useMapStore((state) => state.status);
  const poiData = useMapDataStore((state) => state.poiData);
  const floor = useFloorStore((state) => state.floor);
  const hiddenCategories = usePoiFilterStore((state) => state.hiddenCategories);
  const toggleCategory = usePoiFilterStore((state) => state.toggleCategory);
  const showAllCategories = usePoiFilterStore((state) => state.showAllCategories);
  const hideAllCategories = usePoiFilterStore((state) => state.hideAllCategories);
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const clearQuery = useSearchStore((state) => state.clearQuery);
  const selectPoi = usePoiStore((state) => state.selectPoi);
  const requestFlyTo = usePoiStore((state) => state.requestFlyTo);
  const selectedPoiId = usePoiStore((state) => state.selectedPoiId);

  const categories = poiData !== null && poiData.categories.length > 0 ? poiData.categories : POI_CATEGORIES;

  const results = useMemo(() => {
    if (poiData === null) {
      return [] as readonly { poi: PoiDefinition; category?: PoiCategory }[];
    }
    const matches = searchPois(poiData.pois, query, 100);
    return matches.map((match) => ({
      poi: match.item,
      category: poiData.categories.find((entry) => entry.id === match.item.categoryId),
    }));
  }, [poiData, query]);

  if (!sidebarOpen) {
    return null;
  }

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  const handleResultClick = (poi: PoiDefinition) => {
    selectPoi(poi.id);
    requestFlyTo(poi.position);
  };

  return (
    <aside className="sidebar">
      <h2 className="sidebar-title">{t('sidebar.title')}</h2>

      <div className="sidebar-search">
        <input
          type="search"
          value={query}
          onChange={handleSearchChange}
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchPlaceholder')}
        />
        <button type="button" onClick={clearQuery} disabled={query.length === 0}>
          {t('sidebar.clearSearch')}
        </button>
      </div>

      {query.length > 0 ? (
        <section className="sidebar-results" aria-label={t('sidebar.searchPlaceholder')}>
          <p className="sidebar-result-count">{t('sidebar.resultCount', { count: results.length })}</p>
          <ul>
            {results.map(({ poi, category }) => (
              <li key={poi.id}>
                <button
                  type="button"
                  className={poi.id === selectedPoiId ? 'sidebar-result selected' : 'sidebar-result'}
                  onClick={() => handleResultClick(poi)}
                >
                  <span
                    className="sidebar-category-dot"
                    style={{ backgroundColor: category?.color }}
                  />
                  <span className="sidebar-result-name">{poi.displayName}</span>
                  <span className="sidebar-result-floor">
                    {poi.floor === 0
                      ? t('poi.allFloors')
                      : t('floor.floorName', { floor: poi.floor })}
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 ? (
              <li className="sidebar-result-empty">
                {status === 'ready' ? t('sidebar.emptyWhenReady') : t('sidebar.needMapData')}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="sidebar-categories">
        <h3>{t('sidebar.categories')}</h3>
        <div className="sidebar-category-actions">
          <button type="button" onClick={showAllCategories}>
            {t('sidebar.showAll')}
          </button>
          <button type="button" onClick={hideAllCategories}>
            {t('sidebar.hideAll')}
          </button>
        </div>
        <ul>
          {categories.map((category) => {
            const checked = !hiddenCategories.includes(category.id);
            // 数据包派生分类的 labelKey 不在静态 i18n 键表内，按字符串查表并回退 label。
            const label =
              category.labelKey !== undefined
                ? t(category.labelKey as never, { defaultValue: category.label ?? '' })
                : (category.label ?? category.id);
            return (
              <li key={category.id}>
                <label className="sidebar-category">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCategory(category.id)}
                  />
                  <span
                    className="sidebar-category-dot"
                    style={{ backgroundColor: category.color }}
                  />
                  <span>{label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="sidebar-hint">
        {status === 'ready'
          ? t('sidebar.hintFloor', { floor: floor < 0 ? t('floor.basement', { floor: Math.abs(floor) }) : t('floor.floorName', { floor }) })
          : t('sidebar.needMapData')}
      </p>
    </aside>
  );
}
