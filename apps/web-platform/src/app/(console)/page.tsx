import { redirect } from 'next/navigation';

/** Trang chủ console = cấu hình gói (việc hay làm nhất). */
export default function ConsoleHome() {
  redirect('/plans');
}
