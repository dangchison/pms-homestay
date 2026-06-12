import { type UserRole } from '@pms/shared-types';

export type DeliveryChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'ZNS';

/** Dữ liệu event truyền vào worker/processEvent (từ outbox). */
export interface NotificationEventInput {
  event_id: string;
  event_type: string;
  tenant_id: string;
  payload: Record<string, unknown>;
}

export interface NotificationTarget {
  userId: string;
  email: string | null;
  channel: DeliveryChannel;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

/**
 * §5 (docs/10): role KHÔNG-OWNER có nhận nhóm event này không (route recipients).
 * OWNER nhận tất cả nên xử lý riêng ở routeTargets.
 */
export function roleSeesCategory(role: UserRole, category: string): boolean {
  switch (category) {
    case 'booking':
      return role === 'MANAGER' || role === 'STAFF';
    case 'payment':
    case 'invoice':
      return role === 'MANAGER' || role === 'ACCOUNTANT';
    case 'cleaning_task':
      return role === 'MANAGER' || role === 'STAFF' || role === 'HOUSEKEEPER';
    case 'room':
      return role === 'MANAGER' || role === 'STAFF' || role === 'HOUSEKEEPER';
    case 'sync_job':
      return role === 'MANAGER';
    default:
      return false;
  }
}

/**
 * Kênh theo event_type (MVP): event quan trọng → IN_APP + EMAIL; còn lại chỉ IN_APP.
 * SMS/ZNS chưa route mặc định (provider + template duyệt = track song song docs/14).
 */
const EMAIL_EVENTS = new Set<string>([
  'booking.created',
  'booking.cancelled',
  'booking.no_show',
  'payment.received',
  'invoice.overdue',
]);
export function channelsFor(eventType: string): DeliveryChannel[] {
  return EMAIL_EVENTS.has(eventType) ? ['IN_APP', 'EMAIL'] : ['IN_APP'];
}

/** Tiêu đề/nội dung tiếng Việt theo event_type (MVP chuỗi tĩnh; MJML/Handlebars sau). */
export function renderTemplate(eventType: string): { title: string; body: string } {
  const map: Record<string, { title: string; body: string }> = {
    'booking.created': { title: 'Đặt phòng mới', body: 'Có một đặt phòng mới vừa được tạo.' },
    'booking.confirmed': { title: 'Đặt phòng đã xác nhận', body: 'Một đặt phòng đã được xác nhận.' },
    'booking.cancelled': { title: 'Đặt phòng đã huỷ', body: 'Một đặt phòng vừa bị huỷ.' },
    'booking.no_show': { title: 'Khách không đến (no-show)', body: 'Một đặt phòng đã chuyển sang NO_SHOW.' },
    'booking.checked_in': { title: 'Khách đã nhận phòng', body: 'Một khách vừa check-in.' },
    'booking.checked_out': { title: 'Khách đã trả phòng', body: 'Một khách vừa check-out.' },
    'booking.resource_switched': { title: 'Đổi phòng', body: 'Một đặt phòng vừa được đổi phòng.' },
    'payment.received': { title: 'Nhận thanh toán', body: 'Vừa ghi nhận một khoản thanh toán.' },
    'payment.refunded': { title: 'Hoàn tiền', body: 'Vừa thực hiện một khoản hoàn tiền.' },
    'invoice.issued': { title: 'Hoá đơn phát hành', body: 'Một hoá đơn vừa được phát hành.' },
    'invoice.overdue': { title: 'Hoá đơn quá hạn', body: 'Một hoá đơn đã quá hạn thanh toán.' },
    'room.blocked': { title: 'Chặn phòng', body: 'Một phòng vừa bị chặn (bảo trì).' },
    'room.unblocked': { title: 'Bỏ chặn phòng', body: 'Một phòng vừa được bỏ chặn.' },
  };
  return map[eventType] ?? { title: 'Thông báo', body: `Sự kiện ${eventType}.` };
}
