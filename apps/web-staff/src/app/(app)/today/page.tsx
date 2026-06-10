import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pms/ui';

const SECTIONS = [
  { title: 'Khách đến (arrivals)', hint: 'Check-in hôm nay — quét CCCD ở task 7.1' },
  { title: 'Khách đi (departures)', hint: 'Check-out + thu tiền (QR/cash)' },
  { title: 'Đang ở (in-house)', hint: 'Danh sách phòng có khách' },
] as const;

/** Màn hình "Hôm nay" (ui/02 §today) — dữ liệu thật nối ở task 6.6. */
export default function TodayPage() {
  return (
    <div className="mx-auto grid max-w-md gap-4">
      <h1 className="text-xl font-semibold">Hôm nay</h1>
      {SECTIONS.map((s) => (
        <Card key={s.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{s.title}</CardTitle>
            <CardDescription>{s.hint}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Chưa có dữ liệu</CardContent>
        </Card>
      ))}
    </div>
  );
}
