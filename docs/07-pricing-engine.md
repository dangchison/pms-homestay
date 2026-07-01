# 07 — PRICING ENGINE

> **Phiên bản 3.0 (2026-06-10):** giá gán theo **bookable resource** (không phải room — ADR-0006); quote **persist DB** (bảng `quotes`); mọi phép tính ngày chạy theo **timezone của property** (sửa lỗi lệch ngày lễ khi tính bằng UTC); lịch lễ đọc từ bảng `vietnam_holidays` (nguồn duy nhất).

## 1. Bài toán

Giá không nằm trên `rooms`:
- Giá thay đổi theo mùa, ngày trong tuần, lễ tết.
- Nhiều resource chia sẻ cùng gói giá (rate plan); nguyên căn (`WHOLE`) có giá **riêng**, không phải tổng giá phòng con.
- Cần preview giá ở cả FE và BE, kết quả phải **tái lập được** (re-calculate xác định khi verify lúc tạo booking).

→ **Pricing Engine = pure function** trong `packages/pricing-engine`, dùng chung BE (chốt giá) và FE (preview). Không import NestJS, không chạm DB — mọi dữ liệu (plan, rules, holidays, timezone) đi vào qua **input**.

## 2. Mô hình

```
RatePlan (theo property + mode, gán cho resource qua rate_plan_resources)
  ├─ base_price_vnd, version (bump khi sửa giá)
  ├─ deposit_type/value (chính sách cọc — dùng sinh DEPOSIT invoice, xem 09)
  ├─ config theo HOURLY / DAILY / MONTHLY
  └─ RatePlanRule[] (mùa, ngày trong tuần, lễ — KHÔNG cho 2 rule cùng priority chồng ngày)

QuoteInput  = { resource, plan(+version), check_in, check_out, mode, adults, children,
                propertyTimezone, holidays: Date[] }   // holidays từ bảng vietnam_holidays
QuoteOutput = { line_items[], subtotal, discount, tax, total, breakdown }
```

**Quy tắc tiền tệ:** mọi phép nhân/chia đi qua **một hàm làm tròn duy nhất** `roundVnd()` (round-half-up về VND nguyên) export từ package này — finance (`09`) dùng lại, cấm tự `Math.round` rải rác.

## 3. Công thức HOURLY

### Input
- `H_base`: số giờ gói cơ bản (vd 2h) · `P_base`: giá gói (vd 150.000).
- `block_minutes` (30/60) + `P_extra_per_block`.
- `overnight_window` (vd 22:00→06:00) + `P_overnight`.

### Thuật toán

```typescript
function quoteHourly(input: HourlyQuoteInput, plan: HourlyRatePlan): Quote {
  const minutes = differenceInMinutes(input.checkOut, input.checkIn);
  if (minutes <= 0) throw new PricingError('CHECKOUT_BEFORE_CHECKIN');

  const baseMinutes = plan.baseHours * 60;
  const extraMinutes = Math.max(0, minutes - baseMinutes);     // dưới gói base vẫn tính đủ gói
  const extraBlocks = Math.ceil(extraMinutes / plan.blockMinutes);

  const baseAmount = plan.basePriceVnd;
  const extraAmount = extraBlocks * plan.extraBlockPriceVnd;

  // Phụ thu đêm: tính MỘT LẦN cho MỖI cửa sổ đêm mà khoảng ở giao cắt
  // (booking <24h chỉ có thể giao 1 cửa sổ; booking dài ngày giao N đêm → N lần)
  const overnightCount = countOvernightWindows(
    input.checkIn, input.checkOut,
    plan.overnightStart, plan.overnightEnd, input.propertyTimezone,
  );
  const overnightAmount = overnightCount * plan.overnightSurchargeVnd;

  return buildQuote([
    line('ROOM_CHARGE', `Gói ${plan.baseHours}h cơ bản`, 1, baseAmount),
    ...(extraBlocks > 0 ? [line('SURCHARGE', `Thêm ${extraBlocks} block × ${plan.blockMinutes} phút`, extraBlocks, plan.extraBlockPriceVnd)] : []),
    ...(overnightCount > 0 ? [line('SURCHARGE', 'Phụ thu đêm', overnightCount, plan.overnightSurchargeVnd)] : []),
  ]);
}
```

