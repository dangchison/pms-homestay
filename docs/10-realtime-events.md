# 10 — REALTIME EVENTS & OUTBOX PATTERN

> **Phiên bản 3.0 (2026-06-10):** Outbox v2 (claim PROCESSING + reclaim sweep — hết kẹt row khi worker crash; LISTEN/NOTIFY đánh thức — hết trễ 5s); định nghĩa lại **đúng** semantics SSE reconnect (refetch snapshot, không hứa "không mất event"); một Redis subscriber duy nhất fan-out in-process.

## 1. Tổng quan

Push realtime cho: trạng thái buồng phòng (housekeeping), booking mới từ OTA, task dọn phòng được gán, payment về (đối soát VietQR). **Transport: SSE** (lý do: `01-tech-stack.md` §5).

**Triết lý:** SSE là **tín hiệu invalidation + toast**, không phải nguồn sự thật. Nguồn sự thật là REST API; client nhận event → TanStack Query `invalidateQueries` → refetch. Nhờ vậy mất event không gây sai dữ liệu, chỉ trễ một nhịp refetch.

## 2. Domain events

Naming: `<aggregate>.<verb_past_tense>`. Payload luôn có `event_id` (= outbox id) + `tenant_id` + dữ liệu tối thiểu để route/invalidate (id, không nhét cả entity).

| Event | Trigger | Subscribers chính |
|-------|---------|-------------------|
| `booking.created` | Insert booking (mọi source) | Calendar, notification |
| `booking.confirmed` | PENDING → CONFIRMED (cọc PAID) | Calendar, email khách |
| `booking.cancelled` | → CANCELLED (gồm HOLD_EXPIRED, DEPOSIT_TIMEOUT) | Calendar, refund worker |
| `booking.no_show` | Night-audit | Calendar, notification |
| `booking.checked_in` / `booking.checked_out` | Check-in/out | Calendar, cleaning generator |
| `booking.resource_switched` | Đổi resource/phòng | Calendar |
| `booking.overbooking_detected` | Sync conflict (08 §3) | Notification OWNER/MANAGER |
| `room.housekeeping_changed` | CLEAN/DIRTY/CLEANING/INSPECTION | Room board, staff PWA |
| `room.blocked` / `room.unblocked` | room_blocks | Calendar |
| `payment.received` / `payment.refunded` | Payment SUCCEEDED / refund | Invoice UI, notification |
| `invoice.issued` / `invoice.overdue` | Issue / night-audit | UI, notification |
| `cleaning_task.assigned` / `cleaning_task.completed` | Cleaning flow | Staff PWA push |
| `sync_job.completed` / `sync_job.failed` | iCal sync | Channel dashboard |

## 3. Transactional Outbox v2 (bắt buộc)

### Vì sao outbox

```typescript
// SAI: emit sau commit — crash giữa 2 dòng là mất event (email không gửi, UI không update)
await prisma.booking.create({ data });
eventEmitter.emit('booking.created', payload);
```

Outbox: insert event **cùng transaction** với entity → commit là cả hai cùng tồn tại; dispatcher gửi sau.

```typescript
await withTenant(prisma, tenantId, async (tx) => {
  const booking = await tx.booking.create({ data });
  await outbox.publish(tx, {                       // INSERT outbox_events trong CÙNG tx
    event_type: 'booking.created',
    aggregate_type: 'booking', aggregate_id: booking.id,
    payload: { booking_id: booking.id, property_id: booking.property_id },
  });
});
```

### Dispatcher — claim an toàn đa instance + đánh thức tức thì

Schema `outbox_events` (`03` §4.10): status `PENDING → PROCESSING → PROCESSED | FAILED`, có `claimed_at`; trigger `pg_notify('outbox_new')` AFTER INSERT.

