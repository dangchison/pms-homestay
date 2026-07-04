'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@pms/ui';
import { Download, Loader2 } from 'lucide-react';
import type { DataErasureResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import {
  useConsents,
  useDownloadGuestExport,
  useEraseGuest,
  useRevokeConsent,
} from '@/lib/hooks/use-compliance';

/**
 * Khu quyền chủ thể dữ liệu NĐ13 dùng chung — liệt kê + thu hồi consent, xuất dữ liệu (zip),
 * ẩn danh (confirm + kết quả). Tái dùng ở GuestDetailDialog (task 1.4) và settings/compliance (S6).
 * Chỉ render phần lõi lặp lại; khung ngoài (border/label/header) do nơi gọi tự bọc. Chữ khác nhau
 * giữa hai nơi truyền qua props để không đổi wording hiện có.
 */
export function GuestDataRightsSection({
  guestId,
  emptyConsentText = 'Chưa có ghi nhận consent.',
  exportLabel = 'Tải dữ liệu (zip)',
  eraseLabel = 'Ẩn danh khách',
}: {
  guestId: string;
  emptyConsentText?: string;
  exportLabel?: string;
  eraseLabel?: string;
}) {
  const { data: consents } = useConsents(guestId);
  const revoke = useRevokeConsent(guestId);
  const exportData = useDownloadGuestExport();
  const erase = useEraseGuest();
  const [confirmErase, setConfirmErase] = useState(false);
  const [eraseResult, setEraseResult] = useState<DataErasureResponse | null>(null);

  const doExport = async () => {
    try {
      await exportData.mutateAsync(guestId);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Xuất dữ liệu thất bại');
    }
  };

  const doErase = async () => {
    try {
      const res = await erase.mutateAsync(guestId);
      setEraseResult(res);
      setConfirmErase(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Ẩn danh thất bại');
    }
  };

  return (
    <>
      <div className="grid gap-1">
        {(consents?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyConsentText}</p>
        ) : (
          consents!.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {c.consent_type}
                {c.revoked_at ? (
                  <Badge variant="outline" className="text-[10px]">
                    đã thu hồi
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    hiệu lực
                  </Badge>
                )}
              </span>
              {!c.revoked_at && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={revoke.isPending}
                  onClick={() => void revoke.mutateAsync(c.id)}
                >
                  Thu hồi
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={exportData.isPending} onClick={doExport}>
          {exportData.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {exportLabel}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => setConfirmErase(true)}
        >
          {eraseLabel}
        </Button>
      </div>

      {/* Xác nhận ẩn danh */}
      <Dialog open={confirmErase} onOpenChange={setConfirmErase}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ẩn danh dữ liệu khách?</DialogTitle>
            <DialogDescription>
              Thao tác xoá/ẩn danh thông tin cá nhân theo NĐ13. Dữ liệu còn nghĩa vụ lưu trữ theo
              luật (hồ sơ công an, hoá đơn) sẽ được GIỮ tới hết hạn (legal-hold). Không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmErase(false)}>
              Huỷ
            </Button>
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
              <p>
                {eraseResult.anonymized
                  ? 'Đã ẩn danh thông tin cá nhân.'
                  : 'Chưa thể ẩn danh hoàn toàn do còn nghĩa vụ lưu trữ.'}
              </p>
              {eraseResult.legal_hold_until && (
                <p className="text-warning-foreground">
                  Giữ hồ sơ tới: {eraseResult.legal_hold_until}
                </p>
              )}
              {eraseResult.kept.length > 0 && (
                <p className="text-muted-foreground">
                  Dữ liệu giữ lại: {eraseResult.kept.join(', ')}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
