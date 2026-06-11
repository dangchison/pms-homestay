import { roundVnd } from './round';
import {
  type DepositType,
  type LineItemType,
  type PricingMode,
  type Quote,
  type QuoteLineItem,
} from './types';
import { type VietnamHoliday } from './holiday.types';

/** Tạo một dòng giá; amount = roundVnd(quantity × unitPrice) nếu không truyền tường minh. */
export function line(
  type: LineItemType,
  description: string,
  quantity: number,
  unitPriceVnd: number,
  localDate?: string,
): QuoteLineItem {
  return {
    type,
    description,
    quantity,
    unitPriceVnd,
    amountVnd: roundVnd(quantity * unitPriceVnd),
    ...(localDate ? { localDate } : {}),
  };
}

/** Cọc theo chính sách plan (docs/09 §4): FIXED = số tuyệt đối; PERCENT = basis point của total. */
export function computeDeposit(
  totalVnd: number,
  depositType: DepositType | undefined,
  depositValue: number | undefined,
): number {
  switch (depositType) {
    case 'FIXED':
      return depositValue ?? 0;
    case 'PERCENT':
      return roundVnd((totalVnd * (depositValue ?? 0)) / 10_000);
    default:
      return 0;
  }
}

interface BuildArgs {
  mode: PricingMode;
  lineItems: QuoteLineItem[];
  depositType?: DepositType;
  depositValue?: number;
  holidays: VietnamHoliday[];
  notes?: string;
}

/** Tổng hợp line items → subtotal/discount/tax/total + cọc (một chỗ duy nhất). */
export function buildQuote(args: BuildArgs): Quote {
  let subtotalVnd = 0;
  let discountVnd = 0;
  let taxVnd = 0;
  for (const li of args.lineItems) {
    if (li.type === 'DISCOUNT') discountVnd += -li.amountVnd; // DISCOUNT lưu amount âm
    else if (li.type === 'TAX') taxVnd += li.amountVnd;
    else subtotalVnd += li.amountVnd;
  }
  const totalVnd = subtotalVnd - discountVnd + taxVnd;
  return {
    mode: args.mode,
    lineItems: args.lineItems,
    subtotalVnd,
    discountVnd,
    taxVnd,
    totalVnd,
    depositVnd: computeDeposit(totalVnd, args.depositType, args.depositValue),
    holidays: args.holidays,
    ...(args.notes ? { notes: args.notes } : {}),
  };
}
