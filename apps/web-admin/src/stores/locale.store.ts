import { create } from 'zustand';

/** Tiếng Việt mặc định, key `en` sẵn (docs/ui/00 §4). */
export type Locale = 'vi' | 'en';

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: 'vi',
  setLocale: (locale) => set({ locale }),
}));
