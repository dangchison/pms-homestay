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
    'property.placeholder': 'Chọn cơ sở',
    'property.loading': 'Đang tải cơ sở…',
    'auth.logout': 'Đăng xuất',
    'common.loading': 'Đang tải…',
  },
  en: {
    'topbar.realtime': 'Live',
    'topbar.offline': 'Disconnected',
    'topbar.newBooking': 'New booking',
    'topbar.notifications': 'Notifications',
    'property.placeholder': 'Select property',
    'property.loading': 'Loading properties…',
    'auth.logout': 'Sign out',
    'common.loading': 'Loading…',
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
