import { type Locale, useLocaleStore } from '@/stores/locale.store';

/**
 * i18n tối giản (docs/ui/00 §4): tiếng Việt mặc định + key `en` sẵn. Dict tĩnh,
 * `useT()` đọc locale từ store. Đủ cho chrome (shell); mở rộng key dần theo trang.
 */
const messages = {
  vi: {
    'topbar.realtime': 'Trực tuyến',
    'topbar.offline': 'Mất kết nối',
    'topbar.newBooking': 'Đặt phòng',
    'topbar.notifications': 'Thông báo',
    'notifications.title': 'Thông báo',
    'notifications.empty': 'Chưa có thông báo',
    'notifications.markRead': 'Đánh dấu đã đọc',
    'notifications.markReadError': 'Đánh dấu đã đọc thất bại',
    'notifications.viewAll': 'Xem tất cả',
    'property.placeholder': 'Chọn cơ sở',
    'property.loading': 'Đang tải cơ sở…',
    'property.createFirst': 'Tạo cơ sở đầu tiên',
    'auth.logout': 'Đăng xuất',
    'common.loading': 'Đang tải…',
    'calendar.title': 'Lịch phòng',
    'calendar.today': 'Hôm nay',
    'calendar.filter': 'Trạng thái',
    'calendar.prev': 'Khoảng trước',
    'calendar.next': 'Khoảng sau',
    // Mỗi trang một câu riêng: dùng chung 'calendar.selectProperty' khiến trang Hoá
    // đơn / Thanh toán / Báo cáo hiện "để xem lịch" — sai hẳn ngữ cảnh.
    'calendar.selectProperty': 'Chọn một cơ sở để xem lịch.',
    'bookings.selectProperty': 'Chọn một cơ sở để xem danh sách đặt phòng.',
    'bookings.newSelectProperty': 'Chọn một cơ sở trước khi tạo đặt phòng.',
    'invoices.selectProperty': 'Chọn một cơ sở để xem hoá đơn.',
    'payments.selectProperty': 'Chọn một cơ sở để xem thanh toán.',
    'reports.selectProperty': 'Chọn một cơ sở để xem báo cáo.',
  },
  en: {
    'topbar.realtime': 'Live',
    'topbar.offline': 'Disconnected',
    'topbar.newBooking': 'New booking',
    'topbar.notifications': 'Notifications',
    'notifications.title': 'Notifications',
    'notifications.empty': 'No notifications',
    'notifications.markRead': 'Mark as read',
    'notifications.markReadError': 'Failed to mark as read',
    'notifications.viewAll': 'View all',
    'property.placeholder': 'Select property',
    'property.loading': 'Loading properties…',
    'property.createFirst': 'Create your first property',
    'auth.logout': 'Sign out',
    'common.loading': 'Loading…',
    'calendar.title': 'Calendar',
    'calendar.today': 'Today',
    'calendar.filter': 'Status',
    'calendar.prev': 'Previous range',
    'calendar.next': 'Next range',
    'calendar.selectProperty': 'Select a property to view the calendar.',
    'bookings.selectProperty': 'Select a property to view bookings.',
    'bookings.newSelectProperty': 'Select a property before creating a booking.',
    'invoices.selectProperty': 'Select a property to view invoices.',
    'payments.selectProperty': 'Select a property to view payments.',
    'reports.selectProperty': 'Select a property to view reports.',
  },
} as const;

export type MessageKey = keyof (typeof messages)['vi'];

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.vi[key] ?? key;
}

export function useT(): (key: MessageKey) => string {
  const locale = useLocaleStore((s) => s.locale);
  return (key) => translate(locale, key);
}
