import { Injectable } from '@nestjs/common';
import { resolveDefaultAppOrigin } from './common/origin-config';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  getPublicConfig() {
    const appOrigin = resolveDefaultAppOrigin();

    return {
      appOrigin,
      apiUrl: process.env.PUBLIC_API_URL || appOrigin,
      avatarBaseUrl:
        process.env.UI_AVATAR_BASE_URL || 'https://ui-avatars.com/api/',
      stunServers: (process.env.STUN_SERVER_URLS || 'stun:stun.l.google.com:19302')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }
}
