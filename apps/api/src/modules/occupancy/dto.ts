import { CalendarOccupancyQuerySchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

/** Query GET /occupancy (task 6.2). property_id + from/to (UTC ISO datetime). */
export class CalendarOccupancyQueryDto extends createZodDto(CalendarOccupancyQuerySchema) {}
