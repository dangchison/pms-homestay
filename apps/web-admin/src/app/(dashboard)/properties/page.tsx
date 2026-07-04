'use client';

import { useState } from 'react';
import {
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
  BookableResourceResponse,
  HousekeepingStatus,
  RoomBlockResponse,
  RoomResponse,
} from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useResources } from '@/lib/hooks/use-resources';
import { useRoomBlocks, useDeleteRoomBlock } from '@/lib/hooks/use-room-blocks';
import { useRooms, useUpdateHousekeeping } from '@/lib/hooks/use-rooms';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { RoomBlockFormDialog } from '@/components/properties/RoomBlockFormDialog';
import { RoomFormDialog } from '@/components/properties/RoomFormDialog';
import { WholeResourceFormDialog } from '@/components/properties/WholeResourceFormDialog';

type Tab = 'rooms' | 'resources' | 'blocks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'rooms', label: 'Phòng' },
  { id: 'resources', label: 'Bookable unit' },
  { id: 'blocks', label: 'Block bảo trì' },
];

const HOUSEKEEPING: { value: HousekeepingStatus; label: string }[] = [
  { value: 'CLEAN', label: 'Sạch' },
  { value: 'DIRTY', label: 'Bẩn' },
  { value: 'CLEANING', label: 'Đang dọn' },
  { value: 'INSPECTION', label: 'Kiểm tra' },
];
// Nhãn housekeeping = nguồn-số-duy-nhất HOUSEKEEPING (tránh lệch nhãn cột vs. dropdown).
const HK_LABEL = Object.fromEntries(HOUSEKEEPING.map((h) => [h.value, h.label])) as Record<
  HousekeepingStatus,
  string
>;

const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmt = (iso: string) => VN_DATETIME.format(new Date(iso));

/** Task 1.3 /properties — Phòng / Bookable unit / Block bảo trì (docs/19 §2 Đợt 1). */
export default function PropertiesPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [tab, setTab] = useState<Tab>('rooms');

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Cơ sở & Phòng" />
        <p className="text-sm text-muted-foreground">Chọn cơ sở để quản lý phòng.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Cơ sở & Phòng"
        description="Quản lý phòng vật lý, đơn vị bán được (phòng / nguyên căn) và block bảo trì."
      />

      <div role="tablist" aria-label="Nhóm quản lý" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'rooms' && <RoomsTab propertyId={propertyId} />}
      {tab === 'resources' && <ResourcesTab propertyId={propertyId} />}
      {tab === 'blocks' && <BlocksTab propertyId={propertyId} />}
    </PageContainer>
  );
}

