'use client';

import { Badge, Button, Skeleton, toast } from '@pms/ui';
import type {
  ChannelMappingResponse,
  ChannelResponse,
  IcalSyncResult,
  SyncJobResponse,
  SyncJobStatus,
} from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import {
  useChannelMappings,
  useChannelSyncJobs,
  useChannels,
  useRegenerateToken,
  useSyncMapping,
  useUpdateChannel,
} from '@/lib/hooks/use-channels';
import { useConflictCount } from '@/lib/hooks/use-conflicts';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

// Nhãn trạng thái đồng bộ = nguồn-số-duy-nhất (map từ last_sync_status của kênh & status sync-job).
const SYNC_STATUS: Record<
  SyncJobStatus,
  { label: string; variant: 'secondary' | 'destructive' | 'outline' | 'default' }
> = {
  SUCCESS: { label: 'Đồng bộ OK', variant: 'secondary' },
  FAILED: { label: 'Lỗi', variant: 'destructive' },
  PARTIAL: { label: 'Một phần', variant: 'default' },
  RUNNING: { label: 'Đang chạy', variant: 'default' },
  QUEUED: { label: 'Đang chạy', variant: 'default' },
};
const NOT_SYNCED = { label: 'Chưa đồng bộ', variant: 'outline' as const };

const syncBadge = (status: SyncJobStatus | null) => (status ? SYNC_STATUS[status] : NOT_SYNCED);

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
/** PUSH feed công khai owner dán vào OTA — CHỈ chứa ical_push_token (không PII). */
const pushUrl = (token: string) => `${API_BASE}/api/v1/public/sync/ical/${token}`;

const VN_DATETIME = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmt = (iso: string) => VN_DATETIME.format(new Date(iso));

const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiClientError ? err.message : fallback;

/** Task 1.6 /channels — kênh OTA iCal + mapping + đồng bộ (docs/19 §2 Đợt 1). */
export default function ChannelsPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);

  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Kênh OTA" />
        <p className="text-sm text-muted-foreground">Chọn cơ sở để quản lý kênh OTA.</p>
      </PageContainer>
    );
  }

  return <ChannelsView propertyId={propertyId} />;
}

