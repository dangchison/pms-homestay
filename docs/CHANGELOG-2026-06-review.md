# CHANGELOG — Audit kiến trúc lần 2 & Đồng bộ tài liệu (2026-06-10)

> Bộ docs đã qua review lần 1 (các marker `⚠️ Review` + ADR 0001–0006). Audit lần 2 này: (a) tìm cái review trước bỏ sót, (b) phát hiện **các fix chưa được đồng bộ ngược vào tài liệu thực thi**, (c) cập nhật lựa chọn công nghệ theo thời điểm 2026-06, (d) **tích hợp tất cả vào thân tài liệu** (bản 3.0 — hết "chỗ này nói A, chỗ kia nói B") và (e) bổ sung **UI spec** (`ui/` — trước đó trống).
>
> Mức độ: **P0** = chắc chắn gây sự cố/sai nghiêm trọng khi build · **P1** = vỡ khi hệ thống lớn lên / rủi ro bảo mật-pháp lý · **P2** = chất lượng, chi phí, DX.

## A. Mâu thuẫn tài liệu & pattern đã-bác-nhưng-còn-sót (loại nguy hiểm nhất với AI agent)

| # | Mức | Phát hiện | Xử lý (bản 3.0) |
|---|-----|-----------|------------------|
| A1 | **P0** | **Roadmap 14 chứa pattern ADR đã bác:** task 1.5 yêu cầu đúng middleware `set_config` mà ADR-0002 cấm; task 3.3 ghi công thức `paid = sum(WHERE SUCCEEDED)` — bug refund ADR-0003 đã sửa; task 2.3 "holidays embedded 5 năm" — C2 đã cấm; task 2.4 quote chỉ Redis — C7 đã yêu cầu persist; task 1.6 dùng Prisma middleware (deprecated). Agent code theo task sẽ **tái sinh toàn bộ bug đã fix** | `14` viết lại 100%, mọi acceptance đồng bộ ADR/docs; thêm quy tắc ưu tiên **một chiều** (ADR > docs > 14/15) thay cho 3 quy tắc vòng tròn cũ |
| A2 | **P0** | **Hai cơ chế chống overbooking song song:** ERD giữ cả EXCLUDE trên `bookings` lẫn `room_occupancy`; `bookings.room_id NOT NULL` trong khi ADR-0006 nói booking trỏ `resource_id` — không xác định được schema thật | Chốt MỘT mô hình (ADR-0006 amendment): `bookings.resource_id`, **bỏ room_id + EXCLUDE trên bookings**; occupancy **presence-based** (xoá row khi terminal — không drift status, GiST nhỏ); blocks cũng đi qua occupancy (bỏ trigger cross-check); buffer áp khi sinh occupancy. `03`/`06` viết lại |
| A3 | P1 | Cột được tham chiếu nhưng **không tồn tại trong schema**: `bookings.missing_sync_count`, `previousEventCount` (sanity-guard A3 của 08); bảng được nhắc mà thiếu trong ERD: `document_counters`, `unmatched_payments`, `webhook_events_received`, `vietnam_holidays`, `monthly_meter_readings`, `data_processing_consents`, bảng `quotes` (C7) | Tất cả vào `03` (42 bảng); thêm `channel_resource_mappings.last_event_count/last_pulled_at` |
| A4 | P1 | Bảng ma `sync_external_refs` trong mermaid (không định nghĩa, không trong tổng kết); ERD vẽ booking↔invoice `1:1` mâu thuẫn invoice ad-hoc + finalize | Xoá bảng ma; quan hệ 1:N theo `invoices.kind` |
| A5 | P1 | `09` nói P&L "real-time không cache" trong khi `03` §6.4 (C4) yêu cầu đọc rollup `daily_property_stats` | Chốt: quá khứ đọc rollup + hôm nay live (`09` §8) |
| A6 | P2 | `05` lấy **bookings** làm ví dụ soft-delete (booking là hồ sơ tài chính — không bao giờ delete); 2FA bắt buộc ACCOUNTANT ở `04` nhưng tasks chỉ enforce OWNER; "PITR via pg_dump" ở sơ đồ 00 (pg_dump không làm được PITR); mapping OTA theo **room** trong khi listing nguyên căn ứng với **resource** | `05` §11 đổi ví dụ + cấm delete chứng từ; 8.4 enforce cả ACCOUNTANT; sơ đồ sửa; `channel_room_mappings` → **`channel_resource_mappings`** (map theo resource) |
| A7 | P2 | Code mẫu SAI (middleware set_config) vẫn nằm trong `02` kèm cảnh báo — hazard copy-paste với AI agent; dòng "DPO Anthropic-style" (artifact) trong `12` | Xoá hẳn code sai (chỉ giữ mô tả lý do); dọn artifact |

