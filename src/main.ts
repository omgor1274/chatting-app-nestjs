import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import express from 'express';
import { config as loadEnv } from 'dotenv';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import {
  getEnvFilePath,
  resolveAppRootPath,
  resolveWritableDataPath,
} from './common/app-paths';

loadEnv({ path: getEnvFilePath(), override: false });

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

function setStaticAssetHeaders(
  res: express.Response,
  filePath: string,
) {
  const normalizedPath = filePath.replaceAll('\\', '/');

  if (normalizedPath.endsWith('/sw.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }

  if (normalizedPath.endsWith('/manifest.webmanifest')) {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}

async function bootstrap() {
  mkdirSync(resolveWritableDataPath('uploads', 'avatars'), { recursive: true });
  mkdirSync(resolveWritableDataPath('uploads', 'chat'), { recursive: true });
  mkdirSync(resolveWritableDataPath('uploads', 'groups'), { recursive: true });
  mkdirSync(resolveWritableDataPath('uploads', 'chat-themes'), {
    recursive: true,
  });
  mkdirSync(resolveWritableDataPath('backups'), { recursive: true });

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
    express.static(resolveAppRootPath('public'), {
      maxAge: '1d',
      index: false,
      setHeaders: setStaticAssetHeaders,
    }),
  );
  app.use(
    express.static(resolveAppRootPath('public'), {
      maxAge: '1d',
      index: false,
      setHeaders: setStaticAssetHeaders,
    }),
  );
  app.use(
    '/uploads',
    express.static(resolveWritableDataPath('uploads'), {
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
  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`O-chat server listening on 0.0.0.0:${port}`);
}
bootstrap();
