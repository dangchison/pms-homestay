import { AuthGate } from '@/components/AuthGate';
import { Nav } from '@/components/Nav';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <Nav />
      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </AuthGate>
  );
}
