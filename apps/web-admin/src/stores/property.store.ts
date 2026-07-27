import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Cơ sở đang chọn (PropertySwitcher) — data-hook lọc theo property này.
 *
 * Ghi nhớ trên máy để bỏ bớt một tầng chờ ở cold start: trước đây `selectedId`
 * luôn khởi tạo `null` và chỉ được set SAU khi `GET /properties` trả về, mà 7 hook
 * ở trang chủ đều `enabled: !!propertyId` — thành ra mỗi lần tải app đều là
 * refresh → properties → 7 request, tuần tự ba tầng.
 *
 * Lưu KÈM `userId` chứ không lưu id trần. `GET /properties` scope theo user, nên
 * ngay trong CÙNG tenant, id đã ghi nhớ vẫn có thể là cơ sở mà người đăng nhập sau
 * không có quyền. Khác user → coi như chưa ghi nhớ. (RLS ở tầng DB đã chặn rò dữ
 * liệu; guard này để UI không bắn 7 request vào một id vô nghĩa.)
 *
 * Không đọc `localStorage` lúc render: page là client component nhưng Next VẪN SSR
 * chúng, nên đọc trong initializer sẽ lệch hydration. Để `persist` rehydrate trong
 * effect như mặc định — `selectedId` là `null` ở render đầu rồi có giá trị ở tick
 * sau, chậm một nhịp render chứ không tốn thêm round-trip nào.
 */
interface PropertyState {
  selectedId: string | null;
  /** Chủ sở hữu của `selectedId` — dùng để loại giá trị của người dùng khác. */
  ownerUserId: string | null;
  setSelected: (id: string | null, userId?: string | null) => void;
  clearSelected: () => void;
}

export const usePropertyStore = create<PropertyState>()(
  persist(
    (set) => ({
      selectedId: null,
      ownerUserId: null,
      setSelected: (selectedId, ownerUserId = null) => set({ selectedId, ownerUserId }),
      clearSelected: () => set({ selectedId: null, ownerUserId: null }),
    }),
    {
      name: 'pms.selected-property',
      partialize: (s) => ({ selectedId: s.selectedId, ownerUserId: s.ownerUserId }),
    },
  ),
);
