import type { ReactNode } from 'react';
import { BedDouble, CalendarDays, Home, QrCode, RefreshCw } from 'lucide-react';

/**
 * Khung split-screen dùng chung cho MỌI trang auth (login/register/forgot/reset)
 * — panel thương hiệu trái + form panel phải. API giống AuthCard cũ
 * (title/description/children/footer) nhưng đồng bộ giao diện với login.
 */
const HIGHLIGHTS = [
  { icon: CalendarDays, text: 'Calendar phòng × ngày — kéo thả đổi phòng, chống trùng tuyệt đối' },
  { icon: QrCode, text: 'VietQR động, tự đối soát ngân hàng trong vài giây' },
  { icon: RefreshCw, text: 'Đồng bộ 2 chiều Airbnb / Booking / Agoda' },
  { icon: BedDouble, text: 'Thuê giờ, ngày, tháng — bán từng phòng hoặc nguyên căn' },
] as const;

export interface AuthSplitLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  /** Link điều hướng phụ dưới form (vd "Đã có tài khoản? → Đăng nhập"). */
  footer?: ReactNode;
}

export function AuthSplitLayout({ title, description, children, footer }: AuthSplitLayoutProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-600 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-300/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Home className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">PMS Homestay</span>
        </div>

        <div className="relative max-w-md">
          <p className="text-3xl font-bold leading-tight">
            Vận hành homestay nhẹ nhàng như một cuốn lịch
          </p>
          <p className="mt-3 text-teal-50/90">
            Một nơi cho đặt phòng, dòng tiền, dọn phòng và kênh OTA — xây cho chủ nhà Việt Nam.
          </p>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-teal-50">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-teal-100/70">Dùng thử miễn phí 14 ngày · Không cần thẻ</p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Home className="size-5" />
            </span>
            <span className="text-lg font-semibold">PMS Homestay</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </section>
    </div>
  );
}
