/**
 * Vercel Routing Middleware — chặn toàn site bằng HTTP Basic Auth.
 *
 * Web API chuẩn (Request/Response), KHÔNG import `next/server`, không dependency.
 * Chạy trên Edge runtime (mặc định của Routing Middleware — không khai `runtime`).
 *
 * Thông tin đăng nhập lấy từ biến môi trường AUTH_USER / AUTH_PASS, đặt trên
 * Vercel cho cả Production lẫn Preview. TUYỆT ĐỐI không hardcode vào file này.
 */

/** Loại trừ đường dẫn nội bộ của Vercel; còn lại chặn hết, kể cả `/`. */
export const config = {
  matcher: '/((?!_vercel).*)',
};

const REALM = 'Tracking';

/**
 * `process` không có sẵn kiểu khi không cài `@types/node`. Đọc qua `globalThis`
 * để giữ đúng kiểu mà vẫn không cần thêm dependency nào.
 */
type EnvBag = { process?: { env?: Record<string, string | undefined> } };
const env = (globalThis as unknown as EnvBag).process?.env ?? {};

function unauthorized(): Response {
  return new Response('401 Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      // Không để CDN/trình duyệt giữ lại trang 401 rồi trả cho lần sau.
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

/**
 * So sánh chuỗi theo thời gian hằng định: dồn hiệu qua XOR trên TOÀN BỘ byte,
 * không thoát sớm ở byte đầu tiên lệch. Chênh lệch độ dài cũng trộn vào `diff`
 * thay vì return sớm — return sớm sẽ để lộ độ dài qua thời gian phản hồi.
 */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);

  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/** Giải mã phần base64 của `Authorization: Basic ...` thành chuỗi UTF-8. */
function decodeBasic(value: string): string | null {
  try {
    const binary = atob(value);
    // `atob` trả chuỗi BYTE, không phải ký tự. So thẳng sẽ sai với mật khẩu có
    // dấu tiếng Việt hay ký tự ngoài ASCII — phải dựng lại qua TextDecoder.
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null; // base64 hỏng hoặc không phải UTF-8 hợp lệ
  }
}

export default function middleware(request: Request): Response | undefined {
  const user = env.AUTH_USER;
  const pass = env.AUTH_PASS;

  // Thiếu cấu hình thì KHOÁ, không mở. Cho qua khi thiếu biến đồng nghĩa với
  // việc một lần quên set env là trang nội bộ phơi ra công khai.
  if (!user || !pass) return unauthorized();

  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Basic ')) return unauthorized();

  const decoded = decodeBasic(header.slice('Basic '.length).trim());
  if (decoded === null) return unauthorized();

  // Tách ở dấu ':' ĐẦU TIÊN — theo RFC 7617, mật khẩu được phép chứa dấu ':'.
  const sep = decoded.indexOf(':');
  if (sep === -1) return unauthorized();

  // Tính CẢ HAI vế rồi mới kết luận. Dùng `&&` sẽ ngắn mạch khi username sai,
  // bỏ qua phép so mật khẩu — chênh lệch thời gian đó tự nó tiết lộ username
  // đã đúng hay chưa, phá hỏng chính mục đích của so sánh hằng thời gian.
  const okUser = safeEqual(decoded.slice(0, sep), user);
  const okPass = safeEqual(decoded.slice(sep + 1), pass);
  if (!okUser || !okPass) return unauthorized();

  return undefined; // hợp lệ → đi tiếp tới file tĩnh
}
