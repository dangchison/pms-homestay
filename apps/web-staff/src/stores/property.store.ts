import { create } from 'zustand';

/**
 * Cơ sở đang chọn cho web-staff. Nhân viên thường gắn với 1 cơ sở; mặc định lấy
 * cơ sở đầu tiên truy cập được (use-properties tự set), có thể đổi ở Cá nhân.
 */
interface PropertyState {
  selectedId: string | null;
  setSelected: (id: string) => void;
}

export const usePropertyStore = create<PropertyState>((set) => ({
  selectedId: null,
  setSelected: (selectedId) => set({ selectedId }),
}));
