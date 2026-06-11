import { ReceiptText } from 'lucide-react';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';

export default function InvoicesPage() {
  return (
    <PlaceholderPage
      icon={ReceiptText}
      title="Hoá đơn & Thanh toán"
      description="Hoá đơn cọc/lưu trú/thuê tháng, thu tiền VietQR quét-là-tick-xanh (tự đối soát Casso/SePay), refund và màn đối soát giao dịch chưa khớp."
      plan="Sprint 4 · task 3.2–3.4 + 6.4"
    />
  );
}
