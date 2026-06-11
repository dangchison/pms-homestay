import Link from 'next/link';
import { Home } from 'lucide-react';

/**
 * Khung card giữa màn cho register/forgot/reset (docs/ui/01 nhóm A) —
 * đồng bộ brand với trang login split-screen.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-teal-50/60 to-background p-4">
      <div className="w-full max-w-md">
        <Link href="/login" className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Home className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">PMS Homestay</span>
        </Link>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <div className="mt-6">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}