```typescript
@Injectable()
export class OutboxDispatcher implements OnModuleInit {
  async onModuleInit() {
    // LISTEN trên một pg connection RIÊNG (không qua pooler transaction-mode)
    await this.pgListen.listen('outbox_new', () => this.kick());   // đánh thức ngay khi có event mới
    this.interval = setInterval(() => this.kick(), 5_000);         // poll 5s = FALLBACK (mất NOTIFY/retry)
    setInterval(() => this.reclaimStuck(), 30_000);                // sweep PROCESSING kẹt
  }

  private async kick() {
    if (this.running) return;                                      // chống chồng lần chạy
    this.running = true;
    try {
      // Claim atomic — 2 instance không bao giờ lấy trùng row (đã kiểm chứng SKIP LOCKED trên PG16)
      const events: OutboxEvent[] = await this.prisma.$queryRaw`
        UPDATE outbox_events SET status = 'PROCESSING', claimed_at = now()
        WHERE id IN (
          SELECT id FROM outbox_events WHERE status = 'PENDING'
          ORDER BY created_at LIMIT 100
          FOR UPDATE SKIP LOCKED
        ) RETURNING *`;

      // Dispatch theo batch có giới hạn song song (không tuần tự từng event)
      await pMap(events, e => this.dispatchOne(e), { concurrency: 10 });
    } finally { this.running = false; }
  }

  private async dispatchOne(event: OutboxEvent) {
    try {
      // 1. Fan-out SSE qua Redis pub (kèm event_id để client dedup)
      await this.redisPub.publish(`tnt:${event.tenant_id}:events`, JSON.stringify({
        event_id: event.id, event_type: event.event_type,
        payload: event.payload, ts: event.created_at,
      }));
      // 2. Notification nặng (email/SMS/ZNS) KHÔNG gửi trực tiếp — enqueue BullMQ job riêng (§7)
      await this.notificationRouter.enqueue(event);

      await this.markProcessed(event.id);
    } catch (err) {
      await this.markRetry(event.id, err);          // PENDING lại, retry_count++; ≥10 → FAILED + alert
    }
  }

  // Worker crash sau khi claim → row kẹt PROCESSING vĩnh viễn nếu không có sweep này
  private async reclaimStuck() {
    await this.prisma.$executeRaw`
      UPDATE outbox_events SET status = 'PENDING', retry_count = retry_count + 1
      WHERE status = 'PROCESSING' AND claimed_at < now() - interval '60 seconds'`;
  }
}
```

**Delivery semantics: at-least-once.** Redis publish thành công nhưng bước sau lỗi → retry sẽ publish lại → consumer (SSE client, notification worker) **dedup theo `event_id`**. Không hứa exactly-once.

## 4. SSE endpoint

### Một subscriber Redis duy nhất, fan-out in-process

ioredis ở chế độ subscribe **chiếm trọn connection**; mở 1 subscription per SSE client không scale. Đúng: **một** connection subscriber pattern `tnt:*:events` (psubscribe) cho cả process → router in-process đẩy vào các Observable theo tenant + permission:

```typescript
@Injectable()
export class EventBusService implements OnModuleInit {
  private streams = new Map<string, Subject<DomainEvent>>();   // tenant_id → Subject

  async onModuleInit() {
    this.sub = this.redisFactory.createSubscriberConnection(); // TÁCH khỏi connection lệnh thường
    await this.sub.psubscribe('tnt:*:events');
    this.sub.on('pmessage', (_p, channel, message) => {
      const tenantId = channel.split(':')[1];
      this.streams.get(tenantId)?.next(JSON.parse(message));
    });
  }
  forTenant(tenantId: string): Observable<DomainEvent> { /* getOrCreate Subject */ }
}

@Controller('events')
export class EventsController {
  @Get('stream') @UseGuards(JwtAuthGuard, TenantGuard) @Sse()
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    // KHÔNG mở transaction/withTenant cho stream (ADR-0002); permission snapshot tại subscribe,
    // re-check theo TTL 5' (đổi quyền → hiệu lực trễ tối đa 5' với stream đang mở)
    const scope = this.permissionSnapshot(user);
    return merge(
      this.eventBus.forTenant(user.tnt).pipe(
        filter(e => canUserSeeEvent(scope, e)),
        map(e => ({ id: e.event_id, data: e })),               // id = event_id (client dedup)
      ),
      interval(30_000).pipe(map(() => ({ comment: 'ping' }))), // heartbeat giữ kết nối qua proxy
    );
  }
}
```

**Hạ tầng:** SSE đi **thẳng tới NestJS** (không proxy qua Next.js route handler — bị buffer); bật **HTTP/2** ở LB/Cloudflare — HTTP/1.1 giới hạn ~6 connection/domain, nhiều tab admin sẽ đói connection.

### Client (Next.js) — semantics ĐÚNG của reconnect

