# 09 — FINANCE & ACCOUNTING

> **Phiên bản 3.0 (2026-06-10):** áp dụng [ADR-0003](adr/0003-financial-ledger.md) + amendment — booking↔invoice **1:N** theo `invoices.kind`, luồng **cọc qua DEPOSIT invoice** (phá vòng lặp confirm-cần-cọc), **billing-cycle hằng tháng** cho thuê tháng, hoa hồng OTA một đường ghi, P&L đọc rollup, đối soát **Casso/SePay webhook ngay trong MVP**.

## 1. Luồng tài chính tổng thể

```
Booking ──┬─→ DEPOSIT invoice  (issue tại PENDING — tiền cọc, là LIABILITY)
          ├─→ STAY invoice     (issue tại check-out — tiền phòng + phụ thu − cấn cọc)
          ├─→ MONTHLY_RENT invoice × N (thuê tháng: mỗi tháng 1 hoá đơn)
          └─→ ADJUSTMENT invoice (sửa sai/forfeit cọc — thay vì sửa hoá đơn đã phát hành)
                  │
                  └─ Payments (1 invoice ↔ nhiều payment; refund trừ vào paid)

Operational Expenses (gồm OTA commission auto-sinh) ──→ P&L
Asset Purchases ──→ Depreciation Entries (monthly) ──→ P&L
Night-audit (hằng đêm) ──→ no-show, PENDING hết hạn, OVERDUE, rollup daily_property_stats
```

## 2. Quy tắc bất biến

1. **Mọi tiền tệ là BIGINT VND.** Làm tròn duy nhất qua `roundVnd()` của `packages/pricing-engine` — cấm `Math.round` rải rác.
2. **`invoices.total_vnd = SUM(invoice_items.amount_vnd)`** — enforce trigger; items chỉ sửa được khi DRAFT.
3. **`invoices.paid_vnd`** — enforce trigger, đúng cả khi refund:
   ```sql
   paid_vnd = COALESCE(SUM(amount_vnd)          FILTER (WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED')), 0)
            - COALESCE(SUM(refunded_amount_vnd) FILTER (WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED')), 0);
   ```
   `balance_vnd` là generated column `total_vnd - paid_vnd`.
4. **Invoice đã ISSUED không sửa items.** Sai → VOID (giữ số, không gap — luật kế toán) + phát hành invoice mới / ADJUSTMENT.
5. **Payment SUCCEEDED chỉ refund, không xoá. Booking không bao giờ xoá** (chỉ CANCELLED/NO_SHOW/CHECKED_OUT).
6. **Cọc ≠ doanh thu:** cọc là **nợ phải trả (liability)** tới khi cấn vào STAY invoice lúc check-out (hoặc forfeit khi hủy). Doanh thu ghi nhận tại CHECKED_OUT.
7. **Một nguồn sự thật tiền:** invoice + payment. `bookings.total_amount_vnd` chỉ là snapshot giá đã chốt (read-only); không có cột paid/deposit trên bookings.
8. **Mọi mutation tài chính ghi audit log.**
9. (Phase 2) **Immutable ledger** `ledger_entries` — bút toán kép CASH/AR/DEPOSIT_LIABILITY/REVENUE, số dư derive bằng SUM; xem ADR-0003 §5.

## 3. State machine

### Invoice

```
DRAFT ──issue──→ ISSUED ──(partial)──→ PARTIALLY_PAID ──(full)──→ PAID ──(refund all)──→ REFUNDED
   │                │                                              
   │                └──(due date qua, chưa đủ tiền — night-audit set)──→ OVERDUE
   └──(delete khi chưa issue)──→ ✕        ISSUED/OVERDUE ──(void + lý do)──→ VOID
```

### Booking & thời điểm sinh invoice

```
HOLD ──(10')──→ CANCELLED(HOLD_EXPIRED)
HOLD ──confirm-flow──→ PENDING ──(cọc PAID hoặc OWNER force)──→ CONFIRMED ──checkin──→ CHECKED_IN ──checkout──→ CHECKED_OUT
                          │                                        │                       │ (night-audit, quá giờ không đến)
                          │ hết hạn cọc (night-audit)              │ cancel                ▼
                          ▼                                        ▼                    NO_SHOW
                      CANCELLED                                CANCELLED
```

