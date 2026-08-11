import { create } from 'zustand';

export interface PlatformAdmin {
  id: string;
  email: string;
  full_name: string;
}

interface AuthState {
  /**
   * Access token nền tảng, chỉ nằm trong bộ nhớ. Platform token sống 1h và BE
   * KHÔNG có endpoint refresh — cố tình không ghi vào localStorage/sessionStorage
   * để token không sống lâu hơn tab. Hệ quả: F5 là phải đăng nhập lại.
   */
  accessToken: string | null;
  admin: PlatformAdmin | null;
  /** Đã thử khôi phục phiên chưa — tránh nháy màn login khi app vừa mở. */
  ready: boolean;
  setSession: (token: string, admin: PlatformAdmin) => void;
  clear: () => void;
  markReady: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  admin: null,
  ready: false,
  setSession: (accessToken, admin) => set({ accessToken, admin, ready: true }),
  clear: () => set({ accessToken: null, admin: null, ready: true }),
  markReady: () => set({ ready: true }),
}));
