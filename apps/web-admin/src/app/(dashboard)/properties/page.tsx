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
  BookingMode,
  HousekeepingStatus,
  PropertyType,
  RatePlanResponse,
  RoomBlockResponse,
  RoomResponse,
} from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useProperty } from '@/lib/hooks/use-properties';
import { useDeleteRatePlan, useRatePlans } from '@/lib/hooks/use-rate-plans';
import { useResources } from '@/lib/hooks/use-resources';
import { useRoomBlocks, useDeleteRoomBlock } from '@/lib/hooks/use-room-blocks';
import { useRooms, useUpdateHousekeeping } from '@/lib/hooks/use-rooms';
import { bpToPercent, describeDeposit, formatVnd } from '@/lib/rate-plan-format';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { PropertyFormDialog } from '@/components/properties/PropertyFormDialog';
import { RatePlanFormDialog } from '@/components/properties/RatePlanFormDialog';
import { RatePlanResourcesDialog } from '@/components/properties/RatePlanResourcesDialog';
import { RatePlanRulesDialog } from '@/components/properties/RatePlanRulesDialog';
import { RatePlanTester } from '@/components/properties/RatePlanTester';
import { RoomBlockFormDialog } from '@/components/properties/RoomBlockFormDialog';
import { RoomFormDialog } from '@/components/properties/RoomFormDialog';
import { WholeResourceFormDialog } from '@/components/properties/WholeResourceFormDialog';

type Tab = 'info' | 'rooms' | 'resources' | 'rate-plans' | 'blocks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: 'Thông tin cơ sở' },
  { id: 'rooms', label: 'Phòng' },
  { id: 'resources', label: 'Bookable unit' },
  { id: 'rate-plans', label: 'Gói giá' },
  { id: 'blocks', label: 'Block bảo trì' },
];

const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  HOMESTAY: 'Homestay',
  RENT_TO_RENT: 'Thuê lại cho thuê',
  APARTMENT: 'Căn hộ dịch vụ',
  HOTEL: 'Khách sạn',
};

const MODE_LABEL: Record<BookingMode, string> = {
  HOURLY: 'Theo giờ',
  DAILY: 'Theo ngày',
  MONTHLY: 'Theo tháng',
};

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

/** /properties — Thông tin cơ sở / Phòng / Bookable unit / Gói giá / Block bảo trì. */
export default function PropertiesPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  const [tab, setTab] = useState<Tab>('rooms');
  const [createOpen, setCreateOpen] = useState(false);

  const addButton = <Button onClick={() => setCreateOpen(true)}>Thêm cơ sở</Button>;

  // Chưa có cơ sở nào = tenant vừa đăng ký. Nút tạo PHẢI có ở đây, nếu không
  // người dùng mới không có đường nào tự thiết lập.
  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Cơ sở & Phòng" action={addButton} />
        <p className="text-sm text-muted-foreground">
          Chưa có cơ sở nào được chọn. Tạo cơ sở đầu tiên để bắt đầu thêm phòng và gói giá.
        </p>
        {createOpen && <PropertyFormDialog property={null} onClose={() => setCreateOpen(false)} />}
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Cơ sở & Phòng"
        description="Quản lý phòng vật lý, đơn vị bán được (phòng / nguyên căn), gói giá và block bảo trì."
        action={addButton}
      />
      {createOpen && <PropertyFormDialog property={null} onClose={() => setCreateOpen(false)} />}

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

      {tab === 'info' && <PropertyInfoTab propertyId={propertyId} />}
      {tab === 'rooms' && <RoomsTab propertyId={propertyId} />}
      {tab === 'resources' && <ResourcesTab propertyId={propertyId} />}
      {tab === 'rate-plans' && <RatePlansTab propertyId={propertyId} />}
      {tab === 'blocks' && <BlocksTab propertyId={propertyId} />}
    </PageContainer>
  );
}

