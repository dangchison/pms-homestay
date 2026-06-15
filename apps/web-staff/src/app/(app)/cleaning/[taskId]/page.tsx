'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, CardContent, Separator, Skeleton, Textarea, cn, toast } from '@pms/ui';
import { ArrowLeft, CheckCircle2, ImagePlus, Loader2, Wrench } from 'lucide-react';
import {
  presignCleaningPhoto,
  useCleaningTask,
  useCompleteCleaning,
  useCreateCleaningTask,
  useStartCleaning,
} from '@/lib/hooks/use-cleaning';
import { uploadToPresigned } from '@/lib/image';
import { useOnlineStatus } from '@/hooks/useOfflineCache';
import { CameraCapture, type CapturedImage } from '@/components/CameraCapture';

const CHECKLIST = [
  'Thay ga giường, vỏ gối',
  'Dọn & khử khuẩn nhà vệ sinh',
  'Hút bụi / lau sàn',
  'Bổ sung đồ dùng (khăn, nước)',
  'Kiểm tra minibar',
  'Đổ rác',
];

interface LocalPhoto {
  key: string;
  previewUrl: string;
}

export default function CleaningTaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const online = useOnlineStatus();
  const { data: task, isLoading } = useCleaningTask(taskId);
  const start = useStartCleaning(taskId);
  const complete = useCompleteCleaning(taskId);
  const createTask = useCreateCleaningTask();

  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const [before, setBefore] = useState<LocalPhoto[]>([]);
  const [after, setAfter] = useState<LocalPhoto[]>([]);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const addPhoto = async (phase: 'before' | 'after', img: CapturedImage) => {
    setUploading(true);
    try {
      const { key, upload_url } = await presignCleaningPhoto(taskId, { phase, content_type: 'image/jpeg' });
      await uploadToPresigned(upload_url, img.blob);
      const photo = { key, previewUrl: img.previewUrl };
      (phase === 'before' ? setBefore : setAfter)((prev) => [...prev, photo]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Tải ảnh thất bại');
    } finally {
      setUploading(false);
    }
  };

  const doStart = async () => {
    try {
      await start.mutateAsync({ before_photos: before.map((p) => p.key) });
      toast.success('Đã bắt đầu dọn');
    } catch {
      toast.error('Không bắt đầu được');
    }
  };

  const doComplete = async () => {
    try {
      await complete.mutateAsync({ after_photos: after.map((p) => p.key), notes: notes || undefined });
      toast.success('Đã hoàn thành — phòng chờ kiểm tra');
      router.push('/cleaning');
    } catch {
      toast.error('Không hoàn thành được');
    }
  };

  const reportDamage = async () => {
    if (!task || !notes.trim()) {
      toast.error('Nhập mô tả hỏng hóc trước');
      return;
    }
    try {
      await createTask.mutateAsync({
        property_id: task.property_id,
        room_id: task.room_id,
        task_type: 'MAINTENANCE',
        priority: 0,
        notes,
      });
      toast.success('Đã tạo việc bảo trì');
      setNotes('');
    } catch {
      toast.error('Không tạo được việc bảo trì');
    }
  };

  if (isLoading || !task) {
    return (
      <div className="grid gap-4 px-4 pt-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const done = task.status === 'COMPLETED' || task.status === 'VERIFIED';
  const checkedCount = checked.filter(Boolean).length;

  return (
    <div className="grid gap-4 px-4 pt-4">
      <header className="flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Quay lại" className="-ml-1 p-1">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-lg font-semibold">Dọn phòng</h1>
      </header>

      {/* Checklist */}
      <Card>
        <CardContent className="grid gap-1 py-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Danh mục ({checkedCount}/{CHECKLIST.length})</h2>
          </div>
          {CHECKLIST.map((item, i) => (
            <label key={item} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={checked[i]}
                onChange={(e) => setChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
                className="size-5 rounded border-border"
              />
              <span className={cn(checked[i] && 'text-muted-foreground line-through')}>{item}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Ảnh trước / sau */}
      <Card>
        <CardContent className="grid gap-3 py-4">
          <h2 className="text-sm font-semibold">Ảnh hiện trạng</h2>
          <PhotoRow label="Trước khi dọn" photos={before} />
          {!done && task.status === 'PENDING' && (
            <CameraCapture label="Chụp ảnh trước" disabled={!online || uploading} onCapture={(img) => addPhoto('before', img)} />
          )}
          <Separator />
          <PhotoRow label="Sau khi dọn" photos={after} />
          {!done && task.status === 'IN_PROGRESS' && (
            <CameraCapture label="Chụp ảnh sau" disabled={!online || uploading} onCapture={(img) => addPhoto('after', img)} />
          )}
        </CardContent>
      </Card>

      {/* Ghi chú / báo hỏng */}
      {!done && (
        <Card>
          <CardContent className="grid gap-2 py-4">
            <h2 className="text-sm font-semibold">Ghi chú / hỏng hóc</h2>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="VD: vòi sen rỉ nước, bóng đèn cháy…"
              className="bg-card text-base"
            />
            <Button variant="ghost" className="h-10 justify-start" disabled={!online || createTask.isPending} onClick={reportDamage}>
              <Wrench className="size-4" />
              Báo hỏng hóc (tạo việc bảo trì)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Hành động */}
      {done ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-hk-clean/40 bg-hk-clean/10 py-6 text-center">
          <CheckCircle2 className="size-9 text-hk-clean" />
          <p className="font-medium">Đã hoàn thành</p>
        </div>
      ) : task.status === 'PENDING' ? (
        <Button className="h-12 w-full text-base" disabled={!online || start.isPending || uploading} onClick={doStart}>
          {start.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Bắt đầu dọn'}
        </Button>
      ) : task.status === 'IN_PROGRESS' ? (
        <Button className="h-12 w-full text-base" disabled={!online || complete.isPending || uploading} onClick={doComplete}>
          {complete.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Hoàn thành'}
        </Button>
      ) : null}

      {!online && <p className="text-center text-sm text-amber-600">Offline — cần mạng để thao tác</p>}
    </div>
  );
}

function PhotoRow({ label, photos }: { label: string; photos: LocalPhoto[] }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {photos.length === 0 ? (
        <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground/50">
          <ImagePlus className="size-5" />
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            <img key={p.key} src={p.previewUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
