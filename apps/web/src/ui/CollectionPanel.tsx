import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCollectionStore, type RolledItem } from "@/state/collectionStore";

/**
 * 物资面板（F 键近旁物资 POI 触发；上游实测口径）。
 *
 * - 左列物资清单（390x307）：物品名 20px、副标题 12px；
 * - 右侧详情（400x389）：物品名 18px、副标题 12px、描述 16px、
 *   「概率刷新」16px、「无法交易」标记；
 * - 底栏：「累计价值：」16px #0FF796 + 刷新按钮。
 *   估值数据源缺失（源数据无交易价值字段）：不呈现估值数值，
 *   以「数据未包含估值信息」如实标注（禁止编造数值）。
 * - 收藏：物品行星标（localStorage 持久化）+ 收藏视图切换。
 */
export function CollectionPanel() {
  const open = useCollectionStore((state) => state.open);
  if (!open) {
    return null;
  }
  return <CollectionPanelBody />;
}

function CollectionPanelBody() {
  const { t, i18n } = useTranslation();
  const closePanel = useCollectionStore((state) => state.closePanel);
  const favoritesView = useCollectionStore((state) => state.favoritesView);
  const favorites = useCollectionStore((state) => state.favorites);
  const items = useCollectionStore((state) => state.items);
  const data = useCollectionStore((state) => state.data);
  const setFavoritesView = useCollectionStore((state) => state.setFavoritesView);
  const reroll = useCollectionStore((state) => state.reroll);

  const favoriteItems = useMemo(() => {
    if (data === null) {
      return [];
    }
    return favorites
      .map((id) => data.itemById.get(id))
      .filter((item): item is NonNullable<RolledItem> => item !== undefined);
  }, [favorites, data]);

  const language = i18n.language;
  const listItems = favoritesView ? favoriteItems : items;

  return (
    <div className="collection-backdrop" onClick={closePanel}>
      <section
        className="collection-panel"
        role="dialog"
        aria-label={t("collection.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="collection-header">
          <h3 className="collection-title">{t("collection.title")}</h3>
          <div className="collection-header-actions">
            <button
              type="button"
              className={favoritesView ? "collection-fav-toggle active" : "collection-fav-toggle"}
              onClick={() => setFavoritesView(!favoritesView)}
            >
              {t("collection.favorites")} ({favorites.length})
            </button>
            <button
              type="button"
              className="collection-refresh"
              disabled={favoritesView}
              onClick={() => reroll()}
            >
              {t("collection.refresh")}
            </button>
            <button
              type="button"
              className="collection-close"
              aria-label={t("common.close")}
              onClick={closePanel}
            >
              ×
            </button>
          </div>
        </header>
        {listItems.length === 0 ? (
          <div className="collection-empty">
            <span>{t("collection.emptyTip")}</span>
          </div>
        ) : (
          <div className="collection-body">
            <ul className="collection-list" role="list">
              {listItems.map((item) => (
                <CollectionRow
                  key={item.id}
                  item={item}
                  language={language}
                  favorited={favorites.includes(item.id)}
                />
              ))}
            </ul>
          </div>
        )}
        <footer className="collection-footer">
          <span className="collection-total-value">{t("collection.totalValue")}</span>
          <span className="collection-value-note">{t("collection.valueUnavailable")}</span>
          <span className="collection-rng">{t("collection.rngSpawn")}</span>
          <span className="collection-unable-trade">{t("collection.unableTrade")}</span>
        </footer>
      </section>
    </div>
  );
}

function itemDisplayName(item: RolledItem, language: string): string {
  if (language === "en" && item.nameEn !== null) {
    return item.nameEn;
  }
  return item.name;
}

function CollectionRow({
  item,
  language,
  favorited,
}: {
  item: RolledItem;
  language: string;
  favorited: boolean;
}) {
  const { t } = useTranslation();
  const selectItem = useCollectionStore((state) => state.selectItem);
  const toggleFavorite = useCollectionStore((state) => state.toggleFavorite);
  const selectedItemId = useCollectionStore((state) => state.selectedItemId);
  const selected = selectedItemId === item.id;

  return (
    <li
      className={selected ? "collection-item selected" : "collection-item"}
      role="listitem"
      onClick={() => selectItem(selected ? null : item.id)}
    >
      <button
        type="button"
        className={favorited ? "collection-fav on" : "collection-fav"}
        aria-label={favorited ? t("collection.favoriteRemove") : t("collection.favorites")}
        aria-pressed={favorited}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavorite(item.id);
        }}
      >
        {favorited ? "★" : "☆"}
      </button>
      <div className="collection-item-main">
        <span className="collection-item-name">{itemDisplayName(item, language)}</span>
        {item.subTitle !== "" ? (
          <span className="collection-item-subtitle">{item.subTitle}</span>
        ) : (
          <span className="collection-item-quality">
            {t("collection.rngSpawn")} · {item.quality}
          </span>
        )}
      </div>
      <div className="collection-item-detail">
        {selected && item.description !== "" ? (
          <p className="collection-item-desc">{item.description}</p>
        ) : null}
      </div>
    </li>
  );
}
