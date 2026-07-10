'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
  Textarea,
  toast,
} from '@pms/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { AssetResponse } from '@pms/shared-types';
import { ApiClientError } from '@/lib/api-client';
import { vnd } from '@/lib/format';
import {
  useAssetDepreciation,
  useAssets,
  useCreateAsset,
  useDeleteAsset,
  useDisposeAsset,
  useUpdateAsset,
} from '@/lib/hooks/use-assets';
import { usePropertyStore } from '@/stores/property.store';
import { PageContainer, PageHeader } from '@/components/layout/page';

const VN_DATE = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDate = (iso: string | null) => (iso ? VN_DATE.format(new Date(iso)) : '—');
const period = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Task 2.6 /assets — Tài sản cố định & khấu hao (docs/19 §3 Đợt 2). */
export default function AssetsPage() {
  const propertyId = usePropertyStore((s) => s.selectedId);
  if (!propertyId) {
    return (
      <PageContainer>
        <PageHeader title="Tài sản" />
        <p className="text-sm text-muted-foreground">Chọn cơ sở để xem tài sản.</p>
      </PageContainer>
    );
  }
  return <AssetsView propertyId={propertyId} />;
}

function AssetsView({ propertyId }: { propertyId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AssetResponse | null>(null);
  const [disposeTarget, setDisposeTarget] = useState<AssetResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetResponse | null>(null);
  const [depreciationTarget, setDepreciationTarget] = useState<AssetResponse | null>(null);

  const { data, isLoading, isError, error } = useAssets(propertyId);
  const rows = data?.data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Tài sản"
        description="Tài sản cố định + khấu hao đường thẳng theo tháng (night-audit tự ghi). Tham số tài chính bất biến sau khi tạo."
        action={<Button onClick={() => setCreateOpen(true)}>Thêm tài sản</Button>}
      />

      {isError ? (
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiClientError && error.status === 403
            ? 'Bạn không có quyền xem tài sản.'
            : 'Không tải được danh sách tài sản. Thử lại sau.'}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tên</th>
                <th className="px-3 py-2 font-medium">Phân loại</th>
                <th className="px-3 py-2 text-right font-medium">Nguyên giá</th>
                <th className="px-3 py-2 font-medium">Ngày mua</th>
                <th className="px-3 py-2 text-right font-medium">Số tháng KH</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Chưa có tài sản nào cho cơ sở này.
                  </td>
                </tr>
              ) : (
                rows.map((a) => {
                  const disposed = a.disposal_date !== null;
                  return (
                    <tr key={a.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{a.name}</div>
                        {a.serial_number && (
                          <div className="text-xs text-muted-foreground">SN: {a.serial_number}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{a.category ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{vnd(a.purchase_value_vnd)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDate(a.purchase_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.depreciation_months}</td>
                      <td className="px-3 py-2">
                        {disposed ? (
                          <Badge variant="outline">Đã thanh lý</Badge>
                        ) : (
                          <Badge variant="secondary">Đang dùng</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDepreciationTarget(a)}>
                            Khấu hao
                          </Button>
                          {!disposed && (
                            <Button size="sm" variant="ghost" onClick={() => setDisposeTarget(a)}>
                              Thanh lý
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setEditTarget(a)}>
                            Sửa
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(a)}
                          >
                            Xoá
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && <CreateAssetDialog propertyId={propertyId} onClose={() => setCreateOpen(false)} />}
      {editTarget && <EditAssetDialog asset={editTarget} onClose={() => setEditTarget(null)} />}
      {disposeTarget && <DisposeAssetDialog asset={disposeTarget} onClose={() => setDisposeTarget(null)} />}
      {deleteTarget && <DeleteAssetDialog asset={deleteTarget} onClose={() => setDeleteTarget(null)} />}
      {depreciationTarget && (
        <DepreciationDialog asset={depreciationTarget} onClose={() => setDepreciationTarget(null)} />
      )}
    </PageContainer>
  );
}

// ── Tạo tài sản ──────────────────────────────────────────────────────────────
const CreateSchema = z
  .object({
    name: z.string().min(1, 'Nhập tên tài sản').max(255),
    category: z.string().max(64).optional(),
    serial_number: z.string().max(100).optional(),
    purchase_value_vnd: z.number().int().nonnegative('Nguyên giá phải ≥ 0'),
    purchase_date: z.string().min(1, 'Chọn ngày mua'),
    depreciation_months: z.number().int().min(1, 'Tối thiểu 1 tháng').max(1200),
    residual_value_vnd: z.number().int().nonnegative('Giá trị còn lại phải ≥ 0'),
    notes: z.string().optional(),
  })
  .refine((d) => d.residual_value_vnd <= d.purchase_value_vnd, {
    message: 'Giá trị còn lại không được vượt nguyên giá',
    path: ['residual_value_vnd'],
  });
type CreateValues = z.infer<typeof CreateSchema>;

function CreateAssetDialog({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const create = useCreateAsset();
  const form = useForm<CreateValues>({
    resolver: zodResolver(CreateSchema),
    defaultValues: {
      name: '',
      category: '',
      serial_number: '',
      purchase_value_vnd: 0,
      purchase_date: todayISO(),
      depreciation_months: 12,
      residual_value_vnd: 0,
      notes: '',
    },
  });

  const onSubmit = async (values: CreateValues) => {
    try {
      await create.mutateAsync({
        property_id: propertyId,
        name: values.name,
        category: values.category || undefined,
        serial_number: values.serial_number || undefined,
        purchase_value_vnd: values.purchase_value_vnd,
        purchase_date: values.purchase_date,
        depreciation_method: 'STRAIGHT_LINE',
        depreciation_months: values.depreciation_months,
        residual_value_vnd: values.residual_value_vnd,
        notes: values.notes || undefined,
      });
      toast.success('Đã thêm tài sản');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thêm tài sản thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm tài sản</DialogTitle>
          <DialogDescription>
            Nguyên giá, ngày mua, số tháng khấu hao, giá trị còn lại là BẤT BIẾN sau khi tạo.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên tài sản</FormLabel>
                  <FormControl>
                    <Input placeholder="VD Máy lạnh Daikin 1.5HP" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phân loại (tuỳ chọn)</FormLabel>
                    <FormControl>
                      <Input placeholder="VD Điện máy" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serial_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số serial (tuỳ chọn)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="purchase_value_vnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nguyên giá (₫)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        {...field}
                        value={Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="purchase_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ngày mua</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="depreciation_months"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số tháng khấu hao</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        {...field}
                        value={Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="residual_value_vnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Giá trị còn lại (₫)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        {...field}
                        value={Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ghi chú (tuỳ chọn)</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Sửa tài sản (PATCH — chỉ mô tả) ───────────────────────────────────────────
const EditSchema = z.object({
  name: z.string().min(1, 'Nhập tên tài sản').max(255),
  category: z.string().max(64).optional(),
  serial_number: z.string().max(100).optional(),
  notes: z.string().optional(),
});
type EditValues = z.infer<typeof EditSchema>;

function EditAssetDialog({ asset, onClose }: { asset: AssetResponse; onClose: () => void }) {
  const update = useUpdateAsset();
  const form = useForm<EditValues>({
    resolver: zodResolver(EditSchema),
    defaultValues: {
      name: asset.name,
      category: asset.category ?? '',
      serial_number: asset.serial_number ?? '',
      notes: asset.notes ?? '',
    },
  });

  const onSubmit = async (values: EditValues) => {
    try {
      await update.mutateAsync({
        id: asset.id,
        body: {
          name: values.name,
          category: values.category || null,
          serial_number: values.serial_number || null,
          notes: values.notes || null,
        },
      });
      toast.success('Đã cập nhật tài sản');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Cập nhật thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sửa tài sản</DialogTitle>
          <DialogDescription>Chỉ sửa mô tả — không đổi tham số tài chính (giữ sổ khấu hao).</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên tài sản</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phân loại</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serial_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số serial</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ghi chú</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Thanh lý ──────────────────────────────────────────────────────────────────
const DisposeSchema = z.object({
  disposal_date: z.string().min(1, 'Chọn ngày thanh lý'),
  disposal_value_vnd: z.number().int().nonnegative('Giá trị thanh lý phải ≥ 0'),
});
type DisposeValues = z.infer<typeof DisposeSchema>;

function DisposeAssetDialog({ asset, onClose }: { asset: AssetResponse; onClose: () => void }) {
  const dispose = useDisposeAsset();
  const form = useForm<DisposeValues>({
    resolver: zodResolver(DisposeSchema),
    defaultValues: { disposal_date: todayISO(), disposal_value_vnd: 0 },
  });

  const onSubmit = async (values: DisposeValues) => {
    try {
      await dispose.mutateAsync({ id: asset.id, body: values });
      toast.success('Đã thanh lý tài sản');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Thanh lý thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thanh lý tài sản</DialogTitle>
          <DialogDescription>
            {asset.name} — dừng sinh khấu hao từ kỳ sau ngày thanh lý.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="disposal_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ngày thanh lý</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="disposal_value_vnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Giá trị thu về (₫)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        {...field}
                        value={Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Hủy
              </Button>
              <Button type="submit" disabled={dispose.isPending}>
                {dispose.isPending ? 'Đang xử lý…' : 'Thanh lý'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Xoá tài sản ────────────────────────────────────────────────────────────────
function DeleteAssetDialog({ asset, onClose }: { asset: AssetResponse; onClose: () => void }) {
  const del = useDeleteAsset();

  const onConfirm = async () => {
    try {
      await del.mutateAsync(asset.id);
      toast.success('Đã xoá tài sản');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Xoá thất bại');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xoá tài sản?</DialogTitle>
          <DialogDescription>Xoá &ldquo;{asset.name}&rdquo;. Không thể hoàn tác.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="destructive" disabled={del.isPending} onClick={onConfirm}>
            {del.isPending ? 'Đang xoá…' : 'Xoá'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Lịch khấu hao ──────────────────────────────────────────────────────────────
function DepreciationDialog({ asset, onClose }: { asset: AssetResponse; onClose: () => void }) {
  const { data: entries, isLoading } = useAssetDepreciation(asset.id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lịch khấu hao — {asset.name}</DialogTitle>
          <DialogDescription>
            Nguyên giá {vnd(asset.purchase_value_vnd)} · {asset.depreciation_months} tháng · đường thẳng.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !entries ? (
          <Skeleton className="h-40 w-full" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có kỳ khấu hao nào (night-audit sinh theo tháng).
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Kỳ</th>
                  <th className="px-3 py-1.5 text-right font-medium">Khấu hao</th>
                  <th className="px-3 py-1.5 text-right font-medium">Luỹ kế</th>
                  <th className="px-3 py-1.5 text-right font-medium">Giá trị còn lại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-1.5 tabular-nums">{period(e.period_year, e.period_month)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{vnd(e.amount_vnd)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{vnd(e.accumulated_vnd)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{vnd(e.book_value_vnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
