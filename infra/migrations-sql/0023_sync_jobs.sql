-- Up Migration
-- ============================================================================
-- 0023 — sync_jobs + sync_logs (task 5.2, docs/03 §4.8)
-- Mỗi lần pull/push iCal ghi 1 sync_job (state + đếm) + nhiều sync_log (dòng INFO/
-- WARN/ERROR). Worker iCal pull (15'/mapping) tạo job PULL_ICAL: fetch+parse NGOÀI
-- withTenant, tạo/sửa booking OTA qua createFromIcalTx (conflict 23P01 → log +
-- booking.overbooking_detected, KHÔNG auto-resolve), sanity-guard chống mất booking
-- (docs/08 §3). enum sync_job_status + cột bookings.missing_sync_count/external_uid/
-- channel_mapping_id ĐÃ có (0022/0009) — migration này chỉ thêm 2 bảng job/log.
--
-- RLS (tenant-scoped): worker ghi TRONG withTenant(tenant_id). sync_logs cascade
-- theo sync_job. Retention (docs/03 §7): 2 bảng phình nhanh nhất → dọn theo §7 (sau).
-- ============================================================================

CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  channel_id UUID NOT NULL,
  channel_mapping_id UUID,
  job_type VARCHAR(32) NOT NULL CHECK (job_type IN ('PULL_ICAL', 'PUSH_ICAL', 'WEBHOOK_RECV')),
  status sync_job_status NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  events_processed INT NOT NULL DEFAULT 0,
  events_created INT NOT NULL DEFAULT 0,
  events_updated INT NOT NULL DEFAULT 0,
  events_removed INT NOT NULL DEFAULT 0,
  conflict_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (tenant_id, channel_id) REFERENCES channels (tenant_id, id)
);

-- Lịch sử job của 1 channel/mapping (trang sync): mới nhất trước.
CREATE INDEX idx_sync_jobs_channel ON sync_jobs (tenant_id, channel_id, started_at DESC);
CREATE INDEX idx_sync_jobs_mapping ON sync_jobs (channel_mapping_id, started_at DESC)
  WHERE channel_mapping_id IS NOT NULL;

SELECT enforce_tenant_isolation('sync_jobs');

CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sync_job_id UUID NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  level VARCHAR(16) NOT NULL CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  message TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_logs_job ON sync_logs (sync_job_id, created_at);

SELECT enforce_tenant_isolation('sync_logs');
