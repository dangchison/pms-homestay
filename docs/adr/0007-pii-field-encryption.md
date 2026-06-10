# ADR-0007 — Mã hoá PII mức field + chiến lược tìm kiếm (HMAC)

- **Status:** Accepted
- **Ngày:** 2026-06-10
- **Liên quan:** audit lần 2 (A8); [ADR-0004](0004-data-residency.md); `12-vietnam-compliance.md`; `03-database-erd.md`

## Context

ADR-0004 xếp **số giấy tờ tuỳ thân** vào tier "nhạy cảm / định danh", nhưng schema hiện tại lưu `guests.id_document_number` **plaintext** kèm index trong DB vận hành (dự kiến region SG) — tự mâu thuẫn với chính tiering đó. Ngoài ra flow OCR đang lưu `raw_response` (chứa toàn bộ dữ liệu CCCD dạng JSON) vào DB chính.

Yêu cầu nghiệp vụ xung đột với bảo mật: lễ tân cần **tìm khách theo số giấy tờ** (khách quay lại), báo cáo công an cần **xuất số đầy đủ**.

## Decision

1. **Mã hoá app-level (envelope) cho field nhạy cảm:**
   - `guests.id_document_number_enc BYTEA` — AES-256-GCM, prefix `key_id` để rotate key (key trong KMS/secret manager, không nằm cùng DB).
   - Bỏ cột plaintext `id_document_number` và index của nó.
2. **Tìm kiếm bằng blind index:** `guests.id_document_number_hash BYTEA` = HMAC-SHA256(số đã chuẩn hoá, khoá HMAC **riêng**, không dùng chung khoá mã hoá). Index trên `(tenant_id, id_document_number_hash)`. Search = exact-match qua hash (đủ cho nghiệp vụ "khách quay lại"); không hỗ trợ search một phần số giấy tờ — chấp nhận.
3. **Hiển thị:** `guests.id_document_last4 VARCHAR(4)` cho UI/danh sách (`****1234`). Xem số đầy đủ = endpoint riêng, decrypt server-side, **bắt buộc audit `READ_PII`**.
4. **OCR:** KHÔNG persist `raw_response`. Extract field cần thiết → trả client để verify → lưu các cột đã định nghĩa → vứt raw. Bản ghi pháp lý gốc là **ảnh scan** trên storage (đã có chính sách riêng: tier VN, SSE-KMS, pre-signed URL 15 phút — xem `12`).
5. Phạm vi áp dụng cùng cơ chế: `users.two_factor_secret`, secret trong `channels.config`, (phase 2) MST/thông tin doanh nghiệp trên e-invoice.
6. Export báo cáo công an / data-export: decrypt theo batch trong job, mỗi lần chạy ghi 1 audit record (scope = báo cáo, không log từng số).

## Consequences

**Tích cực:** DB dump/backup/replica leak không lộ số giấy tờ; phù hợp tiering ADR-0004 (kể cả khi DB vận hành còn ở SG, dữ liệu định danh đã được vô hiệu hoá bằng mã hoá); đường đọc PII hội tụ về một chỗ → audit được.

**Tiêu cực:** thêm key management (2 khoá: AES + HMAC, rotate theo key_id); mất khả năng search partial/LIKE theo số giấy tờ; mọi nơi cần số đầy đủ phải đi qua service decrypt (không query SQL trần được).

## Alternatives considered

- **pgcrypto encrypt trong DB** — *Bác bỏ:* khoá nằm trong câu SQL/DB log; compromise DB = compromise khoá.
- **Giữ plaintext, chỉ dựa residency VN** — *Bác bỏ:* residency chưa chốt (ADR-0004 Proposed), và defense-in-depth yêu cầu cả hai.
- **Tokenization service riêng (vault)** — đúng hướng ở scale lớn, *overkill MVP*; thiết kế hiện tại tương thích để nâng cấp sau (đổi backend của EncryptionService).
