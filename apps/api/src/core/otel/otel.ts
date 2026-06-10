/**
 * OpenTelemetry — gắn từ ngày 1, exporter bật ở phase 2 (docs/01 §1).
 * Auto-instrument HTTP/Express/PG/Redis để trace context (trace_id) có sẵn
 * trong log; spanProcessors rỗng = không export đi đâu, không phí mạng.
 *
 * Phải start TRƯỚC khi import express/pg/ioredis (main.ts import file này đầu tiên).
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

if (process.env.OTEL_ENABLED !== 'false') {
  sdk = new NodeSDK({
    serviceName: 'pms-api',
    // Phase 2: thay bằng OTLP exporter (Better Stack/Tempo) — chỉ cần thêm spanProcessor
    spanProcessors: [],
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs quá ồn cho web app
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  await sdk?.shutdown();
}
