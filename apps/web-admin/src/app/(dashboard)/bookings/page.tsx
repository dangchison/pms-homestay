import { BedDouble } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function BookingsPage() {
  return (
    <PlaceholderPage
      icon={BedDouble}
      title="Đặt phòng"
      description="Danh sách booking với filter trạng thái/nguồn/khoảng ngày, tạo booking kèm báo giá sống, check-in/out, đổi phòng — chống overbooking tuyệt đối ở DB."
      plan="Sprint 3 · task 2.6–2.8 + 6.3"
    />
  );
}
