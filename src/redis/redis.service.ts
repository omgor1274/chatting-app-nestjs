import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly enabled: boolean;
  private connectionFailed = false;

  constructor() {
    const redisEnabled = process.env.REDIS_ENABLED?.trim().toLowerCase();
    this.enabled = !['0', 'false', 'no', 'off'].includes(redisEnabled ?? '');

    if (!this.enabled) {
      this.client = null;
      this.logger.warn(
        'Redis is disabled via REDIS_ENABLED. Running in single-instance mode.',
      );
      return;
    }

    this.client = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    this.client.on('error', (error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  isEnabled() {
    return this.enabled;
  }

  async getClient() {
    if (!this.client || this.connectionFailed) {
      return null;
    }

    if (this.client.status === 'wait') {
      try {
        await this.client.connect();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown Redis connection error';
        this.connectionFailed = true;
        this.logger.warn(
          `Redis connection failed. Falling back to single-instance mode. ${message}`,
        );
        return null;
      }
    }

    return this.client;
  }

  async onModuleDestroy() {
    if (this.client && this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
