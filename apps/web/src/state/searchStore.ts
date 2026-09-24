import { create } from "zustand";

interface SearchStoreState {
  query: string;
  setQuery: (query: string) => void;
  clearQuery: () => void;
}

export const useSearchStore = create<SearchStoreState>()((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
  clearQuery: () => set({ query: "" }),
}));