### Ví dụ (H_base=2h, P_base=150k, block=30min, P_extra=25k, P_overnight=200k)

| Khoảng ở | Kết quả |
|----------|---------|
| 13:00 → 14:30 (1.5h) | 150k (tính đủ gói base) |
| 13:00 → 16:15 (3.25h) | 150k + ceil(75/30)=3 block × 25k = 225k |
| 21:00 → 03:00 (qua 1 đêm) | 150k + 8 block × 25k + 200k = 550k |

## 4. Công thức DAILY

### Nguyên tắc số 1: TÍNH NGÀY THEO TIMEZONE CỦA PROPERTY

`check_in` là `timestamptz` (UTC). **Mọi phép "rơi vào ngày nào / thứ mấy / có phải ngày lễ"** phải convert sang `property.timezone` trước:
`2026-05-23T18:00:00Z` = **01:00 ngày 24/5 giờ VN** — bucket theo UTC sẽ áp giá nhầm ngày (sai cả weekend lẫn lễ Tết). Engine nhận `propertyTimezone` trong input và dùng `date-fns-tz` để lấy "local date".

### Số đêm

`nights` = số lần khoảng ở đi qua mốc `checkout_time` theo giờ địa phương. Xấp xỉ đúng cho mọi case thông thường: `nights = differenceInCalendarDays(localDate(checkOut), localDate(checkIn))`, tối thiểu 1. (Check-in 23:00, check-out 06:00 hôm sau = 1 đêm; 14:00 ngày 23 → 12:00 ngày 25 = 2 đêm.)

### Thuật toán

```typescript
function quoteDaily(input: DailyQuoteInput, plan: DailyRatePlan): Quote {
  const tz = input.propertyTimezone;
  const nights = computeNights(input.checkIn, input.checkOut, tz);
  const items: LineItem[] = [];

  for (let i = 0; i < nights; i++) {
    const nightDate = addDays(localDate(input.checkIn, tz), i);   // LOCAL date, không phải UTC
    const price = computeNightPrice(plan, nightDate, input.holidays);
    items.push(line('ROOM_CHARGE', `Đêm ${formatDate(nightDate, 'vi')}`, 1, price));
  }

  // Phụ phí sớm/trễ: so sánh ĐẦY ĐỦ giờ:phút theo giờ địa phương (không so sánh mỗi .hour)
  const localIn = localTime(input.checkIn, tz);                   // 'HH:mm'
  const localOut = localTime(input.checkOut, tz);
  if (localIn < plan.checkinTime) items.push(line('SURCHARGE', 'Nhận phòng sớm', 1, plan.earlyCheckinFeeVnd));
  if (localOut > plan.checkoutTime) items.push(line('SURCHARGE', 'Trả phòng trễ', 1, plan.lateCheckoutFeeVnd));

  return buildQuote(items);
}

function computeNightPrice(plan: DailyRatePlan, date: LocalDate, holidays: Set<string>): number {
  // Rules đã được validate khi ghi: KHÔNG có 2 rule cùng priority chồng ngày.
  // Tie-break phòng hờ: created_at (xác định) — không bao giờ theo id UUID.
  const applicable = plan.rules
    .filter(r => matchesDate(r, date, holidays))
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

  let price = plan.basePriceVnd;
  for (const rule of applicable) {
    switch (rule.priceModifierType) {
      case 'OVERRIDE': return rule.priceModifierValue;
      case 'FIXED':    price += rule.priceModifierValue; break;
      case 'PERCENT':  price = roundVnd(price * (1 + rule.priceModifierValue / 10000)); break; // 1500 = +15%
    }
  }
  return price;
}
```

