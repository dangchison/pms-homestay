import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pms/ui';

const KPIS = [
  { label: 'Phòng đang ở', value: '—', hint: 'occupancy hôm nay' },
  { label: 'Khách đến hôm nay', value: '—', hint: 'arrivals' },
  { label: 'Khách đi hôm nay', value: '—', hint: 'departures' },
  { label: 'Doanh thu tháng', value: '—', hint: 'đã thu (VND)' },
] as const;

/** Dashboard tổng quan (ui/01) — số liệu thật nối ở task 6.1/6.5. */
export default function DashboardPage() {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Tổng quan</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-3xl">{kpi.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{kpi.hint}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
