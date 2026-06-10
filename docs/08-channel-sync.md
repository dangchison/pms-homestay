# 08 — CHANNEL MANAGER & OTA SYNC

> **Phiên bản 3.0 (2026-06-10):** mapping theo **bookable resource** (một listing OTA = một resource, kể cả nguyên căn); pull có **bound thời gian** + sanity-guard có chỗ lưu state thật (`channel_resource_mappings.last_event_count`, `bookings.missing_sync_count`); push **không gồm HOLD** + hỗ trợ ETag/304.

## 1. Phạm vi MVP

- **iCal 2 chiều với Airbnb, Booking.com, Agoda.**
- **Channex/SiteMinder API:** thiết kế sẵn webhook + bảng dedup, không implement MVP. **Ngoại lệ cần cân nhắc sớm:** phòng bán trên ≥2 OTA (xem §6 — cửa sổ overbook của iCal là có thật).

## 2. Mô hình mapping

```
Property ──< Channel (Airbnb/Booking/Agoda của property)
Bookable Resource ──< ChannelResourceMapping >── Channel
                       ├─ external_listing_id   (id listing trên OTA)
                       ├─ ical_pull_url         (URL ta fetch từ OTA)
                       ├─ ical_push_token       (token để OTA fetch từ ta)
                       └─ last_event_count, last_pulled_at  (state cho sanity-guard)
```

- Một **listing OTA = một bookable resource**: listing "Phòng 101" ↔ resource ROOM; listing "Nguyên căn Villa A" ↔ resource WHOLE. (Map theo room vật lý là sai mô hình — listing nguyên căn không thuộc về phòng nào.)
- Một resource có thể map tới nhiều listing (Airbnb + Booking.com) → nhiều mapping.
- Busy time của một listing = occupancy của **mọi phòng thành viên** của resource (qua `resource_members` + `room_occupancy`).

## 3. iCal PULL (OTA → PMS)

### Lịch chạy

