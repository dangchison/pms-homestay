'use client';

import { Skeleton, cn } from '@pms/ui';
import type { BreakEvenScenario } from '@pms/shared-types';
import { vnd } from '@/lib/format';
import { useBreakEven } from '@/lib/hooks/use-reports';

const SCENARIOS = [
  { key: 'pessimistic', label: 'Bi quan', sub: 'ADR thấp nhất 12 tháng' },
  { key: 'realistic', label: 'Thực tế', sub: 'ADR TB 6 tháng' },
  { key: 'optimistic', label: 'Lạc quan', sub: 'ADR cao nhất 12 tháng' },
] as const;

export function BreakEvenReport({ propertyId, period }: { propertyId: string; period: string }) {
  const { data, isLoading } = useBreakEven(propertyId, period);
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface p-4 text-sm">
        <Stat label="Lấp đầy hiện tại" value={`${data.current_occupancy_pct.toFixed(1)}%`} />
        <Stat label="ADR hiện tại" value={vnd(data.current_adr_vnd)} />
        <Stat label="RevPAR" value={vnd(data.current_revpar_vnd)} />
        <Stat label="Chi phí cố định/tháng" value={vnd(data.fixed_cost_vnd)} />
        <Stat label="Biến đổi/đêm" value={vnd(data.variable_cost_per_night_vnd)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {SCENARIOS.map((s) => (
          <ScenarioCard
            key={s.key}
            label={s.label}
            sub={s.sub}
            scenario={data.scenarios[s.key]}
            current={data.current_occupancy_pct}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ScenarioCard({
  label,
  sub,
  scenario,
  current,
}: {
  label: string;
  sub: string;
  scenario: BreakEvenScenario;
  current: number;
}) {
  const be = scenario.break_even_occupancy_pct;
  const reached = be != null && current >= be;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">ADR {vnd(scenario.adr_vnd)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{sub}</p>
      <div className="mt-3">
        <div className="text-2xl font-semibold tabular-nums">
          {be == null ? '—' : `${be.toFixed(1)}%`}
        </div>
        <div className="text-xs text-muted-foreground">
          {be == null ? 'ADR ≤ biến đổi/đêm → không hoà vốn' : 'lấp đầy cần để hoà vốn'}
        </div>
      </div>
      {be != null && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full', reached ? 'bg-booking-confirmed' : 'bg-booking-pending')}
              style={{ width: `${Math.min(100, (current / be) * 100)}%` }}
            />
          </div>
          <p className={cn('mt-1 text-xs font-medium', reached ? 'text-booking-confirmed' : 'text-muted-foreground')}>
            {reached ? '✓ Đã vượt điểm hoà vốn' : `Còn thiếu ${(be - current).toFixed(1)}%`}
          </p>
        </>
      )}
    </div>
  );
}
