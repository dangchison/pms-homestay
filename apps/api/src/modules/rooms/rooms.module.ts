import { Module } from '@nestjs/common';
import { OccupancyModule } from '@modules/occupancy/occupancy.module';
import { ResourcesModule } from '@modules/resources/resources.module';
import { RoomBlocksController } from './room-blocks.controller';
import { RoomBlocksService } from './room-blocks.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

/**
 * Rooms + room_blocks. Tạo phòng → ResourcesService sinh resource ROOM;
 * block → OccupancyService sinh/xoá occupancy (choke-point duy nhất).
 */
@Module({
  imports: [ResourcesModule, OccupancyModule],
  controllers: [RoomsController, RoomBlocksController],
  providers: [RoomsService, RoomBlocksService],
  exports: [RoomsService],
})
export class RoomsModule {}
