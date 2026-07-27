'use client';

import { useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@pms/ui';
import type { RatePlanResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useAssignRatePlanResources } from '@/lib/hooks/use-rate-plans';
import { useResources } from '@/lib/hooks/use-resources';

/**
 * Gán đơn vị bán cho một gói giá. Endpoint là PUT (thay thế toàn bộ) nên luôn gửi
 * danh sách đầy đủ; bỏ chọn hết = gỡ gói khỏi mọi đơn vị, lúc đó đơn vị rơi về gói
 * mặc định của cơ sở khi báo giá.
 */
export function RatePlanResourcesDialog({
  propertyId,
  plan,
  onClose,
}: {
  propertyId: string;
  plan: RatePlanResponse;
  onClose: () => void;
}) {
  const { data: resources, isLoading } = useResources(propertyId);
  const assign = useAssignRatePlanResources();
  const [selected, setSelected] = useState<string[]>(plan.resource_ids);

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));

  const onSave = async () => {
    try {
      await assign.mutateAsync({ id: plan.id, resource_ids: selected });
      toast.success('Đã cập nhật đơn vị áp dụng');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Cập nhật thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đơn vị áp dụng — {plan.name}</DialogTitle>
          <DialogDescription>
            Chọn những phòng hoặc nguyên căn dùng gói giá này. Không chọn gì thì đơn vị sẽ dùng gói
            mặc định của cơ sở.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
            {(resources ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Cơ sở này chưa có đơn vị bán nào.</p>
            ) : (
              (resources ?? []).map((res) => (
                <label key={res.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(res.id)}
                    onCheckedChange={(c) => toggle(res.id, c === true)}
                  />
                  {res.name}
                  <span className="text-xs text-muted-foreground">
                    {res.type === 'WHOLE' ? 'nguyên căn' : 'phòng'}
                  </span>
                </label>
              ))
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="button" disabled={assign.isPending} onClick={onSave}>
            {assign.isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