## B. Lỗ hổng thiết kế audit lần 2 phát hiện (review lần 1 chưa bắt)

| # | Mức | Phát hiện | Xử lý |
|---|-----|-----------|-------|
| B1 | **P0** | **Transaction bọc cả request** (đọc ADR-0002 theo nghĩa đen): external I/O (OCR 15s, S3) trong tx → ghim connection → cạn pool; Prisma interactive tx mặc định **timeout 5s** (P2028); SSE stream không thể sống trong tx | ADR-0002 **amendment**: tx = unit-of-work, cấm external I/O trong tx, GET read-only tx ngắn, SSE/job ngoài tx, `transactionOptions` tường minh (`02` §4) |
| B2 | **P0** | **Mô hình hoá đơn vỡ với thuê tháng** (1 booking 6 tháng cần N hoá đơn điện nước/tiền nhà) + **vòng lặp cọc**: confirm cần cọc → payment cần invoice → invoice chỉ issue khi confirm | ADR-0003 amendment: `invoices.kind` (DEPOSIT/STAY/MONTHLY_RENT/ADJUSTMENT) 1:N; DEPOSIT invoice issue tại PENDING; billing-cycle job hằng tháng + `monthly_meter_readings` (`09` §3–4, task 3.8) |
| B3 | P1 | **Outbox kẹt vĩnh viễn khi worker crash sau claim** (set PROCESSING nhưng status enum không có giá trị này, không có reclaim); poll 5s = "realtime" trễ 5s; dispatch tuần tự | Outbox v2: status 4 giá trị + `claimed_at` + **reclaim sweep 60s** + **LISTEN/NOTIFY** đánh thức + dispatch concurrency (`10` §3, `03` §4.10) |
| B4 | P1 | **Test plan SSE hứa "không mất event khi reconnect"** — thiết kế không có replay → cam kết sai sẽ thành bug report | Định nghĩa lại semantics: SSE = invalidation hint, **reconnect → refetch snapshot**; client dedup theo `event_id` (at-least-once) (`10` §4, §9) |
| B5 | P1 | **Booking ma khoá tồn kho:** PENDING không bao giờ hết hạn; `NO_SHOW` có trong enum nhưng không gì set nó; thiếu nghiệp vụ "chốt ngày" chuẩn PMS | **Night-audit job** (task 4.6): no-show, PENDING expiry (`expires_at` dùng cho cả PENDING), OVERDUE, rollup stats, retention (`09` §9) |
| B6 | P1 | **AuthZ bypass trong tenant:** guard lấy `propertyId` từ `params/body` — endpoint `/bookings/:id` không có → check property scope bị **skip lặng lẽ** → STAFF property A sửa được booking property B | Guard 2 pha: permission theo role (pha 1) + **property resolve từ entity** sau khi load (pha 2); e2e test chống bypass (task 1.8) (`04` §4) |
| B7 | P1 | **`guests.id_document_number` plaintext + index** mâu thuẫn chính tiering ADR-0004 ("số giấy tờ" = tier nhạy cảm); OCR `raw_response` (full PII JSON) persist vào DB chính | **ADR-0007 mới**: AES-256-GCM + HMAC blind index + last4; không persist raw OCR; decrypt hội tụ 1 đường + audit READ_PII (`03` §4.5, `12` §3) |
| B8 | P1 | Refresh rotation: 2 refresh đồng thời (mạng chập chờn) → reuse-detection giết cả chain → **logout oan hàng loạt** | Grace window 60s trả về token kế nhiệm idempotent (`04` §2) |
| B9 | P1 | **Log/audit phình vô hạn:** chỉ outbox có retention; audit_logs (log cả READ_PII) giữ ≥10 năm không partition; sync_jobs ~96 row/ngày/mapping | **Retention matrix** (`03` §7) + audit_logs partition theo tháng từ migration đầu + night-audit dọn + task 8.5 verify |
| B10 | P1 | SaaS **không có module thu tiền**: `subscription_plans` tồn tại nhưng zero task enforce limit / trial expiry / thu phí | Task 4.7 **billing-lite**: trial cron → SUSPENDED, plan-limit guard (422 + CTA), thu phí qua chính VietQR (`14`) |
| B11 | P2 | Throttle 5 fail/15'/IP sau Cloudflare + **CGNAT VN** → khoá oan cả văn phòng/quán cafe | Account-first + IP ngưỡng cao → captcha + `CF-Connecting-IP` (`04` §3) |
| B12 | P2 | HOLD 10' bị đẩy vào iCal push → OTA cache feed hàng giờ → block "ma" phía OTA; thiếu ETag (OTA poll dày) | Push chỉ PENDING/CONFIRMED/CHECKED_IN + ETag/304 (`08` §4) |
| B13 | P2 | iCal pull `findMany` **không bound thời gian** (lớn dần vĩnh viễn); permission check DB mỗi request không cache; SSE trên HTTP/1.1 đói connection (6/domain) | Pull bound `check_out ≥ now−7d`; permission cache TTL 60s + `pv` version; HTTP/2 (`08` §3, `04` §4, `10` §4) |
| B14 | P2 | Pseudocode: khấu hao N+1 + `Math.round` từng tháng → book value cuối ≠ residual; pricing bucket ngày theo **UTC** → lệch ngày lễ/cuối tuần giờ VN; early/late fee so sánh mỗi `.hour`; backup per-tenant dùng server-side `COPY TO /tmp` (managed PG không cho); `UNIQUE … WHERE` inline trong CREATE TABLE (SQL không hợp lệ) | Khấu hao bulk + **plug tháng cuối** (`09` §7); pricing timezone-aware + so sánh đủ giờ:phút (`07` §4); export client-side `\copy` (`02` §7); partial unique = CREATE UNIQUE INDEX (`03` §4.6) |

