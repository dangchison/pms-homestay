import { useEffect, useRef, useState } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAuthStore } from '@/stores/auth.store';
import { ensureRefreshed } from '@/lib/api-client';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Trạng thái kết nối SSE cho chấm realtime ở TopBar. */
export const useRealtimeStore = create<{ connected: boolean; setConnected: (b: boolean) => void }>(
  (set) => ({ connected: false, setConnected: (connected) => set({ connected }) }),
);

/**
 * event_type → queryKey cần invalidate (REST là nguồn sự thật — docs/10 §4).
 * Seed sẵn ['notifications']: KHÔNG có event_type "notification.dot" trong outbox
 * (EVENT_TYPES ở packages/shared-types/events.ts) — dòng IN_APP do notification
 * worker sinh TỪ MỌI domain event, nên mọi event đều phải làm mới chuông TopBar.
 */
export function invalidateForEvent(qc: QueryClient, eventType: string): void {
  const keys: string[][] = [['notifications']];
  if (eventType.startsWith('booking.')) keys.push(['bookings'], ['occupancy'], ['today'], ['channels']);
  else if (eventType.startsWith('payment.')) keys.push(['payments'], ['invoices'], ['today']);
  else if (eventType.startsWith('invoice.')) keys.push(['invoices']);
  else if (eventType.startsWith('room.')) keys.push(['occupancy'], ['rooms']);
  else if (eventType.startsWith('cleaning')) keys.push(['cleaning']);
  for (const key of keys) void qc.invalidateQueries({ queryKey: key });
}

/**
 * Trần cho tập dedup `event_id`. Tab dashboard mở cả ngày nhận rất nhiều event;
 * `Set` không giới hạn sẽ phình mãi. Cắt theo FIFO — event cũ không bao giờ được
 * gửi lại sau hàng nghìn event mới nên bỏ đi là an toàn.
 */
const SEEN_LIMIT = 500;

/**
 * Trần số lần tự làm mới token rồi dựng lại stream. Không có trần thì một server
 * cứ trả 401 sẽ tạo vòng lặp onerror → refresh → connect → 401 chạy mãi.
 */
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * SSE realtime (docs/10 §4): subscribe `/events/stream` (token qua query —
 * EventSource không set header được). Dedup theo `event_id` (at-least-once) → map
 * `event_type` → invalidateQueries. Gọi 1 lần ở dashboard shell (AuthGate).
 *
 * Dep `token` là CỐ Ý dù nó khiến kết nối dựng lại mỗi 15 phút (TTL access token):
 * `events.controller.ts` chỉ verify token lúc handshake, không kiểm lại giữa chừng,
 * nên vòng reconnect này là cơ chế re-validate quyền DUY NHẤT đang có.
 */
export function useEvents(): void {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const setConnected = useRealtimeStore((s) => s.setConnected);
  const seen = useRef<Set<string>>(new Set());
  /** Đã RỚT kết nối thật hay chưa — khác hẳn "đã từng kết nối". */
  const dropped = useRef(false);
  const attempts = useRef(0);
  const [connectSeq, setConnectSeq] = useState(0);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(
      `${BASE_URL}/api/v1/events/stream?access_token=${encodeURIComponent(token)}`,
    );

    es.onopen = () => {
      setConnected(true);
      attempts.current = 0; // kết nối được rồi thì trần thử lại tính lại từ đầu
      // Chỉ bù dữ liệu khi kết nối RỚT thật (API restart, mất mạng) — lúc đó có thể
      // đã lỡ event vì server không replay theo Last-Event-ID. Xoay token là teardown
      // CHỦ ĐỘNG, `es.close()` không kích onerror nên không rơi vào nhánh này; trước
      // đây mọi lần dựng lại đều gọi invalidateQueries() KHÔNG tham số, tức đánh stale
      // toàn bộ cache (kể cả query inactive) và bắn lại ~10 request mỗi 15 phút.
      if (dropped.current) {
        dropped.current = false;
        void qc.refetchQueries({ type: 'active' }); // chỉ lấy lại thứ đang hiển thị
      }
    };
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as { event_id?: string; event_type?: string };
        if (!event.event_id || !event.event_type || seen.current.has(event.event_id)) return;
        if (seen.current.size >= SEEN_LIMIT) {
          seen.current.delete(seen.current.values().next().value!); // Set giữ thứ tự chèn
        }
        seen.current.add(event.event_id);
        invalidateForEvent(qc, event.event_type);
      } catch {
        /* ping/keep-alive — bỏ qua */
      }
    };
    es.onerror = () => {
      setConnected(false);
      dropped.current = true;
      // EventSource tự reconnect bằng ĐÚNG URL cũ, tức token cũ. Quá 15 phút thì
      // server trả 401, và theo spec response non-2xx làm EventSource bỏ cuộc VĨNH
      // VIỄN (readyState = CLOSED) → realtime chết im lặng. Làm mới token rồi dựng
      // lại kết nối bằng cách bump connectSeq.
      if (es.readyState === EventSource.CLOSED && attempts.current < MAX_RECONNECT_ATTEMPTS) {
        attempts.current += 1;
        void ensureRefreshed().then((ok) => {
          if (ok) setConnectSeq((n) => n + 1);
        });
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [token, connectSeq, qc, setConnected]);
}
