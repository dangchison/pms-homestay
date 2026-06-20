'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  HousekeepingDot,
  Skeleton,
  toast,
} from '@pms/ui';
import { BedDouble, Sparkles } from 'lucide-react';
import type { HousekeepingStatus, RoomBoardItem } from '@pms/shared-types';
import { useSelectedProperty } from '@/lib/hooks/use-properties';
import { useRoomBoard, useUpdateHousekeeping } from '@/lib/hooks/use-rooms-board';
import { useCreateCleaningTask } from '@/lib/hooks/use-cleaning';
import { useOnlineStatus } from '@/hooks/useOfflineCache';
import { useAuthStore } from '@/stores/auth.store';
import { PropertyPicker } from '@/components/PropertyPicker';
import { RoomCell } from '@/components/rooms/RoomCell';

const ALL_STATUSES: HousekeepingStatus[] = ['CLEAN', 'DIRTY', 'CLEANING', 'INSPECTION'];
const HK_LABEL: Record<HousekeepingStatus, string> = {
  CLEAN: 'Sạch',
  DIRTY: 'Bẩn',
  CLEANING: 'Đang dọn',
  INSPECTION: 'Chờ kiểm tra',
};

export default function RoomsBoardPage() {
  const { selectedId } = useSelectedProperty();
  const { data, isLoading } = useRoomBoard(selectedId);
  const role = useAuthStore((s) => s.user?.role);
  const online = useOnlineStatus();
  const updateHk = useUpdateHousekeeping();
  const createTask = useCreateCleaningTask();
  const [selected, setSelected] = useState<RoomBoardItem | null>(null);

  // HOUSEKEEPER chỉ CLEANING→CLEAN; vai trò khác đổi tự do.
  const allowed: HousekeepingStatus[] = !selected
    ? []
    : role === 'HOUSEKEEPER'
      ? selected.housekeeping_status === 'CLEANING'
        ? ['CLEAN']
        : []
      : ALL_STATUSES.filter((s) => s !== selected.housekeeping_status);

  const changeStatus = async (status: HousekeepingStatus) => {
    if (!selected) return;
    try {
      await updateHk.mutateAsync({ roomId: selected.id, status });
      toast.success(`Phòng ${selected.room_number}: ${HK_LABEL[status]}`);
      setSelected(null);
    } catch {
      toast.error('Không đổi được trạng thái');
    }
  };

  const makeTask = async () => {
    if (!selected || !selectedId) return;
    try {
      await createTask.mutateAsync({ property_id: selectedId, room_id: selected.id, task_type: 'DEEP_CLEAN', priority: 0 });
      toast.success('Đã tạo việc dọn phòng');
      setSelected(null);
    } catch {
      toast.error('Không tạo được việc dọn');
    }
  };

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Phòng</h1>
        <PropertyPicker />
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          {ALL_STATUSES.map((s) => (
            <HousekeepingDot key={s} status={s} showLabel />
          ))}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : (data?.rooms.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BedDouble className="size-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Chưa có phòng nào</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {data!.rooms.map((room) => (
            <RoomCell key={room.id} room={room} onClick={() => setSelected(room)} />
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Phòng {selected.room_number}</DialogTitle>
                <DialogDescription>Cập nhật tình trạng dọn phòng.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Trạng thái</span>
                  <HousekeepingDot status={selected.housekeeping_status} showLabel />
                </div>
                {selected.is_occupied_now && (
                  <div className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-700">
                    <BedDouble className="size-4" />
                    Đang có khách{selected.current_guest_name ? `: ${selected.current_guest_name}` : ''}
                  </div>
                )}

                {!online && <p className="text-sm text-amber-600">Offline — không đổi được trạng thái</p>}

                {online && allowed.length > 0 && (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium">Đổi sang</p>
                    <div className="grid grid-cols-2 gap-2">
                      {allowed.map((s) => (
                        <Button
                          key={s}
                          variant="outline"
                          className="h-11"
                          disabled={updateHk.isPending}
                          onClick={() => changeStatus(s)}
                        >
                          <HousekeepingDot status={s} />
                          {HK_LABEL[s]}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {online && allowed.length === 0 && role === 'HOUSEKEEPER' && (
                  <p className="text-sm text-muted-foreground">
                    Bạn chỉ có thể đánh dấu Sạch khi phòng đang được dọn.
                  </p>
                )}

                {online && role !== 'HOUSEKEEPER' && (
                  <Button variant="ghost" className="h-11" disabled={createTask.isPending} onClick={makeTask}>
                    <Sparkles className="size-4" />
                    Tạo việc dọn phòng
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
