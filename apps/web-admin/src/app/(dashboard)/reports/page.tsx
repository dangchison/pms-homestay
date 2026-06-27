'use client';

import { useState } from 'react';
import { Button, cn, toast } from '@pms/ui';
import { Download, Printer } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { currentMonth, monthRange } from '@/lib/reports-period';
import { useT } from '@/lib/i18n';
import { useExportReportsXlsx } from '@/lib/hooks/use-reports';
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
  const exportXlsx = useExportReportsXlsx();

  const onExport = () => {
    if (!propertyId) return;
    const { from, to } = monthRange(month);
    exportXlsx.mutate(
      { propertyId, from, to },
      { onError: () => toast.error('Không xuất được Excel') },
    );
  };

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
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none print:hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="print:hidden"
            >
              <Printer className="size-4" />
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={exportXlsx.isPending}
              className="print:hidden"
            >
              <Download className="size-4" />
              {exportXlsx.isPending ? 'Đang xuất…' : 'Excel'}
            </Button>
          </div>
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
