'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Card, CardContent, Skeleton, cn } from '@pms/ui';
import { ChevronRight, Sparkles } from 'lucide-react';
import type { CleaningTaskResponse } from '@pms/shared-types';
import { useSelectedProperty } from '@/lib/hooks/use-properties';
import { useCleaningTasks } from '@/lib/hooks/use-cleaning';
import { useRoomBoard } from '@/lib/hooks/use-rooms-board';
import { useAuthStore } from '@/stores/auth.store';
import { PropertyPicker } from '@/components/PropertyPicker';
import { ddmm, hhmm } from '@/lib/format';

const TYPE_LABEL: Record<string, string> = {
  CHECKOUT_CLEAN: 'Dọn sau trả phòng',
  DEEP_CLEAN: 'Tổng vệ sinh',
  MAINTENANCE: 'Bảo trì',
};
const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ', cls: 'bg-hk-dirty/15 text-hk-dirty' },
  IN_PROGRESS: { label: 'Đang dọn', cls: 'bg-hk-cleaning/15 text-hk-cleaning' },
  COMPLETED: { label: 'Đã xong', cls: 'bg-hk-inspection/15 text-hk-inspection' },
  VERIFIED: { label: 'Đã duyệt', cls: 'bg-hk-clean/15 text-hk-clean' },
  CANCELLED: { label: 'Huỷ', cls: 'bg-muted text-muted-foreground' },
};
const FILTERS = [
  { label: 'Tất cả', status: undefined },
  { label: 'Chờ', status: 'PENDING' },
  { label: 'Đang dọn', status: 'IN_PROGRESS' },
  { label: 'Đã xong', status: 'COMPLETED' },
] as const;

export default function CleaningPage() {
  const { selectedId } = useSelectedProperty();
  const role = useAuthStore((s) => s.user?.role);
  const [filter, setFilter] = useState(0);
  const mineOnly = role === 'HOUSEKEEPER';
  const { data, isLoading } = useCleaningTasks(selectedId, { status: FILTERS[filter]!.status, mineOnly });
  const { data: board } = useRoomBoard(selectedId);
  const roomNo = new Map((board?.rooms ?? []).map((r) => [r.id, r.room_number]));

  const tasks = (data ?? []) as CleaningTaskResponse[];

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dọn phòng</h1>
        <p className="text-sm text-muted-foreground">
          {mineOnly ? 'Công việc được giao cho bạn' : 'Công việc của cơ sở'} · <PropertyPicker />
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            onClick={() => setFilter(i)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors',
              i === filter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </span>
            <p className="mt-1 text-sm font-medium">Chưa có công việc nào</p>
            <p className="max-w-[280px] text-xs text-muted-foreground">
              Task dọn phòng tự sinh sau mỗi check-out và hiện ở đây kèm thông báo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {tasks.map((t) => {
            const st = STATUS_STYLE[t.status] ?? STATUS_STYLE.PENDING!;
            return (
              <Link key={t.id} href={`/cleaning/${t.id}`}>
                <Card className="transition-colors active:bg-muted">
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Phòng {roomNo.get(t.room_id) ?? '—'}</span>
                        {t.priority > 0 && (
                          <Badge variant="destructive" className="text-[10px]">
                            Ưu tiên
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{TYPE_LABEL[t.task_type] ?? t.task_type}</p>
                      {t.due_at && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Hạn: {ddmm(t.due_at)} {hhmm(t.due_at)}
                        </p>
                      )}
                    </div>
                    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', st.cls)}>{st.label}</span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground/50" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
