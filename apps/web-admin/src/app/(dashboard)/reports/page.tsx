import { BarChart3 } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function ReportsPage() {
  return (
    <PlaceholderPage
      icon={BarChart3}
      title="Báo cáo"
      description="P&L theo cơ sở, điểm hoà vốn 3 kịch bản, occupancy/ADR/RevPAR — đọc từ rollup đêm, không query nặng lúc xem."
      plan="Sprint 5 · task 3.7 + 6.5"
    />
  );
}
