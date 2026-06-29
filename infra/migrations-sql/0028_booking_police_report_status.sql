-- Up Migration
-- ============================================================================
-- 0028 — Trạng thái khai báo lưu trú công an (P2-B B6, docs/12 §2 Phase 2)
-- Thêm police_report_status trên bookings để theo dõi vòng đời khai báo lưu trú
-- (Thông tư 56): PENDING (chưa khai) → SUBMITTED (đã gửi) | FAILED (gửi lỗi/thiếu
-- dữ liệu). Phase 1 = export Excel thủ công (task 7.2, vẫn dùng); Phase 2 = nút
-- "Gửi" → POST API quận/huyện (hiện STUB — chưa có hợp đồng/endpoint thật).
-- Chỉ có ý nghĩa với booking đã lưu trú (CHECKED_IN/CHECKED_OUT); booking khác giữ
-- mặc định PENDING vô hại (luồng submit chỉ chạm booking đã lưu trú). Không cột PII.
-- bookings đã RLS sẵn — thêm cột thường, không đổi policy.
-- ============================================================================

ALTER TABLE bookings
  ADD COLUMN police_report_status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (police_report_status IN ('PENDING', 'SUBMITTED', 'FAILED')),
  ADD COLUMN police_report_submitted_at TIMESTAMPTZ;
