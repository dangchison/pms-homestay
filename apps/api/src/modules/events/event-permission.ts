import { type JwtClaims, type RealtimeEvent } from '@pms/shared-types';

export interface EventScope {
  isOwner: boolean;
  role: JwtClaims['rol'];
  propertyIds: ReadonlySet<string>;
}

/**
 * Snapshot quyền lúc subscribe (docs/10 §4) — đọc role + scope property từ JWT
 * (claim `scp`). KHÔNG mở tx/DB cho stream (ADR-0002). Token sống ~15' → reconnect
 * tự dựng snapshot mới; re-check TTL 5' giữa chừng là tinh chỉnh sau.
 */
export function buildEventScope(user: JwtClaims): EventScope {
  return {
    isOwner: user.rol === 'OWNER',
    role: user.rol,
    propertyIds: new Set(user.scp),
  };
}

/**
 * Filter SSE theo quyền (docs/10 §5). SSE là TÍN HIỆU invalidation/toast, KHÔNG
 * phải cổng dữ liệu — REST mới là cổng authz thật (refetch sau khi nhận event).
 * Đây là defense-in-depth + giảm nhiễu UI. OWNER thấy mọi event trong tenant; còn
 * lại lọc theo loại event + property scope (payload.property_id ∈ scope).
 */
export function canUserSeeEvent(scope: EventScope, event: RealtimeEvent): boolean {
  if (scope.isOwner) return true;

  const category = event.event_type.split('.')[0];
  const propertyId = event.payload['property_id'];
  const inScope = typeof propertyId === 'string' && scope.propertyIds.has(propertyId);
  if (!inScope) return false;

  const role = scope.role;
  switch (category) {
    case 'booking':
      return role === 'MANAGER' || role === 'STAFF';
    case 'payment':
    case 'invoice':
      return role === 'MANAGER' || role === 'ACCOUNTANT';
    case 'cleaning_task':
      return role === 'MANAGER' || role === 'STAFF' || role === 'HOUSEKEEPER';
    case 'room':
      return role === 'MANAGER' || role === 'STAFF' || role === 'HOUSEKEEPER';
    case 'sync_job':
      return role === 'MANAGER';
    default:
      return false;
  }
}
