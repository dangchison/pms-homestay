import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * CHO PHÉP index — ngược hẳn với `landing_page/` (trang pitch nội bộ, gắn
 * X-Robots-Tag noindex). Đây là mặt tiền công khai, cần được tìm thấy.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
