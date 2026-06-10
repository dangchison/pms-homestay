import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';
import { ValidationException } from '../exceptions/app.exception';

const ZOD_SCHEMA = Symbol('ZOD_SCHEMA');

interface ZodDtoClass {
  [ZOD_SCHEMA]: ZodType;
  new (): unknown;
}

/**
 * Tạo DTO class từ Zod schema (docs/01: MỘT stack validation duy nhất — Zod,
 * không class-validator). Tự chế thay nestjs-zod trong lúc chờ bản tương thích
 * Zod 4 ổn định — API tương đương:
 *
 *   class CreateBookingDto extends createZodDto(CreateBookingSchema) {}
 */
export function createZodDto<T extends ZodType>(schema: T) {
  class ZodDto {
    static readonly [ZOD_SCHEMA] = schema;
  }
  return ZodDto as unknown as ZodDtoClass & { new (): ReturnType<T['parse']> };
}

/** Global pipe: DTO nào tạo từ createZodDto thì parse bằng schema của nó. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype as Partial<ZodDtoClass> | undefined;
    const schema = metatype?.[ZOD_SCHEMA];
    if (!schema) return value;

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
