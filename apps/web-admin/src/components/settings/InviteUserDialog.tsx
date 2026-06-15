'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  toast,
} from '@pms/ui';
import { Loader2, UserPlus } from 'lucide-react';
import type { UserRole } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { useInviteUser } from '@/lib/hooks/use-users';
import { ROLE_LABEL, ROLE_OPTIONS } from './roles';

/** Mời user mới (email + role mặc định). Gửi email đặt mật khẩu (BE best-effort). */
export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('STAFF');
  const invite = useInviteUser();

  const submit = async () => {
    if (!email || !fullName) {
      toast.error('Cần email và họ tên');
      return;
    }
    try {
      await invite.mutateAsync({ email, full_name: fullName, default_role: role });
      toast.success('Đã mời — email đặt mật khẩu đã được gửi');
      setOpen(false);
      setEmail('');
      setFullName('');
      setRole('STAFF');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Mời thất bại');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" />
          Mời người dùng
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mời người dùng</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-name">Họ tên</Label>
            <Input id="inv-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-role">Vai trò mặc định</Label>
            <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={invite.isPending}>
            {invite.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Gửi lời mời
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
