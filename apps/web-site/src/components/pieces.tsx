import {
  CalendarDays,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  NotebookPen,
  QrCode,
  ScanLine,
} from 'lucide-react';

/* ───────────────────────── Cột trái: những mảnh rời ─────────────────────────
 * Mỗi mảnh là một nơi thông tin đang nằm hôm nay. Nghiêng nhẹ và lệch hàng —
 * đó chính là vấn đề, không phải trang trí. `--tilt` do animation settle-in đọc.
 */

const SOURCE_ICON = {
  zalo: MessageSquare,
  mail: Mail,
  excel: FileSpreadsheet,
  giay: NotebookPen,
} as const;

export type SourceKind = keyof typeof SOURCE_ICON;

export function Scrap({
  kind,
  from,
  children,
  tilt = 0,
  index = 0,
}: {
  kind: SourceKind;
  from: string;
  children: React.ReactNode;
  /** độ nghiêng khi nghỉ, tính bằng độ — giữ nhỏ, đây là giấy tờ chứ không phải sticker */
  tilt?: number;
  index?: number;
}) {
  const Icon = SOURCE_ICON[kind];
  return (
    <div
      data-piece
      style={{ '--tilt': `${tilt}deg`, '--i': index } as React.CSSProperties}
      className="rounded-lg border border-border bg-surface-muted px-3.5 py-3"
    >
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        {from}
      </p>
      <p className="mt-1.5 text-sm leading-snug text-ink-2">{children}</p>
    </div>
  );
}

/* ──────────────────────── Cột phải: sản phẩm đang làm ────────────────────────
 * Dựng bằng đúng token và ngôn ngữ trạng thái của hệ thống (DESIGN.md §Status
 * Language): màu nằm ở chấm + viền + nền tint, chữ luôn là foreground neutral.
 */

export function Surface({
  children,
  label,
  /** Khối đã ở trong tầm mắt lúc tải thì không mờ vào — xem globals.css. */
  still = false,
}: {
  children: React.ReactNode;
  label: string;
  still?: boolean;
}) {
  return (
    <figure
      {...(still ? {} : { 'data-settled': true })}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <figcaption className="border-b border-border px-4 py-2.5 text-xs text-ink-2">
        {label}
      </figcaption>
      <div className="p-4">{children}</div>
    </figure>
  );
}

const BOOKING_TONE = {
  confirmed: 'bg-booking-confirmed',
  hold: 'bg-booking-hold',
  ota: 'bg-booking-ota',
  checkedin: 'bg-booking-checkedin',
} as const;

type Bar = { start: number; span: number; tone: keyof typeof BOOKING_TONE; who: string };

const CALENDAR_ROWS: { room: string; bars: Bar[] }[] = [
  { room: '101', bars: [{ start: 0, span: 3, tone: 'checkedin', who: 'Trần Minh' }] },
  {
    room: '102',
    bars: [
      { start: 1, span: 2, tone: 'ota', who: 'Booking.com' },
      { start: 4, span: 3, tone: 'confirmed', who: 'Lê Hà' },
    ],
  },
  {
    room: '201',
    bars: [
      { start: 0, span: 2, tone: 'confirmed', who: 'Phạm An' },
      { start: 3, span: 2, tone: 'hold', who: 'Giữ chỗ' },
    ],
  },
  { room: '202', bars: [{ start: 2, span: 4, tone: 'confirmed', who: 'Nguyễn Vy' }] },
  { room: '301', bars: [{ start: 0, span: 2, tone: 'ota', who: 'Airbnb' }, { start: 5, span: 2, tone: 'confirmed', who: 'Đỗ Khánh' }] },
  { room: '302', bars: [{ start: 1, span: 5, tone: 'confirmed', who: 'Vũ Hoàng' }] },
];

