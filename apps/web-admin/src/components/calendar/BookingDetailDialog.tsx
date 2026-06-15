'use client';

import { useRouter } from 'next/navigation';
import {
  BookingStatusBadge,
  type BookingStatus,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pms/ui';
import type { CalendarBooking } from '@pms/shared-types';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + '₫';
}

/** Drawer tóm tắt booking khi click bar (spec #C1 → B3). Nút mở trang chi tiết. */
export function BookingDetailDialog({
  booking,
  onClose,
}: {
  booking: CalendarBooking | null;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {booking && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {booking.guest_name ?? 'Khách lẻ'}
                {booking.is_whole && (
                  <span className="rounded bg-foreground/10 px-1.5 text-xs text-muted-foreground">Nguyên căn</span>
                )}
              </DialogTitle>
              <DialogDescription>
                {booking.booking_code} · {booking.source}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Trạng thái</dt>
              <dd>
                <BookingStatusBadge status={booking.status as BookingStatus} />
              </dd>
              <dt className="text-muted-foreground">Nhận phòng</dt>
              <dd>{fmt(booking.check_in)}</dd>
              <dt className="text-muted-foreground">Trả phòng</dt>
              <dd>{fmt(booking.check_out)}</dd>
              <dt className="text-muted-foreground">Số khách</dt>
              <dd>
                {booking.adults} người lớn{booking.children > 0 ? ` · ${booking.children} trẻ em` : ''}
              </dd>
              <dt className="text-muted-foreground">Tổng tiền</dt>
              <dd className="font-medium">{vnd(booking.total_amount_vnd)}</dd>
            </dl>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Đóng
              </Button>
              <Button onClick={() => router.push(`/bookings/${booking.id}`)}>Mở chi tiết</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
