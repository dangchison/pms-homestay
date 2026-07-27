'use client';

import { useMemo, useState } from 'react';
import {
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
} from '@pms/ui';
import type { QuoteRequest, RatePlanResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useQuote } from '@/lib/hooks/use-quote';
import { useResources } from '@/lib/hooks/use-resources';
import { formatVnd, localDate } from '@/lib/rate-plan-format';

/** Giờ mặc định theo phương thức, để người dùng bấm thử được ngay mà không phải nhập. */
function defaultTimes(plan: RatePlanResponse): { start: string; end: string } {
  if (plan.mode === 'HOURLY') return { start: '14:00', end: '17:00' };
  return {
    start: plan.daily_checkin_time?.slice(0, 5) ?? '14:00',
    end: plan.daily_checkout_time?.slice(0, 5) ?? '12:00',
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** 'YYYY-MM-DD' + 'HH:mm' theo giờ máy → ISO UTC cho API. */
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Thử báo giá cho một gói — gọi đúng POST /pricing/quote mà luồng đặt phòng dùng,
 * nên số hiện ở đây là số khách sẽ thấy. Truyền rate_plan_id tường minh để thử
 * đúng gói này thay vì gói mặc định của đơn vị.
 */
export function RatePlanTester({
  propertyId,
  plan,
  onClose,
}: {
  propertyId: string;
  plan: RatePlanResponse;
  onClose: () => void;
}) {
  const { data: resources } = useResources(propertyId);
  const times = defaultTimes(plan);
  const today = localDate(new Date());

  // Ưu tiên đơn vị đã gán cho gói; chưa gán thì cho chọn trong toàn bộ đơn vị của cơ sở.
  const options = useMemo(() => {
    const all = resources ?? [];
    const assigned = all.filter((r) => plan.resource_ids.includes(r.id));
    return assigned.length > 0 ? assigned : all;
  }, [resources, plan.resource_ids]);

  const [resourceId, setResourceId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(addDays(today, plan.mode === 'HOURLY' ? 0 : 2));
  const [fromTime, setFromTime] = useState(times.start);
  const [toTime, setToTime] = useState(times.end);
  const [submitted, setSubmitted] = useState<QuoteRequest | null>(null);

  const effectiveResourceId = resourceId || options[0]?.id || '';
  const { data: quote, isFetching, error } = useQuote(submitted);

  const onRun = () => {
    if (!effectiveResourceId) return;
    setSubmitted({
      resource_id: effectiveResourceId,
      rate_plan_id: plan.id,
      mode: plan.mode,
      check_in: toIso(fromDate, fromTime),
      check_out: toIso(toDate, toTime),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thử giá — {plan.name}</DialogTitle>
          <DialogDescription>
            Gọi đúng cùng một phép tính mà luồng đặt phòng dùng, nên số hiện ở đây là số khách sẽ
            thấy. Không tạo đặt phòng hay giữ chỗ.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tester-resource">Đơn vị bán</Label>
            <Select value={effectiveResourceId} onValueChange={setResourceId}>
              <SelectTrigger id="tester-resource" aria-label="Đơn vị bán">
                <SelectValue placeholder="Chọn đơn vị" />
              </SelectTrigger>
              <SelectContent>
                {options.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} {r.type === 'WHOLE' ? '(nguyên căn)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground">Cơ sở chưa có đơn vị bán nào.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tester-from">Nhận phòng</Label>
            <div className="flex gap-2">
              <Input
                id="tester-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <Input
                type="time"
                aria-label="Giờ nhận phòng"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tester-to">Trả phòng</Label>
            <div className="flex gap-2">
              <Input
                id="tester-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
              <Input
                type="time"
                aria-label="Giờ trả phòng"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={onRun} disabled={!effectiveResourceId || isFetching}>
            {isFetching ? 'Đang tính…' : 'Tính thử'}
          </Button>
        </div>

        {error != null && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error instanceof ApiClientError ? error.message : 'Không tính được báo giá'}
          </p>
        )}

        {isFetching && <Skeleton className="h-40 w-full" />}

        {quote != null && !isFetching && (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ngày</th>
                    <th className="px-3 py-2 font-medium">Diễn giải</th>
                    <th className="px-3 py-2 text-right font-medium">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {quote.line_items.map((item, i) => (
                    <tr key={`${item.description}-${i}`}>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {item.local_date ?? '—'}
                      </td>
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatVnd(item.amount_vnd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tạm tính</dt>
                <dd className="tabular-nums">{formatVnd(quote.subtotal_vnd)}</dd>
              </div>
              {quote.discount_vnd > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Giảm giá</dt>
                  <dd className="tabular-nums">−{formatVnd(quote.discount_vnd)}</dd>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <dt>Tổng cộng</dt>
                <dd className="tabular-nums">{formatVnd(quote.total_vnd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Cọc cần thu</dt>
                <dd className="tabular-nums">{formatVnd(quote.deposit_vnd)}</dd>
              </div>
            </dl>

            {quote.holidays.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Ngày lễ trong kỳ: {quote.holidays.map((h) => `${h.date} ${h.name}`).join(' · ')}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
