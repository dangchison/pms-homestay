import { create } from 'zustand';

/** Cơ sở đang chọn (PropertySwitcher) — data-hook lọc theo property này. */
interface PropertyState {
  selectedId: string | null;
  setSelected: (id: string | null) => void;
}

export const usePropertyStore = create<PropertyState>((set) => ({
  selectedId: null,
  setSelected: (selectedId) => set({ selectedId }),
}));
