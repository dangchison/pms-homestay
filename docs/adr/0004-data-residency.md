# ADR-0004 — Data residency phân tầng (PII nhạy cảm lưu tại VN)

- **Status:** Proposed (cần xác nhận của luật sư + đánh giá provider trước khi Accepted)
- **Ngày:** 2026-06-09
- **Liên quan:** review §E4, §B2; `12-vietnam-compliance.md`

## Context

- Luật An ninh mạng 2018 + Nghị định 53/2022 + Nghị định 13/2023 đặt yêu cầu **lưu trữ dữ liệu cá nhân công dân VN tại Việt Nam** (phạm vi vẫn đang được làm rõ, nhưng dữ liệu nhạy cảm như CCCD/hộ chiếu là rủi ro cao nhất).
- `01-tech-stack.md` chọn Neon / Supabase / Upstash / Cloudflare R2 — **không có region tại VN** (gần nhất Singapore). Scan CCCD (PII **nhạy cảm**) đang dự kiến lưu S3/R2 ở SG/HK.
- Migrate DB của một SaaS đang chạy qua region khác về sau rất tốn kém và rủi ro.

## Decision

**Phân tầng dữ liệu theo độ nhạy cảm, đặt tier nhạy cảm tại hạ tầng VN ngay từ MVP.**

| Tier | Dữ liệu | Nơi lưu |
|------|---------|---------|
| **Nhạy cảm / định danh** | Scan CCCD/passport, số giấy tờ, dữ liệu khai báo lưu trú | **Provider VN**: VNG Cloud / Viettel IDC / FPT Cloud / CMC. Mã hoá at-rest (KMS), access log mọi lần đọc |
| **Vận hành** | bookings, invoices, rooms, rate_plans, ... (không chứa PII nhạy cảm) | Region gần (SG) cho MVP, có cờ cấu hình để migrate |

Hai hướng triển khai, chọn theo kết quả đánh giá provider:

- **(A) Đặt toàn bộ DB chính tại VN** nếu provider VN đủ năng lực managed (backup/PITR/HA). Đơn giản nhất, tránh split.
- **(B) Tách "PII vault"**: blob ảnh giấy tờ + cột nhạy cảm để ở storage/DB VN, DB chính tham chiếu qua id. Phức tạp hơn nhưng giữ được DX của Neon/Supabase cho phần vận hành.

Ưu tiên **(A)** nếu khả thi (production-grade, ít bề mặt lỗi).

**Bắt buộc kèm theo:** rà soát luật sư; DPA (Data Processing Agreement) với mỗi tenant; đăng ký xử lý dữ liệu nhạy cảm với A05; chỉ pre-signed URL expire ngắn cho ảnh giấy tờ (đã có ở `12`).

## Consequences

**Tích cực:** giảm rủi ro pháp lý; phù hợp khi mở rộng tệp khách doanh nghiệp/nhà nước.

**Tiêu cực:** provider VN thường ít tính năng managed và đắt hơn Neon/Supabase; hướng (B) tăng phức tạp vận hành (2 nơi lưu, backup phối hợp).

**Tiêu chí để chuyển sang Accepted:** (1) ý kiến luật sư về phạm vi "dữ liệu phải nội địa"; (2) thử nghiệm backup/PITR trên provider VN được chọn; (3) chốt (A) hay (B).

## Alternatives considered

- **Để toàn bộ ở SG/HK** — *Bác bỏ (production-grade):* rủi ro pháp lý với dữ liệu nhạy cảm.
- **Chờ luật rõ hơn rồi mới làm** — *Bác bỏ:* hệ đã lưu CCCD thật ngay từ luồng check-in MVP.
