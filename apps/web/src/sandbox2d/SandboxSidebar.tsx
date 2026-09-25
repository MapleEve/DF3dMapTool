/**
 * 2D 沙盘侧栏：五控件（难度/楼层/具名点位搜索/类型搜索/分类勾选清单）。
 *
 * 行为逐项实测锚定（上游侧栏语义还原）：
 * - 难度下拉：All + 逐图 difficultyOptions（az3 仅 All）
 * - 楼层下拉：All + 站点楼层（标签 f<0→"{f}F"、f>=0→"{f+1}F"）；选楼层同步共享 floorStore
 * - 具名点位下拉：All + 具名 POI（name 非空；排除 trigger 类——下拉口径 18=20−2），
 *   选项文案 `${name} (${title ?? item})`，值 = {item,x,y} 三元组
 * - 类型搜索：共享 searchStore.query 文本；建议 = 当前图上计数>0 且名称匹配的分类名（250ms 去抖）；
 *   Enter/点建议提交；清空按钮复位；提交文本过滤类型清单（NOT_FOUND 空态）
 * - 组页签：All + 5 组；点击 = 切页签 + 勾选该组全部（替换 selectedItems——整组替换语义）
 * - Select All 开关：全选=并入可见集，取消=移出可见集（并集/差集语义）
 * - 类型卡：42px 图标盒（勾选时 bgColor 底/白边）+ 计数角标（当前过滤下该类上图数，
 *   不含勾选——上游侧栏计数走 selectAll=true）+ 名称；点击切换勾选
 * - 空态：NOT_FOUND（有搜索词）/ NO_DATA + "View other materials" 按钮
 *   （= 清搜索 + 全部复位 + 勾选全部——空态复位语义）
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Sandbox2dData, SandboxLegendItem, SandboxPoint } from "./types";
import { countPointsByItem } from "./filter";
import { useSandboxStore, type SandboxSearchTarget } from "./sandboxStore";
import { useSearchStore } from "@/state/searchStore";

const GROUP_ORDER = ["event", "extraction", "loot", "red-loot", "spawn"] as const;
const SUGGEST_DEBOUNCE_MS = 250;

export interface SandboxSidebarProps {
  data: Sandbox2dData;
  /** 图例图标 object URL（业务键 → url）。 */
  iconUrls: ReadonlyMap<string, string>;
  /** 具名点位（已排序的下拉数据源）。 */
  namedPoints: readonly SandboxPoint[];
  /** 具名点位显示名（语言解析链）。 */
  namedLabel: (point: SandboxPoint) => string;
  /** 楼层选择同步共享 floorStore（app 域）的写入器。 */
  onSiteFloorChange: (siteFloor: number | undefined) => void;
}

