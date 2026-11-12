import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { IdentityService } from '../identity/identity.service.js';
import { AuthController, MeController } from '../identity/identity.controller.js';
import type { Env } from '../config/env.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { createJwksResolver, JWKS_RESOLVER, JwtVerifierService } from './jwt-verifier.service.js';
import { StaffGuard } from './staff.guard.js';

@Global()
@Module({
  controllers: [AuthController, MeController],
  providers: [
    {
      provide: JWKS_RESOLVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createJwksResolver(config),
    },
    JwtVerifierService,
    IdentityService,
    StaffGuard,
    // Denegar por defecto: JWT obligatorio salvo @Public(). Se evalúa después del rate limit global.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [JwtVerifierService, IdentityService, StaffGuard],
})
export class AuthModule {}
