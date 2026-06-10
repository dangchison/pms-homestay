/**
 * CHỈ type — DATA ngày lễ nằm ở bảng `vietnam_holidays` (docs/13 §6),
 * được load ở modules/pricing và truyền vào engine qua input.
 */
export interface VietnamHoliday {
  /** YYYY-MM-DD (theo dương lịch, đã quy đổi nếu là lễ âm lịch) */
  date: string;
  name: string;
  /** Hệ số giá lễ có thể khác cuối tuần — rule cụ thể ở rate_plan_rules */
  isLunarBased?: boolean;
}
