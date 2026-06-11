import { Settings } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function SettingsPage() {
  return (
    <PlaceholderPage
      icon={Settings}
      title="Cài đặt"
      description="Người dùng & phân quyền theo cơ sở, gói dịch vụ & thanh toán SaaS, bảo mật (2FA — backend đã sẵn sàng), audit log, tuân thủ NĐ13."
      plan="Sprint 5–6 · task 6.7 (users/billing/audit/compliance)"
    />
  );
}
