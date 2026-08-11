import Link from 'next/link';
import { LOGIN_URL, REGISTER_URL } from '@/lib/site';

const NAV = [
  { href: '/tinh-nang', label: 'Tính năng' },
  { href: '/bang-gia', label: 'Bảng giá' },
  { href: '/lien-he', label: 'Liên hệ' },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5 md:px-8">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">
          PMS<span className="text-ink-2">&nbsp;Homestay</span>
        </Link>
        <nav className="hidden flex-1 items-center gap-6 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-sm text-ink-2 transition-colors hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <a
            href={LOGIN_URL}
            className="hidden rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:text-foreground sm:inline-block"
          >
            Đăng nhập
          </a>
          <a
            href={REGISTER_URL}
            className="rounded-md bg-primary-strong px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-strong-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Dùng thử
          </a>
        </div>
      </div>

      {/*
        Dưới 640px thanh trên chỉ đủ chỗ cho logo và nút chính, nên điều hướng
        xuống hàng riêng thay vì biến mất. Khách xem trên điện thoại vẫn phải
        tới được bảng giá mà không cần cuộn hết trang xuống footer.
      */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-1.5 whitespace-nowrap sm:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="shrink-0 rounded-md px-2.5 py-2 text-sm text-ink-2 transition-colors hover:text-foreground"
          >
            {n.label}
          </Link>
        ))}
        <a
          href={LOGIN_URL}
          className="ml-auto shrink-0 rounded-md px-2.5 py-2 text-sm text-ink-2 transition-colors hover:text-foreground"
        >
          Đăng nhập
        </a>
      </nav>
    </header>
  );
}
