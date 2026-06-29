'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, HousekeepingDot, type HousekeepingStatus, cn } from '@pms/ui';
import type { CalendarBlock, CalendarBooking, CalendarOccupancyResponse, CalendarResource } from '@pms/shared-types';
import {
  COL_WIDTH,
  HEADER_HEIGHT,
  LABEL_WIDTH,
  ROW_HEIGHT,
  addDays,
  barRect,
  dayHeaders,
  startOfUtcDay,
} from '@/lib/calendar/calendar-utils';
import { useRescheduleBooking, useSwitchResource } from '@/lib/hooks/use-calendar';
import { BookingBar, BookingBarGhost } from './BookingBar';

/** Trạng thái còn cho đổi lịch (kéo mép): chưa nhận phòng & chưa kết thúc. */
const RESCHEDULABLE = new Set(['HOLD', 'PENDING', 'CONFIRMED']);
import { BookingDetailDialog } from './BookingDetailDialog';

type OccKey = readonly ['occupancy', string, string, string];

interface Props {
  data: CalendarOccupancyResponse | undefined;
  isLoading: boolean;
  rangeStart: Date;
  days: number;
  now: Date;
  statusFilter: ReadonlySet<string>;
  queryKey: OccKey;
}

interface QuickSelect {
  resource: CalendarResource;
  startIdx: number;
  endIdx: number; // inclusive
}

export function CalendarView({ data, isLoading, rangeStart, days, now, statusFilter, queryKey }: Props) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeBooking, setActiveBooking] = useState<CalendarBooking | null>(null);
  const [detail, setDetail] = useState<CalendarBooking | null>(null);
  const [quick, setQuick] = useState<QuickSelect | null>(null);
  const switcher = useSwitchResource(queryKey);
  const rescheduler = useRescheduleBooking(queryKey);

  const onReschedule = useCallback(
    (booking: CalendarBooking, checkIn: string, checkOut: string) =>
      rescheduler.mutate({ booking, checkIn, checkOut }),
    [rescheduler],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const resources = data?.resources ?? [];
  const headers = useMemo(() => dayHeaders(rangeStart, days, now), [rangeStart, days, now]);

  // Index booking/block theo resource_id (lọc status ở client cho filter tức thời).
  const byResource = useMemo(() => {
    const bk = new Map<string, CalendarBooking[]>();
    const bl = new Map<string, CalendarBlock[]>();
    for (const b of data?.bookings ?? []) {
      if (!statusFilter.has(b.status)) continue;
      const arr = bk.get(b.resource_id);
      if (arr) arr.push(b);
      else bk.set(b.resource_id, [b]);
    }
    for (const b of data?.blocks ?? []) {
      const arr = bl.get(b.resource_id);
      if (arr) arr.push(b);
      else bl.set(b.resource_id, [b]);
    }
    return { bk, bl };
  }, [data, statusFilter]);

  const virtualizer = useVirtualizer({
    count: resources.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: HEADER_HEIGHT,
  });

  function onDragStart(e: DragStartEvent) {
    setActiveBooking((e.active.data.current?.booking as CalendarBooking) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveBooking(null);
    const booking = e.active.data.current?.booking as CalendarBooking | undefined;
    const targetId = e.over?.id ? String(e.over.id) : null;
    if (booking && targetId && targetId !== booking.resource_id) {
      switcher.mutate({ bookingId: booking.id, newResourceId: targetId });
    }
  }

  function openQuickCreate() {
    if (!quick) return;
    const ci = addDays(startOfUtcDay(rangeStart), quick.startIdx);
    const co = addDays(startOfUtcDay(rangeStart), quick.endIdx + 1);
    const params = new URLSearchParams({
      resource_id: quick.resource.id,
      check_in: ci.toISOString(),
      check_out: co.toISOString(),
    });
    router.push(`/bookings/new?${params.toString()}`);
  }

  const totalWidth = LABEL_WIDTH + days * COL_WIDTH;
  const items = virtualizer.getVirtualItems();

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div
          ref={scrollRef}
          className="relative overflow-auto rounded-lg border border-border bg-surface"
          style={{ height: 'calc(100vh - 230px)', minHeight: 360 }}
        >
          <div style={{ width: totalWidth, position: 'relative' }}>
            {/* ── Header ngày (frozen trên) ── */}
            <div className="sticky top-0 z-30 flex" style={{ height: HEADER_HEIGHT }}>
              <div
                className="sticky left-0 z-40 flex items-center border-r border-b border-border bg-surface px-3 text-xs font-semibold text-muted-foreground"
                style={{ width: LABEL_WIDTH }}
              >
                Phòng / Nguyên căn
              </div>
              {headers.map((h) => (
                <div
                  key={h.date.toISOString()}
                  className={cn(
                    'flex flex-col items-center justify-center border-b border-border text-xs',
                    h.isWeekend && 'bg-muted/40',
                    h.isToday && 'bg-primary/10',
                  )}
                  style={{ width: COL_WIDTH }}
                >
                  <span className="text-muted-foreground">{h.weekday}</span>
                  <span className={cn('font-semibold', h.isToday && 'text-primary')}>{h.dayNum}</span>
                </div>
              ))}
            </div>

            {/* ── Body (virtualize hàng resource) ── */}
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {/* Lớp nền cột: tô cuối tuần + đường hôm nay (sau cột nhãn) */}
              <div className="pointer-events-none absolute inset-y-0 z-0" style={{ left: LABEL_WIDTH, width: days * COL_WIDTH }}>
                {headers.map((h, i) => (
                  <div
                    key={h.date.toISOString()}
                    className={cn('absolute inset-y-0 border-r border-border/40', h.isWeekend && 'bg-muted/20', h.isToday && 'bg-primary/[0.06]')}
                    style={{ left: i * COL_WIDTH, width: COL_WIDTH }}
                  />
                ))}
              </div>

              {!isLoading &&
                items.map((vi) => {
                  const resource = resources[vi.index]!;
                  return (
                    <CalendarRow
                      key={resource.id}
                      resource={resource}
                      bookings={byResource.bk.get(resource.id) ?? []}
                      blocks={byResource.bl.get(resource.id) ?? []}
                      rangeStart={rangeStart}
                      days={days}
                      top={vi.start - virtualizer.options.scrollMargin}
                      onBookingClick={setDetail}
                      onReschedule={onReschedule}
                      onQuickCreate={(startIdx, endIdx) => setQuick({ resource, startIdx, endIdx })}
                    />
                  );
                })}
            </div>
          </div>

          {isLoading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface/60 text-sm text-muted-foreground">
              Đang tải lịch…
            </div>
          )}
          {!isLoading && resources.length === 0 && (
            <div className="absolute inset-0 z-50 flex items-center justify-center text-sm text-muted-foreground">
              Chưa có phòng/nguyên căn cho cơ sở này.
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeBooking ? <BookingBarGhost booking={activeBooking} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Popover "Đặt nhanh" (kéo chọn khoảng → prefill B2/6.3) */}
      {quick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20" onClick={() => setQuick(null)}>
          <div
            className="w-[20rem] rounded-lg border border-border bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">Đặt nhanh</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {quick.resource.name} ·{' '}
              {`${quick.endIdx - quick.startIdx + 1} đêm`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setQuick(null)}>
                Hủy
              </Button>
              <Button size="sm" onClick={openQuickCreate}>
                Tạo đặt phòng
              </Button>
            </div>
          </div>
        </div>
      )}

      <BookingDetailDialog booking={detail} onClose={() => setDetail(null)} />
    </>
  );
}

