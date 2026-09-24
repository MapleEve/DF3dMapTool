import { create } from 'zustand';
import { POI_CATEGORY_IDS, type PoiCategoryId } from '@/poi';

interface PoiFilterStoreState {
  /** 被隐藏的分类；不在其中即显示。 */
  hiddenCategories: readonly PoiCategoryId[];
  toggleCategory: (categoryId: PoiCategoryId) => void;
  showAllCategories: () => void;
  hideAllCategories: () => void;
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
  hideAllCategories: () => set({ hiddenCategories: [...POI_CATEGORY_IDS] }),
}));
