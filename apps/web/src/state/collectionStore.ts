import { create } from "zustand";
import { loadCollectionData, type CollectionData, type CollectionRoll } from "@/data/routes";

/**
 * 收藏（物资）面板状态：F 键近旁物资 POI 触发，展示该点位的概率刷新内容
 * （数据包 roll 表：RollCollections × RollWeights × RollMaxNumber）。
 *
 * 估值口径（如实呈现）：源数据 CollectionConfig 无交易价值字段
 * （管线全量扫描与运行时网络日志均无估值来源），面板不呈现任何估值数值，
 * 仅物品名/副标题/品质与抽取权重；收藏标记为本地偏好（localStorage）。
 */

export const FAVORITES_STORAGE_KEY = "df3dmaptool:collectionFavorites";

/** 面板当前展示的物资条目（含抽取权重）。 */
export interface RolledItem {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly quality: number;
  readonly subTitle: string;
  readonly description: string;
  /** 抽取权重（数据包原值）。 */
  readonly weight: number;
}

/** 收藏数据加载状态。 */
export type CollectionDataStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * 按 roll 表抽取一组物资（加权不放回抽样，数量 = rollMaxNumber；
 * 表内物品数不足时全量返回）。rng 可注入以便测试。
 */
export function rollCollectionItems(
  roll: CollectionRoll,
  data: CollectionData,
  rng: () => number = Math.random,
): RolledItem[] {
  const pool = roll.rollCollections
    .map((id, index) => ({
      item: data.itemById.get(id),
      weight: roll.rollWeights[index] ?? 0,
    }))
    .filter(
      (entry): entry is { item: CollectionData["items"][number]; weight: number } =>
        entry.item !== undefined && entry.weight > 0,
    );
  if (pool.length === 0) {
    return [];
  }
  let totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const out: RolledItem[] = [];
  let available = [...pool];
  const count = Math.min(roll.rollMaxNumber, pool.length);
  for (let i = 0; i < count && available.length > 0; i += 1) {
    let pick = rng() * totalWeight;
    let chosenIndex = available.length - 1;
    for (let j = 0; j < available.length; j += 1) {
      pick -= available[j].weight;
      if (pick <= 0) {
        chosenIndex = j;
        break;
      }
    }
    const chosen = available[chosenIndex];
    if (chosen.item === undefined) {
      continue;
    }
    out.push({ ...chosen.item, weight: chosen.weight });
    totalWeight -= chosen.weight;
    available = available.filter((_, j) => j !== chosenIndex);
  }
  return out;
}

/** 读取本地收藏（物品 id 列表；解析失败回退空表）。 */
export function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 持久化失败不阻塞交互。
  }
}

let dataPromise: Promise<CollectionData | null> | null = null;

interface CollectionStoreState {
  /** 共享收藏数据（collection.dmap）；null = 未就绪。 */
  data: CollectionData | null;
  dataStatus: CollectionDataStatus;
  /** 面板开关。 */
  open: boolean;
  /** 触发面板的 POI id（null = 未关联）。 */
  poiId: string | null;
  /** 当前面板关联的 roll 表 id（重抽用）。 */
  rollId: number | null;
  /** 当前展示的条目（上次抽取结果）。 */
  items: readonly RolledItem[];
  /** 选中的条目（右侧详情）。 */
  selectedItemId: string | null;
  /** 收藏的物品 id（本地偏好）。 */
  favorites: readonly string[];
  /** 收藏视图开关（面板内切换）。 */
  favoritesView: boolean;
  ensureData: () => Promise<CollectionData | null>;
  openPanel: (poiId: string, rollId: number, data: CollectionData) => void;
  closePanel: () => void;
  selectItem: (itemId: string | null) => void;
  /** 重抽（刷新）：按当前 roll 表再抽一次。 */
  reroll: (rng?: () => number) => void;
  toggleFavorite: (itemId: string) => void;
  setFavoritesView: (open: boolean) => void;
}

export const useCollectionStore = create<CollectionStoreState>()((set, get) => ({
  data: null,
  dataStatus: "idle",
  open: false,
  poiId: null,
  rollId: null,
  items: [],
  selectedItemId: null,
  favorites: readFavorites(),
  favoritesView: false,

  ensureData: () => {
    const current = get().data;
    if (current !== null) {
      return Promise.resolve(current);
    }
    set({ dataStatus: "loading" });
    let promise = dataPromise;
    if (promise === null) {
      promise = loadCollectionData()
        .then((data) => {
          set({ data, dataStatus: "ready" });
          return data;
        })
        .catch(() => {
          dataPromise = null;
          set({ dataStatus: "unavailable" });
          return null;
        });
      dataPromise = promise;
    }
    return promise;
  },

  openPanel: (poiId, rollId, data) => {
    const roll = data.rollById.get(rollId);
    if (roll === undefined) {
      // roll 表缺失（数据缺口）：呈现空态，不编造内容。
      set({ open: true, poiId, rollId, favoritesView: false, selectedItemId: null, items: [] });
      return;
    }
    set({
      open: true,
      poiId,
      rollId,
      favoritesView: false,
      selectedItemId: null,
      items: rollCollectionItems(roll, data),
    });
  },

  closePanel: () =>
    set({ open: false, favoritesView: false, items: [], poiId: null, rollId: null }),

  selectItem: (selectedItemId) => set({ selectedItemId }),

  reroll: (rng) => {
    const { data, rollId } = get();
    if (data === null || rollId === null) {
      return;
    }
    const roll = data.rollById.get(rollId);
    if (roll === undefined) {
      set({ items: [] });
      return;
    }
    set({ items: rollCollectionItems(roll, data, rng) });
  },

  toggleFavorite: (itemId) => {
    const current = get().favorites;
    const next = current.includes(itemId)
      ? current.filter((id) => id !== itemId)
      : [...current, itemId];
    writeFavorites(next);
    set({ favorites: next });
  },

  setFavoritesView: (favoritesView) => set({ favoritesView }),
}));
