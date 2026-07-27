'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pms/ui';
import { useT } from '@/lib/i18n';
import { useProperties } from '@/lib/hooks/use-properties';
import { useAuthStore } from '@/stores/auth.store';
import { usePropertyStore } from '@/stores/property.store';

/**
 * PropertySwitcher (docs/13 §3) — đọc /properties (TanStack Query), lưu cơ sở chọn
 * vào store. Auto-chọn cơ sở đầu khi nạp. Select (@pms/ui) cho đồng bộ + accessible.
 */
export function PropertySwitcher() {
  const t = useT();
  const { data: properties, isLoading } = useProperties();
  const { selectedId, ownerUserId, setSelected } = usePropertyStore();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!properties || !userId) return;
    // Giá trị ghi nhớ chỉ dùng được khi ĐÚNG người dùng này VÀ cơ sở vẫn còn trong
    // danh sách họ được thấy. Một điều kiện bao cả ba trường hợp hỏng: id của tài
    // khoản trước trên cùng máy, cơ sở đã bị xoá, và role vừa bị thu hồi.
    const stillValid =
      selectedId !== null && ownerUserId === userId && properties.some((p) => p.id === selectedId);
    if (stillValid) return;
    setSelected(properties[0]?.id ?? null, userId);
  }, [properties, selectedId, ownerUserId, userId, setSelected]);

  if (isLoading) {
    return <span className="text-sm text-muted-foreground">{t('property.loading')}</span>;
  }

  // Chưa có cơ sở nào: KHÔNG dựng Select. Trước đây vẫn dựng, nên người vừa đăng ký
  // thấy ô "Chọn cơ sở" mà bấm vào chỉ mở ra một dropdown trống — vừa không nói được
  // gì, vừa không có lối ra. Thay bằng đúng một lối đi tới màn thiết lập.
  if (properties && properties.length === 0) {
    return (
      <Link
        href="/properties?setup=1"
        className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
      >
        <Building2 className="size-4 shrink-0" />
        {t('property.createFirst')}
      </Link>
    );
  }

  return (
    <Select value={selectedId ?? ''} onValueChange={(v) => setSelected(v || null, userId)}>
      <SelectTrigger
        aria-label={t('property.placeholder')}
        className="h-auto max-w-[15rem] gap-2 rounded-lg border-border bg-surface px-3 py-2 font-medium hover:bg-accent"
      >
        <Building2 className="size-4 shrink-0 text-primary" />
        <SelectValue placeholder={t('property.placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {properties?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
