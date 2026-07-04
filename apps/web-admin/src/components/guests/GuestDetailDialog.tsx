'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Separator,
  Textarea,
  toast,
} from '@pms/ui';
import { Eye, Loader2, ShieldAlert, ShieldOff } from 'lucide-react';
import type { GuestResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { maskEmail, maskPhone } from '@/lib/format';
import { useGuest } from '@/lib/hooks/use-bookings';
import {
  useBlacklistGuest,
  useGuestIdDocument,
  useUnblacklistGuest,
} from '@/lib/hooks/use-guests';
import { GuestDataRightsSection } from '@/components/compliance/GuestDataRightsSection';

/** Một dòng thông tin (label trái, giá trị phải). */
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Task 1.4 — chi tiết 1 khách (Dialog, KHÔNG điều hướng route). PII mask MẶC ĐỊNH
 * (maskPhone/id_document_masked/maskEmail); số giấy tờ đầy đủ CHỈ lấy khi bấm "Xem giấy
 * tờ đầy đủ" (mutation → BE ghi audit READ_PII). Có blacklist/unblacklist + quyền chủ thể
 * dữ liệu NĐ13 (consent/export/ẩn danh). @pms/ui không có Sheet → dùng Dialog.
 */
export function GuestDetailDialog({
  guest,
  onOpenChange,
}: {
  guest: GuestResponse | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!guest} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {guest && <GuestDetailBody guest={guest} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function GuestDetailBody({ guest, onClose }: { guest: GuestResponse; onClose: () => void }) {
  const idDoc = useGuestIdDocument();
  // Bản LIVE của khách (key ['guests', id]) — invalidate ['guests'] sau blacklist/unblacklist
  // refetch bản này → badge/lý-do trong dialog cập nhật (prop `guest` là ảnh chụp lúc mở list).
  const { data: liveGuest } = useGuest(guest.id);
  const g = liveGuest ?? guest;
  // Số giấy tờ đầy đủ CHỈ giữ trong state phiên xem hiện tại (không cache qua react-query).
  const [fullNumber, setFullNumber] = useState<string | null>(null);

  // Đổi khách → xoá số đã giải mã (không rò rỉ giữa các khách khi tái dùng Dialog).
  useEffect(() => {
    setFullNumber(null);
    idDoc.reset();
    // chỉ chạy khi đổi guest.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.id]);

  const revealFullId = async () => {
    try {
      const res = await idDoc.mutateAsync(guest.id);
      setFullNumber(res.id_document_number);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không xem được số giấy tờ');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {g.full_name}
          {g.is_blacklisted && (
            <Badge variant="destructive" className="text-[10px]">
              Blacklist
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription>Hồ sơ khách — thông tin cá nhân được che theo mặc định.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        {/* Thông tin liên hệ + giấy tờ (PII mask) */}
        <div className="grid gap-2 rounded-md border border-border p-3">
          <Field label="Số điện thoại" value={maskPhone(g.phone)} />
          <Field label="Email" value={maskEmail(g.email)} />
          <Field label="Quốc tịch" value={g.nationality ?? '—'} />
          <Field label="Loại giấy tờ" value={g.id_document_type ?? '—'} />
          <Field label="Số giấy tờ" value={fullNumber ?? g.id_document_masked ?? '—'} />

          {fullNumber === null ? (
            <div className="grid gap-1">
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                disabled={idDoc.isPending}
                onClick={revealFullId}
              >
                {idDoc.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Eye className="size-4" />
                )}
                Xem giấy tờ đầy đủ
              </Button>
              <p className="text-xs text-muted-foreground">
                Thao tác này được ghi nhật ký (READ_PII).
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Đã ghi nhật ký truy cập (READ_PII).</p>
          )}
        </div>

        <BlacklistSection guest={g} />

        <Separator />

        <Nd13Section guest={g} />

        <Separator />

        {/* Lịch sử lưu trú — hạn chế BE trung thực (KHÔNG bịa) */}
        <div className="grid gap-1">
          <Label className="text-xs">Lịch sử lưu trú</Label>
          <p className="text-sm text-muted-foreground">
            Chưa thể liệt kê booking của khách này: API /bookings hiện chưa hỗ trợ lọc theo khách
            (chỉ theo cơ sở / trạng thái / khoảng ngày).
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
      </DialogFooter>
    </>
  );
}

/** Khu blacklist: có lý-do + nút gỡ khi đang blacklist; nếu chưa thì confirm + lý-do bắt buộc. */
function BlacklistSection({ guest }: { guest: GuestResponse }) {
  const blacklist = useBlacklistGuest();
  const unblacklist = useUnblacklistGuest();
  const [confirmBlacklist, setConfirmBlacklist] = useState(false);
  const [confirmUnblacklist, setConfirmUnblacklist] = useState(false);
  const [reason, setReason] = useState('');

  const doBlacklist = async () => {
    const r = reason.trim();
    if (!r) return; // bắt buộc; nút cũng disable khi rỗng
    try {
      await blacklist.mutateAsync({ guestId: guest.id, reason: r });
      toast.success('Đã đưa khách vào blacklist');
      setConfirmBlacklist(false);
      setReason('');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không thể đưa vào blacklist');
    }
  };

  const doUnblacklist = async () => {
    try {
      await unblacklist.mutateAsync(guest.id);
      toast.success('Đã gỡ blacklist');
      setConfirmUnblacklist(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Không thể gỡ blacklist');
    }
  };

  return (
    <div className="grid gap-2">
      {guest.is_blacklisted ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge variant="destructive" className="mb-1">
                Blacklist
              </Badge>
              <p className="text-sm text-muted-foreground">
                Lý do: {guest.blacklist_reason ?? '—'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setConfirmUnblacklist(true)}
            >
              <ShieldOff className="size-4" />
              Gỡ blacklist
            </Button>
          </div>

          <Dialog open={confirmUnblacklist} onOpenChange={setConfirmUnblacklist}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Gỡ khách khỏi blacklist?</DialogTitle>
                <DialogDescription>
                  Khách sẽ trở lại bình thường và có thể đặt phòng như thường lệ.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmUnblacklist(false)}>
                  Huỷ
                </Button>
                <Button disabled={unblacklist.isPending} onClick={doUnblacklist}>
                  {unblacklist.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Xác nhận gỡ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start text-destructive"
            onClick={() => setConfirmBlacklist(true)}
          >
            <ShieldAlert className="size-4" />
            Đưa vào blacklist
          </Button>

          <Dialog open={confirmBlacklist} onOpenChange={setConfirmBlacklist}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Đưa khách vào blacklist?</DialogTitle>
                <DialogDescription>
                  Khách bị đánh dấu blacklist sẽ hiển thị cảnh báo khi đặt phòng. Nhập lý do bên dưới.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="blacklist-reason" className="text-xs">
                  Lý do (bắt buộc)
                </Label>
                <Textarea
                  id="blacklist-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ví dụ: gây rối, không thanh toán…"
                  rows={3}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmBlacklist(false)}>
                  Huỷ
                </Button>
                <Button
                  className="text-destructive"
                  disabled={blacklist.isPending || reason.trim().length === 0}
                  onClick={doBlacklist}
                >
                  {blacklist.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Xác nhận blacklist
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

/** Khu quyền chủ thể dữ liệu NĐ13 — tái dùng GuestDataRightsSection (chung với settings/compliance). */
function Nd13Section({ guest }: { guest: GuestResponse }) {
  return (
    <div className="grid gap-2">
      <Label className="text-xs">Quyền chủ thể dữ liệu (NĐ13)</Label>
      <GuestDataRightsSection
        guestId={guest.id}
        emptyConsentText="Chưa có ghi nhận đồng ý xử lý dữ liệu."
        exportLabel="Xuất dữ liệu (zip)"
        eraseLabel="Ẩn danh (NĐ13)"
      />
    </div>
  );
}
