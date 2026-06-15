import { redirect } from 'next/navigation';

export default function RootPage() {
  // → /today; AuthGate (khu app) bootstrap phiên: chưa đăng nhập sẽ chuyển /login.
  redirect('/today');
}
