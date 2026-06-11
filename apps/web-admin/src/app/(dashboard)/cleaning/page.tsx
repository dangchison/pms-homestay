import { Sparkles } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function CleaningPage() {
  return (
    <PlaceholderPage
      icon={Sparkles}
      title="Dọn phòng"
      description="Board công việc buồng phòng: tự sinh task sau check-out, gán người dọn, ảnh trước/sau, đổi trạng thái phòng."
      plan="Sprint 5 · task 4.1"
    />
  );
}
