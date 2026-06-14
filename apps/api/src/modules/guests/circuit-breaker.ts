/**
 * Circuit breaker tối giản cho lời gọi external (task 7.1 — OCR FPT.AI). Sau
 * `threshold` lần fail LIÊN TIẾP → mở mạch trong `cooldownMs` (mọi request bị chặn
 * ngay, không gọi ra ngoài → bảo vệ provider + giảm latency khi provider sập). Hết
 * cooldown → half-open: cho 1 request thử; thành công → đóng lại, fail → mở tiếp.
 * Clock tiêm được để test tất định (không phụ thuộc Date.now thực).
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Có cho phép gọi ra ngoài không? (false khi mạch đang mở trong cooldown). */
  canRequest(): boolean {
    if (this.openedAt === null) return true;
    return this.now() - this.openedAt >= this.cooldownMs; // hết cooldown → half-open cho thử
  }

  /** Mạch coi như đang mở (chặn) tại thời điểm hiện tại. */
  get isOpen(): boolean {
    return this.openedAt !== null && this.now() - this.openedAt < this.cooldownMs;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = this.now(); // (re)mở mạch — half-open fail cũng dập lại cooldown
    }
  }
}
