import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PermissionService } from './permission.service';
import { TokenService } from './token.service';

/** Hạ tầng auth dùng chung (docs/13 §2 core/auth): token, permission cache. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokenService, PermissionService],
  exports: [TokenService, PermissionService, JwtModule],
})
export class AuthCoreModule {}