/** Dải lịch phòng: hàng = phòng, cột = đêm. Bản rút gọn của màn hình trung tâm. */
export function CalendarStrip({ rooms = 4 }: { rooms?: number }) {
  const nights = ['12', '13', '14', '15', '16', '17', '18'];
  const rows = CALENDAR_ROWS.slice(0, rooms);

  return (
    <div className="min-w-0">
      <div
        className="grid gap-x-1 text-xs text-ink-2"
        style={{ gridTemplateColumns: `2.5rem repeat(${nights.length}, minmax(0, 1fr))` }}
      >
        <span aria-hidden />
        {nights.map((n) => (
          <span key={n} className="text-center tabular-nums">
            {n}
          </span>
        ))}
      </div>
      <div className="mt-1.5 grid gap-1">
        {rows.map((r) => (
          <div
            key={r.room}
            className="grid items-center gap-x-1"
            style={{ gridTemplateColumns: `2.5rem repeat(${nights.length}, minmax(0, 1fr))` }}
          >
            <span className="text-xs font-medium tabular-nums text-ink-2">{r.room}</span>
            {nights.map((_, i) => {
              const bar = r.bars.find((b) => b.start === i);
              if (bar) {
                return (
                  <div
                    key={i}
                    style={{ gridColumn: `span ${bar.span}` }}
                    className="flex h-7 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-background px-1.5"
                  >
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${BOOKING_TONE[bar.tone]}`}
                    />
                    <span className="truncate text-xs text-foreground">{bar.who}</span>
                  </div>
                );
              }
              const covered = r.bars.some((b) => i > b.start && i < b.start + b.span);
              return covered ? null : <div key={i} className="h-7 rounded-md bg-surface-muted" />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dòng đối soát tiền: chuyển khoản về khớp đúng hoá đơn. */
export function PaymentMatch() {
  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">HD-2608-0142 · Phòng 202</p>
          <p className="truncate text-xs text-ink-2">Nguyễn Vy · 3 đêm</p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">2.400.000 ₫</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-3 text-xs text-ink-2">
        <QrCode aria-hidden className="size-3.5" strokeWidth={1.75} />
        Khách quét VietQR, nội dung <span className="font-medium text-foreground">HD26080142</span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success-muted px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
          <p className="truncate text-sm">Ngân hàng báo về, khớp tự động</p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">2.400.000 ₫</p>
      </div>
    </div>
  );
}

/** Check-in: quét CCCD ra sẵn tờ khai lưu trú. */
export function CheckinScan() {
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-3">
        <ScanLine aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0 text-sm">
          <p className="font-medium">Nguyễn Thị Vy</p>
          <p className="mt-0.5 text-xs text-ink-2">
            CCCD 0•••••••••••1 · 12/03/1994 · Hải Châu, Đà Nẵng
          </p>
        </div>
      </div>
      <dl className="grid gap-1.5 rounded-lg bg-surface-muted px-3 py-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-2">Tờ khai lưu trú TT56</dt>
          <dd className="font-medium">Đã tạo, chờ gửi</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-2">Lễ tân phải gõ tay</dt>
          <dd className="font-medium">không trường nào</dd>
        </div>
      </dl>
    </div>
  );
}

/** P&L: doanh thu trừ chi phí thật, gồm cả khấu hao. */
export function PnlRows() {
  const rows = [
    { label: 'Doanh thu phòng', value: '84.600.000 ₫', tone: '' },
    { label: 'Hoa hồng OTA', value: '− 9.120.000 ₫', tone: 'text-ink-2' },
    { label: 'Tiền thuê nhà', value: '− 35.000.000 ₫', tone: 'text-ink-2' },
    { label: 'Điện nước, dọn phòng, vật tư', value: '− 12.480.000 ₫', tone: 'text-ink-2' },
    { label: 'Khấu hao tài sản', value: '− 3.250.000 ₫', tone: 'text-ink-2' },
  ];
  return (
    <div className="grid gap-0.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
          <span className="min-w-0 truncate text-ink-2">{r.label}</span>
          <span className={`shrink-0 tabular-nums ${r.tone}`}>{r.value}</span>
        </div>
      ))}
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-border pt-2.5">
        <span className="text-sm font-medium">Lãi thật tháng 8</span>
        <span className="text-base font-semibold tabular-nums">24.750.000 ₫</span>
      </div>
    </div>
  );
}

/** Đồng bộ kênh: một lịch, nhiều nơi bán. */
export function ChannelSync() {
  const channels = [
    { name: 'Booking.com', at: '6 phút trước' },
    { name: 'Airbnb', at: '6 phút trước' },
    { name: 'Agoda', at: '14 phút trước' },
  ];
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm">
        <CalendarDays aria-hidden className="size-4 shrink-0 text-primary" strokeWidth={1.75} />
        <span className="font-medium">Lịch phòng</span>
        <span className="ml-auto text-xs text-ink-2">nguồn duy nhất</span>
      </div>
      <div className="grid gap-1.5 pl-3">
        {channels.map((c) => (
          <div
            key={c.name}
            className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm"
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-booking-ota" />
            <span>{c.name}</span>
            <span className="ml-auto text-xs text-ink-2">đồng bộ {c.at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Danh sách khách đến hôm nay, kèm nơi đặt. Khác hình lịch ở đầu trang có chủ ý:
 * khoảnh khắc "khớp" đầu tiên phải cho thấy điều hero chưa nói — ba nguồn đặt rời
 * rạc rơi đúng vào một dòng, có nguồn ghi rõ.
 */
export function ArrivalsToday() {
  const rows = [
    { room: '102', who: 'Lê Hà', via: 'Zalo', tone: 'confirmed' as const, note: '2 đêm' },
    { room: '201', who: 'Phạm An', via: 'Booking.com', tone: 'ota' as const, note: '3 đêm' },
    { room: '202', who: 'Nguyễn Vy', via: 'Gọi điện', tone: 'confirmed' as const, note: '3 đêm · đã cọc' },
    { room: '301', who: 'Đỗ Khánh', via: 'Airbnb', tone: 'ota' as const, note: '1 đêm' },
  ];
  return (
    <div className="grid gap-1.5">
      {rows.map((r) => (
        <div key={r.room} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
          <span className="w-9 shrink-0 text-sm font-medium tabular-nums text-ink-2">{r.room}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.who}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-2">
            <span aria-hidden className={`size-1.5 rounded-full ${BOOKING_TONE[r.tone]}`} />
            {r.via}
          </span>
          <span className="hidden shrink-0 text-xs text-ink-2 sm:inline">{r.note}</span>
        </div>
      ))}
    </div>
  );
}
