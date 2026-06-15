import { AuthGate } from '@/components/auth/AuthGate';
import { OfflineBanner } from '@/components/OfflineBanner';

/**
 * Layout cho luồng tập trung (check-in/check-out): có AuthGate + OfflineBanner
 * nhưng KHÔNG bottom tabs — toàn màn hình, có nút quay lại trong từng trang.
 */
export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <OfflineBanner />
        <main className="flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</main>
      </div>
    </AuthGate>
  );
}
