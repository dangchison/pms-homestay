'use client';

import { useEffect } from 'react';
import { Building2, ChevronsUpDown } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useProperties } from '@/lib/hooks/use-properties';
import { usePropertyStore } from '@/stores/property.store';

/**
 * PropertySwitcher (docs/13 §3) — đọc /properties (TanStack Query), lưu cơ sở chọn
 * vào store. Auto-chọn cơ sở đầu khi nạp. Select gốc cho gọn + accessible.
 */
export function PropertySwitcher() {
  const t = useT();
  const { data: properties, isLoading } = useProperties();
  const { selectedId, setSelected } = usePropertyStore();

  useEffect(() => {
    if (!selectedId && properties && properties.length > 0) setSelected(properties[0]!.id);
  }, [properties, selectedId, setSelected]);

  if (isLoading) {
    return <span className="text-sm text-muted-foreground">{t('property.loading')}</span>;
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:bg-accent">
      <Building2 className="size-4 shrink-0 text-primary" />
      <select
        aria-label={t('property.placeholder')}
        value={selectedId ?? ''}
        onChange={(e) => setSelected(e.target.value || null)}
        className="max-w-[12rem] cursor-pointer truncate bg-transparent font-medium outline-none"
      >
        <option value="" disabled>
          {t('property.placeholder')}
        </option>
        {properties?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
    </div>
  );
}
