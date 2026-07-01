import ExcelJS from 'exceljs';

/**
 * Dựng phiếu khai báo tạm trú cho người nước ngoài (mẫu NA17) — task 9.3, docs/12 §2.
 * Thuần: nhận dữ liệu 1 khai báo (số thị thực + số hộ chiếu ĐÃ giải mã) → trả Buffer
 * .xlsx dạng phiếu key/value. KHÔNG chạm DB/crypto (decrypt + audit nằm ở service).
 * Mỗi khách nước ngoài = 1 phiếu NA17 riêng (khác báo cáo lưu trú TT56 dạng bảng).
 */

export interface Na17Data {
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  passport_number: string | null; // = số giấy tờ của guest (hộ chiếu), đã giải mã
  visa_type: string | null;
  visa_number: string | null; // đã giải mã (hoặc null nếu miễn/không có/lỗi)
  visa_expiry: string | null;
  date_of_entry: string | null;
  port_of_entry: string | null;
  intended_departure: string | null;
  residence_address: string; // nơi tạm trú = địa chỉ cơ sở
  check_in: string;
  check_out: string;
  booking_code: string;
}

export async function buildNa17Workbook(data: Na17Data): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PMS Homestay';
  const ws = wb.addWorksheet('NA17');

  const title = ws.addRow(['PHIẾU KHAI BÁO TẠM TRÚ CHO NGƯỜI NƯỚC NGOÀI (Mẫu NA17)']);
  ws.mergeCells(1, 1, 1, 2);
  title.getCell(1).font = { bold: true, size: 14 };
  title.getCell(1).alignment = { horizontal: 'center' };
  ws.addRow([]); // dòng trống

  const fields: [string, string][] = [
    ['Họ và tên', data.full_name],
    ['Giới tính', data.gender ?? ''],
    ['Ngày sinh', data.date_of_birth ?? ''],
    ['Quốc tịch', data.nationality ?? ''],
    ['Số hộ chiếu/giấy tờ', data.passport_number ?? ''],
    ['Loại thị thực', data.visa_type ?? ''],
    ['Số thị thực', data.visa_number ?? ''],
    ['Ngày hết hạn thị thực', data.visa_expiry ?? ''],
    ['Ngày nhập cảnh', data.date_of_entry ?? ''],
    ['Cửa khẩu nhập cảnh', data.port_of_entry ?? ''],
    ['Ngày dự kiến rời đi', data.intended_departure ?? ''],
    ['Nơi tạm trú', data.residence_address],
    ['Thời gian lưu trú', `${data.check_in} → ${data.check_out}`],
    ['Mã đặt phòng', data.booking_code],
  ];
  for (const [label, value] of fields) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true };
  }
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 44;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
