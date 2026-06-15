'use client';

import { useSelectedProperty } from '@/lib/hooks/use-properties';

/**
 * Chọn cơ sở (mobile): nếu chỉ 1 cơ sở → hiện tên; nhiều hơn → select gọn. Nhân
 * viên thường gắn 1 cơ sở nên mặc định ẩn gọn dưới tiêu đề trang.
 */
export function PropertyPicker() {
  const { properties, selectedId, current, setSelected } = useSelectedProperty();

  if (properties.length <= 1) {
    return <span className="text-sm text-muted-foreground">{current?.name ?? '…'}</span>;
  }
  return (
    <select
      value={selectedId ?? ''}
      onChange={(e) => setSelected(e.target.value)}
      className="max-w-[60%] truncate rounded-md border border-border bg-card px-2 py-1 text-sm"
      aria-label="Chọn cơ sở"
    >
      {properties.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
