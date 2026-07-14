'use client';

import { useEffect, useState } from 'react';
import { Check, Search, UserPlus, X } from 'lucide-react';
import { Button, Input, Label } from '@pms/ui';
import { useCreateGuest, useGuestsSearch } from '@/lib/hooks/use-guests';
import { GuestPlatformChips } from '@/components/guests/GuestPlatformChips';

export interface PickedGuest {
  id: string;
  name: string;
}

/** GuestPicker (task 6.3, F1 §2): tìm khách (trgm tên/SĐT/4 số cuối) + tạo mới inline. */
export function GuestPicker({
  value,
  onChange,
}: {
  value: PickedGuest | null;
  onChange: (g: PickedGuest | null) => void;
}) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const createGuest = useCreateGuest();

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data: results, isFetching } = useGuestsSearch(dq);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{value.name}</span>
          <GuestPlatformChips guestId={value.id} />
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Đổi khách
        </Button>
      </div>
    );
  }

  async function submitNew() {
    if (newName.trim().length < 1) return;
    const g = await createGuest.mutateAsync({
      full_name: newName.trim(),
      phone: newPhone.trim() || undefined,
    });
    onChange({ id: g.id, name: g.full_name });
    setCreating(false);
    setNewName('');
    setNewPhone('');
  }

  if (creating) {
    return (
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="grid gap-1.5">
          <Label htmlFor="g-name">Họ tên</Label>
          <Input id="g-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nguyễn Văn A" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="g-phone">SĐT (tuỳ chọn)</Label>
          <Input id="g-phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="09xx…" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
            <X /> Hủy
          </Button>
          <Button type="button" size="sm" disabled={createGuest.isPending || newName.trim().length < 1} onClick={submitNew}>
            <Check /> Tạo & chọn
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm tên / SĐT / 4 số cuối giấy tờ"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      <div className="max-h-44 overflow-auto">
        {dq.trim().length < 2 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Gõ ≥ 2 ký tự để tìm khách…</p>
        ) : isFetching && !results ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Đang tìm…</p>
        ) : results && results.length > 0 ? (
          results.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onChange({ id: g.id, name: g.full_name })}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span>
                {g.full_name}
                {g.is_blacklisted && <span className="ml-2 text-xs text-destructive">⚠ blacklist</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{g.phone ?? g.id_document_masked ?? ''}</span>
            </button>
          ))
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">Không thấy khách phù hợp.</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">Để trống = khách lẻ</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCreating(true);
            setNewName(q);
          }}
        >
          <UserPlus /> Tạo mới
        </Button>
      </div>
    </div>
  );
}
