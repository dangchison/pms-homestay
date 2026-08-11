import Link from 'next/link';
import { CONTACT } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-[2fr_1fr_1fr] md:px-8">
        <div className="max-w-sm">
          <p className="text-[15px] font-semibold tracking-tight">
            PMS<span className="text-ink-2">&nbsp;Homestay</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Phần mềm quản lý homestay, căn hộ dịch vụ và rent-to-rent, làm cho cách người Việt
            kinh doanh lưu trú.
          </p>
          {CONTACT.email && (
            <a
              href={`mailto:${CONTACT.email}`}
              className="mt-3 inline-block py-1.5 text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              {CONTACT.email}
            </a>
          )}
        </div>

        <nav className="grid content-start gap-2 text-sm">
          <p className="text-xs font-medium tracking-wide text-ink-2 uppercase">
            Sản phẩm
          </p>
          <Link href="/tinh-nang" className="-my-1 inline-block py-1.5 text-ink-2 transition-colors hover:text-foreground">
            Tính năng
          </Link>
          <Link href="/bang-gia" className="-my-1 inline-block py-1.5 text-ink-2 transition-colors hover:text-foreground">
            Bảng giá
          </Link>
          <Link href="/lien-he" className="-my-1 inline-block py-1.5 text-ink-2 transition-colors hover:text-foreground">
            Liên hệ
          </Link>
        </nav>

        <nav className="grid content-start gap-2 text-sm">
          <p className="text-xs font-medium tracking-wide text-ink-2 uppercase">
            Pháp lý
          </p>
          <Link href="/dieu-khoan" className="-my-1 inline-block py-1.5 text-ink-2 transition-colors hover:text-foreground">
            Điều khoản sử dụng
          </Link>
          <Link href="/bao-mat" className="-my-1 inline-block py-1.5 text-ink-2 transition-colors hover:text-foreground">
            Chính sách bảo mật
          </Link>
        </nav>
      </div>

      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs text-ink-2 md:px-8">
          © {new Date().getFullYear()} PMS Homestay.
          {CONTACT.company ? ` ${CONTACT.company}.` : ''}
        </p>
      </div>
    </footer>
  );
}
