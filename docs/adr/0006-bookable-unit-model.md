# ADR-0006 — Mô hình bookable unit + `room_occupancy` chống overbook chéo

- **Status:** Accepted
- **Ngày:** 2026-06-09
- **Liên quan:** review §E6, §B1; `06-overbooking-prevention.md`, `03-database-erd.md`

## Context

`bookings` luôn tham chiếu **một** `room_id`, và EXCLUDE constraint chỉ chống trùng trên **cùng** `room_id`. Nhưng homestay/apartment VN rất phổ biến kiểu **thuê nguyên căn** (`rooms.rent_mode = WHOLE`) song song bán **từng phòng**. Mô hình hiện tại **không** chặn được overbook chéo: đặt "nguyên căn" trong khi từng phòng con vẫn bán (và ngược lại), vì hai booking nằm trên các `room_id` khác nhau.

## Decision

Tách khái niệm **đơn vị bán được (bookable resource)** khỏi **phòng vật lý**, và đưa nguồn chống-overbooking về **mức phòng vật lý** qua một bảng occupancy.

1. **`bookable_resources`** (id, property_id, type `WHOLE|ROOM`, …) — thứ khách đặt. Booking tham chiếu `resource_id`.
2. **`resource_members`** (resource_id, room_id) — ánh xạ một resource tới các phòng vật lý nó chiếm. `ROOM` → 1 phòng; `WHOLE` → tất cả phòng của căn.
3. **`room_occupancy`** (room_id, period `tstzrange`, booking_id, status) — **nguồn sự thật chống overbooking**, với:
   ```sql
   ALTER TABLE room_occupancy ADD CONSTRAINT room_occupancy_no_overlap
   EXCLUDE USING gist (room_id WITH =, period WITH &&)
   WHERE (status IN ('HOLD','PENDING','CONFIRMED','CHECKED_IN'));
   ```
   Khi tạo/sửa booking, **trong cùng transaction** sinh các hàng occupancy cho **mọi phòng** mà resource chiếm (1 booking nguyên căn → N hàng; 1 booking phòng → 1 hàng). EXCLUDE trên `room_occupancy` tự chặn mọi xung đột — kể cả chéo WHOLE↔ROOM — ở tầng DB.
4. `room_blocks` cũng ghi vào `room_occupancy` (hoặc giữ EXCLUDE riêng + trigger cross-check như `06`).

> **Phương án tối giản nếu chỉ có 2 cấp và muốn nhanh:** khi đặt nguyên căn, tạo N booking con (mỗi phòng 1) gắn `group_id`; EXCLUDE hiện tại tự chặn. Nhược điểm: phải gộp group ở UI/đếm doanh thu. ADR chọn `room_occupancy` vì sạch hơn và mở rộng được (combo phòng, resource ảo).

## Consequences

**Tích cực:** chống overbook chéo nguyên-căn/từng-phòng **bằng DB** (không phụ thuộc application logic); mở rộng cho combo phòng, resource ảo; tách giá/àvailability theo resource.

**Tiêu cực:** thêm bảng `room_occupancy` + logic sinh occupancy rows trong transaction booking; **EXCLUDE chuyển từ `bookings` sang `room_occupancy`** → cập nhật `06-overbooking-prevention.md` và migration tương ứng; quote/calendar phải đọc occupancy theo phòng.

## Alternatives considered

- **Giữ nguyên (EXCLUDE trên `bookings.room_id`)** — *Bác bỏ:* không chặn overbook chéo WHOLE↔ROOM.
- **Cây phòng cha–con không materialize occupancy** — *Bác bỏ:* khó enforce ở tầng DB; vẫn phải check bằng application.
- **`group_id` cho booking con** — phương án dự phòng tối giản (xem ghi chú), không chọn làm mặc định.

---

## Amendment 2026-06-10 — Chốt mô hình MỘT cơ chế: presence-based occupancy

Bản gốc để **hai** cơ chế song song (EXCLUDE trên `bookings` "baseline" + `room_occupancy` khi bật nguyên căn) và `bookings.room_id` vẫn NOT NULL trong khi Decision nói "booking trỏ tới resource_id" — mâu thuẫn này sẽ sinh schema chắp vá. Chốt lại **một** mô hình duy nhất, áp dụng từ migration đầu tiên:

1. **`bookings.resource_id NOT NULL`** (composite FK → `bookable_resources`). **Bỏ hẳn cột `bookings.room_id`** và bỏ EXCLUDE constraint trên `bookings`. Liên kết booking ↔ phòng vật lý đi qua `room_occupancy` (mọi truy vấn theo phòng JOIN qua occupancy). Cơ sở chỉ bán từng phòng: mỗi phòng có sẵn 1 resource type=ROOM (tạo tự động khi tạo room) — mô hình không phức tạp thêm cho case đơn giản.
2. **`room_occupancy` là presence-based** — bỏ cột `status`: *hàng tồn tại = khoảng thời gian bị chặn*. EXCLUDE **vô điều kiện** `(room_id WITH =, period WITH &&)`. Vòng đời quản lý trong **cùng transaction** bởi `OccupancyService`:
   - Booking tạo (HOLD/PENDING/CONFIRMED) → insert N hàng (mỗi phòng thành viên 1 hàng).
   - Booking đổi ngày/đổi resource → delete + reinsert.
   - Booking CANCELLED / NO_SHOW / CHECKED_OUT → **delete** các hàng của nó.
   - `room_blocks` tạo/xoá → insert/delete hàng occupancy (`block_id`).
   - `CHECK (booking_id IS NOT NULL) <> (block_id IS NOT NULL)` (đúng một nguồn).
   Lợi ích: không drift status giữa 2 bảng; GiST index chỉ chứa khoảng đang chặn (nhỏ, ít bloat); xoá hàng theo terminal-state là một choke-point duy nhất.
3. **Buffer dọn phòng áp khi sinh occupancy:** `period = [check_in − buffer, check_out + buffer)` theo `rooms.buffer_minutes` của từng phòng thành viên; booking lưu giờ thực, occupancy lưu khoảng chặn.
4. **Advisory lock (tối ưu UX, không phải guarantee):** lock từng `room_id` thành viên theo **thứ tự đã sort** (`pg_advisory_xact_lock(hashtextextended(room_id::text, 0))`) để tránh deadlock khi 2 booking WHOLE↔ROOM đan nhau. EXCLUDE vẫn là hàng phòng thủ cuối.
5. iCal push/pull, calendar, availability đều đọc occupancy (xem `06`, `08` đã cập nhật).