// ── Tab Thông tin cơ sở ─────────────────────────────────────────────────────
function PropertyInfoTab({ propertyId }: { propertyId: string }) {
  const { data: property, isLoading } = useProperty(propertyId);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!property) return <p className="text-sm text-muted-foreground">Không tải được thông tin cơ sở.</p>;

  const address = [property.address_line, property.ward, property.district, property.province]
    .filter(Boolean)
    .join(', ');

  const rows: { label: string; value: string }[] = [
    { label: 'Tên cơ sở', value: property.name },
    { label: 'Loại hình', value: PROPERTY_TYPE_LABEL[property.property_type] },
    { label: 'Địa chỉ', value: address },
    { label: 'Múi giờ', value: property.timezone },
    { label: 'Mã kinh doanh lưu trú', value: property.police_business_code ?? '—' },
    {
      label: 'Thuê lại cho thuê',
      value: property.is_rent_to_rent ? 'Có' : 'Không',
    },
  ];

  if (property.is_rent_to_rent) {
    rows.push(
      { label: 'Chủ nhà', value: property.landlord_name ?? '—' },
      { label: 'Điện thoại chủ nhà', value: property.landlord_phone ?? '—' },
      {
        label: 'Kỳ hợp đồng',
        value:
          property.rent_to_rent_contract_start != null
            ? `${property.rent_to_rent_contract_start}${
                property.rent_to_rent_contract_end ? ` → ${property.rent_to_rent_contract_end}` : ''
              }`
            : '—',
      },
      {
        label: 'Cách trả chủ nhà',
        value:
          property.landlord_revenue_share_bp != null
            ? `Chia ${bpToPercent(property.landlord_revenue_share_bp)}% doanh thu`
            : property.monthly_landlord_rent_vnd != null
              ? `${formatVnd(property.monthly_landlord_rent_vnd)} / tháng`
              : '—',
      },
    );
  }

  return (
    <section aria-label="Thông tin cơ sở" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditOpen(true)}>Sửa thông tin</Button>
      </div>

      <dl className="overflow-hidden rounded-lg border border-border">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid grid-cols-1 gap-1 px-3 py-2 text-sm sm:grid-cols-[14rem_1fr] ${
              i % 2 === 1 ? 'bg-muted/30' : ''
            }`}
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {editOpen && <PropertyFormDialog property={property} onClose={() => setEditOpen(false)} />}
    </section>
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

// ── Tab Gói giá ─────────────────────────────────────────────────────────────
type PlanDialog = 'form' | 'rules' | 'resources' | 'tester';

function RatePlansTab({ propertyId }: { propertyId: string }) {
  const { data: plans, isLoading } = useRatePlans(propertyId);
  const del = useDeleteRatePlan();
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [active, setActive] = useState<RatePlanResponse | null>(null);

  const open = (kind: PlanDialog, plan: RatePlanResponse | null) => {
    setActive(plan);
    setDialog(kind);
  };
  const close = () => {
    setDialog(null);
    setActive(null);
  };

  const onDelete = (plan: RatePlanResponse) =>
    del.mutate(plan.id, {
      onSuccess: () => toast.success('Đã xoá gói giá'),
      onError: (err) =>
        toast.error(err instanceof ApiClientError ? err.message : 'Xoá gói giá thất bại'),
    });

  return (
    <section aria-label="Gói giá" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => open('form', null)}>Tạo gói giá</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tên gói</th>
                <th className="px-3 py-2 font-medium">Phương thức</th>
                <th className="px-3 py-2 font-medium">Giá cơ bản</th>
                <th className="px-3 py-2 font-medium">Cọc</th>
                <th className="px-3 py-2 font-medium">Đơn vị áp dụng</th>
                <th className="px-3 py-2 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(plans ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có gói giá nào — tạo một gói để bắt đầu nhận đặt phòng.
                  </td>
                </tr>
              ) : (
                (plans ?? []).map((plan) => (
                  <tr key={plan.id}>
                    <td className="px-3 py-2 font-medium">
                      {plan.name}
                      {plan.is_default && (
                        <span className="ml-2 rounded border border-primary px-1.5 py-0.5 text-[0.65rem] uppercase text-primary">
                          Mặc định
                        </span>
                      )}
                      {!plan.is_active && (
                        <span className="ml-2 text-xs text-muted-foreground">(ngừng dùng)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{MODE_LABEL[plan.mode]}</td>
                    <td className="px-3 py-2 tabular-nums">{formatVnd(plan.base_price_vnd)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {describeDeposit(plan.deposit_type, plan.deposit_value)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{plan.resource_ids.length}</td>
                    <td className="flex flex-wrap gap-2 px-3 py-2">
                      <Button size="sm" variant="outline" onClick={() => open('form', plan)}>
                        Sửa
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => open('rules', plan)}>
                        Luật giá
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => open('resources', plan)}>
                        Đơn vị
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => open('tester', plan)}>
                        Thử giá
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={del.isPending}
                        onClick={() => onDelete(plan)}
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

      {dialog === 'form' && (
        <RatePlanFormDialog
          propertyId={propertyId}
          plan={active}
          defaultMode={active?.mode ?? 'DAILY'}
          onClose={close}
        />
      )}
      {dialog === 'rules' && active && <RatePlanRulesDialog plan={active} onClose={close} />}
      {dialog === 'resources' && active && (
        <RatePlanResourcesDialog propertyId={propertyId} plan={active} onClose={close} />
      )}
      {dialog === 'tester' && active && (
        <RatePlanTester propertyId={propertyId} plan={active} onClose={close} />
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
