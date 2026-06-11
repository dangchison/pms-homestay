import { Card, CardContent, HousekeepingDot, Skeleton } from '@pms/ui';
import { BedDouble } from 'lucide-react';

/**
 * T7 /rooms — room board (docs/ui/02): grid phòng, mỗi ô = số phòng +
 * housekeeping dot + icon có khách; chạm đổi trạng thái theo quyền.
 * Nối GET /rooms/board ở task 6.6 (sau khi rooms có ở task 2.1).
 */
export default function RoomsBoardPage() {
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Phòng</h1>
        <p className="text-sm text-muted-foreground">Trạng thái buồng phòng theo cơ sở</p>
      </header>

      {/* Chú giải màu — ngôn ngữ chung toàn hệ thống (docs/ui/00 §3) */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <HousekeepingDot status="CLEAN" showLabel />
          <HousekeepingDot status="DIRTY" showLabel />
          <HousekeepingDot status="CLEANING" showLabel />
          <HousekeepingDot status="INSPECTION" showLabel />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-8">
          <div className="grid grid-cols-3 gap-3 opacity-50">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <div className="mt-6 flex flex-col items-center gap-2 text-center">
            <BedDouble className="size-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Chưa có phòng nào</p>
            <p className="max-w-[260px] text-xs text-muted-foreground/60">
              Phòng sẽ xuất hiện khi chủ nhà khai báo cơ sở & phòng (Sprint 2 · task 2.1)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
