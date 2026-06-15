import { Home, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Màn loading branded toàn màn hình (AuthGate bootstrap + Next loading.tsx). CSS
 * thuần (animate-ping built-in + .pms-loading-bar) → render TỨC THÌ, không cần
 * motion lib. Logo nhịp ping + thanh tiến trình trượt + chấm nảy so le.
 */
export function LoadingScreen({
  title = 'PMS Homestay',
  label = 'Đang tải…',
  icon: Icon = Home,
  className,
}: {
  title?: string;
  label?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-dvh flex-col items-center justify-center gap-7 bg-background',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative flex size-16 items-center justify-center">
        {/* vòng ping lan toả phía sau logo */}
        <span
          className="absolute inset-0 animate-ping rounded-2xl bg-primary/25"
          style={{ animationDuration: '1.6s' }}
        />
        <span className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-600 text-white shadow-lg">
          <Icon className="size-8" />
        </span>
      </div>

      <div className="flex flex-col items-center gap-3">
        <span className="text-base font-semibold tracking-tight text-foreground">{title}</span>
        {/* thanh tiến trình vô định trượt */}
        <div className="h-1 w-44 overflow-hidden rounded-full bg-muted">
          <div className="pms-loading-bar h-full w-2/5 rounded-full bg-primary" />
        </div>
        {/* 3 chấm nảy so le (dự phòng khi reduced-motion tắt thanh trượt) */}
        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
