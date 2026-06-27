import { apiClient } from '@/lib/api-client';

/**
 * Tải Blob có auth (Bearer) → kích hoạt download trình duyệt với tên file gợi ý.
 * Dùng cho mọi file cần header Authorization (xlsx/zip) — KHÔNG dùng `<a href>`
 * trực tiếp vì thẻ a không gửi Bearer. [[use-reports]] [[use-compliance]]
 */
export async function downloadBlob(path: string, filename: string): Promise<void> {
  const blob = await apiClient.getBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
