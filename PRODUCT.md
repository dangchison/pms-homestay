# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hai phân khúc trọng tâm ngang nhau (đã chốt):

- **Chủ homestay nhỏ tự vận hành** (5–30 phòng): tự làm mọi việc, không rành công nghệ, nhạy cảm giá. Cần UI cực dễ, ít thuật ngữ.
- **Vận hành chuyên nghiệp / rent-to-rent**: quản lý nhiều cơ sở, có nhân viên, cần báo cáo P&L sâu, chấp nhận UI dày thông tin.

Người dùng thứ cấp:

- **Nhân viên lễ tân / buồng phòng** dùng `web-staff` (PWA mobile 360–430px, thao tác 1 tay, có khi đeo găng tay dọn phòng → nút ≥44px, cần offline).
- **Khách truy cập landing page**: chủ/quản lý homestay đang cân nhắc mua SaaS.

Admin dùng laptop ≥1280px là chính (desktop-first, responsive xuống 768px).

## Product Purpose

SaaS multi-tenant quản lý homestay / căn hộ dịch vụ / rent-to-rent tại Việt Nam. Một nơi làm hết việc vận hành: lịch phòng chống overbooking, vòng đời booking (hold → check-in/out → đổi phòng), hoá đơn + thanh toán VietQR + đối soát webhook, chi phí/tài sản/khấu hao, báo cáo P&L, đồng bộ OTA qua iCal 2 chiều, dọn phòng, thông báo realtime. Thành công = chủ nhà tin số liệu tài chính và không bao giờ bị trùng phòng.

## Positioning

Tuân thủ pháp lý Việt Nam tích hợp sẵn — thứ PMS ngoại nhập không làm được: OCR CCCD (FPT.AI) khi check-in, báo cáo lưu trú công an theo TT56, quyền dữ liệu NĐ13 (export/erasure/consent), VietQR bản địa. Nền multi-tenant với RLS được chứng minh bằng test interleaved.

## Operating Context

- Tiếng Việt mặc định (i18n key sẵn `en`). Tiền `1.500.000 ₫` theo `Intl 'vi-VN'`; ngày `dd/MM/yyyy`; giờ 24h; mọi giờ hiển thị theo timezone của property.
- **Calendar là màn hình trung tâm** của admin: thao tác thường nhật (tạo booking, đổi phòng, xem trạng thái) làm ngay trên calendar, không rời trang.
- Realtime mặc định: màn hình dữ liệu sống subscribe SSE, không dùng nút "Refresh" làm cơ chế chính.
- Lễ tân làm việc trong ca bận, bị ngắt quãng liên tục; nhân viên buồng phòng di chuyển giữa các phòng, mạng chập chờn.

## Capabilities and Constraints

- Monorepo pnpm: `apps/web-admin` (Next.js, 35 page), `apps/web-staff` (PWA, 9 page), `apps/api`; `landing_page/` (HTML tĩnh, deploy Vercel — chưa vào git).
- UI spec đầy đủ tại `docs/ui/00–03` (nguyên tắc, inventory 44 page, 8 flow nghiệp vụ). FE build theo spec, không tự chế route/luồng.
- Design token là **nguồn duy nhất** tại `packages/ui/src/styles.css`: 2 tầng OKLCH (primitive `--p-*` không expose → semantic map vào `@theme`). Component/trang không được gọi màu thô. Màu trạng thái booking/housekeeping là ngôn ngữ chung mọi màn hình.
- Tailwind v4, shadcn-style components trong `packages/ui`, theme sáng/tối qua `[data-theme]`.
- `web-guest` (trang cho khách đặt phòng) là phase 2, chưa tồn tại.

## Brand Commitments

- Font hệ thống: Inter (subset latin + vietnamese).
- Màu brand hiện hành: teal-600 ≈ `#0d9488` (docs/ui/00 §3).
- **Cá tính đã chốt (2026-08-11): hiện đại, cao cấp, tối giản** — cảm giác boutique hotel: nhiều khoảng trắng, typography lớn, ảnh đẹp chiếm sân khấu. Đây là hướng mọi việc UI mới phải theo; phần visual world cụ thể quyết ở DESIGN.md khi làm.

## Evidence on Hand

- Spec UI thật: `docs/ui/00-ui-overview.md`, `01-web-admin-pages.md`, `02-web-staff-pages.md`, `03-key-flows.md`.
- Sản phẩm chạy được: MVP 50/50 đóng (xem `PROGRESS.md`, `README.md`).
- **Chưa có** testimonial, case study, số liệu khách hàng, logo khách — mọi surface marketing không được bịa các thứ này.
- **Bảng giá đã chốt 2026-08-11**: FREE (1 cơ sở · 5 phòng) 0đ · STARTER (1 · 15) 299.000đ/tháng · PRO (3 cơ sở · 25 phòng mỗi cơ sở) 799.000đ/tháng · ENTERPRISE liên hệ. Nguồn duy nhất là bảng `subscription_plans` (seed ở `scripts/seed-prod-required.ts`); surface marketing đọc `GET /api/v1/public/plans` chứ không viết cứng số. Cờ `features` trong seed điều khiển cả PlanFeatureGuard lẫn bảng tick công khai — **chỉ bật cờ của tính năng đã giao được**.

## Product Principles

1. **Calendar là nhà.** Mọi đường quay về calendar; việc thường nhật xong ngay tại chỗ.
2. **Đơn giản mặc định, sâu khi cần.** Chủ nhỏ thấy dễ ngay; dân chuyên mở được độ sâu (báo cáo, multi-cơ-sở) mà không đổi sản phẩm.
3. **Số liệu tiền bạc phải đối soát được.** Niềm tin vào con số là lý do tồn tại; không hy sinh chính xác cho đẹp.
4. **Thiết kế cho hiện trường thật.** Một tay, găng tay, mạng yếu, bị ngắt quãng — to, rõ, offline, tiếp tục được giữa chừng.
5. **Realtime là mặc định.** Dữ liệu tự sống, người dùng không phải hỏi lại hệ thống.

## Accessibility & Inclusion

- Touch target ≥44px trên web-staff (thao tác 1 tay / găng tay).
- Admin responsive 768px→1280px+; tiếng Việt là ngôn ngữ ưu tiên, không để lọt chuỗi tiếng Anh ra UI.
