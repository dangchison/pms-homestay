/**
 * Giả lập webhook chuyển khoản ngân hàng (Đợt 4/M4 — dev-only) để khép vòng đối
 * soát demo hosted booking KHÔNG cần cổng/creds thật. Script KÝ payload bằng
 * PAYMENT_WEBHOOK_SECRET (secret NỘI BỘ, không gọi bên thứ ba) đúng như Casso/SePay
 * sẽ ký, rồi POST tới webhook thật `POST /api/v1/webhook/payment/:provider`.
 *
 * Webhook thật chỉ dedup + enqueue → cần WORKER chạy (ENABLE_SCHEDULERS=true) để job
 * đối soát tới PAID. Muốn khép vòng NGAY trong 1 request (worker off), dùng endpoint
 * dev đồng bộ `POST /api/v1/dev/simulate-bank-transfer` (bật DEMO_TOOLS_ENABLED=true).
 * e2e xác thực qua endpoint dev; script này để minh hoạ luồng webhook có chữ ký.
 *
 * Chạy:
 *   pnpm demo:bank-transfer --base-url http://localhost:3001 --provider casso \
 *     --bank-account 0901234567 --amount 1500000 --content 'Thanh toan coc BK-260702-0001'
 *   # hoặc để tự dựng content:
 *   pnpm demo:bank-transfer --bank-account 0901234567 --amount 1500000 --booking-code BK-260702-0001
 *   pnpm demo:bank-transfer --bank-account 0901234567 --amount 500000 --invoice-number INV-260702-0001
 */
import { createHmac, randomUUID } from 'node:crypto';
import 'dotenv/config';

interface Args {
  baseUrl: string;
  provider: string;
  bankAccount?: string;
  amount?: number;
  content?: string;
  bookingCode?: string;
  invoiceNumber?: string;
  eventId?: string;
}

/** Parse `--flag value` (KHÔNG hỗ trợ `--flag=value` để giữ đơn giản). */
function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const amountRaw = get('--amount');
  return {
    baseUrl: get('--base-url') ?? 'http://localhost:3001',
    provider: get('--provider') ?? 'casso',
    bankAccount: get('--bank-account'),
    amount: amountRaw !== undefined ? Number(amountRaw) : undefined,
    content: get('--content'),
    bookingCode: get('--booking-code'),
    invoiceNumber: get('--invoice-number'),
    eventId: get('--event-id'),
  };
}

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function buildContent(args: Args): string {
  if (args.content) return args.content;
  if (args.invoiceNumber) return `Thanh toan hoa don ${args.invoiceNumber}`;
  if (args.bookingCode) return `Thanh toan dat phong ${args.bookingCode}`;
  return '';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    fail(
      'Thiếu PAYMENT_WEBHOOK_SECRET trong env — không thể KÝ webhook. ' +
        'Đặt biến này (khớp API) rồi chạy lại. KHÔNG gửi request khi thiếu secret.',
    );
  }
  if (!args.bankAccount) fail('Thiếu --bank-account (TK nhận đã set cho property).');
  if (args.amount === undefined || !Number.isInteger(args.amount) || args.amount <= 0) {
    fail('Thiếu/không hợp lệ --amount (số nguyên VND > 0).');
  }

  const payload = {
    event_id: args.eventId ?? randomUUID(),
    amount_vnd: args.amount,
    content: buildContent(args),
    bank_account: args.bankAccount,
    received_at: new Date().toISOString(),
  };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

  const url = `${args.baseUrl.replace(/\/$/, '')}/api/v1/webhook/payment/${args.provider}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': signature },
    body: rawBody,
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // giữ nguyên text nếu không phải JSON
  }

  // In gọn — KHÔNG log secret/chữ ký/PII, chỉ trạng thái + mã.
  console.log(`→ POST ${url}`);
  console.log(`   provider=${args.provider} event_id=${payload.event_id} amount_vnd=${payload.amount_vnd}`);
  console.log(`← HTTP ${res.status}`);
  console.log(`   ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
