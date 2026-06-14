import JSZip from 'jszip';

/**
 * Dựng gói data-export (Right to Access + Portability, NĐ13 — task 7.3) → zip
 * chứa JSON từng nhóm dữ liệu của khách. Thuần (jszip in-memory) → Buffer; service
 * lo gom data + giải mã + audit. Dữ liệu khách nhỏ nên zip trong RAM đủ (job stream
 * + signed link async là mở rộng sau cho export lớn).
 */

export interface DataExportBundle {
  profile: Record<string, unknown>;
  consents: unknown[];
  bookings: unknown[];
  invoices: unknown[];
}

const README = [
  'Gói dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP — quyền truy cập & chuyển dữ liệu).',
  '',
  '- profile.json   : thông tin cá nhân (gồm số giấy tờ đã giải mã).',
  '- consents.json  : lịch sử đồng ý/thu hồi xử lý dữ liệu.',
  '- bookings.json  : lịch sử đặt phòng/lưu trú.',
  '- invoices.json  : hoá đơn liên quan.',
  '',
  'Đây là dữ liệu của chính chủ thể, cung cấp theo yêu cầu hợp lệ.',
].join('\n');

/** Prisma trả BigInt (cột tiền) + Date → JSON.stringify cần replacer (BigInt ném mặc định). */
function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);
}

export async function buildDataExportZip(bundle: DataExportBundle): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('README.txt', README);
  zip.file('profile.json', json(bundle.profile));
  zip.file('consents.json', json(bundle.consents));
  zip.file('bookings.json', json(bundle.bookings));
  zip.file('invoices.json', json(bundle.invoices));
  return zip.generateAsync({ type: 'nodebuffer' });
}
