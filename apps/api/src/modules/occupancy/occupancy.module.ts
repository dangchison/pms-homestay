import { Module } from '@nestjs/common';
import { OccupancyService } from './occupancy.service';

/**
 * OccupancyService là choke-point dùng chung (rooms/blocks ở 2.1, bookings ở 2.6).
 * Export để module khác inject — KHÔNG có controller (truy cập occupancy đi qua
 * availability/calendar API ở sprint sau).
 */
@Module({
  providers: [OccupancyService],
  exports: [OccupancyService],
})
export class OccupancyModule {}
