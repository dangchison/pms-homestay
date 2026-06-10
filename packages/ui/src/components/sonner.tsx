'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

/** Toast chuẩn hệ thống (ui/00 §4.5) — dùng <Toaster /> ở root layout. */
function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return <SonnerToaster richColors position="top-right" {...props} />;
}

export { Toaster, toast };
