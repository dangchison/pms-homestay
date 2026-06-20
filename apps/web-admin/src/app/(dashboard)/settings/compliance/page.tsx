'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  type DateRange,
  DateRangePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  toast,
} from '@pms/ui';
import { Download, FileSpreadsheet, Loader2, Search, ShieldAlert } from 'lucide-react';
import type { DataErasureResponse, GuestResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useGuestsSearch } from '@/lib/hooks/use-guests';
import { useProperties } from '@/lib/hooks/use-properties';
import {
  useConsents,
  useDownloadGuestExport,
  useDownloadPoliceReport,
  useEraseGuest,
  useRevokeConsent,
} from '@/lib/hooks/use-compliance';
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
  const { data: consents } = useConsents(guest.id);
  const revoke = useRevokeConsent(guest.id);
  const exportData = useDownloadGuestExport();
  const erase = useEraseGuest();
  const [confirmErase, setConfirmErase] = useState(false);
  const [eraseResult, setEraseResult] = useState<DataErasureResponse | null>(null);

  const doErase = async () => {
    try {
      const res = await erase.mutateAsync(guest.id);
      setEraseResult(res);
      setConfirmErase(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Ẩn danh thất bại');
    }
  };

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{guest.full_name}</span>
        <Button variant="ghost" size="sm" onClick={onClear}>Đổi khách</Button>
      </div>

      <div className="grid gap-1">
        <Label className="text-xs">Đồng ý xử lý dữ liệu</Label>
        {(consents?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có ghi nhận consent.</p>
        ) : (
          consents!.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span>
                {c.consent_type}{' '}
                {c.revoked_at ? <Badge variant="outline" className="text-[10px]">đã thu hồi</Badge> : <Badge variant="secondary" className="text-[10px]">hiệu lực</Badge>}
              </span>
              {!c.revoked_at && (
                <Button variant="ghost" size="sm" className="text-destructive" disabled={revoke.isPending} onClick={() => void revoke.mutateAsync(c.id)}>
                  Thu hồi
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={exportData.isPending} onClick={() => void exportData.mutateAsync(guest.id)}>
          {exportData.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Tải dữ liệu (zip)
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmErase(true)}>
          Ẩn danh khách
        </Button>
      </div>

      {/* Xác nhận ẩn danh */}
      <Dialog open={confirmErase} onOpenChange={setConfirmErase}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ẩn danh dữ liệu khách?</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            Thao tác xoá/ẩn danh thông tin cá nhân theo NĐ13. Dữ liệu còn nghĩa vụ lưu trữ theo luật (hồ sơ công an,
            hoá đơn) sẽ được GIỮ tới hết hạn (legal-hold). Không thể hoàn tác.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmErase(false)}>Huỷ</Button>
            <Button className="text-destructive" disabled={erase.isPending} onClick={doErase}>
              {erase.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Xác nhận ẩn danh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kết quả ẩn danh */}
      <Dialog open={!!eraseResult} onOpenChange={(o) => !o && setEraseResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kết quả ẩn danh</DialogTitle>
            <DialogDescription>Tóm tắt thao tác ẩn danh dữ liệu khách.</DialogDescription>
          </DialogHeader>
          {eraseResult && (
            <div className="grid gap-2 text-sm">
              <p>{eraseResult.anonymized ? 'Đã ẩn danh thông tin cá nhân.' : 'Chưa thể ẩn danh hoàn toàn do còn nghĩa vụ lưu trữ.'}</p>
              {eraseResult.legal_hold_until && (
                <p className="text-warning-foreground">Giữ hồ sơ tới: {eraseResult.legal_hold_until}</p>
              )}
              {eraseResult.kept.length > 0 && (
                <p className="text-muted-foreground">Dữ liệu giữ lại: {eraseResult.kept.join(', ')}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
