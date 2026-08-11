'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Bật animation "khớp" khi khối vào khung nhìn, một lần duy nhất.
 *
 * Nội dung hiện SẴN theo mặc định — class `.reconcile` chỉ được gắn thêm khi đã
 * vào tầm mắt. Làm ngược lại (ẩn rồi chờ JS) thì trình duyệt chặn script hay lỗi
 * hydrate là trang trắng, và người dùng `prefers-reduced-motion` mất nội dung.
 */
export function Reconcile({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '-12% 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return (
    <div ref={ref} className={`${seen ? 'reconcile ' : ''}${className}`}>
      {children}
    </div>
  );
}
