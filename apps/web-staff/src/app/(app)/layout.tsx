import { AuthGate } from '@/components/auth/AuthGate';
import { OfflineBanner } from '@/components/OfflineBanner';
import { BottomTabs } from '@/components/BottomTabs';

/**
 * Layout app nhân viên (docs/ui/02): mobile-first 360–430px, một tay. AuthGate
 * bootstrap phiên + SSE; OfflineBanner cho read-cache only (docs/13 §4).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <OfflineBanner />
        <main className="flex-1 px-4 pb-24 pt-4">{children}</main>
        <BottomTabs />
      </div>
    </AuthGate>
  );
}
