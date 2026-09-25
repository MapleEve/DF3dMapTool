import { create } from "zustand";
import { POI_CATEGORY_IDS, type PoiCategoryId } from "@/poi";

interface PoiFilterStoreState {
  /** 被隐藏的分类；不在其中即显示。 */
  hiddenCategories: readonly PoiCategoryId[];
  toggleCategory: (categoryId: PoiCategoryId) => void;
  showAllCategories: () => void;
  /**
   * 全部隐藏：入参为当前分类 id 集（数据包派生 t<TypeId> 或内置兜底表）；
   * 缺省回退内置表（数据未加载场景），避免只隐藏兜底分类而漏掉运行时分类。
   */
  hideAllCategories: (categoryIds?: readonly PoiCategoryId[]) => void;
}

export const usePoiFilterStore = create<PoiFilterStoreState>()((set) => ({
  hiddenCategories: [],
  toggleCategory: (categoryId) =>
    set((state) => ({
      hiddenCategories: state.hiddenCategories.includes(categoryId)
        ? state.hiddenCategories.filter((id) => id !== categoryId)
        : [...state.hiddenCategories, categoryId],
    })),
  showAllCategories: () => set({ hiddenCategories: [] }),
  hideAllCategories: (categoryIds) =>
    set({ hiddenCategories: [...(categoryIds ?? POI_CATEGORY_IDS)] }),
}));