## C. Công nghệ lỗi thời (tại 2026-06) → baseline mới

| Hạng mục | Cũ | Mới | Ghi chú |
|----------|-----|-----|---------|
| Node.js | 20 (**EOL 2026-04 — đã hết hạn trước ngày viết doc**) | **22 LTS** | maintenance tới 2027 |
| NestJS | 10 (Express 4) | **11** (Express 5) | |
| Next.js / React | 14 / 18 | **15 / 19** | |
| Prisma | 5 + `$use` middleware (deprecated) | **6** + Client Extensions | vai trò typed-client giữ nguyên (ADR-0001) |
| Zod / TS / ESLint / Tailwind | 3 / 5.4 / 8 (EOL) / 3 | **4 / 5.8 / 9 flat / 4** | |
| HTTP client | axios | fetch/undici native | bớt dependency |
| Outbox | cron-poll 5s thuần | LISTEN/NOTIFY + poll fallback | latency <500ms |
| Redis hosting | Upstash (per-request) | self-host cạnh VPS | BullMQ poll liên tục = bẫy chi phí serverless |
| Đối soát bank | thủ công (phase 2 mới webhook) | **Casso/SePay webhook vào MVP** | tính năng "wow" chi phí thấp |
| Observability | 5 vendor (Sentry/Axiom/BetterStack/Grafana/UptimeRobot) | **2 vendor** (Sentry + Better Stack) + OTel SDK ngày 1 | |

## D. Dư thừa đã loại bỏ

