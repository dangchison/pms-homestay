import { Card, CardContent } from '@pms/ui';
import { Sparkles } from 'lucide-react';

/**
 * T5 /cleaning — task của tôi / của property (docs/ui/02).
 * Nối GET /cleaning-tasks ở task 6.6 (cleaning module: task 4.1).
 */
export default function CleaningPage() {
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dọn phòng</h1>
        <p className="text-sm text-muted-foreground">Công việc được giao cho bạn</p>
      </header>

      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-5 text-primary" />
          </span>
          <p className="mt-1 text-sm font-medium">Chưa có công việc nào</p>
          <p className="max-w-[280px] text-xs text-muted-foreground">
            Task dọn phòng tự sinh sau mỗi check-out và hiện ở đây kèm thông báo
            (Sprint 5 · task 4.1)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
