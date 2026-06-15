import { NextResponse, type NextRequest } from 'next/server';

const SYSTEM_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'staff']);

/**
 * Tenant subdomain → header X-Tenant-Slug cho server components (docs/13 §3).
 * Auth redirect KHÔNG đặt ở đây: access token in-memory + refresh cookie HttpOnly
 * scoped `/api/v1/auth` → middleware không đọc được phiên. Gate ở client (AuthGate,
 * task 6.1) thử refresh khi mở app rồi redirect /login nếu chưa đăng nhập.
 */
export function middleware(req: NextRequest) {
  const hostname = (req.headers.get('host') ?? '').split(':')[0] ?? '';
  const parts = hostname.split('.');
  const sub = parts.length >= 3 ? parts[0]! : undefined;

  if (sub && !SYSTEM_SUBDOMAINS.has(sub) && hostname !== 'localhost') {
    const headers = new Headers(req.headers);
    headers.set('x-tenant-slug', sub);
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