| Thời điểm | Hành động tài chính |
|-----------|---------------------|
| `PENDING` | Issue **DEPOSIT invoice** (theo `rate_plans.deposit_type/value`; nếu `NONE` → bỏ qua, OWNER có thể confirm trực tiếp). Set `bookings.expires_at` = hạn cọc (mặc định 24h) |
| Cọc SUCCEEDED | Booking tự động → `CONFIRMED` |
| `CHECKED_OUT` | Issue **STAY invoice**: line items từ quote snapshot + phụ thu phát sinh (minibar, dịch vụ, điện nước HOURLY/DAILY) + line `DEPOSIT_APPLIED` **âm** (cấn cọc, `ref_invoice_id` → DEPOSIT invoice). Đồng thời auto-sinh expense OTA_COMMISSION (§6) |
| Hủy có cọc | Theo chính sách: refund payment trên DEPOSIT invoice, hoặc forfeit (DEPOSIT giữ PAID — ghi nhận doanh thu hủy qua ADJUSTMENT note) |
| Thuê tháng | **Billing-cycle job** (§4.5) sinh MONTHLY_RENT invoice mỗi tháng; STAY invoice cuối chỉ quyết toán phần còn lại |

> Vòng lặp cũ "confirm cần cọc → cọc cần invoice → invoice chỉ có khi confirm" được phá bằng DEPOSIT invoice issue ngay tại PENDING.

## 4. Hoá đơn

### 4.1. Số chứng từ

`INV-YYYYMM-NNNN` / `BK-YYYYMM-NNNN` — sinh từ bảng **`document_counters`** (`03` §4.6): `UPDATE ... SET current_value = current_value + 1 ... RETURNING` (UPSERT + row lock) — atomic, liên tục, không gap, reset theo (tenant, tháng). Đây là cách **duy nhất** (không dùng sequence-per-tenant — tích lũy hàng nghìn sequence; không dùng Snowflake — mất ý nghĩa đếm).

### 4.2. DEPOSIT invoice

- 1 line item `ROOM_CHARGE` mô tả "Đặt cọc booking BK-…", amount = chính sách cọc.
- Trạng thái vận hành như invoice thường (ISSUED → PAID). VietQR động sinh theo invoice này.

### 4.3. STAY invoice

- Items: copy từ `quotes.line_items` (snapshot lúc đặt) + phụ thu phát sinh + `DEPOSIT_APPLIED` âm.
- `balance_vnd` còn lại là số khách trả nốt lúc check-out.

### 4.4. ADJUSTMENT invoice

Dùng khi: sửa sai hoá đơn đã ISSUED (sau khi VOID), thu thêm sau check-out, ghi nhận cọc bị forfeit.

### 4.5. MONTHLY_RENT — billing cycle thuê tháng

Cron ngày 1 hằng tháng (một phần của night-audit đêm 30/31 → sáng mùng 1):

1. Tìm booking `mode=MONTHLY`, status `CHECKED_IN` (đang ở).
2. Mỗi booking sinh 1 invoice `kind=MONTHLY_RENT`, `billing_period='YYYY-MM'`:
   - Tiền nhà: full tháng hoặc pro-rate /30 cho tháng đầu/cuối.
   - Điện nước: từ `monthly_meter_readings` kỳ trước (kWh/m³ × đơn giá plan — default giá EVN, xem `12` §7). Chưa có chỉ số → tạo invoice DRAFT + notification nhắc ghi chỉ số.
3. `UNIQUE (booking_id, billing_period)` ở mức nghiệp vụ — job chạy lại không sinh trùng (idempotent theo `(kind, booking_id, billing_period)`).

## 5. Thanh toán

### Phương thức MVP

| Phương thức | Implementation |
|-------------|----------------|
| Tiền mặt | STAFF/MANAGER ghi nhận, SUCCEEDED ngay |
| VietQR động (NAPAS 247) | QR sinh per-invoice; **tự đối soát qua webhook Casso/SePay (MVP)** |
| Chuyển khoản thường | Ghi nhận thủ công khi đối soát |
| OTA collected | SUCCEEDED, method `OTA_COLLECTED` (tiền OTA giữ — không qua quỹ ta) |
| Momo/ZaloPay/thẻ | Phase 2 |

### VietQR động

