'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  BookingStatusBadge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  cn,
  toast,
} from '@pms/ui';
import { ArrowLeft, CheckCircle2, Loader2, ScanLine } from 'lucide-react';
import type { IdDocumentType, ScanIdResponse } from '@pms/shared-types';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { useBooking, useCheckIn, useConfirmBooking } from '@/lib/hooks/use-bookings';
import { useGuest } from '@/lib/hooks/use-guests';
import { createGuest, presignIdScan, scanId, updateGuest } from '@/lib/hooks/use-guests';
import { uploadToPresigned } from '@/lib/image';
import { useOnlineStatus } from '@/hooks/useOfflineCache';
import { useAuthStore } from '@/stores/auth.store';
import { CameraCapture } from '@/components/CameraCapture';
import { FolioPanel } from '@/components/FolioPanel';
import { hhmm } from '@/lib/format';

function mapDocType(s: string | null | undefined): IdDocumentType {
  const u = (s ?? '').toUpperCase();
  if (u.includes('PASSPORT') || u.includes('HỘ CHIẾU')) return 'PASSPORT';
  if (u.includes('CMND') || u.includes('CHỨNG MINH')) return 'CMND';
  return 'CCCD';
}

interface GuestForm {
  full_name: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  id_document_type: IdDocumentType;
  id_document_number: string;
  id_document_issue_date: string;
  id_document_issue_place: string;
  address: string;
}
const EMPTY: GuestForm = {
  full_name: '',
  date_of_birth: '',
  gender: '',
  nationality: 'VN',
  id_document_type: 'CCCD',
  id_document_number: '',
  id_document_issue_date: '',
  id_document_issue_place: '',
  address: '',
};

// Bắc cầu DatePicker (Date) ↔ date_of_birth (chuỗi 'YYYY-MM-DD').
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string): Date | undefined => (s ? new Date(`${s}T00:00:00`) : undefined);

