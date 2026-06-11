import { CalendarDays } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/** C1 — màn hình lõi: timeline phòng × ngày (docs/ui/01 §C). */
export default function CalendarPage() {
  return (
    <PlaceholderPage
      icon={CalendarDays}
      title="Lịch phòng"
      description="Timeline phòng × ngày: kéo chọn để đặt, kéo-thả đổi phòng, màu theo trạng thái booking, dot buồng phòng. Đây là màn hình trung tâm của hệ thống."
      plan="Sprint 3 · task 6.2 (calendar timeline tự dựng: Grid + TanStack Virtual + dnd-kit)"
    />
  );
}
