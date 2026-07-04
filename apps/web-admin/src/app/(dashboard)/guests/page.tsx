'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Input, Skeleton } from '@pms/ui';
import type { GuestResponse } from '@pms/shared-types';
import { maskPhone } from '@/lib/format';
import { useGuestsList } from '@/lib/hooks/use-guests';
import { PageContainer, PageHeader } from '@/components/layout/page';
import { GuestDetailDialog } from '@/components/guests/GuestDetailDialog';

/**
 * Task 1.4 /guests — hồ sơ khách: tìm (tên/SĐT/4 số cuối giấy tờ) + blacklist. PII LUÔN
 * mask ở list; số giấy tờ đầy đủ chỉ xem trong dialog (audit READ_PII). Click dòng mở
 * GuestDetailDialog (state, KHÔNG điều hướng route).
 */
export default function GuestsPage() {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedGuest, setSelectedGuest] = useState<GuestResponse | null>(null);

  // Debounce ~300ms: chờ ngừng gõ mới đổi term + reset về trang 1 (repo chưa có useDebounce).
  useEffect(() => {
    const id = setTimeout(() => {
      setTerm(input);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [input]);

  const { data, isLoading, isFetching } = useGuestsList(term, page);
  const guests = data?.data ?? [];
  const pageInfo = data?.page_info;

  return (
    <PageContainer>
      <PageHeader title="Khách" />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tên / SĐT / 4 số cuối giấy tờ"
          className="h-9 w-[22rem] max-w-full"
          aria-label="Tìm khách"
        />
        {isFetching && <span className="text-xs text-muted-foreground">Đang tải…</span>}
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tên</th>
                <th className="px-3 py-2 font-medium">SĐT</th>
                <th className="px-3 py-2 font-medium">Giấy tờ</th>
                <th className="px-3 py-2 font-medium">Quốc tịch</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {guests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Không có khách.
                  </td>
                </tr>
              ) : (
                guests.map((g) => (
                  <tr
                    key={g.id}
                    onClick={() => setSelectedGuest(g)}
                    className="cursor-pointer hover:bg-accent"
                  >
                    <td className="px-3 py-2 font-medium">{g.full_name}</td>
                    <td className="px-3 py-2 tabular-nums">{maskPhone(g.phone)}</td>
                    <td className="px-3 py-2 tabular-nums">{g.id_document_masked ?? '—'}</td>
                    <td className="px-3 py-2">{g.nationality ?? '—'}</td>
                    <td className="px-3 py-2">
                      {g.is_blacklisted ? (
                        <Badge variant="destructive">Blacklist</Badge>
                      ) : (
                        <span className="text-muted-foreground">Bình thường</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {pageInfo && pageInfo.total_pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Trước
          </Button>
          <span className="text-muted-foreground">
            {pageInfo.page}/{pageInfo.total_pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageInfo.total_pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sau
          </Button>
        </div>
      )}

      <GuestDetailDialog
        guest={selectedGuest}
        onOpenChange={(open) => !open && setSelectedGuest(null)}
      />
    </PageContainer>
  );
}
