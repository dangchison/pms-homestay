import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodType, type output } from 'zod';
import { ValidationException } from '../exceptions/app.exception';

/**
 * Tạo DTO class từ Zod schema (docs/01: MỘT stack validation duy nhất — Zod,
 * không class-validator). Tự chế thay nestjs-zod trong lúc chờ bản tương thích
 * Zod 4 ổn định — API tương đương:
 *
 *   class CreateBookingDto extends createZodDto(CreateBookingSchema) {}
 *
 * Instance type = z.output<T> nên handler đọc dto.field có type đầy đủ.
 */
export function createZodDto<T extends ZodType>(schema: T) {
  class ZodDto {
    static readonly zodSchema = schema;
  }
  return ZodDto as { new (): output<T>; zodSchema: T };
}

/** Global pipe: DTO nào tạo từ createZodDto thì parse bằng schema của nó. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = (metadata.metatype as { zodSchema?: unknown } | undefined)?.zodSchema;
    if (!(schema instanceof ZodType)) return value;

    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationException(
        result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          code: issue.code.toUpperCase(),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