function ChannelsView({ propertyId }: { propertyId: string }) {
  const { data: channels, isLoading } = useChannels(propertyId);
  const { data: conflictCount } = useConflictCount(propertyId);

  return (
    <PageContainer>
      <PageHeader
        title="Kênh OTA"
        description="Đồng bộ 2 chiều Airbnb / Booking / Agoda qua iCal theo từng đơn vị bán: pull lịch về chặn phòng, push lịch đi cho OTA."
        action={
          conflictCount != null && conflictCount > 0 ? (
            <Badge variant="destructive" aria-label={`${conflictCount} xung đột OTA`}>
              {conflictCount} xung đột OTA
            </Badge>
          ) : undefined
        }
      />

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (channels ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có kênh OTA nào cho cơ sở này.</p>
      ) : (
        <div className="grid gap-6">
          {(channels ?? []).map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

// ── 1 kênh: header (trạng thái + toggle) + mappings + sync-jobs ───────────────
function ChannelCard({ channel }: { channel: ChannelResponse }) {
  const updateChannel = useUpdateChannel();
  const badge = syncBadge(channel.last_sync_status);

  const onToggle = () =>
    updateChannel.mutate(
      { id: channel.id, is_active: !channel.is_active },
      {
        onSuccess: () => toast.success(channel.is_active ? 'Đã tắt kênh' : 'Đã bật kênh'),
        onError: (err) => toast.error(errMsg(err, 'Đổi trạng thái kênh thất bại')),
      },
    );

  return (
    <section
      aria-label={channel.display_name}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{channel.display_name}</h2>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {channel.has_secret ? (
            <Badge variant="outline">Đã cấu hình khoá</Badge>
          ) : (
            <Badge variant="outline">Chưa có khoá</Badge>
          )}
          {channel.last_synced_at && (
            <span className="text-xs text-muted-foreground">
              Đồng bộ lần cuối {fmt(channel.last_synced_at)}
            </span>
          )}
        </div>
        <Button
          variant={channel.is_active ? 'secondary' : 'outline'}
          size="sm"
          disabled={updateChannel.isPending}
          onClick={onToggle}
        >
          {channel.is_active ? 'Đang bật · Tắt kênh' : 'Đang tắt · Bật kênh'}
        </Button>
      </div>

      <ChannelMappings channelId={channel.id} />
      <ChannelSyncJobs channelId={channel.id} />
    </section>
  );
}

// ── Khối mappings của kênh ────────────────────────────────────────────────────
function ChannelMappings({ channelId }: { channelId: string }) {
  const { data: mappings, isLoading } = useChannelMappings(channelId);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if ((mappings ?? []).length === 0) {
    return <p className="text-sm text-muted-foreground">Kênh này chưa có listing nào được map.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {(mappings ?? []).map((mapping) => (
        <MappingRow key={mapping.id} channelId={channelId} mapping={mapping} />
      ))}
    </div>
  );
}

function MappingRow({
  channelId,
  mapping,
}: {
  channelId: string;
  mapping: ChannelMappingResponse;
}) {
  const regenerate = useRegenerateToken(channelId);
  const sync = useSyncMapping(channelId);
  const url = pushUrl(mapping.ical_push_token);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Đã sao chép URL push feed');
    } catch {
      toast.error('Không sao chép được — hãy chọn và copy thủ công');
    }
  };

  const onRegenerate = () =>
    regenerate.mutate(mapping.id, {
      onSuccess: () => toast.success('Đã tạo lại token push (URL cũ đã thu hồi)'),
      onError: (err) => toast.error(errMsg(err, 'Tạo lại token thất bại')),
    });

  const onSync = () =>
    sync.mutate(mapping.id, {
      onSuccess: (res: IcalSyncResult) =>
        toast.success(
          `Đồng bộ ${res.status}: +${res.created} mới, ${res.cancelled} huỷ, ${res.conflicts} xung đột`,
        ),
      onError: (err) => toast.error(errMsg(err, 'Đồng bộ thất bại')),
    });

  return (
    <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Listing: {mapping.external_listing_id}</span>
        <Button size="sm" variant="outline" disabled={sync.isPending} onClick={onSync}>
          Đồng bộ ngay
        </Button>
      </div>

      <div className="grid gap-1 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">PULL URL:</span>
          <span className="break-all font-mono">{mapping.ical_pull_url ?? '—'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">PUSH URL (dán vào OTA):</span>
          <span
            className="break-all font-mono"
            aria-label="URL push feed công khai"
            title="URL push feed công khai — dán vào OTA"
          >
            {url}
          </span>
          <Button size="sm" variant="ghost" onClick={onCopy}>
            Sao chép
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={regenerate.isPending}
            onClick={onRegenerate}
          >
            Tạo lại token
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Lịch sử sync-jobs (10 gần nhất) ───────────────────────────────────────────
function ChannelSyncJobs({ channelId }: { channelId: string }) {
  const { data: jobs, isLoading } = useChannelSyncJobs(channelId);

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  // BE trả full (take:50) → chỉ hiện 10 GẦN NHẤT: sắp theo started_at desc rồi slice (không giả định thứ tự BE).
  const recent = [...(jobs ?? [])]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 10);

  if (recent.length === 0) {
    return <p className="text-xs text-muted-foreground">Chưa có lịch sử đồng bộ.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Loại</th>
            <th className="px-3 py-1.5 font-medium">Trạng thái</th>
            <th className="px-3 py-1.5 font-medium">Thời điểm</th>
            <th className="px-3 py-1.5 font-medium">Ghi chú</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {recent.map((job: SyncJobResponse) => {
            const badge = syncBadge(job.status);
            return (
              <tr key={job.id}>
                <td className="px-3 py-1.5">{job.job_type}</td>
                <td className="px-3 py-1.5">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className="px-3 py-1.5 tabular-nums">{fmt(job.started_at)}</td>
                <td className="px-3 py-1.5 text-destructive">
                  {job.status === 'FAILED' && job.error_message ? job.error_message : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
