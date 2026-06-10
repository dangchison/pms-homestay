import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="text-muted-foreground">Trang không tồn tại</p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        Về trang chủ
      </Link>
    </main>
  );
}