export function SandboxSidebar(props: SandboxSidebarProps) {
  const { data, iconUrls, namedPoints, namedLabel, onSiteFloorChange } = props;
  const { t } = useTranslation();

  const difficulty = useSandboxStore((s) => s.difficulty);
  const floor = useSandboxStore((s) => s.floor);
  const searchTarget = useSandboxStore((s) => s.searchTarget);
  const selectedItems = useSandboxStore((s) => s.selectedItems);
  const activeGroup = useSandboxStore((s) => s.activeGroup);
  const submittedSearch = useSandboxStore((s) => s.submittedSearch);
  const setDifficulty = useSandboxStore((s) => s.setDifficulty);
  const setFloor = useSandboxStore((s) => s.setFloor);
  const setSearchTarget = useSandboxStore((s) => s.setSearchTarget);
  const toggleItem = useSandboxStore((s) => s.toggleItem);
  const setItems = useSandboxStore((s) => s.setItems);
  const selectVisible = useSandboxStore((s) => s.selectVisible);
  const setActiveGroup = useSandboxStore((s) => s.setActiveGroup);
  const setSubmittedSearch = useSandboxStore((s) => s.setSubmittedSearch);
  const resetAll = useSandboxStore((s) => s.resetAll);

  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const clearQuery = useSearchStore((s) => s.clearQuery);

  // ---- 类型搜索建议（250ms 去抖；名称匹配且当前图上计数>0）----
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestDismissedAt, setSuggestDismissedAt] = useState(0);

  const countsOnMap = useMemo(
    () =>
      countPointsByItem(data.points, {
        difficulty,
        floor,
        location: searchTarget,
        selectedItems,
      }),
    [data.points, difficulty, floor, searchTarget, selectedItems],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const suggestions = useMemo(() => {
    if (debouncedQuery === "" || debouncedQuery === submittedSearch) {
      return [];
    }
    const needle = debouncedQuery.toLowerCase();
    const names = new Set<string>();
    for (const item of data.legend) {
      if ((countsOnMap.get(item.id) ?? 0) > 0 && item.nameEn.toLowerCase().includes(needle)) {
        names.add(item.nameEn);
      }
    }
    return [...names];
  }, [debouncedQuery, submittedSearch, data.legend, countsOnMap]);

  // ---- 类型清单（activeGroup 过滤 + 提交搜索 + 图上有数过滤）----
  const displayGroups = useMemo(() => {
    const needle = submittedSearch.toLowerCase();
    const groups = new Map<string, SandboxLegendItem[]>();
    for (const item of data.legend) {
      if (activeGroup !== "all" && item.group !== activeGroup) {
        continue;
      }
      if ((countsOnMap.get(item.id) ?? 0) <= 0 || !item.nameEn.toLowerCase().includes(needle)) {
        continue;
      }
      const bucket = groups.get(item.group);
      if (bucket === undefined) {
        groups.set(item.group, [item]);
      } else {
        bucket.push(item);
      }
    }
    return [...groups.values()].toSorted(
      (a, b) => GROUP_ORDER.indexOf(a[0].group) - GROUP_ORDER.indexOf(b[0].group),
    );
  }, [data.legend, activeGroup, submittedSearch, countsOnMap]);

  const visibleItemIds = useMemo(
    () => displayGroups.flatMap((group) => group.map((item) => item.id)),
    [displayGroups],
  );
  const selectedSet = useMemo(() => new Set(selectedItems), [selectedItems]);
  const isAllSelected =
    visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedSet.has(id));

  // ---- 组页签点击：切页签 + 勾选该组全部（整组替换语义）----
  const handleGroupTab = (group: "all" | (typeof GROUP_ORDER)[number]) => {
    setActiveGroup(group);
    setItems(
      data.legend.filter((item) => group === "all" || item.group === group).map((item) => item.id),
    );
  };

  // ---- 空态复位按钮：清搜索 + 全部复位 + 勾选全部（空态复位语义）----
  const handleViewOtherMaterials = () => {
    clearQuery();
    setSubmittedSearch("");
    resetAll();
    setItems(data.legend.map((item) => item.id));
  };

  const floorOptions = useMemo(
    () =>
      data.meta.siteFloors.map((siteFloor) => ({
        value: String(siteFloor),
        label: siteFloor < 0 ? `${siteFloor}F` : `${siteFloor + 1}F`,
      })),
    [data.meta.siteFloors],
  );

  return (
    <div className="sandbox2d-sidebar">
      <div className="sandbox2d-filters">
        <label className="sandbox2d-field">
          <span>{t("sandbox2d.difficulty")}</span>
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
            aria-label={t("sandbox2d.difficulty")}
          >
            <option value="all">{t("sandbox2d.all")}</option>
            {data.meta.difficultyOptions.map((option) => (
              <option key={option} value={option}>
                {option === "easy"
                  ? t("sandbox2d.difficultyEasy")
                  : option === "normal"
                    ? t("sandbox2d.difficultyNormal")
                    : option}
              </option>
            ))}
          </select>
        </label>
        <label className="sandbox2d-field">
          <span>{t("sandbox2d.floor")}</span>
          <select
            value={floor}
            onChange={(event) => {
              const value = event.target.value;
              setFloor(value);
              onSiteFloorChange(value === "all" ? undefined : Number.parseInt(value, 10));
            }}
            aria-label={t("sandbox2d.floor")}
          >
            <option value="all">{t("sandbox2d.all")}</option>
            {floorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sandbox2d-field sandbox2d-field-wide">
          <span>{t("sandbox2d.searchPlaceholder")}</span>
          <select
            value={searchTarget === null ? "all" : JSON.stringify(searchTarget)}
            onChange={(event) => {
              const value = event.target.value;
              setSearchTarget(value === "all" ? null : (JSON.parse(value) as SandboxSearchTarget));
            }}
            aria-label={t("sandbox2d.searchPlaceholder")}
          >
            <option value="all">{t("sandbox2d.all")}</option>
            {namedPoints.map((point) => {
              const value = JSON.stringify({ item: point.item, x: point.x, y: point.y });
              return (
                <option key={`${point.item}@${point.x},${point.y}`} value={value}>
                  {namedLabel(point)}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="sandbox2d-search">
        <input
          type="text"
          value={query}
          placeholder={t("sandbox2d.searchPlaceholder")}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value !== "" && suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setSubmittedSearch(query.trim());
              setShowSuggestions(false);
            }
          }}
          onFocus={() => {
            // onFocus：已有输入时展开建议（刚收起 250ms 内不重复展开）
            if (query !== "" && performance.now() - suggestDismissedAt > 250) {
              setShowSuggestions(true);
            }
          }}
          onBlur={() => {
            // onBlur：延迟收起（让建议点击先命中）
            window.setTimeout(() => setShowSuggestions(false), 200);
          }}
          aria-label={t("sandbox2d.searchPlaceholder")}
        />
        {query !== "" ? (
          <button
            type="button"
            className="sandbox2d-search-clear"
            aria-label="Clear search"
            onClick={() => {
              clearQuery();
              setSubmittedSearch("");
              setShowSuggestions(false);
            }}
          >
            ×
          </button>
        ) : null}
        {showSuggestions && suggestions.length > 0 ? (
          <div className="sandbox2d-suggestions">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setQuery(name);
                  setSubmittedSearch(name);
                  setShowSuggestions(false);
                  setSuggestDismissedAt(performance.now());
                }}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="sandbox2d-grouptabs">
        <button
          type="button"
          className={activeGroup === "all" ? "active" : ""}
          onClick={() => handleGroupTab("all")}
        >
          {t("sandbox2d.groups.all")}
        </button>
        {GROUP_ORDER.map((group) => (
          <button
            key={group}
            type="button"
            className={activeGroup === group ? "active" : ""}
            onClick={() => handleGroupTab(group)}
          >
            {t(`sandbox2d.groups.${group === "red-loot" ? "redLoot" : group}`)}
          </button>
        ))}
      </div>

      {displayGroups.length > 0 ? (
        <div className="sandbox2d-legend">
          <div className="sandbox2d-selectall">
            <label>
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={(event) => selectVisible(visibleItemIds, event.target.checked)}
              />
              {t("sandbox2d.selectAll")}
            </label>
          </div>
          {displayGroups.map((group) => (
            <section key={group[0].group}>
              <h3>
                {t(
                  `sandbox2d.groups.${group[0].group === "red-loot" ? "redLoot" : group[0].group}`,
                )}
              </h3>
              <div className="sandbox2d-legend-grid">
                {group.map((item) => {
                  const selected = selectedSet.has(item.id);
                  const count = countsOnMap.get(item.id) ?? 0;
                  const iconUrl = iconUrls.get(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        selected ? "sandbox2d-legend-item selected" : "sandbox2d-legend-item"
                      }
                      style={
                        selected && item.bgColor !== null
                          ? { backgroundColor: item.bgColor }
                          : undefined
                      }
                      onClick={() => toggleItem(item.id)}
                      title={item.nameEn}
                    >
                      <span className="sandbox2d-legend-icon">
                        {iconUrl !== undefined ? (
                          <img src={iconUrl} alt={item.nameEn} loading="lazy" />
                        ) : (
                          <span className="sandbox2d-legend-placeholder" />
                        )}
                        <span className={selected ? "count selected" : "count"}>{count}</span>
                      </span>
                      <span className="sandbox2d-legend-name">{item.nameEn}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="sandbox2d-empty">
          <p>{submittedSearch !== "" ? t("sandbox2d.notFound") : t("sandbox2d.noData")}</p>
          <button type="button" onClick={handleViewOtherMaterials}>
            {t("sandbox2d.viewOtherMaterials")}
          </button>
        </div>
      )}
    </div>
  );
}