// ── Tab Phòng ───────────────────────────────────────────────────────────────
function RoomsTab({ propertyId }: { propertyId: string }) {
  const { data: rooms, isLoading } = useRooms(propertyId);
  const updateHk = useUpdateHousekeeping();
  const [addOpen, setAddOpen] = useState(false);

  const onChangeHk = (room: RoomResponse, housekeeping_status: HousekeepingStatus) =>
    updateHk.mutate(
      { id: room.id, housekeeping_status },
      {
        onSuccess: () => toast.success('Đã đổi trạng thái buồng phòng'),
        onError: (err) =>
          toast.error(err instanceof ApiClientError ? err.message : 'Đổi trạng thái thất bại'),
      },
    );

  return (
    <section aria-label="Phòng" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>Thêm phòng</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Số phòng</th>
                <th className="px-3 py-2 font-medium">Tên</th>
                <th className="px-3 py-2 font-medium">Sức chứa</th>
                <th className="px-3 py-2 font-medium">Trạng thái buồng phòng</th>
                <th className="px-3 py-2 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(rooms ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có phòng nào.
                  </td>
                </tr>
              ) : (
                (rooms ?? []).map((room) => (
                  <tr key={room.id}>
                    <td className="px-3 py-2 font-medium">{room.room_number}</td>
                    <td className="px-3 py-2">{room.display_name ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{room.capacity_adults}</td>
                    <td className="px-3 py-2 text-muted-foreground">{HK_LABEL[room.housekeeping_status]}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={room.housekeeping_status}
                        onValueChange={(v) => onChangeHk(room, v as HousekeepingStatus)}
                      >
                        <SelectTrigger
                          aria-label={`Đổi trạng thái buồng phòng ${room.room_number}`}
                          className="h-8 w-[9rem] text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HOUSEKEEPING.map((h) => (
                            <SelectItem key={h.value} value={h.value}>
                              {h.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <RoomFormDialog propertyId={propertyId} onClose={() => setAddOpen(false)} />}
    </section>
  );
}

// ── Tab Bookable unit ─────────────────────────────────────────────────────────
function ResourcesTab({ propertyId }: { propertyId: string }) {
  const { data: resources, isLoading } = useResources(propertyId);
  const { data: rooms } = useRooms(propertyId);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section aria-label="Bookable unit" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>Thêm nguyên căn (WHOLE)</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tên</th>
                <th className="px-3 py-2 font-medium">Loại</th>
                <th className="px-3 py-2 font-medium">Số phòng thành viên</th>
                <th className="px-3 py-2 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(resources ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có đơn vị bán nào.
                  </td>
                </tr>
              ) : (
                (resources ?? []).map((res: BookableResourceResponse) => (
                  <tr key={res.id}>
                    <td className="px-3 py-2 font-medium">{res.name}</td>
                    <td className="px-3 py-2">{res.type === 'WHOLE' ? 'Nguyên căn' : 'Phòng'}</td>
                    <td className="px-3 py-2 tabular-nums">{res.room_ids.length}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {res.type === 'ROOM' ? 'Tự sinh khi tạo phòng' : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <WholeResourceFormDialog
          propertyId={propertyId}
          rooms={rooms ?? []}
          onClose={() => setAddOpen(false)}
        />
      )}
    </section>
  );
}

// ── Tab Block bảo trì ─────────────────────────────────────────────────────────
function BlocksTab({ propertyId }: { propertyId: string }) {
  const { data: rooms } = useRooms(propertyId);
  const [roomId, setRoomId] = useState<string | null>(null);
  const { data: blocks, isLoading } = useRoomBlocks(roomId);
  const del = useDeleteRoomBlock();
  const [addOpen, setAddOpen] = useState(false);

  const onDelete = (block: RoomBlockResponse) =>
    del.mutate(block.id, {
      onSuccess: () => toast.success('Đã xoá block'),
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'Xoá block thất bại'),
    });

  return (
    <section aria-label="Block bảo trì" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={roomId ?? ''} onValueChange={(v) => setRoomId(v || null)}>
          <SelectTrigger aria-label="Chọn phòng" className="h-9 w-[16rem]">
            <SelectValue placeholder="Chọn phòng để xem block" />
          </SelectTrigger>
          <SelectContent>
            {(rooms ?? []).map((room) => (
              <SelectItem key={room.id} value={room.id}>
                {room.room_number}
                {room.display_name ? ` — ${room.display_name}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={!roomId} onClick={() => setAddOpen(true)}>
          Thêm block
        </Button>
      </div>

      {!roomId ? (
        <p className="text-sm text-muted-foreground">Chọn một phòng để xem danh sách block.</p>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Từ</th>
                <th className="px-3 py-2 font-medium">Đến</th>
                <th className="px-3 py-2 font-medium">Lý do</th>
                <th className="px-3 py-2 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(blocks ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Phòng này chưa có block nào.
                  </td>
                </tr>
              ) : (
                (blocks ?? []).map((block) => (
                  <tr key={block.id}>
                    <td className="px-3 py-2 tabular-nums">{fmt(block.start_at)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(block.end_at)}</td>
                    <td className="px-3 py-2">{block.reason}</td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={del.isPending}
                        onClick={() => onDelete(block)}
                      >
                        Xoá
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && roomId && (
        <RoomBlockFormDialog roomId={roomId} onClose={() => setAddOpen(false)} />
      )}
    </section>
  );
}
