import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Endpoint không cần auth (health, /auth/login, iCal public feed — docs/02 §skip). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
