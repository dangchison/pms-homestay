/**
 * No-flash theme script (docs/ui/00 §3). Chạy ĐỒNG BỘ trước khi paint để set
 * data-theme trên <html>: ưu tiên localStorage('pms-theme') → prefers-color-scheme
 * → 'light'. Nhúng inline qua <script dangerouslySetInnerHTML> ở đầu <body>.
 *
 * Đổi theme runtime: document.documentElement.dataset.theme = 'dark'|'warm'|'light'
 * (ThemeSwitcher UI để task 6.7).
 */
export const THEME_STORAGE_KEY = 'pms-theme';

export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;