interface RowProps {
  resource: CalendarResource;
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  rangeStart: Date;
  days: number;
  top: number;
  onBookingClick: (b: CalendarBooking) => void;
  onReschedule: (booking: CalendarBooking, checkIn: string, checkOut: string) => void;
  onQuickCreate: (startIdx: number, endIdx: number) => void;
}

function CalendarRow({ resource, bookings, blocks, rangeStart, days, top, onBookingClick, onReschedule, onQuickCreate }: RowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: resource.id });
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);

  function idxFromEvent(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(days - 1, Math.floor((e.clientX - rect.left) / COL_WIDTH)));
  }

  return (
    <div className="absolute flex w-full" style={{ top, height: ROW_HEIGHT }}>
      {/* Nhãn resource (frozen trái) */}
      <div
        className="sticky left-0 z-20 flex items-center gap-2 border-r border-b border-border bg-surface px-3"
        style={{ width: LABEL_WIDTH }}
      >
        {resource.type === 'ROOM' && resource.housekeeping_status && (
          <HousekeepingDot status={resource.housekeeping_status as HousekeepingStatus} />
        )}
        <span className="truncate text-sm font-medium">{resource.name}</span>
        {resource.type === 'WHOLE' && (
          <span className="ml-auto shrink-0 rounded bg-foreground/10 px-1 text-[10px] text-muted-foreground">căn</span>
        )}
      </div>

      {/* Track (droppable + kéo chọn để đặt nhanh) */}
      <div
        ref={setNodeRef}
        className={cn('relative border-b border-border/60', isOver && 'bg-primary/5')}
        style={{ width: days * COL_WIDTH, height: ROW_HEIGHT }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return; // chỉ nền trống (không phải bar)
          const i = idxFromEvent(e);
          setSel({ a: i, b: i });
        }}
        onPointerMove={(e) => {
          if (!sel) return;
          setSel((s) => (s ? { ...s, b: idxFromEvent(e) } : s));
        }}
        onPointerUp={() => {
          if (sel) {
            onQuickCreate(Math.min(sel.a, sel.b), Math.max(sel.a, sel.b));
            setSel(null);
          }
        }}
        onPointerLeave={() => setSel(null)}
      >
        {sel && (
          <div
            className="pointer-events-none absolute top-1 bottom-1 rounded border border-primary/50 bg-primary/15"
            style={{ left: Math.min(sel.a, sel.b) * COL_WIDTH, width: (Math.abs(sel.a - sel.b) + 1) * COL_WIDTH }}
          />
        )}
        {blocks.map((bl) => {
          const r = barRect(bl.start_at, bl.end_at, rangeStart, days);
          return (
            <div
              key={bl.id}
              title={`Chặn phòng: ${bl.reason}`}
              className="absolute top-1/2 flex h-[24px] -translate-y-1/2 items-center gap-1 overflow-hidden rounded-md border border-border bg-block/20 px-1.5 text-[11px] text-muted-foreground"
              style={{ left: r.left, width: r.width }}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-block" />
              <span className="truncate">{bl.reason}</span>
            </div>
          );
        })}
        {bookings.map((b) => (
          <BookingBar
            key={b.id}
            booking={b}
            rangeStart={rangeStart}
            days={days}
            onClick={onBookingClick}
            onReschedule={RESCHEDULABLE.has(b.status) ? onReschedule : undefined}
          />
        ))}
      </div>
    </div>
  );
}
