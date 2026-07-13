'use client';

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  BookingStatusBadge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  cn,
  toast,
} from '@pms/ui';
import type { BookingMode, BookingResponse, UpdateBookingRequest } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { BOOKING_TRANSITIONS, isTerminal } from '@/lib/booking-status';
import { maskEmail, maskPhone, vnd } from '@/lib/format';
import {
  useBooking,
  useBookingActions,
  useGuest,
  useInvoicesByBooking,
  useRescheduleBookingDetail,
  useSwitchBookingResource,
  useUpdateBooking,
} from '@/lib/hooks/use-bookings';
import { useResources } from '@/lib/hooks/use-resources';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { InvoiceKindBadge, InvoiceStatusBadge } from '@/components/invoices/badges';
import { SurchargesCard } from '@/components/bookings/SurchargesCard';
import { MeterReadingsCard } from '@/components/bookings/MeterReadingsCard';

const MODE_LABEL: Record<BookingMode, string> = {
  HOURLY: 'Theo giờ',
  DAILY: 'Theo ngày',
  MONTHLY: 'Theo tháng',
};
const POLICE_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chưa khai', cls: 'border-border bg-muted text-muted-foreground' },
  SUBMITTED: { label: 'Đã khai', cls: 'border-booking-confirmed/40 bg-booking-confirmed/12 text-foreground' },
  FAILED: { label: 'Khai lỗi', cls: 'border-destructive/40 bg-destructive-muted text-foreground' },
};

const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmt = (iso: string | null): string => (iso ? VN_DATETIME.format(new Date(iso)) : '—');

/** Task 1.2 /bookings/[id] — chi tiết booking + vòng đời (docs/19 §2 Đợt 1). */
export default function BookingDetailPage() {
  const id = String(useParams().id);
  const { data: booking, isLoading } = useBooking(id);

  if (isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }

  if (!booking) {
    return (
      <PageContainer>
        <PageHeader breadcrumb={[{ label: 'Đặt phòng', href: '/bookings' }]} title="Chi tiết đặt phòng" />
        <p className="text-sm text-muted-foreground">Không tìm thấy đặt phòng.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Đặt phòng', href: '/bookings' }, { label: booking.booking_code }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {booking.booking_code}
            <BookingStatusBadge status={booking.status} />
          </span>
        }
      />

      <div className="grid gap-6 md:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <InfoCard booking={booking} />
          <InvoicesCard bookingId={booking.id} />
          <SurchargesCard booking={booking} />
          {booking.mode === 'MONTHLY' && <MeterReadingsCard bookingId={booking.id} />}
          <TimelineCard booking={booking} />
        </div>

        <div className="space-y-4">
          <GuestCard guestId={booking.guest_id} />
          <ActionsCard booking={booking} />
        </div>
      </div>
    </PageContainer>
  );
}

// ── Card thông tin ─────────────────────────────────────────────────────────────

function InfoCard({ booking }: { booking: BookingResponse }) {
  const police = POLICE_LABEL[booking.police_report_status] ?? {
    label: booking.police_report_status,
    cls: 'border-border bg-muted text-muted-foreground',
  };
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 rounded-lg border border-border p-4 text-sm">
      <Field label="Trạng thái">
        <BookingStatusBadge status={booking.status} />
      </Field>
      <Field label="Nguồn">{booking.source}</Field>
      <Field label="Mode">{MODE_LABEL[booking.mode] ?? booking.mode}</Field>
      <Field label="Khai báo lưu trú">
        <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', police.cls)}>
          {police.label}
        </span>
      </Field>
      <Field label="Nhận phòng kế hoạch">{fmt(booking.check_in)}</Field>
      <Field label="Nhận phòng thực tế">{fmt(booking.actual_check_in)}</Field>
      <Field label="Trả phòng kế hoạch">{fmt(booking.check_out)}</Field>
      <Field label="Trả phòng thực tế">{fmt(booking.actual_check_out)}</Field>
      <Field label="Số khách">
        {booking.adults} người lớn{booking.children > 0 ? ` · ${booking.children} trẻ em` : ''}
      </Field>
      <Field label="Tổng tiền">
        <span className="font-medium tabular-nums">{vnd(booking.total_amount_vnd)}</span>
      </Field>
    </dl>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </>
  );
}

