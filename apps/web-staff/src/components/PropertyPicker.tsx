'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pms/ui';
import { useSelectedProperty } from '@/lib/hooks/use-properties';

/**
 * Chọn cơ sở (mobile): nếu chỉ 1 cơ sở → hiện tên; nhiều hơn → Select gọn. Nhân
 * viên thường gắn 1 cơ sở nên mặc định ẩn gọn dưới tiêu đề trang.
 */
export function PropertyPicker() {
  const { properties, selectedId, current, setSelected } = useSelectedProperty();

  if (properties.length <= 1) {
    return <span className="text-sm text-muted-foreground">{current?.name ?? '…'}</span>;
  }
  return (
    <Select value={selectedId ?? ''} onValueChange={setSelected}>
      <SelectTrigger className="h-9 max-w-[60%]" aria-label="Chọn cơ sở">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {properties.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
