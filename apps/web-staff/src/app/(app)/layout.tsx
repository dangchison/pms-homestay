import { BottomTabs } from '@/components/BottomTabs';

/**
 * Layout app nhân viên (docs/ui/02): mobile-first 360–430px, một tay.
 * TODO(task 6.6): OfflineBanner (read-cache, mutation cần mạng).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>
      <BottomTabs />
    </div>
  );
}
