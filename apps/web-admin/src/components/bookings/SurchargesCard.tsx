'use client';

import { useState } from 'react';
import { Badge, Button, Input, Label, Skeleton, toast } from '@pms/ui';
import type { BookingResponse, BookingSurchargeItemType } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { isTerminal } from '@/lib/booking-status';
import { vnd } from '@/lib/format';
import { useAddSurcharge, useRemoveSurcharge, useSurcharges } from '@/lib/hooks/use-surcharges';

/**
 * Card 'Phụ thu' ở chi tiết booking (task 2.7, docs/19 §3 Đợt 2). Booking đã chốt
 * (isTerminal — xem @/lib/booking-status: CHECKED_OUT/CANCELLED/NO_SHOW) thì BE trả 422
 * BOOKING_INVALID_STATUS cho add/remove, nên ẩn form thêm + nút xoá (danh sách vẫn
 * read-only). ĐƠN VỊ: unit_price_vnd là VND NGUYÊN (KHÔNG basis-point như discount);
 * amount_vnd do BE tính (roundVnd(qty×unit)) → FE chỉ hiển thị vnd().
 */
const ITEM_TYPE_LABEL: Record<BookingSurchargeItemType, string> = {
  SURCHARGE: 'Phụ thu',
  AMENITY: 'Tiện ích',
  UTILITY: 'Điện nước',
};

export function SurchargesCard({ booking }: { booking: BookingResponse }) {
  const { data: surcharges, isLoading } = useSurcharges(booking.id);
  const add = useAddSurcharge(booking.id);
  const remove = useRemoveSurcharge(booking.id);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const terminal = isTerminal(booking.status);

  async function submit() {
    const desc = description.trim();
    const unit = Number(amount);
    if (!desc) {
      toast.error('Nhập nhãn phụ thu');
      return;
    }
    if (!Number.isInteger(unit) || unit <= 0) {
      toast.error('Số tiền phải là số nguyên dương');
      return;
    }
    try {
      await add.mutateAsync({
        item_type: 'SURCHARGE',
        description: desc,
        quantity: 1,
        unit_price_vnd: unit,
      });
      toast.success('Đã thêm phụ thu');
      setDescription('');
      setAmount('');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm phụ thu thất bại');
    }
  }

  async function onRemove(id: string) {
    try {
      await remove.mutateAsync(id);
      toast.success('Đã xoá phụ thu');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Xoá phụ thu thất bại');
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <p className="mb-3 font-medium">Phụ thu</p>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !surcharges || surcharges.length === 0 ? (
        <p className="text-muted-foreground">Chưa có phụ thu</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {surcharges.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <Badge variant="outline" className="shrink-0">
                {ITEM_TYPE_LABEL[s.item_type] ?? s.item_type}
              </Badge>
              <span className="min-w-0 flex-1 truncate">{s.description}</span>
              <span className="shrink-0 font-medium tabular-nums">{vnd(s.amount_vnd)}</span>
              {!terminal && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive"
                  aria-label={`Xoá ${s.description}`}
                  disabled={remove.isPending}
                  onClick={() => onRemove(s.id)}
                >
                  Xoá
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!terminal && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
          <div className="grid min-w-[10rem] flex-1 gap-1.5">
            <Label htmlFor="sc-desc">Nhãn</Label>
            <Input
              id="sc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VD: Minibar"
            />
          </div>
          <div className="grid w-32 gap-1.5">
            <Label htmlFor="sc-amount">Số tiền (₫)</Label>
            <Input
              id="sc-amount"
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={submit} disabled={add.isPending}>
            {add.isPending ? 'Đang thêm…' : 'Thêm'}
          </Button>
        </div>
      )}
    </div>
  );
}
