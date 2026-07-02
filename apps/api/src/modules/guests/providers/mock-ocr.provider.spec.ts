import { describe, expect, it } from 'vitest';
import { ScanIdResponseSchema } from '@pms/shared-types';
import { MockOcrProvider } from './mock-ocr.provider';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TWELVE_DIGITS_RE = /^\d{12}$/;

/**
 * ★ Đợt 4 / M3 (docs/18): MockOcrProvider thuần (KHÔNG cần app — theo convention KHÔNG
 * dùng overrideProvider). Chứng minh determinism độc lập: cùng image_key → cùng
 * document_number (12 chữ số); 2 key khác → doc_number khác; mọi field non-null hợp lệ,
 * dob/issue_date đúng ISO, và toàn bộ khớp Zod ScanIdResponseSchema.
 */
describe('MockOcrProvider (M3)', () => {
  const provider = new MockOcrProvider();

  it('name = mock', () => {
    expect(provider.name).toBe('mock');
  });

  it('cùng image_key gọi 2 lần → document_number GIỐNG NHAU và là 12 chữ số', async () => {
    const a = await provider.scan('cccd/t1/a/front.jpg');
    const b = await provider.scan('cccd/t1/a/front.jpg');
    expect(a.document_number).toBe(b.document_number);
    expect(a.document_number).toMatch(TWELVE_DIGITS_RE);
    // Toàn bộ payload tất định (không chỉ số giấy tờ).
    expect(a).toEqual(b);
  });

  it('2 image_key KHÁC nhau → document_number KHÁC nhau', async () => {
    const a = await provider.scan('cccd/t1/a/front.jpg');
    const b = await provider.scan('cccd/t1/b/front.jpg');
    expect(a.document_number).not.toBe(b.document_number);
    expect(a.document_number).toMatch(TWELVE_DIGITS_RE);
    expect(b.document_number).toMatch(TWELVE_DIGITS_RE);
  });

  it('mọi field non-null hợp lệ; dob/issue_date đúng ISO; khớp Zod schema', async () => {
    const out = await provider.scan('cccd/tenant-x/uuid-123/front.jpg');
    // Không field nào null (mock luôn sinh đủ).
    for (const [k, v] of Object.entries(out)) {
      expect(v, `field ${k} phải non-null`).not.toBeNull();
    }
    expect(out.document_type).toBe('CCCD');
    expect(out.nationality).toBe('VN');
    expect(out.date_of_birth).toMatch(ISO_DATE_RE);
    expect(out.issue_date).toMatch(ISO_DATE_RE);
    expect(out.gender === 'NAM' || out.gender === 'NỮ').toBe(true);
    // Khớp shape/kiểu Zod ScanIdResponse (mọi field đúng schema — không cần app).
    expect(ScanIdResponseSchema.safeParse(out).success).toBe(true);
  });

  it('ISO date sinh ra luôn là ngày hợp lệ (day 1–28, month 1–12) qua nhiều key', async () => {
    for (let i = 0; i < 200; i++) {
      const out = await provider.scan(`cccd/t/${i}/front.jpg`);
      const dob = new Date(`${out.date_of_birth}T00:00:00Z`);
      const issue = new Date(`${out.issue_date}T00:00:00Z`);
      expect(Number.isNaN(dob.getTime())).toBe(false);
      expect(Number.isNaN(issue.getTime())).toBe(false);
      // Round-trip: chuỗi in lại đúng (không bị Date chuẩn hoá vì ngày không hợp lệ).
      expect(dob.toISOString().slice(0, 10)).toBe(out.date_of_birth);
      expect(issue.toISOString().slice(0, 10)).toBe(out.issue_date);
    }
  });
});