```typescript
export function useEvents() {
  const qc = useQueryClient();
  const seen = useRef(new LRUSet(500));                        // dedup theo event_id (at-least-once)

  useEffect(() => {
    const es = new EventSource(`${API_URL}/api/v1/events/stream`, { withCredentials: true });
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (seen.current.has(e.event_id)) return;
      seen.current.add(e.event_id);
      invalidateFor(qc, e);                                    // map event_type → queryKey cần refetch
    };
    es.onopen = () => qc.invalidateQueries({ type: 'active' }); // RECONNECT → REFETCH SNAPSHOT
    return () => es.close();
  }, []);
}
```

> **Quan trọng:** SSE **không replay** event đã phát trong lúc client mất kết nối (không có Last-Event-ID replay ở MVP). Outbox bảo đảm event *được phát ra* dù app crash — nhưng client offline thì không nhận được. Bù lại: `onopen` sau reconnect → invalidate toàn bộ active queries → UI tự đúng lại bằng snapshot. Đừng thiết kế UI phụ thuộc "nhận đủ mọi event".

## 5. Filtering theo permission

| Event | Ai thấy |
|-------|---------|
| `booking.*` | OWNER; MANAGER/STAFF của property (theo payload `property_id`) |
| `payment.*`, `invoice.*` | OWNER, ACCOUNTANT, MANAGER của property |
| `cleaning_task.*` | OWNER, MANAGER, STAFF property + HOUSEKEEPER được assign |
| `room.*`, `sync_job.*` | OWNER, MANAGER (room.* thêm STAFF/HOUSEKEEPER property) |

`canUserSeeEvent(scope, event)` so role + property scope từ payload với snapshot lúc subscribe (re-check TTL 5').

## 6. Scale ngang

- Mỗi instance API: 1 Redis subscriber + EventBus in-process như §4 — SSE client kết nối instance nào cũng nhận đủ.
- Dispatcher chạy ở **mọi** instance đều an toàn (claim bằng `FOR UPDATE SKIP LOCKED` — không double-send). BullMQ chỉ lock *lịch chạy*, không lock *row outbox* — vì vậy claim SQL là bắt buộc, không phụ thuộc BullMQ.

## 7. Notification fan-out (Email/SMS/ZNS)

Dispatcher không gửi trực tiếp — enqueue BullMQ queue `notifications` (job types `email`/`sms`/`zns`/`in_app`, dedup theo `event_id + channel`):

```typescript
async enqueue(event: OutboxEvent) {
  for (const target of routeTargets(event)) {        // template + người nhận theo event_type
    await this.notifyQueue.add(target.channel, { event_id: event.id, ...target },
      { jobId: `${event.id}:${target.channel}:${target.userId}` });   // idempotent
  }
}
```

Lỗi gửi email không block event khác; BullMQ retry exponential backoff; template Handlebars/MJML (chi tiết task 4.4).

## 8. Retention

`outbox_events`: PROCESSED giữ 7 ngày, FAILED 90 ngày (night-audit dọn — matrix `03` §7). Index partial chỉ trên PENDING/PROCESSING để bảng to không làm chậm claim.

## 9. Test plan

| Test | Mô tả | Expected |
|------|-------|----------|
| Crash trước commit | Inject crash trong tx sau khi create booking, trước commit | Không booking, không event (atomic) |
| Crash sau commit, trước dispatch | Kill app ngay sau commit | Dispatcher (instance khác/khởi động lại) gửi — event đến trễ, không mất |
| **Worker crash sau claim** | Kill worker khi row đang PROCESSING | Sweep 60s trả về PENDING, retry — không kẹt vĩnh viễn |
| Multi-instance | 3 dispatcher đồng thời, 1000 events | Mỗi event PROCESSED đúng 1 lần (SKIP LOCKED) |
| Redis publish fail 10 lần | Mock publish lỗi | Event FAILED + alert; các event khác không bị chặn |
| At-least-once dedup | Force retry sau publish thành công | Client nhận 2 lần cùng `event_id`, UI chỉ xử lý 1 (LRU dedup) |
| **Client mất kết nối 1 phút** | Ngắt mạng, có event trong lúc đó | Reconnect → `onopen` invalidate → UI đúng lại bằng refetch (event KHÔNG replay — đây là hành vi thiết kế) |
| NOTIFY latency | Insert outbox → đo thời gian SSE tới client | < 500ms p95 (không đợi poll 5s) |