export default function CheckInPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const router = useRouter();
  const online = useOnlineStatus();
  const role = useAuthStore((s) => s.user?.role);
  const { data: booking, isLoading } = useBooking(bookingId);
  const { data: guest } = useGuest(booking?.guest_id);
  const checkIn = useCheckIn(bookingId);
  const confirm = useConfirmBooking(bookingId);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<GuestForm>(EMPTY);
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [consent, setConsent] = useState(false);

  // Prefill từ guest đã gắn (nếu có).
  useEffect(() => {
    if (guest) {
      setForm((f) => ({
        ...f,
        full_name: guest.full_name ?? f.full_name,
        date_of_birth: guest.date_of_birth ?? '',
        gender: guest.gender ?? '',
        nationality: guest.nationality ?? 'VN',
        address: guest.address ?? '',
        id_document_type: mapDocType(guest.id_document_type),
      }));
    }
  }, [guest]);

  const set = <K extends keyof GuestForm>(k: K, v: GuestForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const scanFront = async (blob: Blob, previewUrl: string) => {
    setScanning(true);
    try {
      const { key, upload_url } = await presignIdScan({ side: 'front', content_type: 'image/jpeg' });
      await uploadToPresigned(upload_url, blob);
      setFrontKey(key);
      setFrontPreview(previewUrl);
      const ocr: ScanIdResponse = await scanId(key);
      setForm((f) => ({
        ...f,
        full_name: ocr.full_name ?? f.full_name,
        date_of_birth: ocr.date_of_birth ?? f.date_of_birth,
        gender: ocr.gender ?? f.gender,
        nationality: ocr.nationality && ocr.nationality.length === 2 ? ocr.nationality : 'VN',
        id_document_type: mapDocType(ocr.document_type),
        id_document_number: ocr.document_number ?? f.id_document_number,
        id_document_issue_date: ocr.issue_date ?? f.id_document_issue_date,
        id_document_issue_place: ocr.issue_place ?? f.id_document_issue_place,
        address: ocr.address ?? f.address,
      }));
      toast.success('Đã nhận diện giấy tờ — kiểm tra lại thông tin');
      setStep(2);
    } catch (err) {
      // OCR lỗi/không cấu hình → fallback nhập tay
      toast.error(err instanceof ApiClientError ? err.message : 'OCR thất bại — nhập tay giúp khách');
      setStep(2);
    } finally {
      setScanning(false);
    }
  };

  const saveGuestAndNext = async () => {
    if (!booking) return;
    if (!form.full_name.trim()) {
      toast.error('Cần họ tên khách');
      return;
    }
    if (!consent) {
      toast.error('Cần khách đồng ý xử lý dữ liệu cá nhân (NĐ13)');
      return;
    }
    const payload = {
      full_name: form.full_name.trim(),
      date_of_birth: form.date_of_birth || undefined,
      gender: form.gender || undefined,
      nationality: form.nationality.length === 2 ? form.nationality : 'VN',
      id_document_type: form.id_document_type,
      id_document_number: form.id_document_number.length >= 4 ? form.id_document_number : undefined,
      id_document_issue_date: form.id_document_issue_date || undefined,
      id_document_issue_place: form.id_document_issue_place || undefined,
      address: form.address || undefined,
      id_document_scan_url: frontKey || undefined,
    };
    try {
      if (booking.guest_id) {
        await updateGuest(booking.guest_id, payload);
      } else {
        const g = await createGuest(payload);
        await apiClient.patch(`/bookings/${bookingId}`, { guest_id: g.id }, { headers: { 'If-Match': String(booking.version) } });
      }
      toast.success('Đã lưu thông tin khách');
      setStep(3);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Lưu thông tin thất bại');
    }
  };

  const doCheckIn = async () => {
    try {
      await checkIn.mutateAsync();
      toast.success('Đã nhận phòng');
      router.replace('/today');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Nhận phòng thất bại');
    }
  };

  const forceConfirm = async () => {
    try {
      await confirm.mutateAsync({ force: true });
      toast.success('Đã xác nhận (bỏ qua cọc)');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Xác nhận thất bại');
    }
  };

  if (isLoading || !booking) {
    return (
      <div className="grid gap-4 px-4 pt-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const canCheckIn = booking.status === 'CONFIRMED';

  return (
    <div className="grid gap-4 px-4 pt-4">
      <header className="flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Quay lại" className="-ml-1 p-1">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Check-in · {booking.booking_code}</h1>
          <p className="text-xs text-muted-foreground">Nhận phòng lúc {hhmm(booking.check_in)}</p>
        </div>
      </header>

      <StepIndicator step={step} />

      {step === 1 && (
        <Card>
          <CardContent className="grid gap-4 py-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
                <ScanLine className="size-6 text-primary" />
              </span>
              <p className="text-sm text-muted-foreground">Chụp mặt trước CCCD/hộ chiếu để tự điền thông tin</p>
            </div>
            {frontPreview && <img src={frontPreview} alt="CCCD" className="mx-auto max-h-40 rounded-lg" />}
            {scanning ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin" /> Đang nhận diện…
              </div>
            ) : (
              <CameraCapture
                label="Chụp / chọn ảnh CCCD"
                disabled={!online}
                onCapture={(img) => scanFront(img.blob, img.previewUrl)}
              />
            )}
            <Button variant="ghost" className="h-11" onClick={() => setStep(2)}>
              Nhập tay (bỏ qua OCR)
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent className="grid gap-3 py-4">
            <Field label="Họ tên" value={form.full_name} onChange={(v) => set('full_name', v)} />
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Ngày sinh</Label>
                <DatePicker
                  className="h-11"
                  placeholder="Chọn ngày"
                  value={parseYmd(form.date_of_birth)}
                  onChange={(d) => set('date_of_birth', d ? ymd(d) : '')}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Giới tính</Label>
                <Select value={form.gender} onValueChange={(v) => set('gender', v)}>
                  <SelectTrigger className="h-11 text-base">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Nam">Nam</SelectItem>
                    <SelectItem value="Nữ">Nữ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>Loại</Label>
                <Select value={form.id_document_type} onValueChange={(v) => set('id_document_type', v as IdDocumentType)}>
                  <SelectTrigger className="h-11 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CCCD">CCCD</SelectItem>
                    <SelectItem value="CMND">CMND</SelectItem>
                    <SelectItem value="PASSPORT">Hộ chiếu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 grid gap-1.5">
                <Label>Số giấy tờ</Label>
                <Input value={form.id_document_number} onChange={(e) => set('id_document_number', e.target.value)} className="h-11" inputMode="numeric" />
              </div>
            </div>
            <Field label="Quốc tịch (ISO-2)" value={form.nationality} onChange={(v) => set('nationality', v.toUpperCase().slice(0, 2))} />
            <Field label="Địa chỉ" value={form.address} onChange={(v) => set('address', v)} />

            <label className="mt-1 flex items-start gap-2.5 text-sm">
              <Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5 size-5" />
              <span>Khách đồng ý cho cơ sở xử lý dữ liệu cá nhân theo Nghị định 13/2023.</span>
            </label>

            <Button className="h-12 w-full text-base" disabled={!online} onClick={saveGuestAndNext}>
              Tiếp tục
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="grid gap-4">
          <Card>
            <CardContent className="grid gap-2 py-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{booking.resource_id ? form.full_name : ''}</span>
                <BookingStatusBadge status={booking.status} />
              </div>
              <Separator />
              <p className="text-sm text-muted-foreground">
                {canCheckIn
                  ? 'Khách đã đủ điều kiện nhận phòng.'
                  : 'Cần thu cọc để xác nhận trước khi nhận phòng.'}
              </p>
            </CardContent>
          </Card>

          {!canCheckIn && (
            <>
              <FolioPanel
                bookingId={bookingId}
                online={online}
                kindFilter={(k) => k === 'DEPOSIT'}
                emptyHint="Chưa có hoá đơn cọc — có thể nhận phòng sau khi xác nhận."
              />
              {role === 'OWNER' && (
                <Button variant="outline" className="h-11" disabled={!online || confirm.isPending} onClick={forceConfirm}>
                  {confirm.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Xác nhận không cần cọc (OWNER)'}
                </Button>
              )}
            </>
          )}

          <Button
            className={cn('h-12 w-full text-base', !canCheckIn && 'opacity-60')}
            disabled={!online || !canCheckIn || checkIn.isPending}
            onClick={doCheckIn}
          >
            {checkIn.isPending ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}
            Nhận phòng
          </Button>
          {!canCheckIn && (
            <p className="text-center text-xs text-muted-foreground">
              Nút nhận phòng mở khi booking ở trạng thái “Đã xác nhận”.
            </p>
          )}
        </div>
      )}

      {!online && <p className="text-center text-sm text-amber-600">Offline — cần mạng để thao tác</p>}
    </div>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Quét giấy tờ', 'Xác nhận', 'Hoàn tất'];
  return (
    <div className="flex items-center justify-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n <= step;
        return (
          <div key={label} className="flex items-center gap-2">
            <span className={cn('flex size-6 items-center justify-center rounded-full text-xs font-semibold', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
              {n}
            </span>
            <span className={cn('text-xs', active ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
            {i < 2 && <span className="h-px w-3 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-11 text-base" />
    </div>
  );
}
