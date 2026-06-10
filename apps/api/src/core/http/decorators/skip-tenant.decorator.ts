import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_KEY = 'skipTenantScope';

/**
 * Endpoint chạy ngoài tenant scope (health, webhook chưa resolve được tenant,
 * platform admin — docs/02 §skip). TenantGuard sẽ bỏ qua check.
 */
export const SkipTenantScope = () => SetMetadata(SKIP_TENANT_KEY, true);
