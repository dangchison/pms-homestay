import { RecordMeterReadingRequestSchema } from '@pms/shared-types';
import { z } from 'zod';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class RecordMeterReadingDto extends createZodDto(RecordMeterReadingRequestSchema) {}

const MeterReadingListQuerySchema = z.object({ booking_id: z.uuid() });
export class MeterReadingListQueryDto extends createZodDto(MeterReadingListQuerySchema) {}
