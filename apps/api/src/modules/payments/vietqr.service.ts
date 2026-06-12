import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

/** EMVCo TLV: id(2) + length(2, zero-pad) + value. */
function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, '0') + value;
}

/**
 * CRC16-CCITT (FALSE): poly 0x1021, init 0xFFFF — chuẩn checksum EMVCo/NAPAS.
 * Tính trên toàn chuỗi payload GỒM cả "6304" (tag+len của CRC), value để trống.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface VietQrInput {
  bankBin: string; // NAPAS acquirer BIN: '970422' (MB), '970436' (VCB)
  accountNumber: string;
  amount: number; // VND integer
  addInfo: string; // booking_code — để bot ngân hàng/Casso match
}

/**
 * ★ VietQR động NAPAS 247 (docs/12 §5). Pure builder + render PNG. KHÔNG state —
 * QR sinh on-demand theo số dư invoice tại thời điểm hỏi.
 */
@Injectable()
export class VietqrService {
  buildPayload(input: VietQrInput): string {
    // tag 38 — Merchant Account Information (NAPAS)
    const merchantAccount =
      tlv('00', 'A000000727') + // GUID NAPAS
      tlv('01', tlv('00', input.bankBin) + tlv('01', input.accountNumber)) + // acquirer + số TK
      tlv('02', 'QRIBFTTA'); // service code: chuyển khoản kèm nội dung
    const withoutCrc =
      tlv('00', '01') + // payload format indicator
      tlv('01', '12') + // 12 = QR động (có amount); 11 = tĩnh
      tlv('38', merchantAccount) +
      tlv('53', '704') + // currency VND (ISO 4217)
      tlv('54', String(input.amount)) +
      tlv('58', 'VN') + // country
      tlv('62', tlv('08', input.addInfo)) + // additional data → purpose (08)
      '6304'; // CRC tag(63) + len(04); value nối ngay sau
    return withoutCrc + crc16ccitt(withoutCrc);
  }

  async toPng(payload: string): Promise<Buffer> {
    return QRCode.toBuffer(payload, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 320 });
  }
}
