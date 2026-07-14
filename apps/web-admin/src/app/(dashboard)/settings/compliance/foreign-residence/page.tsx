'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Skeleton, toast } from '@pms/ui';
import { ArrowLeft, Download, Loader2, Send } from 'lucide-react';
import type { ForeignResidenceResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import {
  foreignResidenceStatusLabel,
  foreignResidenceStatusVariant,
  visaMask,
  visaTypeLabel,
} from '@/lib/foreign-residence-format';
import { useGuest } from '@/lib/hooks/use-bookings';
import {
  useDownloadNa17,
  useForeignResidences,
  useSubmitForeignResidence,
} from '@/lib/hooks/use-foreign-residence';
import { useProperties } from '@/lib/hooks/use-properties';
import { ForeignResidenceFormDialog } from '@/components/compliance/ForeignResidenceFormDialog';
import { usePropertyStore } from '@/stores/property.store';

/**
 * Task 2.8 (docs/19 §3 Đợt 2) — trang con /settings/compliance/foreign-residence: khai
 * báo tạm trú khách nước ngoài (NA17). Nằm TRONG Settings layout (header 'Tuân thủ' +
 * SettingsNav khớp qua pathname.startsWith('/settings/compliance')) → KHÔNG bọc thêm
 * PageContainer. Danh sách theo cơ sở đang chọn (usePropertyStore, như PoliceReportCard).
 * PII: chỉ hiện ≤4 số cuối visa (visaMask); tải NA17 qua getBlob (Bearer).
 */
export default function ForeignResidencePage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const { data: properties } = useProperties();
  const propName = properties?.find((p) => p.id === propertyId)?.name;

  const { data, isLoading, isError, error } = useForeignResidences(propertyId);
  const rows = data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ForeignResidenceResponse | null>(null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <Link
            href="/settings/compliance"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Tuân thủ
          </Link>
          <h2 className="text-lg font-semibold">Khai báo tạm trú khách nước ngoài (NA17)</h2>
          <p className="text-sm text-muted-foreground">
            Nghĩa vụ riêng với khách nước ngoài (Cục Quản lý xuất nhập cảnh) — cơ sở{' '}
            <strong>{propName ?? '(chưa chọn)'}</strong>. Số thị thực chỉ hiện 4 số cuối.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!propertyId}>
          Thêm khai báo
        </Button>
      </div>

      {!propertyId ? (
        <p className="text-sm text-muted-foreground">Chọn cơ sở ở thanh trên để xem khai báo.</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiClientError && error.status === 403
            ? 'Bạn không có quyền xem khai báo tạm trú.'
            : 'Không tải được danh sách khai báo. Thử lại sau.'}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Khách</th>
                <th className="px-3 py-2 font-medium">Loại thị thực</th>
                <th className="px-3 py-2 font-medium">Số thị thực</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có khai báo tạm trú nào cho cơ sở này. Bấm “Thêm khai báo” để tạo.
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <DeclarationRow key={d.id} decl={d} onEdit={() => setEditTarget(d)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && propertyId && (
        <ForeignResidenceFormDialog propertyId={propertyId} onClose={() => setCreateOpen(false)} />
      )}
      {editTarget && propertyId && (
        <ForeignResidenceFormDialog
          propertyId={propertyId}
          declaration={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * 1 dòng khai báo. ForeignResidenceResponse KHÔNG kèm tên khách → useGuest(guest_id).
 * Khoá sửa sau SUBMITTED (nút 'Sửa' disabled); 'Gửi XNC' chỉ hiện khi CHƯA gửi.
 */
function DeclarationRow({
  decl,
  onEdit,
}: {
  decl: ForeignResidenceResponse;
  onEdit: () => void;
}) {
  const { data: guest } = useGuest(decl.guest_id);
  const submit = useSubmitForeignResidence();
  const download = useDownloadNa17();
  const isSubmitted = decl.status === 'SUBMITTED';

  const onSubmitXnc = async () => {
    try {
      const res = await submit.mutateAsync(decl.id);
      if (res.status === 'SUBMITTED') {
        toast.success(`Đã gửi XNC${res.xnc_reference ? ` — ${res.xnc_reference}` : ''}`);
      } else {
        toast.error(`Gửi XNC thất bại: ${res.failure_reason ?? 'thiếu dữ liệu bắt buộc'}`);
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Gửi XNC thất bại');
    }
  };

  const onDownload = async () => {
    try {
      await download.mutateAsync(decl.id);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Tải NA17 thất bại');
    }
  };

  return (
    <tr>
      <td className="px-3 py-2 font-medium">{guest?.full_name ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{visaTypeLabel(decl.visa_type)}</td>
      <td className="px-3 py-2 tabular-nums">{visaMask(decl.visa_number_last4)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <Badge variant={foreignResidenceStatusVariant(decl.status)} className="w-fit">
            {foreignResidenceStatusLabel(decl.status)}
          </Badge>
          {decl.xnc_reference && (
            <span className="text-xs text-muted-foreground">{decl.xnc_reference}</span>
          )}
          {decl.failure_reason && (
            <span className="text-xs text-destructive">{decl.failure_reason}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          {!isSubmitted && (
            <Button size="sm" variant="ghost" disabled={submit.isPending} onClick={onSubmitXnc}>
              {submit.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Gửi XNC
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={download.isPending} onClick={onDownload}>
            {download.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Tải NA17
          </Button>
          <Button size="sm" variant="ghost" disabled={isSubmitted} onClick={onEdit}>
            Sửa
          </Button>
        </div>
      </td>
    </tr>
  );
}