BullMQ cron **mỗi 15 phút per mapping** (configurable). OWNER có nút "Sync now" (job priority cao). Adaptive interval (5–30' theo mật độ booking) để phase 2.

### Worker

```typescript
@Processor('ical-pull')
export class IcalPullProcessor {
  @Process()
  async pullIcal(job: Job<{ mappingId: string; tenantId: string }>) {
    const mapping = await this.loadMapping(job.data);             // ngoài tx
    const syncJob = await this.createSyncJob(mapping, 'PULL_ICAL');

    try {
      // 1. Fetch + parse — external I/O, NGOÀI withTenant (ADR-0002)
      const res = await this.http.get(mapping.ical_pull_url, { timeout: 30_000, validateStatus: s => s < 500 });
      if (res.status !== 200) return this.failSyncJob(syncJob, `HTTP ${res.status}`);
      const events = await this.parseIcal(res.data);              // [{ uid, start, end, summary }]

      // 2. Load booking OTA hiện có của mapping — CÓ BOUND thời gian
      //    (horizon khớp với feed OTA; không load lịch sử vô hạn — bảng lớn dần theo năm)
      const existing = await withTenant(this.prisma, job.data.tenantId, tx =>
        tx.booking.findMany({
          where: {
            channel_mapping_id: mapping.id,
            external_uid: { not: null },
            check_out: { gte: subDays(new Date(), 7) },           // chỉ quan tâm hiện tại + tương lai
          },
        }));
      const byUid = new Map(existing.map(b => [b.external_uid, b]));

      // 3. Diff: tạo / cập nhật
      let created = 0, updated = 0, removed = 0, conflicts = 0;
      for (const ev of events) {
        const found = byUid.get(ev.uid);
        try {
          if (!found) { await this.createExternalBooking(mapping, ev); created++; }
          else if (this.timesChanged(found, ev)) { await this.updateExternalBooking(found, ev); updated++; }
        } catch (e) {
          if (e.code === '23P01') {                               // exclusion_violation từ room_occupancy
            await this.logConflict(syncJob, ev); conflicts++;
          } else throw e;
        }
      }

      // 4. REMOVED — có DATA-LOSS GUARD (hủy nhầm hàng loạt = khách đến nơi không có phòng)
      //    Airbnb có thể trả 200 + body rỗng/cụt khi lỗi tạm thời.
      const suspicious = events.length === 0
        || events.length < mapping.last_event_count * 0.5;
      if (suspicious && mapping.last_event_count > 0) {
        await this.warnAndAlert(syncJob, mapping, 'ICAL_FEED_SUSPICIOUS');   // KHÔNG hủy gì cả
      } else {
        const feedUids = new Set(events.map(e => e.uid));
        for (const b of existing) {
          const gone = !feedUids.has(b.external_uid);
          const cancellable = !['CANCELLED','CHECKED_IN','CHECKED_OUT','NO_SHOW'].includes(b.status)
            && b.check_in > new Date();                            // CHỈ hủy booking TƯƠNG LAI
          if (gone && cancellable) {
            if (b.missing_sync_count + 1 >= 2) {                   // vắng ≥2 lần sync LIÊN TIẾP mới hủy
              await this.cancelExternalBooking(b, 'Removed from OTA feed'); removed++;
            } else await this.bumpMissingCount(b);
          } else if (!gone && b.missing_sync_count > 0) {
            await this.resetMissingCount(b);
          }
        }
      }

      // 5. Chốt job + state cho lần sau
      await this.completeSyncJob(syncJob, { created, updated, removed, conflicts });
      await this.updateMappingState(mapping, { last_pulled_at: new Date(), last_event_count: events.length });
    } catch (err) {
      await this.failSyncJob(syncJob, err.message);
      throw err;                                                   // BullMQ retry với backoff
    }
  }
}
```

`createExternalBooking` đi qua **đúng một đường** `createBookingTx` (06 §3): booking trỏ `resource_id` của mapping, occupancy sinh trong cùng tx, EXCLUDE chặn xung đột.

### Idempotency

- `external_uid` từ iCal `UID`; unique theo **mapping**: `UNIQUE (channel_mapping_id, external_uid)` (không global — UID có thể đụng giữa 2 tenant). Re-run cron không tạo duplicate.
- UID đổi giữa các lần sync (hiếm): fallback match theo `(check_in, check_out, summary)` trước khi coi là cặp removed+created.

### Conflict resolution

Event OTA trùng booking nội bộ active:
- **Không tự ghi đè bên nào.** Log `sync_logs` WARN, tăng `conflict_count`, emit `booking.overbooking_detected` → notification OWNER + MANAGER: "Phát hiện overbooking giữa Airbnb và #BK-…".
- Booking nội bộ giữ nguyên; event OTA skip, lần sync sau retry (nếu host xử lý xong thì vào bình thường).

### Parse (node-ical)

- `DTSTART;VALUE=DATE` (all-day): convert theo timezone property → `[14:00 checkin, 12:00 checkout]` mặc định của plan thay vì 00:00–23:59 (tránh chặn lố sang slot giờ).
- `DTSTART;TZID=...`: convert UTC. `STATUS:CANCELLED`: coi như removed. `RRULE`: expand 12 tháng tới.

## 4. iCal PUSH (PMS → OTA)

### Endpoint public (token)

```
GET /api/v1/public/sync/ical/:token        @Public @SkipTenantScope
```

```typescript
async exportIcal(token: string, req, res) {
  const mapping = await this.findActiveMappingByToken(token);     // role riêng, scope hẹp (xem Bảo mật)
  if (!mapping) return res.status(404).send();

  // Busy = booking active của resource (KHÔNG gồm HOLD) — qua occupancy của các phòng thành viên
  const bookings = await this.loadActiveBookingsOfResource(mapping.resource_id, {
    statuses: ['PENDING', 'CONFIRMED', 'CHECKED_IN'],             // HOLD 10' không đẩy lên OTA:
    from: new Date(),                                             // OTA cache feed hàng giờ → hold ngắn
  });                                                             // sẽ thành block "ma" phía OTA

  const body = this.buildIcal(bookings, mapping);                 // uid: pms-<booking_id>@pmsapp.vn
  const etag = `"${sha256(body)}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();   // OTA poll dày → 304 rẻ

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');                     // bắt revalidate, ETag quyết định
  return res.send(body);
}
```

- Summary chỉ ghi `Reserved` — **không PII** (không tên khách, không số điện thoại).
- Trade-off HOLD: không đẩy HOLD nghĩa là trong ≤10 phút giữ chỗ, OTA về lý thuyết vẫn nhận đặt — nhưng OTA chỉ refetch iCal theo chu kỳ hàng giờ nên việc đẩy HOLD cũng không bảo vệ được cửa sổ đó; đổi lại tránh được block "ma" kéo dài. Rủi ro thật nằm ở độ trễ iCal nói chung (§6).

### Bảo mật

- Token 24-byte random hex (unguessable); lookup qua index riêng; endpoint chạy bằng đường code **không có tenant context** → query giới hạn đúng 1 mapping + booking của resource đó (service chuyên trách, role DB scope hẹp).
- Rate limit 10/min/IP per token. Nghi lộ token → nút "Regenerate" (OTA paste URL mới).
- Cảnh báo UI nếu một token bị pull từ quá nhiều IP khác nhau bất thường.

## 5. Webhook (Channex/SiteMinder — phase 2, thiết kế sẵn)

```
POST /api/v1/webhook/channel/:channel_id
Headers: X-Channel-Signature: sha256=<hmac>
Body: { event_id, event_type, data }
```

1. Verify HMAC (secret per channel, mã hoá khi lưu — ADR-0007).
2. Dedup: `webhook_events_received (source, event_id)` PK.
3. Enqueue BullMQ (jobId = event_id), trả 200 **ngay** — không xử lý sync trong request.
4. Worker xử lý qua `createBookingTx` như iCal.

## 6. Giới hạn của iCal & kế hoạch nâng cấp

**Cửa sổ overbook là có thật:** Airbnb refresh iCal phía họ có thể trễ 1–2h; ta poll 15'. Phòng bán trên ≥2 OTA có thể bị đặt chéo trong cửa sổ đó. Đối sách theo bậc:

1. **Mặc định:** disclaimer rõ cho host khi bật ≥2 OTA cho cùng resource (quyết định *có chủ đích*, không âm thầm).
2. **Mitigation:** giảm interval còn 5' cho mapping có ≥2 OTA hoặc mật độ booking cao.
3. **Giải pháp thật (kéo lên sớm khi có nhu cầu):** chuyển các resource multi-OTA sang **Channex API** (webhook 2 chiều, gần realtime) — không đợi hết phase 2. Schema đã sẵn (`channel_type = CHANNEX_API`, webhook + dedup).

## 7. Pitfalls

| Lỗi | Phòng tránh |
|-----|------------|
| iCal feed sai timezone | Test với feed Airbnb THẬT, không chỉ feed mẫu |
| UID đổi giữa các lần sync | Fallback match `(check_in, check_out, summary)` |
| Feed rỗng/cụt do lỗi tạm thời | Sanity-guard §3 (`last_event_count`, vắng ≥2 lần mới hủy, chỉ hủy tương lai) |
| Sync race với booking nội bộ | Một đường ghi qua occupancy; conflict → log + notify, không auto-resolve |
| Token push leak | Regenerate + cảnh báo multi-IP |
| Booking PMS không hiện trên OTA | Monitor: OTA có pull không (`last fetch` theo token) + alert |

## 8. Monitoring

- Dashboard OWNER: lần sync gần nhất per mapping, status, conflict count, link sync_logs.
- Alert PLATFORM_ADMIN: 3 lần fail liên tiếp cùng channel; conflict > 5/24h; cron không chạy > 60'; token không được OTA pull > 48h (cấu hình sai phía OTA).
- Retention: `sync_logs` 30 ngày, `sync_jobs` 90 ngày (cron — xem `03` §7).
