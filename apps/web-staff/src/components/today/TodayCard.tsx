'use client';

import Link from 'next/link';
import { Badge, BookingStatusBadge, Card, CardContent } from '@pms/ui';
import { ChevronRight, Clock, Users } from 'lucide-react';
import type { TodayBookingCard } from '@pms/shared-types';
import { hhmm, vnd } from '@/lib/format';

/** 1 card khách trên bảng hôm nay → điều hướng check-in (đến) hoặc check-out (đi/đang ở). */
export function TodayCard({ card, kind }: { card: TodayBookingCard; kind: 'arrival' | 'departure' | 'in_house' }) {
  const href = kind === 'arrival' ? `/checkin/${card.id}` : `/checkout/${card.id}`;
  const time = kind === 'arrival' ? card.check_in : card.check_out;

  return (
    <Link href={href}>
      <Card className="transition-colors active:bg-muted">
        <CardContent className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{card.resource_name}</span>
              {card.is_whole && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Nguyên căn
                </Badge>
              )}
            </div>
            <p className="truncate text-sm text-muted-foreground">{card.guest_name ?? 'Chưa gán khách'}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" /> {hhmm(time)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-3" /> {card.adults + card.children}
              </span>
              <BookingStatusBadge status={card.status} />
            </div>
            {kind === 'arrival' && card.deposit_due_vnd > 0 && (
              <p className="mt-1 text-xs font-medium text-booking-pending">
                Cọc chưa đủ: còn {vnd(card.deposit_due_vnd)}
              </p>
            )}
            {kind !== 'arrival' && card.balance_due_vnd > 0 && (
              <p className="mt-1 text-xs font-medium text-destructive">
                Còn phải thu: {vnd(card.balance_due_vnd)}
              </p>
            )}
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground/50" />
        </CardContent>
      </Card>
    </Link>
  );
}
