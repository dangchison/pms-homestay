'use client';

import { useRef, useState } from 'react';
import { Button, toast } from '@pms/ui';
import { Camera, Loader2 } from 'lucide-react';
import { compressImage } from '@/lib/image';

export interface CapturedImage {
  blob: Blob;
  previewUrl: string;
}

/**
 * Chụp/chọn ảnh (ui/02 §Camera): dùng `<input capture="environment">` (mở camera
 * sau trên mobile, fallback chọn file trên desktop) → nén client ≤1MB → trả blob +
 * preview. Disable khi offline (mutation cần mạng).
 */
export function CameraCapture({
  label,
  onCapture,
  disabled,
}: {
  label: string;
  onCapture: (img: CapturedImage) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // cho phép chọn lại cùng file
          if (!file) return;
          setBusy(true);
          try {
            const blob = await compressImage(file);
            onCapture({ blob, previewUrl: URL.createObjectURL(blob) });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Không xử lý được ảnh');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base"
        disabled={disabled || busy}
        onClick={() => ref.current?.click()}
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        {label}
      </Button>
    </>
  );
}
