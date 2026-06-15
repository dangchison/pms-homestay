'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PropertyResponse } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';
import { usePropertyStore } from '@/stores/property.store';

/** Danh sách cơ sở nhân viên truy cập được (BE đã lọc theo user_property_roles). */
export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () => apiClient.get<{ data: PropertyResponse[] }>('/properties').then((r) => r.data),
  });
}

/**
 * Cơ sở đang chọn + tự set mặc định (cơ sở đầu tiên) khi chưa chọn. Trả thêm danh
 * sách để dựng switcher ở Cá nhân.
 */
export function useSelectedProperty() {
  const { data: properties, isLoading } = useProperties();
  const selectedId = usePropertyStore((s) => s.selectedId);
  const setSelected = usePropertyStore((s) => s.setSelected);

  useEffect(() => {
    if (!selectedId && properties && properties.length > 0) setSelected(properties[0]!.id);
  }, [selectedId, properties, setSelected]);

  const current = properties?.find((p) => p.id === selectedId) ?? null;
  return { properties: properties ?? [], selectedId, current, setSelected, isLoading };
}
