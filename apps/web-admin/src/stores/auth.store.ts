import { create } from 'zustand';
import { type UserRole } from '@pms/shared-types';

/**
 * Access token + CSRF token giữ IN-MEMORY (docs/13 §3 — KHÔNG localStorage);
 * refresh token nằm trong cookie HTTP-only do BE set. `status` để auth-gate biết
 * đã bootstrap xong chưa (idle → đang thử refresh; authenticated/unauthenticated).
 */
export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

export type AuthStatus = 'idle' | 'authenticated' | 'unauthenticated';

interface AuthState {
  accessToken: string | null;
  csrfToken: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  setSession: (s: { accessToken: string; csrfToken: string; user: AuthUser }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  csrfToken: null,
  user: null,
  status: 'idle',
  setSession: ({ accessToken, csrfToken, user }) =>
    set({ accessToken, csrfToken, user, status: 'authenticated' }),
  clear: () => set({ accessToken: null, csrfToken: null, user: null, status: 'unauthenticated' }),
}));
