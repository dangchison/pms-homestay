# 06 — CHỐNG OVERBOOKING (DEFENSE IN DEPTH)

> **Phiên bản 3.0 (2026-06-10):** hợp nhất theo [ADR-0006](adr/0006-bookable-unit-model.md) (amendment) — **một cơ chế duy nhất** `room_occupancy`, áp dụng từ migration đầu tiên. Không còn EXCLUDE trên `bookings`, không còn trigger cross-check `bookings`↔`room_blocks`.

## 1. Vì sao cần nhiều lớp?

Overbooking là **lỗi nghiêm trọng nhất** của một PMS: khách bay đến không có phòng, thiệt hại tiền + uy tín. Không dựa vào một cơ chế đơn lẻ:

```
Lớp 1 — Application pre-check : kiểm tra trước khi tạo (UX nhanh, fail fast)
Lớp 2 — HOLD trong DB         : giữ slot khi khách đang thanh toán
Lớp 3 — Advisory lock         : serialize concurrent request trên cùng nhóm phòng
Lớp 4 — EXCLUDE constraint    : room_occupancy — hàng phòng thủ cuối, KHÔNG THỂ bypass
```

Lớp 1–3 là tối ưu trải nghiệm (trả lỗi đẹp, tránh đường lỗi constraint). **Chỉ lớp 4 là guarantee** — nếu 1–3 fail vì bất kỳ lý do gì (bug, race, node crash), DB constraint vẫn chặn.

## 2. Lớp 4 — EXCLUDE trên `room_occupancy` (nguồn sự thật)

### Vì sao không đặt EXCLUDE trên `bookings`?

`bookings` tham chiếu **bookable resource** (ADR-0006). Một resource `WHOLE` (nguyên căn) và các resource `ROOM` (từng phòng con) là các hàng khác nhau — EXCLUDE theo cột resource sẽ **không** chặn được khách A đặt nguyên căn trong khi khách B đặt một phòng con (overbook chéo). Phải đưa việc chặn trùng về **mức phòng vật lý**:

```sql
CREATE TABLE room_occupancy (
  -- định nghĩa đầy đủ: 03-database-erd.md §4.3
  room_id UUID NOT NULL,
  booking_id UUID,            -- hoặc
  block_id UUID,              -- đúng một trong hai (CHECK)
  period TSTZRANGE NOT NULL,  -- ĐÃ gồm buffer dọn phòng
  CONSTRAINT room_occupancy_no_overlap
    EXCLUDE USING gist (room_id WITH =, period WITH &&)
);
```

### Mô hình presence-based

**Hàng tồn tại ⇔ khoảng thời gian bị chặn.** Không có cột status (không drift với `bookings.status`):

| Sự kiện | OccupancyService làm gì (CÙNG transaction) |
|---------|---------------------------------------------|
| Booking tạo (HOLD/PENDING/CONFIRMED) | INSERT N hàng — mỗi phòng thành viên của resource 1 hàng (`resource_members`) |
| Booking đổi ngày / đổi resource | DELETE hàng cũ + INSERT hàng mới |
| Booking → CANCELLED / NO_SHOW / CHECKED_OUT | DELETE các hàng của booking |
| `room_block` tạo / xoá | INSERT / DELETE hàng (`block_id`) |

- `period = [check_in − buffer, check_out + buffer)` với `buffer = rooms.buffer_minutes` của **từng phòng** (booking lưu giờ thực, occupancy lưu khoảng chặn). HOURLY: buffer = 0 để 14:00–16:00 rồi 16:00–18:00 hợp lệ.
- `'[)'` = inclusive start, exclusive end → check-out 12:00 không đụng check-in 12:00.
- Vi phạm → PostgreSQL ném `23P01 exclusion_violation` → application map thành `409 BOOKING_OVERLAP`.
- GiST index chỉ chứa các khoảng **đang chặn** (hàng bị xoá khi terminal) → index nhỏ, ít bloat. Monitor bloat + `REINDEX CONCURRENTLY` định kỳ nếu churn HOLD lớn.
- Mọi nơi cần availability/calendar/iCal **đọc occupancy**, không đọc trực tiếp bookings theo phòng.

