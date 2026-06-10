import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ENV, type Env } from './env.schema';

/** Cung cấp env đã validate cho toàn app qua token ENV. */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
