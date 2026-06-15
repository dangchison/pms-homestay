'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, toast } from '@pms/ui';
import type { BookingMode, CreateBookingRequest, QuoteRequest } from '@pms/shared-types';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiClientError } from '@/lib/api-client';
import { isoToLocalInput, localInputToIso } from '@/lib/datetime';
import { useCreateBooking } from '@/lib/hooks/use-bookings';
import { useQuote } from '@/lib/hooks/use-quote';
import { useResources } from '@/lib/hooks/use-resources';
import { GuestPicker, type PickedGuest } from './GuestPicker';
import { QuoteBreakdown } from './QuoteBreakdown';

const FormSchema = z.object({
  resource_id: z.string().uuid('Chọn phòng / nguyên căn'),
  mode: z.enum(['HOURLY', 'DAILY', 'MONTHLY']),
  check_in: z.string().min(1, 'Chọn giờ nhận phòng'),
  check_out: z.string().min(1, 'Chọn giờ trả phòng'),
  adults: z.number().int().min(1, 'Tối thiểu 1').max(50),
  children: z.number().int().min(0).max(50),
  source: z.enum(['DIRECT', 'WALK_IN']),
  hold: z.boolean(),
  notes: z.string().max(1000).optional(),
});
type FormValues = z.infer<typeof FormSchema>;

interface Props {
  propertyId: string;
  prefill: { resourceId?: string; checkIn?: string; checkOut?: string };
}

export function BookingForm({ propertyId, prefill }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: resources } = useResources(propertyId);
  const createBooking = useCreateBooking();
  const [guest, setGuest] = useState<PickedGuest | null>(null);
  const [conflict, setConflict] = useState(false);
  const [priceChanged, setPriceChanged] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      resource_id: prefill.resourceId ?? '',
      mode: 'DAILY',
      check_in: prefill.checkIn ? isoToLocalInput(prefill.checkIn) : '',
      check_out: prefill.checkOut ? isoToLocalInput(prefill.checkOut) : '',
      adults: 1,
      children: 0,
      source: 'DIRECT',
      hold: false,
      notes: '',
    },
  });

  const v = watch();
  const quoteInput = useMemo<QuoteRequest | null>(() => {
    const ci = localInputToIso(v.check_in);
    const co = localInputToIso(v.check_out);
    if (!v.resource_id || !ci || !co || new Date(co) <= new Date(ci)) return null;
    return {
      resource_id: v.resource_id,
      mode: v.mode as BookingMode,
      check_in: ci,
      check_out: co,
      adults: Number(v.adults) || 1,
      children: Number(v.children) || 0,
    };
  }, [v.resource_id, v.mode, v.check_in, v.check_out, v.adults, v.children]);

  const [debouncedInput, setDebouncedInput] = useState<QuoteRequest | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInput(quoteInput), 400);
    return () => clearTimeout(t);
  }, [quoteInput]);

  const { data: quote, isFetching: quoteLoading, error: quoteError } = useQuote(debouncedInput);
  useEffect(() => setPriceChanged(false), [quote?.quote_id]);

  const onSubmit = async (values: FormValues) => {
    if (!quote) {
      toast.error('Chưa có báo giá hợp lệ');
      return;
    }
    setConflict(false);
    const body: CreateBookingRequest = {
      resource_id: values.resource_id,
      quote_id: quote.quote_id,
      guest_id: guest?.id,
      mode: values.mode,
      check_in: localInputToIso(values.check_in),
      check_out: localInputToIso(values.check_out),
      adults: values.adults,
      children: values.children,
      source: values.source,
      hold: values.hold,
      notes: values.notes || undefined,
    };
    try {
      const created = await createBooking.mutateAsync({ body, idempotencyKey: crypto.randomUUID() });
      toast.success(`Đã tạo booking ${created.booking_code}`);
      router.push(`/bookings/${created.id}`);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.body?.code : undefined;
      if (code === 'PRICE_CHANGED') {
        setPriceChanged(true);
        void qc.invalidateQueries({ queryKey: ['quote'] }); // lấy báo giá mới (quote_id mới)
        toast.error('Giá đã thay đổi — xem lại báo giá rồi tạo lại');
      } else if (code === 'BOOKING_OVERLAP') {
        setConflict(true);
      } else {
        toast.error(err instanceof ApiClientError ? err.message : 'Tạo booking thất bại');
      }
    }
  };

  const fieldError = (k: keyof FormValues) =>
    errors[k] && <p className="text-sm text-destructive">{errors[k]?.message}</p>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6 md:grid-cols-[1fr_22rem]" noValidate>
      {/* ── Cột trái: input ── */}
      <div className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="resource_id">Phòng / Nguyên căn</Label>
          <select
            id="resource_id"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register('resource_id')}
          >
            <option value="">— Chọn —</option>
            {resources?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.type === 'WHOLE' ? 'Nguyên căn' : 'Phòng'})
              </option>
            ))}
          </select>
          {fieldError('resource_id')}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mode">Hình thức</Label>
            <select
              id="mode"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...register('mode')}
            >
              <option value="DAILY">Theo ngày</option>
              <option value="HOURLY">Theo giờ</option>
              <option value="MONTHLY">Theo tháng</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="source">Nguồn</Label>
            <select
              id="source"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...register('source')}
            >
              <option value="DIRECT">Trực tiếp</option>
              <option value="WALK_IN">Khách vãng lai</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="check_in">Nhận phòng</Label>
            <Input id="check_in" type="datetime-local" {...register('check_in')} />
            {fieldError('check_in')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="check_out">Trả phòng</Label>
            <Input id="check_out" type="datetime-local" {...register('check_out')} />
            {fieldError('check_out')}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="adults">Người lớn</Label>
            <Input id="adults" type="number" min={1} {...register('adults', { valueAsNumber: true })} />
            {fieldError('adults')}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="children">Trẻ em</Label>
            <Input id="children" type="number" min={0} {...register('children', { valueAsNumber: true })} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Khách</Label>
          <GuestPicker value={guest} onChange={setGuest} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="notes">Ghi chú</Label>
          <textarea
            id="notes"
            rows={2}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...register('notes')}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register('hold')} className="size-4" />
          Chỉ giữ chỗ tạm 10 phút (HOLD) — bỏ chọn để tạo PENDING chờ cọc
        </label>
      </div>

      {/* ── Cột phải: báo giá + submit ── */}
      <div className="space-y-3">
        <QuoteBreakdown quote={quote} isLoading={quoteLoading} error={quoteError} enabled={!!debouncedInput} />

        {priceChanged && (
          <p className="rounded-md border border-booking-pending/40 bg-booking-pending/12 p-3 text-sm">
            Giá đã thay đổi từ lúc báo giá. Báo giá mới đã được tải lại — kiểm tra rồi bấm tạo lại.
          </p>
        )}
        {conflict && (
          <div className="rounded-md border border-destructive/30 bg-destructive-muted p-3 text-sm">
            <p className="font-medium">Phòng đã có khách/đặt trong khoảng này.</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => router.push('/calendar')}>
              Xem trên lịch
            </Button>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={!quote || quoteLoading || createBooking.isPending}>
          {createBooking.isPending ? 'Đang tạo…' : v.hold ? 'Tạo & giữ chỗ' : 'Tạo & chờ cọc'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Idempotency-Key tự sinh mỗi lần gửi — an toàn khi mạng chập chờn.
        </p>
      </div>
    </form>
  );
}
