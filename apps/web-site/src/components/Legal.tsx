/**
 * Khung trang pháp lý: một cột hẹp, đo dòng khoảng 70 ký tự, phân cấp bằng cỡ và
 * màu chứ không bằng khung thẻ. Trang này để đọc, không để lướt.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** dd/MM/yyyy — ngày hiệu lực, người đọc cần biết mình đang đọc bản nào. */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 md:px-8 md:py-24">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-ink-2">Cập nhật {updated}</p>
      <div className="mt-12 grid gap-10">{children}</div>
    </main>
  );
}

export function Clause({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <div className="grid gap-3 text-[15px] leading-relaxed text-ink-2 [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  );
}

/** Chỗ phải điền thông tin pháp nhân thật trước khi mở trang ra công khai. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded-sm bg-warning-muted px-1.5 py-0.5 text-foreground not-italic">
      {children}
    </mark>
  );
}
