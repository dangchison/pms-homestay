'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Ca thu ngân MỞ cục bộ (task 2.10b, docs/16 #10). STAFF thu ngân KHÔNG có
 * `report.financial` nên KHÔNG GET được /shifts — nguồn "đang có ca mở hay chưa"
 * của web-staff là localStorage, ghi khi mở ca / xoá khi đóng (hoặc lệch state).
 * Persist khoá `pms.staff.shift`, tách theo cơ sở (một ca mở / cơ sở).
 */
export interface OpenShiftLocal {
  shiftId: string;
  version: number;
  openingFloatVnd: number;
  openedAt: string;
}

interface ShiftState {
  byProperty: Record<string, OpenShiftLocal>;
  setOpen: (propertyId: string, shift: OpenShiftLocal) => void;
  clearOpen: (propertyId: string) => void;
}

export const useShiftStore = create<ShiftState>()(
  persist(
    (set) => ({
      byProperty: {},
      setOpen: (propertyId, shift) =>
        set((s) => ({ byProperty: { ...s.byProperty, [propertyId]: shift } })),
      clearOpen: (propertyId) =>
        set((s) => {
          if (!(propertyId in s.byProperty)) return s;
          const next = { ...s.byProperty };
          delete next[propertyId];
          return { byProperty: next };
        }),
    }),
    {
      name: 'pms.staff.shift',
      // localStorage: SSR-safe — createJSONStorage try/catch → server thành no-op.
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
