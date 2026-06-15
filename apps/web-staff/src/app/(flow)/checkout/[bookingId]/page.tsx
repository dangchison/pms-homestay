'use client';

import { useParams, useRouter } from 'next/navigation';
import { BookingStatusBadge, Button, Card, CardContent, Separator, Skeleton, toast } from '@pms/ui';
import { ArrowLeft, CheckCircle2, Loader2, LogOut } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { useBooking, useCheckOut } from '@/lib/hooks/use-bookings';
import { useGuest } from '@/lib/hooks/use-guests';
import { useInvoicesByBooking } from '@/lib/hooks/use-invoices';
import { useOnlineStatus } from '@/hooks/useOfflineCache';
import { useAuthStore } from '@/stores/auth.store';
import { FolioPanel } from '@/components/FolioPanel';
import { ddmm, vnd } from '@/lib/format';

const PAYABLE = new Set(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);

export default function CheckOutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const router = useRouter();
  const online = useOnlineStatus();
  const role = useAuthStore((s) => s.user?.role);
  const { data: booking, isLoading } = useBooking(bookingId);
  const { data: guest } = useGuest(booking?.guest_id);
  const { data: invoices } = useInvoicesByBooking(bookingId);
  const checkOut = useCheckOut(bookingId);

  if (isLoading || !booking) {
    return (
      <div className="grid gap-4 px-4 pt-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const outstanding = (invoices ?? [])
    .filter((i) => i.status !== 'VOID' && PAYABLE.has(i.status))
    .reduce((s, i) => s + i.balance_vnd, 0);
  const isManager = role === 'OWNER' || role === 'MANAGER';
  const isCheckedOut = booking.status === 'CHECKED_OUT';
  // Disable tới khi balance = 0 hoặc MANAGER override (ui/02 #T4).
  const canCheckOut = booking.status === 'CHECKED_IN' && (outstanding === 0 || isManager);

  const doCheckOut = async () => {
    try {
      await checkOut.mutateAsync();
      toast.success('Đã trả phòng — hoá đơn tiền phòng đã phát hành');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Trả phòng thất bại');
    }
  };

  return (
    <div className="grid gap-4 px-4 pt-4">
      <header className="flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Quay lại" className="-ml-1 p-1">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Check-out · {booking.booking_code}</h1>
          <p className="text-xs text-muted-foreground">
            {ddmm(booking.check_in)} → {ddmm(booking.check_out)}
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="grid gap-2 py-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{guest?.full_name ?? 'Khách'}</span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <Separator />
          <Row label="Tổng tiền phòng" value={vnd(booking.total_amount_vnd)} />
          <Row label="Còn phải thu" value={vnd(outstanding)} highlight={outstanding > 0} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Hoá đơn & thanh toán</h2>
        <FolioPanel bookingId={bookingId} online={online} emptyHint="Hoá đơn tiền phòng phát hành khi trả phòng." />
      </div>

      {isCheckedOut ? (
        <>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-booking-confirmed/40 bg-booking-confirmed/12 py-5 text-center">
            <CheckCircle2 className="size-9 text-booking-confirmed" />
            <p className="font-medium">Đã trả phòng</p>
            {outstanding > 0 && <p className="text-sm text-destructive">Còn lại {vnd(outstanding)} — thu nốt ở trên</p>}
          </div>
          <Button variant="outline" className="h-12 w-full text-base" onClick={() => router.replace('/today')}>
            Xong
          </Button>
        </>
      ) : (
        <>
          <Button className="h-12 w-full text-base" disabled={!online || !canCheckOut || checkOut.isPending} onClick={doCheckOut}>
            {checkOut.isPending ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}
            Trả phòng (check-out)
          </Button>
          {!canCheckOut && booking.status === 'CHECKED_IN' && (
            <p className="text-center text-xs text-muted-foreground">
              Còn nợ {vnd(outstanding)} — thu đủ hoặc cần MANAGER duyệt ghi nợ.
            </p>
          )}
          {booking.status !== 'CHECKED_IN' && (
            <p className="text-center text-xs text-muted-foreground">Chỉ trả phòng được khi khách đang ở.</p>
          )}
        </>
      )}

      {!online && <p className="text-center text-sm text-amber-600">Offline — cần mạng để thao tác</p>}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={highlight ? 'font-semibold text-destructive' : 'font-medium'}>{value}</span>
    </div>
  );
}
