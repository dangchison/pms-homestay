import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';
import { loadEnv } from '@core/config/env.schema';
import { MaintenanceService } from '@modules/night-audit/maintenance.service';

/**
 * ★ Acceptance task 8.5: vòng đời partition audit_logs.
 *  - ensure_audit_partitions: tự tạo partition tháng kế khi thiếu (idempotent).
 *  - audit_partitions_missing: health-check phát hiện tháng thiếu (alert).
 *  - detach_old_audit_partitions: detach partition >12 tháng → archive đứng riêng.
 * Tính tháng động từ now() (độc lập đồng hồ). MaintenanceService gói cả 3.
 */

describe('Audit partition lifecycle (task 8.5)', () => {
  let app: INestApplication;
  let admin: Client;
  let maintenance: MaintenanceService;
  let futureMonth: string; // YYYY_MM, +2 tháng (trong cửa sổ ensure mặc định 3)
  let oldMonth: string; // YYYY_MM, ~7 năm trước (quá hạn lưu 12 tháng)

  const regclass = async (name: string): Promise<boolean> =>
    (await admin.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [name])).rows[0].ok;

  const isPartition = async (name: string): Promise<boolean> =>
    (
      await admin.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent
           WHERE p.relname = 'audit_logs' AND c.relname = $1
         ) AS ok`,
        [name],
      )
    ).rows[0].ok;

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
    maintenance = app.get(MaintenanceService);
    admin = new Client({ connectionString: process.env.DATABASE_URL_MIGRATIONS });
    await admin.connect();

    futureMonth = (await admin.query(`SELECT to_char(date_trunc('month', now()) + interval '2 months', 'YYYY_MM') AS m`)).rows[0].m;
    oldMonth = (await admin.query(`SELECT to_char(date_trunc('month', now()) - interval '84 months', 'YYYY_MM') AS m`)).rows[0].m;
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP TABLE IF EXISTS audit_logs_archived_${oldMonth}`);
      await admin.query(`DROP TABLE IF EXISTS audit_logs_${oldMonth}`);
      await admin.end();
    }
    await app?.close();
  });

  it('health-check phát hiện partition tháng tới bị thiếu, rồi ensure tạo lại', async () => {
    // Xoá partition tháng +2 (rỗng — audit ghi vào tháng hiện tại) để tạo "lỗ hổng".
    await admin.query(`DROP TABLE IF EXISTS audit_logs_${futureMonth}`);
    const missingBefore: string[] = (await admin.query(`SELECT audit_partitions_missing(3) AS m`)).rows[0].m;
    expect(missingBefore).toContain(futureMonth);

    const res = await maintenance.runAuditPartitionMaintenance();
    expect(res.created).toBeGreaterThanOrEqual(1);
    expect(res.missing).toEqual([]); // sau ensure không còn thiếu trong cửa sổ tới
    expect(await regclass(`audit_logs_${futureMonth}`)).toBe(true);
    expect(await isPartition(`audit_logs_${futureMonth}`)).toBe(true);
  });

  it('ensure idempotent — gọi lại không tạo thêm', async () => {
    const res = await maintenance.runAuditPartitionMaintenance();
    expect(res.created).toBe(0);
    expect(res.missing).toEqual([]);
  });

  it('detach_old archive partition quá hạn lưu → đứng riêng, không còn là partition', async () => {
    // Tạo partition tháng ~7 năm trước (rỗng).
    await admin.query(
      `CREATE TABLE audit_logs_${oldMonth} PARTITION OF audit_logs FOR VALUES FROM ('${oldMonth.replace('_', '-')}-01') TO ('${oldMonth.replace('_', '-')}-01'::date + interval '1 month')`,
    );
    expect(await isPartition(`audit_logs_${oldMonth}`)).toBe(true);

    const res = await maintenance.runAuditPartitionMaintenance({ keepMonths: 12 });
    expect(res.archived).toContain(`audit_logs_archived_${oldMonth}`);

    // Đã detach: không còn là partition của audit_logs nhưng vẫn tồn tại (archive).
    expect(await isPartition(`audit_logs_${oldMonth}`)).toBe(false);
    expect(await regclass(`audit_logs_archived_${oldMonth}`)).toBe(true);
    expect(await isPartition(`audit_logs_archived_${oldMonth}`)).toBe(false);
  });
});