// ── Card khách ─────────────────────────────────────────────────────────────────

function GuestCard({ guestId }: { guestId: string | null }) {
  const { data: guest, isLoading } = useGuest(guestId ?? '');

  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <p className="mb-3 font-medium">Khách</p>
      {!guestId ? (
        <p className="text-muted-foreground">Khách lẻ / chưa gán</p>
      ) : isLoading || !guest ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Field label="Tên">{guest.full_name}</Field>
          <Field label="SĐT">
            <span className="tabular-nums">{maskPhone(guest.phone)}</span>
          </Field>
          <Field label="Email">{maskEmail(guest.email)}</Field>
          <Field label="Giấy tờ">{guest.id_document_masked ?? '—'}</Field>
          <Field label="Quốc tịch">{guest.nationality ?? '—'}</Field>
        </dl>
      )}
    </div>
  );
}

// ── Card hoá đơn ───────────────────────────────────────────────────────────────

function InvoicesCard({ bookingId }: { bookingId: string }) {
  const { data: invoices, isLoading } = useInvoicesByBooking(bookingId);

  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <p className="mb-3 font-medium">Hoá đơn</p>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !invoices || invoices.length === 0 ? (
        <p className="text-muted-foreground">Chưa có hoá đơn</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {invoices.map((inv) => (
            <li key={inv.id} className="py-2">
              <Link href={`/invoices/${inv.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                <span className="font-medium">{inv.invoice_number}</span>
                <InvoiceKindBadge kind={inv.kind} />
                <InvoiceStatusBadge status={inv.status} />
                <span className="ml-auto flex items-center gap-3 tabular-nums">
                  <span>{vnd(inv.total_vnd)}</span>
                  {inv.balance_vnd > 0 && (
                    <span className="text-destructive">còn {vnd(inv.balance_vnd)}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Timeline vòng đời ──────────────────────────────────────────────────────────

interface Milestone {
  label: string;
  at: string;
  note?: string | null;
}

/** Dựng CHỈ từ mốc có trong BookingResponse — KHÔNG gọi endpoint status-history. */
function buildTimeline(b: BookingResponse): Milestone[] {
  const terminal = isTerminal(b.status);
  const items: Milestone[] = [{ label: 'Tạo', at: b.created_at }];
  if (b.expires_at && !terminal) items.push({ label: 'Hạn giữ/cọc', at: b.expires_at });
  if (b.actual_check_in) items.push({ label: 'Nhận phòng', at: b.actual_check_in });
  if (b.actual_check_out) items.push({ label: 'Trả phòng', at: b.actual_check_out });
  if (b.cancelled_at) items.push({ label: 'Huỷ', at: b.cancelled_at, note: b.cancellation_reason });
  return items.sort((a, c) => new Date(a.at).getTime() - new Date(c.at).getTime());
}

function TimelineCard({ booking }: { booking: BookingResponse }) {
  const items = buildTimeline(booking);
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <p className="mb-3 font-medium">Vòng đời</p>
      <ol className="space-y-3">
        {items.map((m, i) => (
          <li key={`${m.label}-${i}`} className="flex gap-3">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary/60" />
            <div>
              <p className="font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{fmt(m.at)}</p>
              {m.note && <p className="text-xs text-muted-foreground">Lý do: {m.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Khối thao tác + dialog ─────────────────────────────────────────────────────

type OpenDialog = 'cancel' | 'switch' | 'reschedule' | 'edit' | null;

function ActionsCard({ booking }: { booking: BookingResponse }) {
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const actions = useBookingActions();
  const terminal = isTerminal(booking.status);
  const transitions = BOOKING_TRANSITIONS[booking.status];

  const canConfirm = booking.status === 'HOLD' || booking.status === 'PENDING';
  const canCheckIn = booking.status === 'CONFIRMED';
  const canCheckOut = booking.status === 'CHECKED_IN';
  const canCancel = !terminal && transitions.includes('CANCELLED');
  // reschedule: BE chặn CHECKED_IN/terminal (RescheduleBookingRequestSchema doc L80).
  const canReschedule = !terminal && booking.status !== 'CHECKED_IN';

  async function run(label: string, p: Promise<unknown>) {
    try {
      await p;
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : `${label} thất bại`);
    }
  }

  // Terminal → không nút chuyển trạng thái nào.
  if (terminal) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm">
        <p className="mb-1 font-medium">Thao tác</p>
        <p className="text-muted-foreground">Đặt phòng đã kết thúc — không còn thao tác vòng đời.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-3 text-sm font-medium">Thao tác</p>
      <div className="flex flex-col gap-2">
        {canConfirm && (
          <Button
            size="sm"
            disabled={actions.confirm.isPending}
            onClick={() => run('Đã xác nhận đặt phòng', actions.confirm.mutateAsync({ id: booking.id }))}
          >
            Xác nhận
          </Button>
        )}
        {canCheckIn && (
          <Button
            size="sm"
            disabled={actions.checkIn.isPending}
            onClick={() => run('Đã nhận phòng', actions.checkIn.mutateAsync({ id: booking.id }))}
          >
            Nhận phòng
          </Button>
        )}
        {canCheckOut && (
          <Button
            size="sm"
            disabled={actions.checkOut.isPending}
            onClick={() => run('Đã trả phòng', actions.checkOut.mutateAsync({ id: booking.id }))}
          >
            Trả phòng
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setDialog('switch')}>
          Đổi phòng
        </Button>
        {canReschedule && (
          <Button size="sm" variant="outline" onClick={() => setDialog('reschedule')}>
            Đổi lịch
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setDialog('edit')}>
          Sửa thông tin
        </Button>
        {canCancel && (
          <Button size="sm" variant="destructive" onClick={() => setDialog('cancel')}>
            Huỷ
          </Button>
        )}
      </div>

      {dialog === 'cancel' && <CancelDialog booking={booking} onClose={() => setDialog(null)} />}
      {dialog === 'switch' && <SwitchResourceDialog booking={booking} onClose={() => setDialog(null)} />}
      {dialog === 'reschedule' && <RescheduleDialog booking={booking} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditDialog booking={booking} onClose={() => setDialog(null)} />}
    </div>
  );
}

function CancelDialog({ booking, onClose }: { booking: BookingResponse; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { cancel } = useBookingActions();

  async function submit() {
    if (reason.trim().length < 1) {
      toast.error('Cần nhập lý do huỷ');
      return;
    }
    try {
      await cancel.mutateAsync({ id: booking.id, reason: reason.trim() });
      toast.success('Đã huỷ đặt phòng');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Huỷ thất bại');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Huỷ đặt phòng {booking.booking_code}</DialogTitle>
          <DialogDescription>Ghi lý do huỷ (lưu lại để đối soát).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cx-reason">Lý do huỷ</Label>
          <Textarea id="cx-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button variant="destructive" onClick={submit} disabled={cancel.isPending}>
            {cancel.isPending ? 'Đang huỷ…' : 'Xác nhận huỷ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SwitchResourceDialog({ booking, onClose }: { booking: BookingResponse; onClose: () => void }) {
  const { data: resources } = useResources(booking.property_id);
  const [resourceId, setResourceId] = useState('');
  const [reason, setReason] = useState('');
  const switchResource = useSwitchBookingResource();
  // Loại resource hiện tại + resource tắt (BOOKING_SAME_RESOURCE 422 nếu chọn cùng phòng).
  const options = (resources ?? []).filter((r) => r.is_active && r.id !== booking.resource_id);

  async function submit() {
    if (!resourceId) {
      toast.error('Chọn phòng mới');
      return;
    }
    if (reason.trim().length < 1) {
      toast.error('Cần nhập lý do đổi phòng');
      return;
    }
    try {
      await switchResource.mutateAsync({ id: booking.id, new_resource_id: resourceId, reason: reason.trim() });
      toast.success('Đã đổi phòng');
      onClose();
    } catch {
      /* toast lỗi đã phát ở onError của hook (BOOKING_OVERLAP / chung) */
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đổi phòng</DialogTitle>
          <DialogDescription>Chuyển booking sang phòng/bookable khác (giữ nguyên ngày).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label>Phòng mới</Label>
            <Select value={resourceId} onValueChange={setResourceId}>
              <SelectTrigger aria-label="Phòng mới">
                <SelectValue placeholder="Chọn phòng" />
              </SelectTrigger>
              <SelectContent>
                {options.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sw-reason">Lý do</Label>
            <Input id="sw-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={submit} disabled={switchResource.isPending}>
            {switchResource.isPending ? 'Đang đổi…' : 'Đổi phòng'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** datetime-local (không timezone) → ISO UTC cho payload. */
const toIso = (local: string): string => (local ? new Date(local).toISOString() : '');
/** ISO UTC → chuỗi datetime-local (yyyy-MM-ddTHH:mm) theo giờ máy để prefill input. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RescheduleDialog({ booking, onClose }: { booking: BookingResponse; onClose: () => void }) {
  const [checkIn, setCheckIn] = useState(toLocalInput(booking.check_in));
  const [checkOut, setCheckOut] = useState(toLocalInput(booking.check_out));
  const [reason, setReason] = useState('');
  const reschedule = useRescheduleBookingDetail();

  async function submit() {
    if (!checkIn || !checkOut) {
      toast.error('Nhập ngày nhận và trả phòng');
      return;
    }
    if (reason.trim().length < 1) {
      toast.error('Cần nhập lý do đổi lịch');
      return;
    }
    try {
      await reschedule.mutateAsync({
        id: booking.id,
        check_in: toIso(checkIn),
        check_out: toIso(checkOut),
        reason: reason.trim(),
      });
      toast.success('Đã đổi lịch');
      onClose();
    } catch {
      /* toast lỗi đã phát ở onError của hook */
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đổi lịch</DialogTitle>
          <DialogDescription>Đổi ngày nhận/trả (giữ nguyên phòng, tính lại giá).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rs-in">Nhận phòng</Label>
            <Input id="rs-in" type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rs-out">Trả phòng</Label>
            <Input id="rs-out" type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rs-reason">Lý do</Label>
            <Input id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={submit} disabled={reschedule.isPending}>
            {reschedule.isPending ? 'Đang đổi…' : 'Đổi lịch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ booking, onClose }: { booking: BookingResponse; onClose: () => void }) {
  const [adults, setAdults] = useState(booking.adults);
  const [children, setChildren] = useState(booking.children);
  const [notes, setNotes] = useState(booking.notes ?? '');
  const update = useUpdateBooking();

  async function submit() {
    const body: UpdateBookingRequest = {
      adults,
      children,
      notes: notes.trim() ? notes.trim() : undefined,
    };
    try {
      await update.mutateAsync({ id: booking.id, version: booking.version, body });
      toast.success('Đã cập nhật đặt phòng');
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        toast.error('Thiếu phiên bản — tải lại');
      } else if (err instanceof ApiClientError && err.status === 409) {
        toast.error('Bản ghi đã bị người khác sửa — đã tải lại');
        onClose(); // onSettled đã invalidate ['bookings'] → refetch, tránh loop
      } else {
        toast.error(err instanceof ApiClientError ? err.message : 'Cập nhật thất bại');
      }
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sửa thông tin {booking.booking_code}</DialogTitle>
          <DialogDescription>Cập nhật số khách và ghi chú (không đổi phòng/ngày).</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ed-adults">Người lớn</Label>
            <Input
              id="ed-adults"
              type="number"
              min={1}
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ed-children">Trẻ em</Label>
            <Input
              id="ed-children"
              type="number"
              min={0}
              value={children}
              onChange={(e) => setChildren(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ed-notes">Ghi chú</Label>
          <Textarea id="ed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={submit} disabled={update.isPending}>
            {update.isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
