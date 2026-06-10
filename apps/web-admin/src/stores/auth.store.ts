import { create } from 'zustand';

/**
 * Access token giữ IN-MEMORY (docs/13 §3 — không localStorage);
 * refresh token nằm trong cookie HTTP-only do BE set.
 * TODO(task 1.7): login/logout/refresh actions gọi api-client.
 */
interface AuthState {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
}));
