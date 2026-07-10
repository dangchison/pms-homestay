'use client';

import { useState } from 'react';
import { Button, cn, toast } from '@pms/ui';
import { Download, Printer } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { currentMonth, monthRange } from '@/lib/reports-period';
import { useT } from '@/lib/i18n';
import { useExportReportsXlsx } from '@/lib/hooks/use-reports';
import { useProperties } from '@/lib/hooks/use-properties';
import { usePropertyStore } from '@/stores/property.store';
import { AntiFraudReport } from '@/components/reports/AntiFraudReport';
import { BreakEvenReport } from '@/components/reports/BreakEvenReport';
import { LandlordStatementReport } from '@/components/reports/LandlordStatementReport';
import { OccupancyReport } from '@/components/reports/OccupancyReport';
import { PnlReport } from '@/components/reports/PnlReport';

type Tab = 'pnl' | 'break-even' | 'occupancy' | 'landlord' | 'anti-fraud';

/** R1–R3 (task 6.5) + Landlord/Anti-fraud (Đợt 2/2.4). Tab Landlord chỉ hiện với cơ sở R2R. */
export default function ReportsPage() {
  const t = useT();
  const propertyId = usePropertyStore((s) => s.selectedId);
  const { data: properties } = useProperties();
  const [tab, setTab] = useState<Tab>('pnl');
  const [month, setMonth] = useState(() => currentMonth(new Date()));
  const exportXlsx = useExportReportsXlsx();

  const isRentToRent = properties?.find((p) => p.id === propertyId)?.is_rent_to_rent ?? false;

  // Landlord chỉ khả dụng khi cơ sở là rent-to-rent (else BE trả 422) → ẩn tab.
  const tabs: { key: Tab; label: string }[] = [
    { key: 'pnl', label: 'P&L' },
    { key: 'break-even', label: 'Điểm hoà vốn' },
    { key: 'occupancy', label: 'Lấp đầy' },
    ...(isRentToRent ? [{ key: 'landlord' as Tab, label: 'Chủ nhà (R2R)' }] : []),
    { key: 'anti-fraud', label: 'Chống thất thoát' },
  ];
  // Nếu tab đang chọn không còn khả dụng (đổi sang cơ sở không R2R) → về P&L.
  const activeTab: Tab = tabs.some((tb) => tb.key === tab) ? tab : 'pnl';

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
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={cn(
              'px-3 py-2 text-sm transition-colors',
              activeTab === tb.key
                ? 'border-b-2 border-primary font-medium text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {activeTab === 'pnl' && <PnlReport propertyId={propertyId} month={month} />}
      {activeTab === 'break-even' && <BreakEvenReport propertyId={propertyId} period={month} />}
      {activeTab === 'occupancy' && <OccupancyReport propertyId={propertyId} month={month} />}
      {activeTab === 'landlord' && (
        <LandlordStatementReport propertyId={propertyId} month={month} isRentToRent={isRentToRent} />
      )}
      {activeTab === 'anti-fraud' && <AntiFraudReport propertyId={propertyId} month={month} />}
    </PageContainer>
  );
}
