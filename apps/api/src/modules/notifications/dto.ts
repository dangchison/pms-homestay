import { ListNotificationsQuerySchema, ListOutboundMessagesQuerySchema } from '@pms/shared-types';
import { createZodDto } from '@core/http/pipes/zod-validation.pipe';

export class ListNotificationsDto extends createZodDto(ListNotificationsQuerySchema) {}

export class ListOutboundMessagesDto extends createZodDto(ListOutboundMessagesQuerySchema) {}
