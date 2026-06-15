import { ClipboardList } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

/** B3 — đích "Mở chi tiết" từ bar calendar. */
export default function BookingDetailPage() {
  return (
    <PlaceholderPage
      icon={ClipboardList}
      title="Chi tiết đặt phòng"
      description="Timeline trạng thái, thông tin khách (PII mask), hoá đơn liên quan, nguồn OTA + các thao tác check-in/out/hủy/đổi phòng."
      plan="EPIC 6 · task B3 (booking detail)"
    />
  );
}
