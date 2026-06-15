'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  toast,
} from '@pms/ui';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { UserResponse, UserRole } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useProperties } from '@/lib/hooks/use-properties';
import { useAssignRole, useDeleteRole, useUserPropertyRoles } from '@/lib/hooks/use-users';
import { ROLE_LABEL, ROLE_OPTIONS } from './roles';

const splitKeys = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);

/** Gán role theo cơ sở + override grant/deny cho 1 user (S2). */
export function UserRolesDialog({ user, open, onOpenChange }: { user: UserResponse; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: properties } = useProperties();
  const { data: roles, isLoading } = useUserPropertyRoles(open ? user.id : null);
  const assign = useAssignRole();
  const del = useDeleteRole();

  const [propertyId, setPropertyId] = useState('');
  const [role, setRole] = useState<UserRole>('STAFF');
  const [grant, setGrant] = useState('');
  const [deny, setDeny] = useState('');

  const propName = (id: string) => properties?.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const add = async () => {
    if (!propertyId) {
      toast.error('Chọn cơ sở');
      return;
    }
    try {
      await assign.mutateAsync({
        user_id: user.id,
        property_id: propertyId,
        role,
        permissions: { grant: splitKeys(grant), deny: splitKeys(deny) },
      });
      toast.success('Đã gán quyền theo cơ sở');
      setPropertyId('');
      setGrant('');
      setDeny('');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Gán quyền thất bại');
    }
  };

  const remove = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast.success('Đã gỡ quyền');
    } catch {
      toast.error('Gỡ quyền thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Phân quyền theo cơ sở · {user.full_name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Đang tải…</p>
          ) : (roles?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa gán cơ sở nào (dùng vai trò mặc định).</p>
          ) : (
            <div className="grid gap-2">
              {roles!.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{propName(r.property_id)}</span>
                      <Badge variant="secondary" className="text-[10px]">{ROLE_LABEL[r.role]}</Badge>
                    </div>
                    {(r.permissions.grant.length > 0 || r.permissions.deny.length > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {r.permissions.grant.map((g) => (
                          <span key={g} className="rounded bg-success/10 px-1.5 py-0.5 text-success">+{g}</span>
                        ))}
                        {r.permissions.deny.map((d) => (
                          <span key={d} className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">−{d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(r.id)} disabled={del.isPending}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />
          <p className="text-sm font-medium">Thêm phân quyền</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Cơ sở</Label>
              <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
                <option value="">— chọn —</option>
                {(properties ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Vai trò</Label>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Cấp thêm quyền (grant, cách nhau dấu phẩy)</Label>
              <Input value={grant} onChange={(e) => setGrant(e.target.value)} placeholder="report.financial" className="text-sm" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Thu hồi quyền (deny)</Label>
              <Input value={deny} onChange={(e) => setDeny(e.target.value)} placeholder="booking.cancel" className="text-sm" />
            </div>
          </div>
          <Button onClick={add} disabled={assign.isPending} className="justify-self-start">
            {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Thêm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
