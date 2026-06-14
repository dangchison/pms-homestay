import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ScanIdResponse } from '@pms/shared-types';
import { ENV, type Env } from '@core/config/env.schema';
import { AppException } from '@core/http/exceptions/app.exception';
import { StorageService } from '@core/storage/storage.service';
import { CircuitBreaker } from './circuit-breaker';

const FPT_TIMEOUT_MS = 15_000; // docs/12 §3
const FPT_MAX_RETRY = 1; // tổng tối đa 2 lần gọi
const CB_THRESHOLD = 5; // 5 fail liên tiếp → mở mạch
const CB_COOLDOWN_MS = 60_000;

/** Một mục data FPT.AI trả về (field tuỳ loại giấy tờ — đọc phòng thủ). */
export interface FptOcrRaw {
  errorCode?: number;
  errorMessage?: string;
  data?: Array<Record<string, unknown>>;
}

/** 'dd/mm/yyyy' (FPT.AI) → ISO 'yyyy-mm-dd'; không khớp → null. */
function parseVnDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * OCR CCCD/hộ chiếu qua FPT.AI Vision (task 7.1, docs/12 §3). GỌI NGOÀI tx
 * (external I/O — ADR-0002): timeout 15s, retry 1 lần, circuit breaker. Chỉ TRẢ VỀ
 * các field đã trích — **KHÔNG persist raw response** (chứa toàn bộ PII; bản ghi gốc
 * là ảnh trên storage tier VN). Thiếu API key → 503 (fallback nhập tay luôn sẵn).
 * Test bypass HTTP qua seam `opts.rawOcr`.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly breaker = new CircuitBreaker(CB_THRESHOLD, CB_COOLDOWN_MS);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageService,
  ) {}

  /** Trích giấy tờ từ ảnh đã upload (image_key). `opts.rawOcr` = seam test (bỏ HTTP). */
  async scanIdDocument(imageKey: string, opts?: { rawOcr?: FptOcrRaw }): Promise<ScanIdResponse> {
    const raw = opts?.rawOcr ?? (await this.callFpt(imageKey));
    return this.mapExtraction(raw);
  }

  // ── Gọi FPT.AI (NGOÀI tx) + circuit breaker ────────────────────────────────
  private async callFpt(imageKey: string): Promise<FptOcrRaw> {
    if (!this.env.FPT_AI_API_KEY) {
      throw new AppException({
        code: 'OCR_NOT_CONFIGURED',
        title: 'Dịch vụ OCR chưa cấu hình — vui lòng nhập tay',
        status: 503,
      });
    }
    if (!this.breaker.canRequest()) {
      throw new AppException({
        code: 'OCR_CIRCUIT_OPEN',
        title: 'Dịch vụ OCR tạm gián đoạn — vui lòng nhập tay',
        status: 503,
      });
    }
    const buffer = await this.storage.getObject(imageKey); // tải ảnh (ngoài tx)
    try {
      const raw = await this.fetchWithRetry(buffer);
      this.breaker.recordSuccess();
      return raw;
    } catch (err) {
      this.breaker.recordFailure();
      this.logger.warn(`OCR FPT.AI lỗi: ${String(err)}`);
      throw new AppException({
        code: 'OCR_FAILED',
        title: 'OCR thất bại — vui lòng nhập tay',
        status: 502,
      });
    }
  }

  private async fetchWithRetry(buffer: Buffer): Promise<FptOcrRaw> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= FPT_MAX_RETRY; attempt++) {
      try {
        const form = new FormData();
        form.append('image', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), 'cccd.jpg');
        const res = await fetch(this.env.FPT_AI_ENDPOINT, {
          method: 'POST',
          body: form,
          headers: { 'api-key': this.env.FPT_AI_API_KEY as string },
          signal: AbortSignal.timeout(FPT_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`FPT.AI HTTP ${res.status}`);
        const json = (await res.json()) as FptOcrRaw;
        if (json.errorCode !== undefined && Number(json.errorCode) !== 0) {
          throw new Error(`FPT.AI errorCode ${json.errorCode}: ${json.errorMessage ?? ''}`);
        }
        return json;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // ── Map raw → extracted (CHỈ field cần, không raw) ──────────────────────────
  private mapExtraction(raw: FptOcrRaw): ScanIdResponse {
    const d = raw.data?.[0] ?? {};
    const s = (k: string): string | null => {
      const v = d[k];
      return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
    };
    return {
      document_type: s('type_new') ?? s('type'),
      document_number: s('id'),
      full_name: s('name'),
      date_of_birth: parseVnDate(s('dob')),
      gender: s('sex'),
      nationality: s('nationality') ?? 'VN',
      issue_date: parseVnDate(s('issue_date')),
      issue_place: s('issue_loc') ?? s('issue_place'),
      address: s('address'),
    };
  }
}