- Sinh chuỗi EMVCo/NAPAS (spec chi tiết: `12` §5), `addInfo = booking_code`.
- `GET /api/v1/invoices/{id}/qr-image` → PNG/SVG. QR **động** (có amount + nội dung) để bot ngân hàng/Casso nhận diện — không dùng QR tĩnh.

### Đối soát tự động — Casso/SePay (NÂNG LÊN MVP)

Đây là tính năng "wow" với host VN (quét QR → hệ thống tự xác nhận trong vài giây) và chi phí tích hợp thấp (webhook đã thiết kế):

```
POST /api/v1/webhook/payment/:provider     (HMAC verify + dedup webhook_events_received)
Body: { transaction_id, amount, content, bank_account, received_at, ... }
```

**Matching đa tiêu chí có confidence** (không chỉ regex):
1. Parse `content` tìm `BK-\d{6}-\d{4}` / `INV-\d{6}-\d{4}`.
2. Chấm điểm: khớp mã (+50) · khớp amount với một payment PENDING (+30) · thời gian gần QR issue (+10) · đúng tài khoản nhận (+10).
3. Confidence cao (≥80) → auto-confirm payment SUCCEEDED → trigger cập nhật invoice → emit `payment.received` (SSE + notification).
4. Thấp hơn → ghi `unmatched_payments` cho host đối soát tay (màn hình riêng — `ui/01`).

Fallback luôn tồn tại: ghi nhận thủ công (cách 3 cũ). Webhook lỗi không chặn vận hành.

### Refund

`POST /api/v1/payments/:id/refund` (reason bắt buộc, permission `payment.refund`): tăng `refunded_amount_vnd`, status `PARTIALLY_REFUNDED`/`REFUNDED`; trigger tự tính lại `paid_vnd` (công thức §2.3); audit log.

## 6. Hoa hồng OTA — MỘT đường ghi

- `bookings.commission_vnd` = input snapshot (từ iCal/Channex hoặc nhập tay).
- Khi booking `CHECKED_OUT`: hệ thống **auto-sinh** `operational_expenses(expense_type='OTA_COMMISSION', source_booking_id=...)` — partial unique index bảo đảm mỗi booking sinh đúng 1 lần.
- **P&L đọc chi phí hoa hồng DUY NHẤT từ expenses** — không bao giờ cộng `bookings.commission_vnd` trực tiếp (double-count).

## 7. Khấu hao (Depreciation)

Cron ngày 1 hằng tháng, per tenant ACTIVE:

```typescript
async runMonthlyDepreciation(tenantId: string, year: number, month: number) {
  await withTenant(this.prisma, tenantId, async (tx) => {
    const periodEnd = endOfMonth(new Date(year, month - 1));
    const assets = await tx.asset.findMany({
      where: { purchase_date: { lte: periodEnd }, OR: [{ disposal_date: null }, { disposal_date: { gt: periodEnd } }] },
    });
    // Chống N+1: lấy accumulated của TẤT CẢ asset trong 1 query
    const accMap = await this.accumulatedByAsset(tx, assets.map(a => a.id));   // GROUP BY asset_id

    const entries = assets.flatMap(asset => {
      const monthIndex = monthsBetween(startOfMonth(asset.purchase_date), periodEnd);  // 0-based
      if (monthIndex < 0 || monthIndex >= asset.depreciation_months) return [];

      const base = asset.purchase_value_vnd - asset.residual_value_vnd;
      const acc = accMap.get(asset.id) ?? 0;
      let amount: number;
      if (monthIndex === asset.depreciation_months - 1) {
        amount = base - acc;                       // THÁNG CUỐI = PLUG phần dư — triệt tiêu lệch làm tròn,
      } else {                                     // bảo đảm accumulated cuối == base, book_value == residual
        const prorate = monthIndex === 0 ? firstMonthProrate(asset.purchase_date) : 1;
        amount = roundVnd((base / asset.depreciation_months) * prorate);
      }
      return [{ asset_id: asset.id, period_year: year, period_month: month,
                amount_vnd: amount, accumulated_vnd: acc + amount,
                book_value_vnd: asset.purchase_value_vnd - (acc + amount) }];
    });
    await tx.depreciationEntry.createMany({ data: entries, skipDuplicates: true });  // idempotent re-run
  });
}
```

Thanh lý: nhập `disposal_date` + `disposal_value_vnd` → entry DISPOSAL (lãi/lỗ = book_value − disposal_value), dừng sinh tháng kế.

