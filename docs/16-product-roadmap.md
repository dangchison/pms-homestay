# 16 — PRODUCT ROADMAP SAU MVP (đề xuất tính năng)

> **Phiên bản 1.0 (2026-06-10).** Đây là **wish-list đã thẩm định kiến trúc**, KHÔNG phải cam kết giao hàng. Khi quyết định làm một tính năng → viết task vào [`14-roadmap-tasks.md`](14-roadmap-tasks.md) theo đúng chuẩn (ADR > docs 00–13/ui > 14), kèm ADR mới nếu là quyết định kiến trúc.
>
> Mốc tham chiếu: MVP go-live dự kiến **~09/2026** (sau 6 sprint — [`15`](15-sprint-plan.md)).

## 0. Nguyên tắc ưu tiên

1. **Ăn theo hạ tầng sẵn có trước** — tính năng tận dụng quote API, outbox/SSE, VietQR+Casso, OCR, ZNS, occupancy, `daily_property_stats`, `audit_logs` có chi phí biên rất thấp so với giá trị.
2. **Đúng đặc thù thị trường homestay VN:** chốt khách qua **Zalo/FB inbox** (không phải website), hộ kinh doanh **thuế khoán**, mô hình **rent-to-rent**, vận hành **không lễ tân 24/7**, chủ **vắng mặt** sợ thất thoát tiền mặt.
3. **Ưu tiên feature giữ chân / tạo lý do trả phí** (sticky) hơn feature "đẹp hồ sơ".
4. Effort: **S** = vài ngày · **M** = 1–2 sprint · **L** = nhiều sprint.

## 1. Danh mục tính năng (23 mục, 6 nhóm)

### Nhóm A — Tăng doanh thu trực tiếp cho host

