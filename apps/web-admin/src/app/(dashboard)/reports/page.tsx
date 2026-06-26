'use client';

import { useState } from 'react';
import { cn } from '@pms/ui';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { currentMonth } from '@/lib/reports-period';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { BreakEvenReport } from '@/components/reports/BreakEvenReport';
import { OccupancyReport } from '@/components/reports/OccupancyReport';
import { PnlReport } from '@/components/reports/PnlReport';

type Tab = 'pnl' | 'break-even' | 'occupancy';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pnl', label: 'P&L' },
  { key: 'break-even', label: 'Điểm hoà vốn' },
  { key: 'occupancy', label: 'Lấp đầy' },
];

/** R1–R3 /reports (task 6.5): P&L + break-even + occupancy (tabs, đọc rollup đêm). */
export default function ReportsPage() {
  const t = useT();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [tab, setTab] = useState<Tab>('pnl');
  const [month, setMonth] = useState(() => currentMonth(new Date()));

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Báo cáo" />
        <p className="text-sm text-muted-foreground">{t('calendar.selectProperty')}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Báo cáo"
        action={
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none"
          />
        }
      />

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={cn(
              'px-3 py-2 text-sm transition-colors',
              tab === tb.key
                ? 'border-b-2 border-primary font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'pnl' && <PnlReport propertyId={propertyId} month={month} />}
      {tab === 'break-even' && <BreakEvenReport propertyId={propertyId} period={month} />}
      {tab === 'occupancy' && <OccupancyReport propertyId={propertyId} month={month} />}
    </PageContainer>
  );
}
