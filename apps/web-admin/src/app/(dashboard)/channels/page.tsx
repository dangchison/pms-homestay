import { Share2 } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function ChannelsPage() {
  return (
    <PlaceholderPage
      icon={Share2}
      title="Kênh OTA"
      description="Đồng bộ 2 chiều Airbnb / Booking / Agoda qua iCal theo từng resource: pull lịch về chặn phòng, push lịch đi kèm sanity-guard chống hủy nhầm."
      plan="Sprint 5 · task 5.1–5.3"
    />
  );
}
