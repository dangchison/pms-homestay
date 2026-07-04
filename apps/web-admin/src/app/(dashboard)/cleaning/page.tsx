'use client';

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@pms/ui';
import type {
  CleaningTaskResponse,
  CleaningTaskStatus,
  CleaningTaskType,
  UserResponse,
} from '@pms/shared-types';
import { useAssignCleaning, useCleaningTasks, useVerifyCleaning } from '@/lib/hooks/use-cleaning';
import { useRoomsBoard } from '@/lib/hooks/use-rooms-board';
import { useUsers } from '@/lib/hooks/use-users';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

/** 4 cột board (thứ tự cố định); CANCELLED không hiển thị. */
const COLUMNS: { status: CleaningTaskStatus; label: string }[] = [
  { status: 'PENDING', label: 'Chờ' },
  { status: 'IN_PROGRESS', label: 'Đang dọn' },
  { status: 'COMPLETED', label: 'Đã xong' },
  { status: 'VERIFIED', label: 'Đã duyệt' },
];

const TASK_TYPE_LABEL: Record<CleaningTaskType, string> = {
  CHECKOUT_CLEAN: 'Dọn sau trả phòng',
  DEEP_CLEAN: 'Tổng vệ sinh',
  MAINTENANCE: 'Bảo trì',
};

const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtDue = (iso: string) => VN_DATETIME.format(new Date(iso));

/** Task 1.5 /cleaning — board điều phối buồng phòng (Kanban 4 cột theo status). */
export default function CleaningPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const { data, isLoading } = useCleaningTasks(propertyId);
  const roomsBoard = useRoomsBoard(propertyId);
  const usersQuery = useUsers();

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Dọn phòng" />
        <p className="text-sm text-muted-foreground">Chọn cơ sở để xem board dọn phòng.</p>
      </PageContainer>
    );
  }

  // room_id → room_number (fallback '—' nếu board chưa tải hoặc phòng đã ẩn).
  const roomNumberById = new Map((roomsBoard.data?.rooms ?? []).map((r) => [r.id, r.room_number]));
  const users = usersQuery.data ?? [];

  const tasks = data ?? [];
  const byStatus = (status: CleaningTaskStatus) =>
    tasks.filter((t: CleaningTaskResponse) => t.status === status);

  return (
    <PageContainer>
      <PageHeader
        title="Dọn phòng"
        description="Board công việc buồng phòng — gán người dọn và nghiệm thu theo cột trạng thái."
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {COLUMNS.map((c) => (
            <Skeleton key={c.status} className="h-64 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = byStatus(col.status);
            return (
              <section key={col.status} aria-label={col.label} className="flex flex-col gap-3">
                <header className="flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold">{col.label}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </header>
                <div className="flex flex-col gap-3">
                  {items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground/60">
                      Không có việc.
                    </p>
                  ) : (
                    items.map((task) => (
                      <CleaningCard
                        key={task.id}
                        task={task}
                        roomNumber={roomNumberById.get(task.room_id) ?? '—'}
                        users={users}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}

function CleaningCard({
  task,
  roomNumber,
  users,
}: {
  task: CleaningTaskResponse;
  roomNumber: string;
  users: UserResponse[];
}) {
  const assign = useAssignCleaning(task.id);
  const verify = useVerifyCleaning(task.id);

  const canAssign = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
  const canVerify = task.status === 'COMPLETED';
  const before = task.before_photos;
  const after = task.after_photos;

  const onAssign = (assigned_to: string) =>
    assign.mutate(
      { assigned_to },
      {
        onSuccess: () => toast.success('Đã gán người dọn'),
        onError: () => toast.error('Không gán được người dọn'),
      },
    );

  const onVerify = () =>
    verify.mutate(
      {},
      {
        onSuccess: () => toast.success('Đã nghiệm thu'),
        onError: () => toast.error('Không nghiệm thu được'),
      },
    );

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold">Phòng {roomNumber}</span>
        {task.priority > 0 && <Badge variant="destructive">Ưu tiên</Badge>}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{TASK_TYPE_LABEL[task.task_type]}</p>

      {task.due_at && (
        <p className="mt-1 text-xs text-muted-foreground">Hạn: {fmtDue(task.due_at)}</p>
      )}

      {(before.length > 0 || after.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...before, ...after].map((src, i) => (
            <img
              key={`${task.id}-photo-${i}`}
              src={src}
              alt="Ảnh dọn phòng"
              className="size-10 rounded object-cover"
            />
          ))}
        </div>
      )}

      {canAssign && (
        <div className="mt-3">
          <Select
            value={task.assigned_to ?? undefined}
            onValueChange={onAssign}
            disabled={assign.isPending}
          >
            <SelectTrigger aria-label="Người dọn" className="h-8 text-xs">
              <SelectValue placeholder="Chọn người dọn" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {canVerify && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 w-full"
          disabled={verify.isPending}
          onClick={onVerify}
        >
          Nghiệm thu
        </Button>
      )}
    </article>
  );
}