### Lịch lễ Việt Nam — bảng `vietnam_holidays` là NGUỒN DUY NHẤT

- Tết âm + **ngày nghỉ bù** do Chính phủ công bố **hằng năm**, thay đổi mỗi năm → **không hardcode** trong package (`holidays.ts` của package chỉ chứa *type*, không chứa data).
- Service load holidays từ DB → truyền vào engine qua input (giữ pure-function). FE preview nhận holidays qua API quote response.
- Seed khi deploy (`scripts/seed-prod-required.ts`) + nhắc cập nhật yearly (alert tháng 11 nếu năm sau chưa có data).

## 5. Công thức MONTHLY

```typescript
function quoteMonthly(input: MonthlyQuoteInput, plan: MonthlyRatePlan): Quote {
  const tz = input.propertyTimezone;
  const months = differenceInCalendarMonths(localDate(input.checkOut, tz), localDate(input.checkIn, tz));
  const partialDays = computePartialDays(input.checkIn, input.checkOut, months, tz);
  const dayRate = roundVnd(plan.basePriceVnd / 30);   // quy ước /30 cố định, kể cả tháng 28-31 ngày

  return buildQuote([
    ...(months > 0 ? [line('ROOM_CHARGE', `${months} tháng`, months, plan.basePriceVnd)] : []),
    ...(partialDays > 0 ? [line('ROOM_CHARGE', `${partialDays} ngày lẻ`, partialDays, dayRate)] : []),
  ], plan.includesUtilities ? null : 'Điện/nước tính theo chỉ số, xuất hoá đơn hằng tháng');
}
```

- Quote MONTHLY chỉ là **báo giá kỳ đầu**. Vận hành thực tế: job billing-cycle sinh `MONTHLY_RENT` invoice mỗi tháng (tiền nhà + điện nước từ `monthly_meter_readings`) — xem `09` §4.5. Giá điện default = giá EVN (ràng buộc pháp lý — `12` §7).

## 6. Quote: persist + verify

### Endpoint

```
POST /api/v1/pricing/quote
{
  "resource_id": "uuid",
  "rate_plan_id": "uuid",          // optional, default plan của resource
  "mode": "DAILY",
  "check_in": "2026-06-23T07:00:00Z",
  "check_out": "2026-06-25T05:00:00Z",
  "adults": 2, "children": 1
}
```

Server tính bằng engine → **INSERT bảng `quotes`** (line_items, totals, `rate_plan_version`, `expires_at = now()+15'` — schema: `03` §4.4) → trả về kèm `quote_id`.

> Quote nằm trong **DB**, không phải Redis — Redis evict là mất quote giữa lúc khách thao tác. Cron dọn quote hết hạn >7 ngày.

### Verify khi tạo booking

1. FE gửi `quote_id` trong `POST /bookings`.
2. BE kiểm: quote tồn tại, chưa hết hạn, đúng resource/khoảng ở, **re-calculate** bằng engine với plan version hiện tại.
3. Khớp → tạo booking, set `quotes.used_by_booking_id`, copy `line_items` vào invoice DRAFT.
4. Lệch (giá đã đổi / quote hết hạn) → `409 PRICE_CHANGED` — FE re-quote và hiển thị giá mới cho khách xác nhận.

`rate_plans.version` bump mỗi lần sửa giá → mọi re-calculate là xác định, phục vụ cả audit/tranh chấp giá.

## 7. Discount & Promotion (Wave-1 #4 — đã triển khai)

`discount_codes` (bảng ở migration 0032, link `quotes.discount_code_id` ở 0033): code per tenant (CITEXT), FIXED (VND) / PERCENT (basis-point 0..10000), min order, max uses, validity window (closed-interval), `applicable_property_ids` (NULL = MỌI property, KHÁC `[]` = KHÔNG property nào).

