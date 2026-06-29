# 12 — TUÂN THỦ PHÁP LÝ VIỆT NAM

## 1. Danh sách quy định cần tuân thủ

| Quy định | Phạm vi | Mức độ MVP |
|---------|---------|------------|
| Thông tư 56/2017/TT-BCA (báo cáo lưu trú khách quốc tế cho công an) | Bắt buộc với mọi cơ sở lưu trú | **MVP** |
| Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân | Áp dụng mọi nền tảng xử lý PII của công dân VN | **MVP** |
| Luật An ninh mạng 2018 | Lưu trữ dữ liệu công dân VN trong nước | **MVP** (chọn region SG/HK ban đầu, có plan migrate VN) |
| Nghị định 123/2020/NĐ-CP về hoá đơn điện tử | Bắt buộc với doanh nghiệp xuất hoá đơn | Phase 2 |
| Thông tư 78/2021/TT-BTC | Format hoá đơn điện tử | Phase 2 |
| Luật Bảo vệ quyền lợi người tiêu dùng | Hợp đồng dịch vụ, hoàn tiền | MVP (clauses trong ToS) |

> **Data residency — phân tầng ngay từ MVP** ([ADR-0004](adr/0004-data-residency.md)): PII nhạy cảm (scan CCCD/passport, số giấy tờ, dữ liệu khai báo lưu trú) lưu tại **provider VN**; phần vận hành linh hoạt. Migrate DB SaaS đang chạy qua region khác rất tốn kém — quyết định phải chốt **trước khi lưu CCCD thật** (Sprint 6). Bổ trợ: số giấy tờ **mã hoá mức field** bất kể region ([ADR-0007](adr/0007-pii-field-encryption.md)).

## 2. Báo cáo lưu trú công an (Thông tư 56)

### Yêu cầu

Mọi cơ sở lưu trú (kể cả homestay) phải khai báo:
- **Khách Việt Nam:** Trong vòng 24h sau check-in.
- **Khách nước ngoài:** Trong vòng 12h sau check-in (24h nếu vùng sâu vùng xa).

