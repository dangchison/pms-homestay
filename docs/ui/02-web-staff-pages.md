# UI/02 — WEB-STAFF PWA: PAGE INVENTORY (9 page)

> App cho **lễ tân + buồng phòng**, mobile-first 360–430px, cài như app (manifest + Workbox). **Offline = read-cache only:** xem được dữ liệu đã tải; mọi mutation yêu cầu online (nút disable + `OfflineBanner`) — không có offline mutation queue ở MVP (`13` §4). Nút chạm ≥44px, font ≥16px (tránh zoom iOS), thao tác một tay.

## Điều hướng

Bottom tab bar 4 tab: **Hôm nay · Phòng · Dọn phòng · Cá nhân** (tab hiện theo role: HOUSEKEEPER chỉ thấy Phòng/Dọn phòng/Cá nhân). Realtime qua SSE (cleaning assigned → vibrate + toast).

| ID | Route | Mục đích & thành phần | API | Roles |
|----|-------|------------------------|-----|-------|
| T1 | `/login` | Đăng nhập (lưu tenant slug lần trước); hỗ trợ thêm vào màn hình chính (A2HS prompt) | `POST /auth/login` | tất cả staff |
| T2 | `/today` | **Ca làm hôm nay:** 3 section — Khách đến (badge PENDING cọc chưa đủ → không cho check-in), Khách đi (kèm balance còn lại), Đang ở; mỗi card: phòng/resource, tên khách, giờ, trạng thái; pull-to-refresh; đếm số trên tab | `GET /bookings?arrival=today…` | STAFF, MANAGER, OWNER |
| T3 | `/checkin/[bookingId]` | **Flow check-in 3 bước** (chi tiết `03-key-flows` F3):<br>① **Scan giấy tờ** — camera chụp 2 mặt CCCD → upload pre-signed → OCR; fallback "Nhập tay"<br>② **Xác nhận** — form prefill từ OCR (tên/DOB/giới tính/số giấy tờ/địa chỉ), lễ tân sửa; checkbox consent NĐ13 (khách đồng ý)<br>③ **Hoàn tất** — xác nhận giờ vào, thu nốt tiền nếu thiếu (→ VietQrPanel/cash), nút "Check-in" | `POST /guests/scan-id`, `PATCH /guests/:id`, `POST /bookings/:id/check-in` | STAFF, MANAGER, OWNER |
| T4 | `/checkout/[bookingId]` | **Check-out:** folio STAY invoice (items + cấn cọc + balance); thêm phụ thu nhanh (minibar, hỏng đồ — item picker); thu tiền (cash / **VietQR realtime tick**); nút "Check-out" (disable tới khi balance = 0 hoặc MANAGER override ghi nợ) | `GET /bookings/:id/folio`, `POST /invoices/:id/items`, `POST /payments`, `POST /bookings/:id/check-out` | STAFF, MANAGER, OWNER |
| T5 | `/cleaning` | List task của tôi (HOUSEKEEPER) / của property (STAFF+): card phòng + loại + due + priority; filter trạng thái; nhận task (start) | `GET /cleaning-tasks?assigned_to=me` | HOUSEKEEPER, STAFF, MANAGER |
| T6 | `/cleaning/[taskId]` | Chi tiết task: checklist; **ảnh trước/sau** (camera, nén client-side, upload pre-signed); ghi chú hỏng hóc (→ tạo maintenance task); nút Bắt đầu / Hoàn thành (→ housekeeping CLEANING→CLEAN) | `PATCH /cleaning-tasks/:id`, upload S3 | như T5 |
| T7 | `/rooms` | **Room board:** grid phòng theo property, mỗi ô = số phòng + housekeeping dot + icon đang có khách (occupancy); chạm → đổi housekeeping status (theo quyền — HOUSEKEEPER chỉ CLEANING→CLEAN); long-press → tạo cleaning task | `GET /rooms/board`, `PATCH /rooms/:id/housekeeping` | tất cả staff |
| T8 | `/profile` | Thông tin cá nhân, đổi password, ngôn ngữ, đăng xuất; trạng thái kết nối (online/offline, SSE) | `/auth/*` | tất cả |
| T9 | `/offline` | Fallback khi mở route chưa cache lúc offline: hướng dẫn + nút thử lại (Workbox navigation fallback) | — | — |

## Wireframe check-in (T3 — bước ② Xác nhận)

```
┌────────────────────────────┐
│ ←  Check-in P.101 · BK-…   │
│  ①──────②──────③           │
│ ┌────────────────────────┐ │
│ │ [ảnh CCCD mặt trước]   │ │
│ │ [ảnh CCCD mặt sau ]    │ │
│ └────────────────────────┘ │
│ Họ tên   [NGUYỄN VĂN A  ]  │
│ Ngày sinh[12/03/1990    ]  │
│ Số CCCD  [0790…    ] ⚠ OCR │
│ Giới tính[Nam ▾] QT[VN ▾]  │
│ Địa chỉ  [Q.7, TP.HCM   ]  │
│ ☑ Khách đồng ý xử lý dữ    │
│   liệu cá nhân (NĐ13)      │
│ ┌────────────────────────┐ │
│ │      Tiếp tục  →       │ │
│ └────────────────────────┘ │
└────────────────────────────┘
 ⚠ = field OCR confidence thấp, viền vàng nhắc lễ tân kiểm tra
```

## PWA spec

- **Manifest:** standalone, theme teal, icons 192/512, shortcut "Hôm nay" + "Dọn phòng".
- **Workbox:** precache app shell; runtime cache `GET /bookings|rooms|cleaning-tasks` (stale-while-revalidate, maxAge 1h); KHÔNG cache response có PII đầy đủ (chỉ list đã mask).
- **Camera:** `getUserMedia` + capture fallback `<input type=file capture>`; nén ảnh client ≤1MB trước upload.
- **Login giữ phiên:** refresh cookie; access token memory — mở lại app trong 30 ngày không phải đăng nhập lại.
