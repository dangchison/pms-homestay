import { useEffect, useRef } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { toast } from '@pms/ui';
import { useAuthStore } from '@/stores/auth.store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Trạng thái kết nối SSE cho chấm realtime (profile + offline banner). */
export const useRealtimeStore = create<{ connected: boolean; setConnected: (b: boolean) => void }>(
  (set) => ({ connected: false, setConnected: (connected) => set({ connected }) }),
);

/** event_type → queryKey cần invalidate (REST là nguồn sự thật — docs/10 §4). */
function invalidateForEvent(qc: QueryClient, eventType: string): void {
  const keys: string[][] = [];
  if (eventType.startsWith('booking.')) keys.push(['today'], ['rooms-board'], ['bookings']);
  else if (eventType.startsWith('payment.')) keys.push(['invoices'], ['payments'], ['today']);
  else if (eventType.startsWith('invoice.')) keys.push(['invoices'], ['today']);
  else if (eventType.startsWith('room.')) keys.push(['rooms-board']);
  else if (eventType.startsWith('cleaning')) keys.push(['cleaning']);
  for (const key of keys) void qc.invalidateQueries({ queryKey: key });
}

/**
 * SSE realtime (docs/10 §4, ui/02 §nav): subscribe `/events/stream` (token qua
 * query — EventSource không set header được). Dedup theo `event_id` → invalidate.
 * `cleaning_task.assigned` → rung + toast (buồng phòng nhận việc mới). Reconnect →
 * refetch toàn bộ. Mount 1 lần ở AuthGate.
 */
export function useEvents(): void {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const setConnected = useRealtimeStore((s) => s.setConnected);
  const seen = useRef<Set<string>>(new Set());
  const connectedOnce = useRef(false);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(
      `${BASE_URL}/api/v1/events/stream?access_token=${encodeURIComponent(token)}`,
    );

    es.onopen = () => {
      setConnected(true);
      if (connectedOnce.current) void qc.invalidateQueries(); // refetch sau reconnect
      connectedOnce.current = true;
    };
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as { event_id?: string; event_type?: string };
        if (!event.event_id || !event.event_type || seen.current.has(event.event_id)) return;
        seen.current.add(event.event_id);
        invalidateForEvent(qc, event.event_type);
        if (event.event_type === 'cleaning_task.assigned') {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(200);
          toast.info('Bạn có việc dọn phòng mới');
        }
      } catch {
        /* ping/keep-alive — bỏ qua */
      }
    };
    es.onerror = () => setConnected(false); // EventSource tự reconnect

    return () => {
      es.close();
      setConnected(false);
    };
  }, [token, qc, setConnected]);
}
