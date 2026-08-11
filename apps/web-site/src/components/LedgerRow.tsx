import { Reconcile } from '@/components/Reconcile';

/**
 * Một dòng của tờ đối soát: vế trái là những mảnh đang rời, vế phải là cùng việc
 * đó đã khớp. Đường kẻ dọc giữa hai vế chạy suốt trang — nó là xương sống bố cục.
 *
 * Dưới 768px hai vế xếp chồng và đường kẻ dọc biến mất; thứ tự đọc vẫn là
 * rời-trước-khớp-sau, nên lập luận không vỡ khi hết chỗ.
 */
export function LedgerRow({
  job,
  pain,
  scraps,
  surface,
}: {
  /** Việc phải làm, gọi đúng tên nghề. */
  job: string;
  /** Câu đau nhất của việc đó — cụ thể, không tính từ. */
  pain: string;
  scraps: React.ReactNode;
  surface: React.ReactNode;
}) {
  return (
    <Reconcile className="relative grid gap-8 py-14 md:grid-cols-2 md:gap-14 md:py-20">
      <span
        aria-hidden
        className="ledger-rule absolute inset-y-0 left-1/2 hidden w-px md:block"
      />

      <div className="md:pr-2">
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{job}</h2>
        <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-ink-2">{pain}</p>
        <div className="mt-6 grid gap-2.5 sm:max-w-md">{scraps}</div>
      </div>

      <div className="md:pl-2">{surface}</div>
    </Reconcile>
  );
}
