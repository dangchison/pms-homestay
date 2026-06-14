import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Lưu trữ object S3-compatible dùng chung (@Global) — cleaning task (4.1) inject
 * StorageService để presign ảnh. ENV @Global sẵn.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
