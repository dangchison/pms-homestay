import Link from 'next/link';
import { Button } from '@pms/ui';
import { ArrowLeft, type LucideIcon } from 'lucide-react';

/**
 * Empty-state cho route đã spec nhưng feature thuộc sprint sau —
 * mọi trang phải có trạng thái empty có hướng dẫn (docs/ui/00 §2.6).
 */
export function PlaceholderPage({
  icon: Icon,
  title,
  description,
  plan,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** vd: "Sprint 3 · task 6.2" */
  plan: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <Icon className="size-7 text-primary" />
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      <span className="mt-3 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
        Theo lộ trình: {plan}
      </span>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/">
          <ArrowLeft className="size-4" />
          Về Tổng quan
        </Link>
      </Button>
    </div>
  );
}