### Áp mã vào báo giá (task 9.4c)

`POST /api/v1/pricing/quote` nhận thêm field **optional** `discount_code`:

```
POST /api/v1/pricing/quote
{ ...quote fields..., "discount_code": "SUMMER25" }   // discount_code optional
```

- KHÔNG gửi `discount_code` → báo giá y hệt trước (backward-compatible tuyệt đối).
- Có mã hợp lệ → server áp qua `DiscountsService` (CÙNG tx, RLS + property đã-resolve của quote):
  `discount_vnd = engineDiscount + voucher`, thêm 1 dòng `line_items` loại `DISCOUNT` (amount âm),
  `total_vnd = subtotal − discount_vnd + tax`, ghi `quotes.discount_code_id`, echo `discount_code` trong response.
  Số tiền voucher: FIXED = min(value, subtotal) (cap, không âm total); PERCENT = `roundVnd(subtotal × value / 10000)`
  (basis-point, half-away-from-zero — tính DUY NHẤT ở `DiscountsService.evaluate`).
- Mã KHÔNG hợp lệ (NOT_FOUND / INACTIVE / EXPIRED / NOT_STARTED / BELOW_MIN_ORDER / PROPERTY_NOT_ELIGIBLE /
  USAGE_LIMIT_REACHED) → **422 `DISCOUNT_NOT_APPLICABLE`** (RFC7807; `reason_code` ở `detail`), **KHÔNG persist quote**
  (báo giá nguyên tử — áp sạch hoặc từ chối, để booking sau không âm thầm rớt voucher).

`verifyQuoteForBooking` (khi tạo booking) so tổng ENGINE (vô-cảm-voucher) với tổng **TRƯỚC voucher** của quote
(`total_vnd + (discount_vnd − engineDiscount)`) — booking có voucher KHÔNG bị 409 PRICE_CHANGED oan; đổi giá thật vẫn 409.
Redeem `used_count` (atomic, exactly-once, chống double-spend) ở tx booking — task 9.4b, không đổi.

### Pre-check voucher (FE, task 9.4c)

`GET /api/v1/discount-codes/:code/validate?subtotal_vnd=<int>&property_id=<uuid>` — gate `booking.read` (read-only),
trả **200** `{ valid, discount_vnd, reason_code }` (số khớp byte-for-byte với áp-mã-lúc-báo-giá). Mã không tồn tại
(kể cả cross-tenant do RLS ẩn) → 200 `{ valid:false, reason_code:'NOT_FOUND' }` (KHÔNG 404 — an toàn làm gate FE, không lộ tồn tại).

## 8. Test cases bắt buộc

| Case | Mong đợi |
|------|----------|
| Hourly: 1h < base 2h | Tính đủ giá base |
| Hourly: 4h, base 2h, block 30', extra 25k | base + 4 block × 25k |
| Hourly: 21:00 → 02:00 | 1 lần phụ thu đêm |
| Daily: 1 đêm weekend, rule +20% | base × 1.2 (qua roundVnd) |
| Daily: 3 đêm gồm 1 đêm lễ (OVERRIDE, priority cao) | base + base + giá lễ |
| Daily: check-in 11:00 (sớm hơn 14:00) | Có early fee |
| **Daily: check-in 18:30 UTC = 01:30 VN hôm sau** | Đêm đầu tính theo **ngày VN**, không lệch |
| **Daily: đêm 30 Tết (nghỉ bù trong `vietnam_holidays`)** | Rule HOLIDAY ăn — data từ input, không hardcode |
| Monthly: 1.5 tháng | 1 tháng + 15 ngày × (base/30) |
| Quote 16 phút → tạo booking | 409 PRICE_CHANGED |
| Sửa giá plan sau khi quote (version bump) | 409 PRICE_CHANGED |
| 2 rule cùng priority chồng ngày | **Bị từ chối khi ghi rule** (validation) |
