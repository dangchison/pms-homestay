import ExcelJS from 'exceljs';

/**
 * Dựng workbook báo cáo lưu trú công an (Thông tư 56) — task 7.2, docs/12 §2.
 * Thuần: nhận rows (số giấy tờ ĐÃ giải mã) → trả Buffer .xlsx. KHÔNG chạm DB/crypto
 * (decrypt + audit nằm ở service). Cột theo dữ liệu cần khai báo (docs/12 §2 — mỗi
 * quận có thể yêu cầu khác; đây là form tổng quát đủ trường).
 */

export interface PoliceReportRow {
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  id_document_type: string | null;
  id_document_number: string | null; // đã giải mã (hoặc null nếu không có/giải mã lỗi)
  id_document_issue_date: string | null;
  id_document_issue_place: string | null;
  address: string | null;
  phone: string | null;
  check_in: string;
  check_out: string;
  booking_code: string;
}

export interface PoliceReportMeta {
  property_name: string;
  from: string;
  to: string;
}

const COLUMNS: { header: string; width: number }[] = [
  { header: 'STT', width: 6 },
  { header: 'Họ và tên', width: 26 },
  { header: 'Ngày sinh', width: 14 },
  { header: 'Giới tính', width: 10 },
  { header: 'Quốc tịch', width: 12 },
  { header: 'Loại giấy tờ', width: 12 },
  { header: 'Số giấy tờ', width: 20 },
  { header: 'Ngày cấp', width: 14 },
  { header: 'Nơi cấp', width: 28 },
  { header: 'Địa chỉ thường trú', width: 32 },
  { header: 'Số điện thoại', width: 16 },
  { header: 'Ngày đến', width: 22 },
  { header: 'Ngày đi', width: 22 },
  { header: 'Mã đặt phòng', width: 18 },
];

export async function buildPoliceReportWorkbook(
  rows: PoliceReportRow[],
  meta: PoliceReportMeta,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PMS Homestay';
  const ws = wb.addWorksheet('Lưu trú');

  const title = ws.addRow(['DANH SÁCH KHÁCH LƯU TRÚ (Thông tư 56/2017/TT-BCA)']);
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  title.getCell(1).font = { bold: true, size: 14 };
  title.getCell(1).alignment = { horizontal: 'center' };

  const sub = ws.addRow([`Cơ sở: ${meta.property_name} — Từ ${meta.from} đến ${meta.to}`]);
  ws.mergeCells(2, 1, 2, COLUMNS.length);
  sub.getCell(1).alignment = { horizontal: 'center' };

  ws.addRow([]); // dòng trống

  const header = ws.addRow(COLUMNS.map((c) => c.header));
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', wrapText: true };
  });
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  rows.forEach((r, idx) => {
    ws.addRow([
      idx + 1,
      r.full_name,
      r.date_of_birth ?? '',
      r.gender ?? '',
      r.nationality ?? '',
      r.id_document_type ?? '',
      r.id_document_number ?? '',
      r.id_document_issue_date ?? '',
      r.id_document_issue_place ?? '',
      r.address ?? '',
      r.phone ?? '',
      r.check_in,
      r.check_out,
      r.booking_code,
    ]);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
