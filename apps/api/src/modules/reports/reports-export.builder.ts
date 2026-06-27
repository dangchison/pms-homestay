import ExcelJS from 'exceljs';
import type { OccupancyReportResponse, PnlResponse } from '@pms/shared-types';

/**
 * Dựng workbook Excel báo cáo tài chính (A3 F3 — phần 2). Thuần: nhận dữ liệu báo
 * cáo ĐÃ tính (P&L + occupancy) → trả Buffer .xlsx. KHÔNG chạm DB (đọc rollup nằm ở
 * service). Hai sheet: "Tổng quan" (P&L + KPI + chi phí theo loại) và "Lấp đầy theo
 * ngày" (mỗi ngày 1 dòng — nguồn cho kế toán đối chiếu). [[reports.service]]
 */

export interface ReportsExportInput {
  property_name: string;
  from: string;
  to: string;
  pnl: PnlResponse;
  occupancy: OccupancyReportResponse;
}

/** Nhãn tiếng Việt cho các loại chi phí (đồng bộ docs/09 §8). */
const EXPENSE_LABELS: Record<string, string> = {
  RENT_LANDLORD: 'Thuê nhà',
  STAFF_SALARY: 'Lương nhân viên',
  ELECTRICITY: 'Điện',
  WATER: 'Nước',
  GAS: 'Gas',
  AMENITIES: 'Vật dụng',
  CLEANING_SUPPLIES: 'Đồ dọn phòng',
  OTA_COMMISSION: 'Hoa hồng OTA',
  PLATFORM_FEE: 'Phí nền tảng',
  DEPRECIATION: 'Khấu hao',
  MARKETING: 'Marketing',
  MAINTENANCE: 'Bảo trì',
  OTHER: 'Khác',
};

const VND_FMT = '#,##0" ₫"';
const PCT_FMT = '0.0"%"';

function titleRow(ws: ExcelJS.Worksheet, text: string): void {
  const row = ws.addRow([text]);
  row.font = { bold: true, size: 13 };
  ws.addRow([]);
}

function kpiRow(ws: ExcelJS.Worksheet, label: string, value: number, fmt = VND_FMT): void {
  const row = ws.addRow([label, value]);
  row.getCell(1).font = { color: { argb: 'FF555555' } };
  row.getCell(2).numFmt = fmt;
  row.getCell(2).alignment = { horizontal: 'right' };
}

/** Header xám cho 1 dòng tiêu đề bảng. */
function headerRow(ws: ExcelJS.Worksheet, cells: string[]): void {
  const row = ws.addRow(cells);
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
}

export async function buildReportsWorkbook(input: ReportsExportInput): Promise<Buffer> {
  const { pnl, occupancy } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PMS Homestay';

  // ── Sheet 1: Tổng quan (P&L + KPI + chi phí) ──────────────────────────────
  const s1 = wb.addWorksheet('Tổng quan');
  s1.columns = [{ width: 28 }, { width: 20 }];
  titleRow(s1, `Báo cáo tài chính — ${input.property_name}`);
  s1.addRow([`Kỳ: ${input.from} → ${input.to}`]).font = { italic: true, color: { argb: 'FF888888' } };
  s1.addRow([]);

  s1.addRow(['Doanh thu']).font = { bold: true };
  kpiRow(s1, 'Doanh thu phòng', pnl.revenue_room_vnd);
  kpiRow(s1, 'Doanh thu khác', pnl.revenue_other_vnd);
  kpiRow(s1, 'Tổng doanh thu', pnl.revenue_total_vnd);
  s1.addRow([]);

  s1.addRow(['Chi phí & lợi nhuận']).font = { bold: true };
  kpiRow(s1, 'Chi phí trực tiếp', pnl.direct_cost_vnd);
  kpiRow(s1, 'Lợi nhuận gộp', pnl.gross_profit_vnd);
  kpiRow(s1, 'Chi phí vận hành', pnl.operating_cost_vnd);
  kpiRow(s1, 'Khấu hao', pnl.depreciation_vnd);
  kpiRow(s1, 'Lợi nhuận hoạt động', pnl.operating_profit_vnd);
  kpiRow(s1, 'Thuế ước tính', pnl.tax_estimate_vnd);
  kpiRow(s1, 'Lợi nhuận ròng', pnl.net_profit_vnd);
  s1.lastRow!.font = { bold: true };
  s1.lastRow!.getCell(2).numFmt = VND_FMT;
  s1.addRow([]);

  s1.addRow(['Chỉ số vận hành']).font = { bold: true };
  kpiRow(s1, 'Đêm phòng khả dụng', pnl.available_room_nights, '#,##0');
  kpiRow(s1, 'Đêm phòng đã bán', pnl.occupied_room_nights, '#,##0');
  kpiRow(s1, 'Tỷ lệ lấp đầy', pnl.occupancy_rate_pct, PCT_FMT);
  kpiRow(s1, 'ADR (giá phòng TB)', pnl.adr_vnd);
  kpiRow(s1, 'RevPAR', pnl.revpar_vnd);

  const expenseEntries = Object.entries(pnl.expense_by_type).filter(([, v]) => v > 0);
  if (expenseEntries.length > 0) {
    s1.addRow([]);
    s1.addRow(['Chi phí theo loại']).font = { bold: true };
    for (const [type, amount] of expenseEntries) {
      kpiRow(s1, EXPENSE_LABELS[type] ?? type, amount);
    }
  }

  // ── Sheet 2: Lấp đầy theo ngày ────────────────────────────────────────────
  const s2 = wb.addWorksheet('Lấp đầy theo ngày');
  s2.columns = [
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
  ];
  headerRow(s2, [
    'Ngày',
    'Đêm khả dụng',
    'Đêm đã bán',
    'Lấp đầy',
    'ADR',
    'RevPAR',
    'Doanh thu phòng',
  ]);
  for (const d of occupancy.days) {
    const row = s2.addRow([
      d.stat_date,
      d.available_room_nights,
      d.occupied_room_nights,
      d.occupancy_rate_pct,
      d.adr_vnd,
      d.revpar_vnd,
      d.room_revenue_vnd,
    ]);
    row.getCell(4).numFmt = PCT_FMT;
    row.getCell(5).numFmt = VND_FMT;
    row.getCell(6).numFmt = VND_FMT;
    row.getCell(7).numFmt = VND_FMT;
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
