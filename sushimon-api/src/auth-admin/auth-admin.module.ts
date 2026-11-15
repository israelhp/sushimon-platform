import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AUTH_ADMIN_PORT, type AuthAdminPort } from './auth-admin.port.js';
import { SupabaseAuthAdminAdapter } from './supabase-auth-admin.adapter.js';
import { UnavailableAuthAdminAdapter } from './unavailable-auth-admin.adapter.js';

/** Real solo con `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_URL`; en cualquier otro caso, adaptador «no disponible». */
export function selectAuthAdminAdapter(config: ConfigService<Env, true>): AuthAdminPort {
  const serviceRoleKey = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
  const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
  if (!serviceRoleKey || !supabaseUrl) return new UnavailableAuthAdminAdapter();
  return new SupabaseAuthAdminAdapter({
    supabaseUrl,
    serviceRoleKey,
    timeoutMs: config.get('SUPABASE_ADMIN_TIMEOUT_MS', { infer: true }),
  });
}

/** Puerto de administración de identidad (Supabase Auth Admin API) tras `AUTH_ADMIN_PORT`. */
@Module({
  providers: [
    { provide: AUTH_ADMIN_PORT, inject: [ConfigService], useFactory: selectAuthAdminAdapter },
  ],
  exports: [AUTH_ADMIN_PORT],
})
export class AuthAdminModule {}
