'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useProperties } from '@/lib/hooks/use-properties';

const SETUP_PATH = '/properties';

/**
 * Tenant chưa có cơ sở nào thì đưa thẳng về màn thiết lập.
 *
 * Không có cơ sở là trạng thái của người VỪA ĐĂNG KÝ, và gần như mọi thứ trong app
 * đều phụ thuộc `propertyId`: 7 hook ở trang chủ bị `enabled:false` nên KPI hiện
 * "0" giả thay vì trạng thái rỗng, còn Lịch phòng / Đặt phòng / Hoá đơn / Thanh
 * toán / Báo cáo đều cụt ở câu "chọn một cơ sở" — trong khi không có cơ sở nào để
 * chọn. Thay vì để người dùng tự dò ra, đưa họ tới đúng chỗ tạo cơ sở.
 *
 * Chỉ điều hướng khi query ĐÃ THÀNH CÔNG và trả về mảng rỗng. Dựa vào `!data` sẽ
 * đá cả người đang tải dở lẫn người gặp lỗi mạng, kể cả khi họ có cơ sở.
 */
export function RequirePropertySetup(): null {
  const router = useRouter();
  const pathname = usePathname();
  const { data: properties, isSuccess } = useProperties();

  useEffect(() => {
    if (!isSuccess || properties.length > 0) return;
    if (pathname === SETUP_PATH) return; // đã ở đúng chỗ — tránh điều hướng lặp
    router.replace(`${SETUP_PATH}?setup=1`);
  }, [isSuccess, properties, pathname, router]);

  return null;
}
