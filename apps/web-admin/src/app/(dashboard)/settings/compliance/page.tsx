'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  type DateRange,
  DateRangePicker,
  Input,
  Label,
  toast,
} from '@pms/ui';
import { Download, FileSpreadsheet, Loader2, Search, ShieldAlert } from 'lucide-react';
import type { GuestResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { GuestDataRightsSection } from '@/components/compliance/GuestDataRightsSection';
import { useGuestsSearch } from '@/lib/hooks/use-guests';
import { useProperties } from '@/lib/hooks/use-properties';
import { useDownloadPoliceReport } from '@/lib/hooks/use-compliance';
import { usePropertyStore } from '@/stores/property.store';

/** S6 /settings/compliance — báo cáo lưu trú TT56 + quyền chủ thể dữ liệu NĐ13. */
export default function CompliancePage() {
  return (
    <div className="grid gap-4">
      <PoliceReportCard />
      <GuestDataRightsCard />
    </div>
  );
}

function PoliceReportCard() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const { data: properties } = useProperties();
  const download = useDownloadPoliceReport();
  const [range, setRange] = useState<DateRange | undefined>();
  const propName = properties?.find((p) => p.id === propertyId)?.name;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const submit = async () => {
    if (!propertyId) {
      toast.error('Chọn cơ sở ở thanh trên');
      return;
    }
    if (!range?.from || !range?.to) {
      toast.error('Chọn khoảng thời gian');
      return;
    }
    try {
      await download.mutateAsync({ propertyId, from: ymd(range.from), to: ymd(range.to) });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Tải báo cáo thất bại');
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-primary" />
          <h2 className="font-semibold">Báo cáo lưu trú (TT56)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Xuất Excel danh sách khách lưu trú theo cơ sở <strong>{propName ?? '(chưa chọn)'}</strong> để khai báo công an.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Khoảng thời gian</Label>
            <DateRangePicker className="w-[18rem]" value={range} onChange={setRange} />
          </div>
          <Button onClick={submit} disabled={download.isPending}>
            {download.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Tải Excel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GuestDataRightsCard() {
  const [q, setQ] = useState('');
  const { data: results } = useGuestsSearch(q);
  const [guest, setGuest] = useState<GuestResponse | null>(null);

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-primary" />
          <h2 className="font-semibold">Quyền chủ thể dữ liệu (NĐ13)</h2>
        </div>

        <div className="relative sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Tìm khách (tên / SĐT / 4 số cuối)" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>

        {q.trim().length >= 2 && !guest && (
          <div className="grid gap-1">
            {(results ?? []).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => { setGuest(g); setQ(''); }}
                className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{g.full_name}</span>
                <span className="ml-2 text-muted-foreground">{g.phone ?? g.id_document_masked ?? ''}</span>
              </button>
            ))}
            {(results?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">Không tìm thấy.</p>}
          </div>
        )}

        {guest && <GuestActions guest={guest} onClear={() => setGuest(null)} />}
      </CardContent>
    </Card>
  );
}

function GuestActions({ guest, onClear }: { guest: GuestResponse; onClear: () => void }) {
  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{guest.full_name}</span>
        <Button variant="ghost" size="sm" onClick={onClear}>Đổi khách</Button>
      </div>

      <Label className="text-xs">Đồng ý xử lý dữ liệu</Label>
      <GuestDataRightsSection guestId={guest.id} />
    </div>
  );
}