> `room_blocks` không cần EXCLUDE riêng hay trigger cross-check: block đi qua cùng bảng occupancy nên EXCLUDE chung tự chặn xung đột block↔booking và block↔block.

## 3. Lớp 3 — Advisory lock theo nhóm phòng

Serialize các request đặt chỗ đụng cùng phòng để chúng xếp hàng thay vì cùng đâm vào constraint:

```typescript
// bookings.service.ts — chạy BÊN TRONG withTenant (xem 02). Pricing/quote verify đã làm TRƯỚC đó,
// ngoài transaction (quy tắc: không external I/O, không compute dài trong tx — ADR-0002).
async function createBookingTx(tx: Tx, cmd: CreateBookingCmd): Promise<Booking> {
  const memberRoomIds = await occupancy.memberRooms(tx, cmd.resourceId); // resource_members

  // Lock từng phòng theo thứ tự ĐÃ SORT — tránh deadlock khi WHOLE ↔ ROOM đan nhau
  for (const roomId of [...memberRoomIds].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${roomId}::text, 0))`;
  }

  // Pre-check trong lock (trả 409 kèm chi tiết conflict, đẹp hơn lỗi constraint)
  const conflicts = await occupancy.findOverlaps(tx, memberRoomIds, cmd.periodWithBuffer);
  if (conflicts.length) throw new ConflictException({ code: 'BOOKING_OVERLAP', conflicts });

  const booking = await tx.booking.create({ data: { ...cmd, status: cmd.hold ? 'HOLD' : 'PENDING' } });
  await occupancy.insertForBooking(tx, booking, memberRoomIds);  // EXCLUDE là chốt chặn cuối
  await outbox.publish(tx, 'booking.created', booking);
  return booking;
}
```

- Advisory lock tự release khi tx kết thúc (commit/rollback), không unlock thủ công.
- `hashtextextended(uuid::text, 0)` → bigint; đụng hash chỉ gây contention thừa, **không** gây sai (EXCLUDE mới là guarantee).
- Lock là tối ưu UX — bỏ lock hệ thống vẫn ĐÚNG, chỉ xấu hơn về error path.

## 4. Lớp 2 — HOLD giữ slot khi khách thanh toán

Khách bấm "Đặt" và đi nhập thanh toán → giữ phòng 10 phút:

- Tạo booking `status = 'HOLD'`, `expires_at = now() + 10 min` — occupancy rows được sinh ngay ⇒ **mọi request khác thấy phòng bận ở tầng DB**.
- Thanh toán cọc OK → `HOLD → CONFIRMED` (qua deposit invoice — xem `09` §4).
- Cron mỗi phút: `WHERE status='HOLD' AND expires_at < now()` (đã có partial index `idx_bookings_expiry`) → CANCELLED (`HOLD_EXPIRED`) + **xoá occupancy rows trong cùng tx**.
- Redis **không** tham gia giữ chỗ — chỉ dùng đẩy cảnh báo UI "đang có người xem phòng này". Lý do: Redis crash là mất hold, DB constraint không biết về Redis.
- HOLD **không** xuất hiện trong iCal push (xem `08` §4) — hold 10 phút mà đẩy lên OTA sẽ bị OTA cache hàng giờ, mất khách vô ích.

> Booking `PENDING` (đã giữ chỗ, chưa cọc) cũng có `expires_at` (mặc định 24h, cấu hình per tenant). **Night-audit job** (xem `09` §9) hủy PENDING quá hạn — chống "booking ma" khoá tồn kho vô hạn.

## 5. Lớp 1 — Application pre-check (availability)

```typescript
// availability.service.ts — MỘT query trên occupancy, dùng cho cả calendar lẫn pre-check
async function getAvailability(tx: Tx, resourceId: string, from: Date, to: Date) {
  const rows = await tx.$queryRaw`
    SELECT ro.room_id, ro.period, ro.booking_id, ro.block_id
    FROM room_occupancy ro
    JOIN resource_members rm ON rm.room_id = ro.room_id
    WHERE rm.resource_id = ${resourceId}
      AND ro.period && tstzrange(${from}, ${to}, '[)')`;
  return { available: rows.length === 0, conflicts: rows };
}
```

Endpoint: `GET /api/v1/availability?resource_id=...&from=...&to=...` — FE disable nút đặt khi bận. Kết quả pre-check có thể stale (race) → lớp 3/4 xử lý phần còn lại.

## 6. Edge case quan trọng

| Case | Hành vi |
|------|---------|
| **Buffer dọn phòng** | Nới `period` khi sinh occupancy; giờ thực trên booking không đổi. HOURLY đặt buffer = 0 |
| **3–4 booking theo giờ cùng ngày** | `'[)'` xử lý đúng: 14:00–16:00 không trùng 16:00–18:00 |
| **MONTHLY check_out 6 tháng sau** | Cùng cơ chế; UI cảnh báo "phòng khoá tới ngày X" |
| **Đổi giờ check-in/out** | UPDATE booking → OccupancyService delete+reinsert → EXCLUDE tự re-check → 409 nếu đụng |
| **WHOLE ↔ ROOM** | Booking nguyên căn sinh occupancy cho MỌI phòng con → tự đụng EXCLUDE với bất kỳ booking phòng lẻ nào |
| **Timezone** | `tstzrange` so sánh ở UTC; input convert UTC trước khi insert; hiển thị theo TZ property |
| **Hủy rồi đặt lại cùng giờ** | Hủy đã xoá occupancy rows → đặt lại OK |

## 7. Concurrent webhook / sync từ OTA

1. Webhook handler enqueue BullMQ job với `jobId = event_id` → BullMQ dedup; bảng `webhook_events_received` dedup tầng DB.
2. Worker xử lý tuần tự per mapping; insert booking qua **đúng một đường** `createBookingTx` (đi qua occupancy + EXCLUDE).
3. Nếu constraint reject (khách OTA đụng booking nội bộ): log conflict vào `sync_logs`, tăng `conflict_count`, notify OWNER/MANAGER — **không tự hủy** bên nào; host xử lý thủ công (xem `08` §3).

## 8. Test plan

| Test | Mô tả | Mong đợi |
|------|-------|----------|
| Concurrent 2 booking cùng resource cùng giờ | 2 promise đồng thời | 1 thành công, 1 nhận 409 |
| **Concurrent WHOLE ↔ ROOM** | 1 đặt nguyên căn + 1 đặt phòng con, cùng khoảng | Chỉ 1 thành công |
| HOLD expire | Tạo HOLD, chờ quá 10' | CANCELLED + occupancy rows đã xoá |
| PENDING quá hạn cọc | Tạo PENDING, chạy night-audit | CANCELLED (`DEPOSIT_TIMEOUT`) |
| Đổi ngày đè booking khác | PATCH check_in/out | 409, occupancy giữ nguyên (tx rollback) |
| Block trùng booking | POST room_block | 409 từ EXCLUDE chung |
| Hủy rồi tạo lại cùng giờ | CANCEL → CREATE | Cả hai thành công |
| Buffer | buffer=30', booking 14:00–16:00 rồi 16:15–18:00 | 409 (đụng buffer); 16:30 OK |
| Crash giữa chừng | Kill app sau insert booking, trước insert occupancy | Tx rollback — không có booking mồ côi |

## 9. Tổng kết quyết định

- ✅ `btree_gist` + EXCLUDE **duy nhất** trên `room_occupancy` (presence-based, ADR-0006).
- ✅ Booking đặt **resource**; occupancy sinh per-phòng-vật-lý trong cùng tx (một choke-point: `OccupancyService`).
- ✅ Advisory xact lock theo room ids đã sort — tối ưu UX, không phải guarantee.
- ✅ HOLD là booking trong DB (10'), PENDING có hạn cọc (night-audit dọn); cron dùng partial index `idx_bookings_expiry`.
- ❌ KHÔNG dùng Redis lock làm source of truth — chỉ UI hint.
- ❌ KHÔNG có EXCLUDE/trigger trên `bookings`/`room_blocks` — mọi thứ hội tụ về occupancy.