Hiện tại Bộ Công an có cổng [https://dichvucong.dancuquocgia.gov.vn/](https://dichvucong.dancuquocgia.gov.vn/) (hệ thống tích hợp cư trú) cho phép khai báo online, có API.

### Implementation MVP

Phase 1 — Manual export:
- Sinh file Excel template chuẩn theo định dạng công an phường/xã (mỗi nơi có thể yêu cầu khác nhau).
- OWNER download file, upload vào cổng khai báo thủ công.
- Endpoint: `GET /api/v1/compliance/police-report?property_id=...&date=...`

Phase 2 — API tích hợp (khi có hợp đồng):
- POST trực tiếp lên API dịch vụ công cư trú (`dichvucong.dancuquocgia.gov.vn`) — khai báo tại **cấp xã (phường/xã)**.
- Lưu `police_report_status` (PENDING, SUBMITTED, FAILED) trên booking. ✅ **Đã làm (B6)** — cột + `POST /compliance/police-report/submit` (STUB dịch vụ công); xem [docs/18](18-phase2-backlog.md).

> **Cải cách hành chính 2025 (hiệu lực 01/7/2025):** bỏ cấp huyện → mô hình **2 cấp** (tỉnh/thành → phường/xã); khai báo lưu trú do **công an cấp xã** tiếp nhận. Khi nối API thật cần **mã đơn vị hành chính (ĐVHC)** chuẩn — nguồn: [Tổng cục Thống kê — Danh mục ĐVHC](https://www.nso.gov.vn/phuong-phap-luan-thong-ke/danh-muc/don-vi-hanh-chinh/) — cho (a) phường/xã của cơ sở, (b) thường trú của khách. Hiện `properties.province` / `guests.address` là **free text** → cân nhắc bảng tham chiếu `administrative_units` (code/name/level/parent, seed từ NSO) + dropdown đổ dần để chuẩn hoá khi triển khai tích hợp.

### Dữ liệu cần thiết

Bảng `guests` đã có đủ: full name, DOB, gender, nationality, ID document (type + number + issue date/place), check-in/out, address, phone.

> Số giấy tờ lưu **mã hoá** (ADR-0007) — job export báo cáo decrypt theo **batch**, mỗi lần chạy ghi 1 audit `READ_PII` scope "police-report" (không log từng số).

### UI flow

1. Khi check-in, lễ tân scan CCCD/passport → OCR tự động fill form.
2. Lễ tân verify + bấm "Lưu".
3. Job background tổng hợp form công an mỗi giờ → preview cho OWNER.
4. OWNER review + download Excel/PDF.
5. (Phase 2) Bấm nút "Gửi" → API call lên dịch vụ công.

## 3. OCR CCCD/Hộ chiếu (FPT.AI hoặc VNPT eKYC)

### Provider candidates

| Provider | Pros | Cons | Pricing approx |
|----------|------|------|----------------|
| **FPT.AI Vision** | Mature, doc CCCD VN chi tiết | Tốn token | ~500 VND/lần |
| **VNPT eKYC** | Tích hợp data CCCD chip | Phức tạp hơn, cần B2B contract | Negotiate |
| Google Document AI | Đa năng | Hỗ trợ tiếng Việt limited | Cost cao |
| Self-host PaddleOCR | Free, control | Maintenance, accuracy thấp hơn | 0 + dev cost |

**Đề xuất 3 cách:**
- **Cách 1 (KHUYẾN NGHỊ MVP):** FPT.AI Vision — accuracy cao, doc tiếng Việt rõ, on-demand pricing dễ start.
- **Cách 2:** VNPT eKYC — nếu sau này tích hợp dịch vụ công khác (VNeID), cùng provider tiện hơn.
- **Cách 3:** Self-host — chỉ khi volume lớn (> 100k/tháng) và có team ML.

### Integration

```typescript
@Injectable()
export class FptOcrService {
  // GỌI NGOÀI withTenant (external I/O — ADR-0002); timeout 15s, retry 1 lần, circuit breaker
  async extractIdDocument(imageBuffer: Buffer): Promise<IdDocumentExtraction> {
    const form = new FormData();
    form.append('image', new Blob([imageBuffer]));

    const res = await fetchWithRetry('https://api.fpt.ai/vision/idr/vnm', {
      method: 'POST', body: form,
      headers: { 'api-key': this.config.fptApiKey },
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await res.json();

    // Trả về CHỈ các field cần — KHÔNG persist raw response (chứa toàn bộ PII dạng JSON — ADR-0007).
    // Bản ghi pháp lý gốc là ảnh scan trên storage tier VN.
    return {
      document_type: raw.type_new || raw.type,    // CCCD, PASSPORT, CMND
      document_number: raw.id,                    // → mã hoá mức field khi save (ADR-0007)
      full_name: raw.name,
      date_of_birth: this.parseVnDate(raw.dob),
      gender: raw.sex,
      nationality: raw.nationality || 'VN',
      issue_date: this.parseVnDate(raw.issue_date),
      issue_place: raw.issue_loc,
      address: raw.address,
    };
  }
}
```

### Flow

1. Lễ tân chụp 2 mặt CCCD (web-staff PWA).
2. Upload thẳng lên storage **tier VN** (pre-signed PUT, path `tenants/{tenant_id}/guests/{guest_id}/cccd_front.jpg`).
3. POST `/api/v1/guests/scan-id` với storage key → service tải ảnh, gọi FPT.AI (ngoài tx), trả extracted data — **không ghi DB ở bước này**.
4. UI prefill form, lễ tân verify/sửa.
5. Save vào `guests`: số giấy tờ được **mã hoá mức field** theo [ADR-0007](adr/0007-pii-field-encryption.md) (cơ chế enc + blind-index hash; không lưu plaintext).
6. OCR fail → form nhập tay (fallback luôn sẵn).

### Lưu trữ ảnh

Theo Nghị định 13, scan CCCD là dữ liệu cá nhân **nhạy cảm**:
- Mã hoá at-rest (S3 SSE-KMS).
- Access log mọi lần đọc.
- Retention: 5 năm sau check-out cuối cùng (theo luật lưu trữ giao dịch dân sự), sau đó tự động xoá.
- Không expose URL public, chỉ pre-signed URL có expire 15 phút.

## 4. Nghị định 13/2023 — Bảo vệ dữ liệu cá nhân

### Yêu cầu chính

1. **Thông báo + Đồng ý:** Trước khi thu thập, khách phải được biết và đồng ý.
2. **Đăng ký xử lý dữ liệu nhạy cảm:** Báo cáo với Cục An ninh mạng & Phòng chống tội phạm sử dụng công nghệ cao (A05).
3. **Quyền của chủ thể:** Truy cập, xoá, sửa, từ chối xử lý, chuyển dữ liệu.
4. **DPO (Data Protection Officer):** Bắt buộc nếu xử lý dữ liệu nhạy cảm.
5. **Lưu trữ ở VN:** Yêu cầu lưu dữ liệu công dân VN tại VN (Luật ANM 2018) — hiện đang được làm rõ thêm.

### Implementation

**Bảng `data_processing_consents`:** schema chính thức ở `03-database-erd.md` §4.11 (consent_type, full text + hash tại thời điểm đồng ý, granted/revoked, IP/UA — composite FK theo chuẩn chung).

**Endpoints quyền chủ thể:**
- `GET /api/v1/guests/{id}/data-export` — Export toàn bộ data của khách (Right to Access + Portability).
- `POST /api/v1/guests/{id}/data-erasure` — Yêu cầu xoá, **có legal-hold check**: KHÔNG xoá dữ liệu đang bị nghĩa vụ lưu trữ ràng buộc — hồ sơ lưu trú công an, hoá đơn (≥10 năm), scan CCCD (5 năm). Chỉ anonymize phần được phép, giữ phần luật buộc; phần giữ lại được đánh dấu `legal_hold` + lịch xoá khi hết hạn. Quyền xoá (NĐ13) **không vượt** nghĩa vụ lưu trữ theo luật kế toán/cư trú.
- `POST /api/v1/guests/{id}/data-correction` — Sửa thông tin.

**Audit:** mọi lần đọc số giấy tờ đầy đủ / export → `audit_logs.action = 'READ_PII'` (decrypt hội tụ một đường — ADR-0007). `audit_logs.before/after` redact PII trước khi ghi; bảng append-only + RLS + partition/retention theo `03` §7.

**Anonymization sau retention period:**
- Sau 5 năm không có booking mới, anonymize: `full_name → 'ANONYMIZED'`, `phone → null`, `id_document_number → null`, `id_document_scan_url → deleted from S3`.
- Giữ `id` + lịch sử booking để báo cáo agg, không identifying.

### Privacy policy & ToS

- Cần có bản tiếng Việt + tiếng Anh, link footer mọi trang.
- Khách xác nhận đồng ý qua checkbox khi booking trực tiếp (không pre-checked).
- Khách qua OTA: assume consent đã được lấy bởi OTA, ta xử lý dưới điều khoản OTA — vẫn note rõ vai trò.

### Đăng ký A05

Hệ thống là **Data Processor** xử lý dữ liệu của tenant (Data Controller). Cần:
- Hợp đồng DPA (Data Processing Agreement) với mỗi tenant (template ký kèm ToS khi đăng ký).
- Đăng ký xử lý dữ liệu nhạy cảm (CCCD, passport) với A05.
- DPO: chỉ định nội bộ hoặc thuê dịch vụ DPO-as-a-service (track song song từ Sprint 1 — lead time dài).

## 5. VietQR — thanh toán

### Spec NAPAS 247

Format chuỗi QR (EMVCo + NAPAS extension):

```
00020101021238<length><merchant_account_info>5303704540<amount>5802VN62<add_info>6304<crc>
```

`<merchant_account_info>` =
```
0010A000000727  (NAPAS BIN)
0124  (length của sub-field)
00<acquirer_id><account_number>
0208QRIBFTTA  (transfer with content)
```

Thư viện helper:
```typescript
function buildVietQR(input: {
  bankBin: string;         // '970422' for MB, '970436' for VCB
  accountNumber: string;
  accountName?: string;
  amount: number;          // VND, integer
  addInfo: string;         // 'BK202605-0042'
}): string {
  // ... build chuẩn EMVCo + CRC16-CCITT
}
```

Có thể dùng package `vietqr` trên npm (verified).

### Sinh QR động cho mỗi invoice

- Khi issue invoice → sinh QR string + lưu cache.
- Endpoint `GET /api/v1/invoices/{id}/qr-image` trả PNG/SVG.
- QR dùng `addInfo = booking_code` để dễ match.

### Webhook đối soát

Tích hợp Casso/SePay (như mô tả `09-finance-accounting.md`).

## 6. Hoá đơn điện tử (Phase 2, không MVP)

Bộ tài chính bắt buộc doanh nghiệp xuất hoá đơn điện tử (E-invoice) từ 01/07/2022 theo Nghị định 123/2020.

### Triggers cần
- Tenant nâng cấp lên gói có "Hoá đơn điện tử".
- Tenant nhập MST + thông tin doanh nghiệp.
- Hệ thống kết nối nhà cung cấp đã được Tổng cục Thuế xác nhận (VNPT-Invoice, Viettel-Invoice, MISA meInvoice, Easyinvoice).
- Mỗi invoice ISSUED → POST qua API provider → nhận mã CQT (cơ quan thuế) → lưu lại.

### Bảng mới (Phase 2)
```sql
CREATE TABLE e_invoices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  provider VARCHAR(32),
  provider_invoice_id VARCHAR(100),
  cqt_code VARCHAR(50),                -- mã CQT cấp
  pdf_url TEXT,
  xml_url TEXT,
  status VARCHAR(16),                  -- PENDING, ISSUED, CANCELLED
  issued_at TIMESTAMPTZ,
  raw_response JSONB
);
```

## 7. Tiền điện nước cho khách thuê tháng

Theo Quyết định 28/2014 (giá điện): chủ nhà KHÔNG được tự ý áp giá điện cao hơn giá EVN. Nếu áp giá kinh doanh cho khách trọ, có thể bị phạt 7-10 triệu/lần.

Implementation:
- Trong rate_plan MONTHLY, cho phép cấu hình giá điện nhưng default = giá EVN (hiển thị disclaimer cảnh báo).
- Báo cáo công an: nếu có hợp đồng thuê tháng cần đăng ký "tạm trú", không phải "lưu trú".

## 8. Phòng ngừa rủi ro pháp lý

| Rủi ro | Phòng tránh |
|--------|------------|
| Tenant dùng hệ thống cho hoạt động bất hợp pháp (massage trá hình, đánh bạc) | ToS rõ ràng, anti-abuse policy, monitor pattern lạ |
| Khách khiếu nại không bảo mật dữ liệu | DPA, encryption, audit log, response process |
| Cơ quan thuế kiểm tra | Audit log + invoice records giữ ≥ 10 năm |
| Khách quốc tế lừa đảo CC | KYC khi check-in, blacklist guest |
| Dữ liệu CCCD bị leak | Encryption, access control nghiêm, security training |

## 9. Quy trình incident response

Nếu có data breach:
1. **Trong 72h** notify Cục An ninh mạng A05 (Nghị định 13 Điều 23).
2. Notify mọi tenant ảnh hưởng.
3. Notify khách bị ảnh hưởng nếu có nguy cơ cao.
4. Public incident report (anonymized) trên status page.
5. Post-mortem nội bộ, deploy fix.
