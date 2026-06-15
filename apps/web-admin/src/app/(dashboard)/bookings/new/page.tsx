import { CalendarPlus } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/** B2 — đích của "Đặt nhanh"/"+ Đặt" từ calendar (prefill resource_id/check_in/check_out qua query). */
export default function NewBookingPage() {
  return (
    <PlaceholderPage
      icon={CalendarPlus}
      title="Đặt phòng mới"
      description="Form tạo + báo giá sống: chọn phòng, khoảng ngày, khách → quote, cọc, submit (Idempotency-Key). Calendar đã truyền sẵn phòng & ngày qua URL."
      plan="Sprint 3 · task 6.3 (booking form + quote)"
    />
  );
}
