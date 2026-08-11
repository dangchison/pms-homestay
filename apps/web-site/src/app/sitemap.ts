import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

const ROUTES = ['', '/tinh-nang', '/bang-gia', '/lien-he', '/dieu-khoan', '/bao-mat'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((r) => ({
    url: `${SITE_URL}${r}`,
    changeFrequency: r === '' ? 'weekly' : 'monthly',
    priority: r === '' ? 1 : 0.7,
  }));
}
