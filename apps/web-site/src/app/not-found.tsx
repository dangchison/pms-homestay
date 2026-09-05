import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-5 py-24 md:px-8 md:py-32">
      <h1 className="text-3xl font-semibold tracking-tight">Không có trang này</h1>
      <p className="text-[15px] leading-relaxed text-ink-2">
        Đường dẫn bạn mở không tồn tại hoặc đã đổi.
      </p>
      <Link
        href="/"
        className="mt-2 justify-self-start rounded-md border border-input px-5 py-3 text-sm font-medium transition-colors hover:bg-primary-muted"
      >
        Về trang chủ
      </Link>
    </main>
  );
}
