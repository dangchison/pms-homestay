import { Users } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function GuestsPage() {
  return (
    <PlaceholderPage
      icon={Users}
      title="Khách"
      description="Hồ sơ khách: tìm theo tên/SĐT/4 số cuối giấy tờ, lịch sử lưu trú, blacklist. Số giấy tờ mã hoá — xem đầy đủ phải có quyền và được audit."
      plan="Sprint 2 · task 2.5 (guests + PII encryption)"
    />
  );
}
