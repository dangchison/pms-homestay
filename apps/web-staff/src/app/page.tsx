import { redirect } from 'next/navigation';

export default function RootPage() {
  // TODO(task 6.6): điều hướng theo trạng thái đăng nhập
  redirect('/today');
}
