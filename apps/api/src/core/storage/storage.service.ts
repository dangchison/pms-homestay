import { Inject, Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV, type Env } from '@core/config/env.schema';

/** Mặc định pre-signed URL hết hạn sau 15' (đủ để client upload 1 ảnh). */
const DEFAULT_EXPIRES_IN = 900;

/**
 * Lưu trữ object S3-compatible (dev: MinIO :9000; prod: S3/R2 qua cùng env S3_*).
 * @Global. Dùng cho ảnh cleaning task (task 4.1) — client upload TRỰC TIẾP lên S3
 * qua pre-signed PUT (server không trung chuyển bytes). `getSignedUrl` ký cục bộ
 * bằng credential, KHÔNG gọi mạng tới S3 → presign luôn chạy kể cả khi chưa có bucket.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: 'us-east-1', // MinIO bỏ qua; S3 thật override qua endpoint/AWS_REGION
      forcePathStyle: true, // MinIO + nhiều S3-compatible yêu cầu path-style
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  /** URL PUT có chữ ký để client upload 1 object (ràng buộc cả Content-Type). */
  async presignPut(
    key: string,
    contentType: string,
    expiresIn: number = DEFAULT_EXPIRES_IN,
  ): Promise<{ key: string; upload_url: string; expires_in: number }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const upload_url = await getSignedUrl(this.client, command, { expiresIn });
    return { key, upload_url, expires_in: expiresIn };
  }

  /**
   * Tải object về buffer (server-side) — dùng khi BE cần chính bytes (vd gửi ảnh
   * CCCD cho FPT.AI OCR, task 7.1). KHÁC presign: gọi mạng THẬT tới S3, nên chỉ
   * dùng ngoài tx và không trong test (test bypass qua seam rawOcr).
   */
  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) {
      throw new Error(`StorageService.getObject: object rỗng tại key=${key}`);
    }
    return Buffer.from(await res.Body.transformToByteArray());
  }

  /**
   * Xoá object (vd ảnh CCCD khi erasure NĐ13, task 7.3). Gọi mạng THẬT tới S3 →
   * caller nên best-effort (try/catch), không để chặn nghiệp vụ chính nếu S3 lỗi.
   */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