| # | Tính năng | Giá trị / bối cảnh VN | Hạ tầng tận dụng | Effort | Wave |
|---|-----------|------------------------|-------------------|:------:|:----:|
| 1 | **Hosted booking page** — trang đặt phòng `book.pmsapp.vn/<slug>` per property: chọn phòng → đặt → cọc VietQR; nhúng/gửi link qua Zalo/FB | Host chốt khách qua chat là chính — gửi 1 link thay vì chat qua lại; **né hoa hồng OTA 15–20%**. Là bản "mini" thay cho cả app `web-guest` | Quote API (`07` §6), HOLD + deposit invoice (`09` §3), VietQR + Casso (`09` §5) — chủ yếu chỉ làm UI | M | **1** |
| 2 | **Dynamic pricing rule-based** — luật tự động: occupancy >X% → +Y%; đêm mồ côi (orphan night) kẹt giữa 2 booking → giảm; last-minute giảm theo giờ; min/max guardrail | Tăng RevPAR 10–20% không cần AI; host đang chỉnh giá tay theo cảm tính | `rate_plan_rules` + `daily_property_stats` (`03` §4.12) | M | 2 |
| 3 | **Upsell & service catalog** — đưa đón sân bay, thuê xe máy, ăn sáng, late-checkout; bán lúc đặt + check-in; auto-gợi ý theo booking | Doanh thu phụ 5–15%; xe máy/đưa đón là dịch vụ chuẩn homestay VN | `invoice_items` + folio check-out (`ui/03` F4) | S–M | 2 |
| 4 | **Discount codes & khuyến mãi** — voucher, giảm theo độ dài lưu trú, ưu đãi khách quay lại | Kích cầu mùa thấp; nguyên liệu cho ZNS re-marketing (#5) | Schema `discount_codes` đã thiết kế (`07` §7) | S | **1** |

### Nhóm B — Trải nghiệm khách & tự động hoá giao tiếp

| # | Tính năng | Giá trị / bối cảnh VN | Hạ tầng tận dụng | Effort | Wave |
|---|-----------|------------------------|-------------------|:------:|:----:|
| 5 | **Guest messaging tự động qua ZNS** — T-1: đường đi + giờ nhận phòng; ngày đến: wifi/mã cửa; sau checkout: cảm ơn + xin review + voucher | Giảm ~70% tin nhắn lặp của lễ tân; ZNS rẻ hơn SMS; **thấy giá trị ngay tuần đầu** | Outbox events + notification queue + Zalo OA (đã track Sprint 1) — chỉ thêm scheduler theo mốc booking | S–M | **1** |
| 6 | **Online pre-check-in** — khách nhận link, tự upload CCCD + khai thông tin + chọn giờ đến trước khi tới | Check-in tại quầy còn ~30 giây; dữ liệu báo cáo lưu trú sẵn sàng trước | OCR (`12` §3) + consent + guest form — nguyên bộ đã có | M | 2 |
| 7 | **Self check-in smart lock** (TTLock / Igloohome / PhilGate) — sinh mã cửa theo booking, gửi ZNS, thu hồi khi checkout/hủy | Mô hình **không lễ tân 24/7** rất phổ biến; là lý do host đổi PMS | Booking lifecycle events qua outbox (`10` §2) — chỉ cần adapter per hãng khoá | M | 2 |
| 8 | **Guest portal mini** (signed link, không cần tài khoản) — xem booking/hoá đơn, yêu cầu dịch vụ, **xin gia hạn lưu trú** (tự check availability) | "Cho ở thêm 1 đêm được không" thành nút bấm; giảm chat | Availability + quote + invoice API | M | 3 |
| 9 | **Review management** — tự động xin review Google Maps sau checkout, theo dõi điểm trung bình per property | Review = nguồn khách trực tiếp lớn thứ 2 sau OTA | ZNS template (#5) | S | 3 |

### Nhóm C — Vận hành sâu & chống thất thoát

| # | Tính năng | Giá trị / bối cảnh VN | Hạ tầng tận dụng | Effort | Wave |
|---|-----------|------------------------|-------------------|:------:|:----:|
| 10 | **Sổ quỹ ca + bàn giao ca** — đếm tiền đầu/cuối ca, đối chiếu tự động với payments CASH trong ca (`received_by` + timestamp), lệch → cảnh báo OWNER | **Chống thất thoát tiền mặt — nỗi đau số 1 của chủ vắng mặt**; lý do trả phí rõ ràng | `payments` đã có người nhận + thời điểm | M | **1** |
| 11 | **Báo cáo anti-fraud** — pattern: hủy-sau-thu-cash, refund bất thường theo staff, no-show có cọc bị xoá, sửa giá sau check-in | Chạy thuần trên dữ liệu sẵn có | `audit_logs` + `payments` + `booking_status_history` | S | **1** |
| 12 | **Maintenance ticketing** — housekeeper báo hỏng (ảnh) → ticket → phân công sửa → chi phí gắn asset/expense → lịch sử per phòng | Khép vòng: hỏng → sửa → chi phí → P&L | `cleaning_tasks` đã có chỗ ghi hỏng hóc (`ui/02` T6); `assets`/`expenses` | M | 2 |
| 13 | **Định mức vật tư tiêu hao** — khăn/dầu gội/nước theo phòng, trừ kho khi dọn xong, cảnh báo nhập thêm | Gắn vào cleaning checklist sẵn có | `cleaning_tasks` checklist | M | 3 |

### Nhóm D — Tài chính & quản trị nâng cao

| # | Tính năng | Giá trị / bối cảnh VN | Hạ tầng tận dụng | Effort | Wave |
|---|-----------|------------------------|-------------------|:------:|:----:|
| 14 | **Landlord statement (R2R)** — báo cáo kỳ cho chủ nhà gốc: doanh thu/chi phí/tiền thuê; hỗ trợ hợp đồng chia % doanh thu | **Differentiator** — chưa PMS VN nào làm tốt cho tệp rent-to-rent; tăng niềm tin chủ nhà gốc → host giữ được nhà | Properties R2R config (`03` §4.3) + P&L (`09` §8) — data có đủ | S–M | **1** |
| 15 | **Báo cáo thuế khoán hộ KD** — xuất doanh thu theo mẫu cho chi cục thuế | Đa số tenant là hộ KD nộp thuế khoán — tính năng "giữ chân" rất Việt Nam | Invoice data + rollup | S | 2 |
| 16 | **Ledger đầy đủ + sổ quỹ** — bút toán kép append-only, số dư derive | Nền cho e-invoice + đối soát kế toán chuẩn | Thiết kế sẵn [ADR-0003](adr/0003-financial-ledger.md) §5 | M–L | 2 |
| 17 | **e-Invoice NĐ123** (VNPT/Viettel/MISA/Easyinvoice) | Bắt buộc khi tenant là doanh nghiệp; mở tệp khách lớn hơn | Thiết kế sẵn (`12` §6, bảng `e_invoices`) | M | 2 |
| 18 | **Multi-currency hiển thị** — khách quốc tế xem giá USD (charge vẫn VND) | Tệp khách Tây ba lô Đà Lạt/Hội An | FE formatter | S | 3 |

### Nhóm E — Nền tảng SaaS (cho platform owner)

| # | Tính năng | Giá trị | Hạ tầng tận dụng | Effort | Wave |
|---|-----------|---------|-------------------|:------:|:----:|
| 19 | **Platform console** — tenants, health score (usage giảm = churn risk), impersonate-with-consent để support | Bắt buộc khi >20 tenant; MVP đang dùng API + scripts (`ui/01` ghi chú cuối) | `platform_users` + billing data (4.7) | M | 2 |
| 20 | **Referral host-giới-thiệu-host** + landing theo khu vực (Đà Lạt, Vũng Tàu, Hội An…) | CAC thấp — thị trường lan truyền theo hội nhóm Zalo/FB | Billing-lite (4.7) cộng credit | S–M | 3 |
| 21 | **Public API + API keys per tenant** | Mở tích hợp (MISA, Google Sheets, Zapier-style) | Chuẩn webhook-out đã có (`05` §10) | M | 3 |
| 22 | **Zalo Mini App đặt phòng** | Khách đặt ngay trong Zalo, không cài app — rất hợp hành vi VN | Hosted booking page (#1) làm nền | L | 3 |

### Nhóm F — AI (thực dụng)

| # | Tính năng | Giá trị / bối cảnh VN | Hạ tầng tận dụng | Effort | Wave |
|---|-----------|------------------------|-------------------|:------:|:----:|
| 23 | **Trợ lý chốt khách qua Zalo OA** — AI đọc inbox ("còn phòng 2 người cuối tuần không?") → check availability → báo giá → gửi link giữ chỗ; host chỉ xác nhận | **Strategic bet lớn nhất:** ~80% booking trực tiếp của homestay VN đến từ chat; PMS nào tự động hoá được khâu này sẽ thắng tệp SMB | Availability + quote + HOLD + hosted page (#1) — AI chỉ là lớp hội thoại phía trên | M–L | 3 *(prototype sớm ở Wave 2)* |
| 24 | OCR hoá đơn chi phí — chụp bill điện/nước → tự tạo expense | Nhập liệu chi phí là việc bị bỏ bê nhất → P&L sai; OCR pipeline tái dùng được | FPT.AI service (`12` §3) | S | **1** |
| 25 | AI gợi ý giá theo lịch sử + sự kiện địa phương | Cần ≥6 tháng data tích lũy mới đáng tin | `daily_property_stats` + #2 | L | 3 |

## 2. Lộ trình 3 wave

```
Go-live ~09/2026
│
├── WAVE 1 — Quick wins (Q4/2026, ~1 quý): #5 ZNS messaging · #1 Hosted booking page
│     · #14 Landlord statement · #10 Sổ quỹ ca · #11 Anti-fraud · #4 Discount codes · #24 OCR bill
│     → chủ đề: "thu nhiều hơn, mất ít hơn, nhắn ít hơn" — toàn bộ chạy trên hạ tầng MVP, không ADR mới
│
├── WAVE 2 — Mở rộng vận hành & tài chính (H1/2027): #7 Smart lock · #6 Pre-check-in
│     · #2 Dynamic pricing · Channex full (đã thiết kế `08` §6) · #16 Ledger · #17 e-Invoice
│     · #12 Maintenance · #15 Thuế khoán · #19 Platform console · (prototype #23 AI Zalo)
│
└── WAVE 3 — Nền tảng & AI (H2/2027+): #23 AI Zalo production · #8 Guest portal · #22 Zalo Mini App
      · #21 Public API · #25 AI pricing · #13 Inventory · #20 Referral · #9 Review mgmt · #18 Multi-currency
```

## 3. Top-5 khuyến nghị ngay sau go-live (nếu nguồn lực chỉ đủ 5)

| Ưu tiên | Tính năng | Vì sao đứng đây |
|:-------:|-----------|------------------|
| 1 | #5 ZNS guest messaging | Rẻ nhất, host thấy giá trị trong tuần đầu — vũ khí giữ chân trial |
| 2 | #1 Hosted booking page | Tăng doanh thu trực tiếp; tận dụng tối đa hạ tầng thanh toán vừa xây |
| 3 | #14 Landlord statement | Differentiator đúng tệp R2R mà đối thủ bỏ qua |
| 4 | #10 + #11 Sổ quỹ ca + anti-fraud | Giải nỗi đau "chủ vắng mặt" → lý do trả phí rõ nhất |
| 5 | #7 Smart lock | Mở khoá mô hình không lễ tân — bước vào phân khúc tự vận hành |

> **#23 (trợ lý AI Zalo)** là bet dài hạn giá trị nhất — không nằm top-5 vì cần hosted page (#1) làm nền và cần thử nghiệm thị trường; khuyến nghị **prototype giới hạn ở Wave 2** (5–10 tenant thân thiết) trước khi đầu tư production.

## 4. Quy tắc đưa tính năng vào thực thi

1. Chọn tính năng → viết **task vào `14`** (acceptance + depends) — file này không phải nguồn thực thi.
2. Tính năng đụng kiến trúc (smart lock adapter, public API, AI) → **ADR mới** trước khi code.
3. Mỗi tính năng mới phải khai: bảng mới (kèm RLS/composite FK/retention), event mới (vào `10` §2), page mới (vào `ui/`), permission mới (vào `04` §4).
