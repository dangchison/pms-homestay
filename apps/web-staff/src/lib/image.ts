/**
 * Nén ảnh client-side trước upload (ui/02 §Camera: ≤1MB). Vẽ lại qua canvas,
 * giới hạn cạnh dài + chất lượng JPEG → giảm dung lượng đáng kể trên mạng 3G/4G.
 */
export async function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest > maxDim) {
    const scale = maxDim / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Không nén được ảnh');
  return blob;
}

/** PUT ảnh đã nén lên URL pre-signed (S3 tier VN). */
export async function uploadToPresigned(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } });
  if (!res.ok) throw new Error(`Upload ảnh thất bại (${res.status})`);
}
