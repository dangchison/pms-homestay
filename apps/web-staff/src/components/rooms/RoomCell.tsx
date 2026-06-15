'use client';

import { HousekeepingDot, cn } from '@pms/ui';
import { BedDouble } from 'lucide-react';
import type { RoomBoardItem } from '@pms/shared-types';

/** Ô phòng trên room board: số phòng + dot housekeeping + icon đang có khách. */
export function RoomCell({ room, onClick }: { room: RoomBoardItem; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card p-1 transition-colors active:bg-muted',
      )}
    >
      {room.is_occupied_now && (
        <BedDouble className="absolute right-1.5 top-1.5 size-3.5 text-violet-500" aria-label="Đang có khách" />
      )}
      <span className="text-lg font-semibold leading-none">{room.room_number}</span>
      <HousekeepingDot status={room.housekeeping_status} showLabel />
    </button>
  );
}
