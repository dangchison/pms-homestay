'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  DateRangePicker,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from '@pms/ui';
import { ChevronDown } from 'lucide-react';
import type { AuditAction } from '@pms/shared-types';
import { useAuditLogs, type AuditFilters } from '@/lib/hooks/use-audit';

const ACTIONS: AuditAction[] = ['CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'LOGIN', 'LOGOUT', 'EXPORT', 'READ_PII'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ACTION_STYLE: Record<string, string> = {
  CREATE: 'bg-success/10 text-success',
  UPDATE: 'bg-primary/10 text-primary',
  DELETE: 'bg-destructive/10 text-destructive',
  STATE_CHANGE: 'bg-warning/10 text-warning-foreground',
  READ_PII: 'bg-chip-brand-soft text-chip-brand',
  EXPORT: 'bg-chip-brand-soft text-chip-brand',
  LOGIN: 'bg-muted text-muted-foreground',
  LOGOUT: 'bg-muted text-muted-foreground',
};

function fmt(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

/** S5 /settings/audit-logs — bảng audit + filter + diff before/after (task 6.7). */
export default function AuditLogsPage() {
  const [filters, setFilters] = useState<AuditFilters>({ page: 1 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading, isFetching } = useAuditLogs(filters);

  const set = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pageInfo = data?.page_info;

  return (
    <div className="grid gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Loại đối tượng (vd: bookings)"
          className="h-9 w-48"
          value={filters.entity_type ?? ''}
          onChange={(e) => set({ entity_type: e.target.value || undefined })}
        />
        <Select
          value={filters.action ?? 'ALL'}
          onValueChange={(v) => set({ action: v === 'ALL' ? undefined : (v as AuditAction) })}
        >
          <SelectTrigger aria-label="Hành động" className="h-9 w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Mọi hành động</SelectItem>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          className="w-[16rem]"
          placeholder="Khoảng thời gian"
          value={filters.from ? { from: new Date(filters.from), to: filters.to ? new Date(filters.to) : undefined } : undefined}
          onChange={(r) =>
            set({
              from: r?.from ? `${ymd(r.from)}T00:00:00.000Z` : undefined,
              to: r?.to ? `${ymd(r.to)}T23:59:59.999Z` : undefined,
            })
          }
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(data?.data ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Không có bản ghi.</p>
              ) : (
                data!.data.map((log) => {
                  const open = expanded.has(log.id);
                  return (
                    <div key={log.id}>
                      <button
                        type="button"
                        onClick={() => toggle(log.id)}
                        className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                      >
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', ACTION_STYLE[log.action] ?? 'bg-muted')}>
                          {log.action}
                        </span>
                        <span className="text-sm font-medium">{log.entity_type}</span>
                        <span className="hidden truncate text-xs text-muted-foreground sm:inline">{log.entity_id?.slice(0, 8) ?? ''}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{fmt(log.created_at)}</span>
                        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                      </button>
                      {open && (
                        <div className="grid gap-2 bg-muted/30 p-3 sm:grid-cols-2">
                          <DiffBlock title="Trước" data={log.before_data} />
                          <DiffBlock title="Sau" data={log.after_data} />
                          <p className="text-xs text-muted-foreground sm:col-span-2">
                            User: {log.user_id?.slice(0, 8) ?? '—'} · IP: {log.ip_address ?? '—'} · Req: {log.request_id ?? '—'}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {pageInfo && pageInfo.total_pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={(filters.page ?? 1) <= 1 || isFetching} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>
            Trước
          </Button>
          <span className="text-muted-foreground">Trang {pageInfo.page}/{pageInfo.total_pages}</span>
          <Button variant="outline" size="sm" disabled={(filters.page ?? 1) >= pageInfo.total_pages || isFetching} onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>
            Sau
          </Button>
        </div>
      )}
    </div>
  );
}

function DiffBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <pre className="max-h-48 overflow-auto rounded bg-card p-2 text-xs">
        {data ? JSON.stringify(data, null, 2) : '—'}
      </pre>
    </div>
  );
}
