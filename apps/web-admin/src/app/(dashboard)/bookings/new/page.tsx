'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { usePropertyStore } from '@/stores/property.store';
import { BookingForm } from '@/components/bookings/BookingForm';

/** B2 /bookings/new (task 6.3, flow F1): form tạo + báo giá sống. Prefill resource_id/
 *  check_in/check_out qua query (từ "Đặt nhanh" trên calendar 6.2). */
function NewBookingInner() {
  const t = useT();
  const params = useSearchParams();
  const propertyId = usePropertyStore((s) => s.selectedId);

  if (!propertyId) {
    return <p className="text-sm text-muted-foreground">{t('calendar.selectProperty')}</p>;
  }

  return (
    <BookingForm
      propertyId={propertyId}
      prefill={{
        resourceId: params.get('resource_id') ?? undefined,
        checkIn: params.get('check_in') ?? undefined,
        checkOut: params.get('check_out') ?? undefined,
      }}
    />
  );
}

export default function NewBookingPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Đặt phòng mới</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Đang tải…</p>}>
        <NewBookingInner />
      </Suspense>
    </div>
  );
}
