import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma client (typed client introspected — ADR-0001).
 * KHÔNG gọi this.prisma.<model> trực tiếp từ modules/ — mọi truy vấn bảng
 * tenant-scoped đi qua withTenant(tx => ...) (ADR-0002, lint rule enforce).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
