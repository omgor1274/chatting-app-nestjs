import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  resolveDefaultAppOrigin,
  resolveRequestOrigin,
} from './common/origin-config';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  getPublicConfig(request?: Request) {
    const requestOrigin = resolveRequestOrigin({
      protocol:
        request?.headers['x-forwarded-proto']?.toString().split(',')[0] ??
        request?.protocol,
      host:
        request?.headers['x-forwarded-host']?.toString().split(',')[0] ??
        request?.headers.host,
    });
    const appOrigin = requestOrigin || resolveDefaultAppOrigin();
    const configuredApiUrl = process.env.PUBLIC_API_URL?.trim();

    return {
      appOrigin,
      apiUrl: configuredApiUrl || requestOrigin || appOrigin,
      avatarBaseUrl:
        process.env.UI_AVATAR_BASE_URL || '/icons/default-avatar.svg',
      stunServers: (process.env.STUN_SERVER_URLS || 'stun:stun.l.google.com:19302')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }
}
