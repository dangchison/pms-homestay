import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { OccupancyController } from './occupancy.controller';
import { OccupancyService } from './occupancy.service';

/**
 * OccupancyService là choke-point dùng chung (rooms/blocks ở 2.1, bookings ở 2.6).
 * Export để module khác inject. CalendarService + OccupancyController (task 6.2)
 * thêm endpoint đọc-only GET /occupancy cho calendar timeline (spec ui/01 #C1).
 */
@Module({
  controllers: [OccupancyController],
  providers: [OccupancyService, CalendarService],
  exports: [OccupancyService],
})
export class OccupancyModule {}