| Hạng mục thừa | Vì sao | Hành động |
|---------------|--------|-----------|
| `class-validator` + `class-transformer` | Zod đã là chuẩn validation duy nhất (05) | Bỏ khỏi stack (`01`) |
| `uuid-ossp` | `gen_random_uuid()` native PG13+ | Bỏ extension (`01`, `03`, task 1.3) |
| Redlock trong sơ đồ 00 | `06` đã quyết Redis không giữ chỗ | Xoá khỏi diagram |
| EXCLUDE trên `bookings` + trigger cross-check room_blocks | `room_occupancy` là cơ chế duy nhất | Xoá (A2) |
| `rooms.rent_mode` | Bán gì do `bookable_resources` định nghĩa | Xoá cột |
| `rooms.status` trộn OCCUPIED/BLOCKED (suy diễn được → drift) | Availability luôn derive từ occupancy/blocks | Thu thành `housekeeping_status` 4 giá trị |
| `bookings.commission_vnd` + expense OTA_COMMISSION nhập tay (đếm đôi P&L) | Một đường ghi | Commission = input snapshot → **auto-sinh expense** khi CHECKED_OUT; P&L chỉ đọc expenses |
| `rate_plan_rooms` (gán giá theo phòng) | Nguyên căn có giá riêng theo resource | → `rate_plan_resources` |
| shadcn copy trong từng app + `packages/ui` | 2 bản copy = drift theme | Chỉ `packages/ui` |
| `apps/web-guest` scaffold + offline-mutation-queue của web-staff | App chết + sync-conflict phức tạp chưa cần | web-guest → phụ lục phase 2; offline = read-cache |
| Snippet sequence-per-tenant (09), holidays data trong package (07), quote trong Redis (2.4) | Đã bị bác nhưng còn đứng như code chính | Dọn — `document_counters` / bảng `vietnam_holidays` / bảng `quotes` là cách duy nhất |
| `scp` trong JWT làm căn cứ authz | Stale tới 15' | Chỉ render UI; authz server-side + `pv` |

## E. Bổ sung mới hoàn toàn

- **UI spec** `ui/00–03`: design system + token màu trạng thái; **35 page web-admin + 9 page web-staff = 44 page**; wireframe Calendar + Check-in; 8 key flows có bảng màn-hình↔API↔lỗi; map SSE event → màn hình invalidate. (Trước audit: thư mục `ui/` trống.)
- **ADR-0007** (PII field encryption) + amendments cho ADR-0001/0002/0003/0006.
- Task mới trong `14`: 3.8 (billing tháng), 4.6 (night-audit), 4.7 (billing-lite SaaS), 6.7 (settings UI), 8.5 (data lifecycle); checklist PR mở rộng (occupancy choke-point, retention bắt buộc, external-I/O-ngoài-tx).

## Đề xuất tính năng theo giai đoạn (tham khảo cho roadmap sau MVP)

> **Cập nhật 2026-06-10:** danh sách dưới đã được mở rộng và thẩm định đầy đủ thành [`16-product-roadmap.md`](16-product-roadmap.md) (25 tính năng, 3 wave, top-5 khuyến nghị) — dùng file đó làm nguồn chính.

- **Đã kéo vào MVP:** đối soát Casso/SePay; night-audit; billing-lite SaaS.
- **Phase 2 (3–6 tháng):** ZNS guest messaging tự động (hướng dẫn check-in T-1, mã cửa, xin review sau checkout); **landlord statement** cho rent-to-rent (báo cáo minh bạch cho chủ nhà gốc — differentiator, dữ liệu đã có); quản lý cọc giữ nhà thuê tháng (hoàn trừ hư hỏng — chạy trên ledger ADR-0003 §5); smart-lock self check-in (TTLock/Igloohome); báo cáo chống thất thoát tiền mặt (pattern cancel-sau-thu-cash, refund bất thường theo staff); hosted booking page nhẹ (1 trang/property) thay vì cả app web-guest; Channex cho phòng multi-OTA; e-invoice NĐ123.
- **Phase 3:** dynamic pricing rule-based (guardrail min/max theo occupancy); guest CRM + phân khúc; BI/forecast.
