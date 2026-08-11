'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LoadingScreen } from '@pms/ui';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Chặn console khi chưa đăng nhập. Token nền tảng chỉ nằm trong bộ nhớ (xem
 * auth.store) nên không có gì để "khôi phục phiên" — tải lại trang là về /login.
 * Đổi lại token không sống sót ngoài tab, và BE cũng không có refresh cho nó.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!token) router.replace('/login');
  }, [token, router, pathname]);

  if (!token) return <LoadingScreen />;
  return <>{children}</>;
}
