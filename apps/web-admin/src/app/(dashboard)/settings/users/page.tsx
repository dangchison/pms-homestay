'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
  toast,
} from '@pms/ui';
import { KeyRound } from 'lucide-react';
import type { UserResponse, UserRole } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useUpdateUser, useUsers } from '@/lib/hooks/use-users';
import { useAuthStore } from '@/stores/auth.store';
import { InviteUserDialog } from '@/components/settings/InviteUserDialog';
import { UserRolesDialog } from '@/components/settings/UserRolesDialog';
import { ROLE_LABEL, ROLE_OPTIONS } from '@/components/settings/roles';

/** S2 /settings/users — danh sách + mời + đổi role/khoá + phân quyền theo cơ sở. */
export default function UsersPage() {
  const { data: users, isLoading } = useUsers();
  const update = useUpdateUser();
  const meId = useAuthStore((s) => s.user?.id);
  const [rolesFor, setRolesFor] = useState<UserResponse | null>(null);

  const changeRole = async (u: UserResponse, role: UserRole) => {
    try {
      await update.mutateAsync({ id: u.id, body: { default_role: role } });
      toast.success('Đã đổi vai trò');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Đổi vai trò thất bại');
    }
  };

  const toggleActive = async (u: UserResponse) => {
    try {
      await update.mutateAsync({ id: u.id, body: { is_active: !u.is_active } });
      toast.success(u.is_active ? 'Đã vô hiệu hoá' : 'Đã kích hoạt');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thao tác thất bại');
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Quản lý nhân sự, vai trò & phân quyền theo cơ sở.</p>
        <InviteUserDialog />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {(users ?? []).map((u) => {
                const isSelf = u.id === meId;
                return (
                  <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{u.full_name}</span>
                        {isSelf && <Badge variant="outline" className="text-[10px]">Bạn</Badge>}
                        {u.two_factor_enabled && (
                          <KeyRound className="size-3.5 text-success" aria-label="Đã bật 2FA" />
                        )}
                        {!u.is_active && <Badge variant="destructive" className="text-[10px]">Vô hiệu</Badge>}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                    </div>

                    <Select
                      value={u.default_role}
                      disabled={isSelf || update.isPending}
                      onValueChange={(v) => changeRole(u, v as UserRole)}
                    >
                      <SelectTrigger className="h-8 w-[8.5rem]" aria-label="Vai trò">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button variant="outline" size="sm" onClick={() => setRolesFor(u)}>
                      Phân quyền
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isSelf || update.isPending}
                      onClick={() => toggleActive(u)}
                      className={cn(u.is_active && 'text-destructive hover:text-destructive')}
                    >
                      {u.is_active ? 'Vô hiệu hoá' : 'Kích hoạt'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {rolesFor && (
        <UserRolesDialog user={rolesFor} open={!!rolesFor} onOpenChange={(o) => !o && setRolesFor(null)} />
      )}
    </div>
  );
}
