import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { type JwtClaims } from '@pms/shared-types';
import { CurrentUser } from '@core/http/decorators/current-user.decorator';
import { RequirePermissions } from '@core/http/decorators/require-permissions.decorator';
import { CreateExpenseDto, ExpenseListQueryDto, UpdateExpenseDto } from './dto';
import { ExpensesService } from './expenses.service';

/**
 * /api/v1/expenses — chi phí vận hành (task 3.6, docs/09 §6). Property-scoped:
 * pha-1 RBAC `expense.crud` + pha-2 authorizeOnProperty (service). Hoa hồng OTA
 * (OTA_COMMISSION) KHÔNG tạo qua đây — hệ thống auto-sinh khi booking CHECKED_OUT.
 * Sinh chi phí định kỳ do night-audit (4.6) gọi generateRecurringExpenses.
 */
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @RequirePermissions('expense.crud')
  async create(@Body() dto: CreateExpenseDto, @CurrentUser() user: JwtClaims) {
    return { data: await this.expenses.create(dto, user) };
  }

  @Get()
  @RequirePermissions('expense.crud')
  async list(@Query() query: ExpenseListQueryDto, @CurrentUser() user: JwtClaims) {
    const { data, page_info } = await this.expenses.list(query.property_id, user, query);
    return { data, page_info };
  }

  @Get(':id')
  @RequirePermissions('expense.crud')
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    return { data: await this.expenses.getById(id, user) };
  }

  @Patch(':id')
  @RequirePermissions('expense.crud')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() user: JwtClaims,
  ) {
    return { data: await this.expenses.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermissions('expense.crud')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtClaims) {
    await this.expenses.remove(id, user);
  }
}
