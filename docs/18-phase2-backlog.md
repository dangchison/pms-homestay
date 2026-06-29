# 18 — BACKLOG PHASE 2 (Hoàn thiện sau khi roadmap 50/50 đóng)

> **Ngày:** 2026-06-26. Roadmap MVP (EPIC 1–8, 50 task) đã đóng — xem [`PROGRESS.md`](../PROGRESS.md) §3–§4. File này gom các **TODO/hoãn** còn rải rác trong mô tả task đã đóng + phần **kích hoạt vận hành** chưa bật, thành backlog có cấu trúc.
>
> **"Đóng task" ≠ "hoàn thiện sản phẩm":** mỗi task đóng kèm acceptance (chủ yếu **265 e2e backend**), nhưng FE chưa có e2e runtime và một số nhánh con bị hoãn. Đây là danh sách "chống mục" cho giai đoạn sau MVP.
>
> Quy ước: mỗi mục có **mô tả · file/nguồn · acceptance · ưu tiên** (P0 cao → P2 thấp). Khi quyết định làm → tạo task vào [`14-roadmap-tasks.md`](14-roadmap-tasks.md) (đúng quy trình docs/00 §7), không code thẳng từ file này.

---

## P2-A — Frontend hoàn thiện & E2E

| # | Mục | Mô tả | Nguồn | Acceptance | Ưu tiên |
|---|-----|-------|-------|-----------|:---:|
| A1 ✅ | E2E web-admin (Playwright) | Smoke điều hướng (login demo + dashboard/calendar/invoices/reports/settings) + flow ghi (thu tiền hoá đơn → còn lại 0₫). webServer tự khởi động api+web; job CI `e2e-web`. | [apps/web-admin/e2e](../apps/web-admin/e2e) · [ci.yml](../.github/workflows/ci.yml) | ✅ **Done** [PR#42] — 3/3 xanh local; CI chạy mỗi PR. _(web-staff E2E = A2)_ | **P0** |
| A2 | web-staff PWA hoàn thiện | Workbox/offline cache, camera + OCR check-in, nối API đầy đủ (hiện 6.6 mới shell + trang tĩnh) | PROGRESS 6.6 | Offline shell hoạt động; check-in OCR end-to-end trên thiết bị | P1 |
| A3 | Trang/luồng FE hoãn | Ledger `/payments` theo property (F3), export PDF/Excel ở Reports, chế độ giờ HOURLY + kéo mép đổi ngày ở Calendar | PROGRESS 6.4/6.5/6.2 | Mỗi trang có dữ liệu thật + thao tác chính chạy | P1 |

## P2-B — Tính năng hoãn (BE)

| # | Mục | Mô tả | Nguồn | Acceptance | Ưu tiên |
|---|-----|-------|-------|-----------|:---:|
| B1 ✅ | Forfeit cọc NO_SHOW + retention matrix | Sinh ADJUSTMENT khi NO_SHOW; áp đầy đủ retention matrix; night-audit per-property timezone | PROGRESS 4.6 TODO | ✅ **Done** — NO_SHOW có cọc đã thu → ADJUSTMENT (SURCHARGE +cọc / DEPOSIT_APPLIED −cọc, total 0; DEPOSIT giữ PAID); no-show theo TZ TỪNG cơ sở; retention §7 đầy đủ (idempotency_keys/sync_logs/sync_jobs/notifications/payment_attempts per-tenant + outbox PROCESSED/FAILED global). e2e 4/4 | P1 |
| B2 | Notifications nâng cấp | Template MJML/Handlebars; **SMS/ZNS provider thật** (đang stub); e2e đầu-cuối qua queue | PROGRESS 4.4 TODO | Email render template; SMS/ZNS gửi thật ở staging | P1 |
| B3 | Audit mở rộng | Ghi LOGIN/LOGOUT/EXPORT; archive partition cũ (>12 tháng) ra S3 | PROGRESS 4.5 TODO | e2e: login ghi audit; partition cũ DETACH + upload S3 | P2 |
| B4 | Billing SaaS hoàn chỉnh | Cổng thanh toán tự động (thay confirm thủ công); **platform-auth module** (thay `PLATFORM_ADMIN_SECRET` header) | PROGRESS 4.7 TODO | Thanh toán thuê bao tự kích hoạt ACTIVE; platform admin đăng nhập module riêng | P1 |
| B5 ✅ | STAY phụ thu | Surcharge/phụ thu phát sinh trên STAY invoice (minibar/dịch vụ) | PROGRESS 3.2 TODO | ✅ **Done** — bảng `booking_surcharges` (0027, RLS); POST/GET/DELETE `/bookings/:id/surcharges` (chặn khi terminal → ADJUSTMENT); check-out gộp vào STAY (SURCHARGE/AMENITY/UTILITY) → total/balance đúng. e2e: minibar→STAY 1.1M + xoá + 422 sau checkout | P2 |
| B6 | Police report Phase 2 | `police_report_status` trên booking + nối API quận/huyện (hiện manual export Excel) | PROGRESS 7.2 / docs/12 §2 | Trạng thái PENDING→SUBMITTED; gửi API thành công | P2 |

## P2-C — Kích hoạt vận hành (ops — code sẵn, chưa bật)

| # | Mục | Mô tả | Nguồn | Acceptance | Ưu tiên |
|---|-----|-------|-------|-----------|:---:|
| C1 🟡 | Sentry | Set `SENTRY_DSN` (BE + FE) + dashboards + source-map token CI | PROGRESS 8.2 "Kích hoạt (ops)" | 🟡 **Đã kích hoạt + verify (2026-06-29)** — 3 project riêng (`pms-api`/`pms-web-admin`/`pms-web-staff`); DSN trong env **gitignored** (không commit); BE bắn event thật lên dashboard kèm `request_id`/`tenant_id`; FE build nhúng DSN vào client bundle. **Còn:** source-map upload CI → hoãn đến deploy (xem Ghi chú ↓) | **P0** |
| C2 | Backup R2 | R2 bucket + creds + lifecycle (30d/12w) + cron 02:00 ICT thật; PITR provider | PROGRESS 8.1 / docs/11 §6 · docs/17 §1 | Backup chạy hằng đêm; restore-drill đo RTO/RPO | **P0** |
| C3 | Load-test staging | Chạy k6 trên **staging** (book scenario GHI dữ liệu — không prod) | PROGRESS 8.3 / infra/k6 | Threshold p95 đạt budget docs/11 §10 | P1 |
| C4 | Object storage prod | MinIO/S3 tier VN cho ảnh phòng/CCCD/dọn phòng (ADR-0004) | docs/12 §3 · ADR-0004 | Upload/presign hoạt động ở môi trường thật | P1 |

## P2-D — Chống mục kỹ thuật (hardening — từ đánh giá rủi ro multi-tenancy)

| # | Mục | Mô tả | Nguồn | Acceptance | Ưu tiên |
|---|-----|-------|-------|-----------|:---:|
| D1 ✅ | CI guard RLS coverage | Meta-test quét `pg_class`/`pg_policy`: mọi bảng có cột `tenant_id` PHẢI `FORCE ROW LEVEL SECURITY` + policy — chặn merge nếu thiếu (allowlist cross-tenant: outbox_events/webhook_events_received/subscription_payments) | [apps/api/test/integration/rls-coverage.spec.ts](../apps/api/test/integration/rls-coverage.spec.ts) · [docs/02 §12](02-multi-tenancy.md) | ✅ **Done** — thêm bảng tenant-scoped thiếu RLS → test đỏ (đã verify negative test) | **P0** |
| D2 | Tune & giám sát connection pool | Cấu hình `connection_limit`/pgbouncer (hiện `.env.example` chưa set); giám sát query-cost theo tenant (noisy neighbor) | [docs/02 §11–§12](02-multi-tenancy.md) · docs/11 §10 | Pool có giới hạn rõ; dashboard cost theo tenant | P1 |

---

## Ghi chú

- **C1 Sentry — source-map CI (hoãn đến deploy):** SDK đã wire (task 8.2) + DSN đã set + verify (2026-06-29, 3 project riêng). Upload source-map chỉ có giá trị cho bundle **minified đã DEPLOY** nên làm lúc deploy: (a) thêm GitHub repo secrets `SENTRY_AUTH_TOKEN` (secret thật) + `SENTRY_ORG`; (b) vì **3 project riêng**, build mỗi FE app với `SENTRY_PROJECT` riêng (`pms-web-admin` / `pms-web-staff`) — sửa `.github/workflows/ci.yml` truyền env per-app vào bước build; (c) set `SENTRY_RELEASE` (vd git SHA) cho BE+FE để gắn version. `next.config.ts` đã đọc sẵn `SENTRY_ORG/PROJECT/AUTH_TOKEN`; thiếu → bỏ qua upload (build vẫn xanh). "Dashboards" = Sentry tự tạo issue stream mỗi project; tuỳ biến trên UI, không cần code.
- **Không phải EPIC mới** — đây là lớp hoàn thiện/hardening sau MVP. Khi go-live tới gần (docs/16 ~09/2026), ưu tiên P0 trước (E2E happy-path, Sentry, backup R2, CI guard RLS).
- Wish-list tính năng *mới* sau MVP (không phải hoàn thiện cái đã có) nằm ở [`16-product-roadmap.md`](16-product-roadmap.md) — đừng trộn hai danh sách.
