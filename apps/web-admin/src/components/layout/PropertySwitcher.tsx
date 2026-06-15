'use client';

import { useEffect } from 'react';
import { Building2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pms/ui';
import { useT } from '@/lib/i18n';
import { useProperties } from '@/lib/hooks/use-properties';
import { usePropertyStore } from '@/stores/property.store';

/**
 * PropertySwitcher (docs/13 §3) — đọc /properties (TanStack Query), lưu cơ sở chọn
 * vào store. Auto-chọn cơ sở đầu khi nạp. Select (@pms/ui) cho đồng bộ + accessible.
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
    <Select value={selectedId ?? ''} onValueChange={(v) => setSelected(v || null)}>
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