## 8. Báo cáo P&L

### Cấu trúc

```
DOANH THU            — room (invoice_items ROOM_CHARGE), dịch vụ (SURCHARGE/AMENITY/UTILITY), khác
CHI PHÍ TRỰC TIẾP    — thuê chủ nhà (RENT_LANDLORD), điện nước, vật tư, hoa hồng OTA (auto, §6)
LỢI NHUẬN GỘP        = Revenue − Direct cost
CHI PHÍ VẬN HÀNH     — lương, marketing, bảo trì, khấu hao (depreciation_entries)
LỢI NHUẬN HOẠT ĐỘNG  = Gross − OpEx       → Thuế (estimate) → LỢI NHUẬN RÒNG
```

**Nguyên tắc ghi nhận:** doanh thu tính theo invoice ISSUED+ (loại DRAFT/VOID), phân bổ theo ngày check-out (DAILY/HOURLY) hoặc `billing_period` (MONTHLY). Cọc chưa cấn không phải doanh thu.

### Nguồn dữ liệu: rollup, KHÔNG SUM real-time

- `GET /api/v1/reports/pnl?property_id=...&from=...&to=...` đọc **`daily_property_stats`** (ngày quá khứ, night-audit đã fill) + tính live **chỉ phần ngày hôm nay**. Expenses/depreciation đọc trực tiếp (bảng nhỏ).
- Lý do: SUM toàn bộ invoice_items theo period là O(số booking) mỗi lần xem dashboard — đạt budget <1s hôm nay nhưng vỡ khi dữ liệu tích lũy nhiều năm; rollup giữ chi phí đọc O(số ngày).

## 9. Night-audit job (hằng đêm, per tenant — giờ chạy theo timezone property, mặc định 02:00)

Nghiệp vụ "chốt ngày" chuẩn PMS — một BullMQ job tổng hợp, các bước **idempotent** (chạy lại không sinh đôi):

| Bước | Hành động |
|------|-----------|
| 1. No-show | Booking `CONFIRMED` có `check_in` quá X giờ (config, mặc định qua nửa đêm) mà không check-in → `NO_SHOW` + xoá occupancy + notification (chính sách cọc no-show áp dụng) |
| 2. PENDING hết hạn | `PENDING` có `expires_at < now()` (hạn cọc) → `CANCELLED (DEPOSIT_TIMEOUT)` + xoá occupancy |
| 3. OVERDUE | Invoice ISSUED/PARTIALLY_PAID có `due_date < today` → `OVERDUE` + emit `invoice.overdue` |
| 4. Rollup | Fill `daily_property_stats` cho ngày vừa qua (available/occupied room-nights, revenue, ADR, RevPAR) |
| 5. Billing tháng | Ngày 1: chạy billing-cycle MONTHLY_RENT (§4.5) + depreciation (§7) + recurring expenses |
| 6. Retention | Dọn theo matrix `03` §7 (idempotency_keys, outbox PROCESSED, sync_logs, quotes hết hạn) |

## 10. Break-even Occupancy

```
ADR     = room_revenue / occupied_room_nights        (từ daily_property_stats)
RevPAR  = room_revenue / available_room_nights
V_day   = chi phí biến đổi / occupied_room_night     (utility + amenities + cleaning supplies)
F_fixed = thuê chủ nhà + lương + bảo hiểm + khấu hao tháng

Break-even occupancy = F_fixed / ((ADR − V_day) × available_room_nights) × 100%
```

`GET /api/v1/reports/break-even?property_id=...&period=2026-06` → 3 kịch bản: pessimistic (ADR thấp nhất 12 tháng), realistic (trung bình 6 tháng), optimistic (cao nhất 12 tháng) + occupancy/ADR/RevPAR hiện tại. (Response mẫu giữ nguyên như bản cũ.)

## 11. Compliance kế toán VN (phase 2 — không MVP)

- Hoá đơn điện tử NĐ 123/2020 + TT 78/2021: tích hợp VNPT/Viettel/MISA/Easyinvoice qua API, bảng `e_invoices` (xem `12` §6).
- Báo cáo doanh thu thuế (01/GTGT); sổ kế toán TT 200/2014 nếu là doanh nghiệp.
- MVP: in PDF "biên lai thu tiền" có MST tenant (nếu có). Hồ sơ tài chính giữ ≥10 năm (legal-hold — `12` §4).
