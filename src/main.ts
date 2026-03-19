import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import express from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

function readEnvNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTrustProxy(value?: string) {
  if (!value) {
    return undefined;
  }

  if (value === 'true') {
    return 1;
  }

  if (value === 'false') {
    return false;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : value;
}

function isAllowedLocalDevOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim());
}

async function bootstrap() {
  mkdirSync(join(process.cwd(), 'uploads', 'avatars'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'chat'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'groups'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'chat-themes'), { recursive: true });
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  mkdirSync(join(process.cwd(), 'public'), { recursive: true });

  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ||
    process.env.APP_ORIGIN ||
    `http://localhost:${process.env.PORT ?? 3000}`
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);

  expressApp.disable('x-powered-by');
  if (trustProxy !== undefined) {
    expressApp.set('trust proxy', trustProxy);
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origin === 'null') {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (isAllowedLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'", 'https:', 'ws:', 'wss:'],
          fontSrc: ["'self'", 'https:', 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          objectSrc: ["'none'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          // The current frontend still depends on inline onclick handlers.
          // Keep this until those handlers are migrated to JS listeners.
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.tailwindcss.com',
            'https://cdn.socket.io',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        },
      },
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
      crossOriginOpenerPolicy: false,
    }),
  );
  app.use(
    rateLimit({
      windowMs: readEnvNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      limit: readEnvNumber('RATE_LIMIT_MAX', 400),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) =>
        req.path === '/health' ||
        req.path.startsWith('/uploads/') ||
        req.path === '/sw.js',
      message: {
        message: 'Too many requests. Please try again in a few minutes.',
      },
    }),
  );
  app.use(
    '/auth',
    rateLimit({
      windowMs: readEnvNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      limit: readEnvNumber('AUTH_RATE_LIMIT_MAX', 20),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        message: 'Too many authentication attempts. Please wait and try again.',
      },
    }),
  );
  app.use(
    '/public',
    express.static(join(process.cwd(), 'public'), {
      maxAge: '1d',
      index: false,
    }),
  );
  app.use(
    express.static(join(process.cwd(), 'public'), {
      maxAge: '1d',
      index: false,
    }),
  );
  app.use(
    '/uploads',
    express.static(join(process.cwd(), 'uploads'), {
      maxAge: '1d',
      index: false,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      stopAtFirstError: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
