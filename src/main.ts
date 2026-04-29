import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import express from 'express';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import {
  resolveAppRootPath,
  getWritableDataDir,
  recoverWritableDataDirFromError,
  resolveWritableDataPath,
} from './common/app-paths';
import {
  collectConfiguredOrigins,
  isAllowedRequestOrigin,
} from './common/origin-config';
import { resolveRateLimitClientKey } from './common/rate-limit-client-key';
import { ensureEnvLoaded } from './common/env';

ensureEnvLoaded();

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

function setStaticAssetHeaders(res: express.Response, filePath: string) {
  const normalizedPath = filePath.replaceAll('\\', '/');

  if (normalizedPath.endsWith('/sw.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }

  if (normalizedPath.endsWith('/manifest.webmanifest')) {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}

function setUploadedAssetHeaders(res: express.Response) {
  res.setHeader(
    'Cache-Control',
    'public, max-age=2592000, immutable, stale-while-revalidate=86400',
  );
}

async function bootstrap() {
  const writableDirectories: string[][] = [
    ['uploads', 'avatars'],
    ['uploads', 'chat'],
    ['uploads', 'chat-sessions', 'meta'],
    ['uploads', 'chat-sessions', 'chunks'],
    ['uploads', 'chat-sessions', 'assembled'],
    ['uploads', 'groups'],
    ['uploads', 'chat-themes'],
    ['backups'],
  ];
  const ensureWritableDirectories = () => {
    for (const segments of writableDirectories) {
      mkdirSync(resolveWritableDataPath(...segments), { recursive: true });
    }
  };

  try {
    ensureWritableDirectories();
  } catch (error) {
    const failedPath =
      error &&
      typeof error === 'object' &&
      'path' in error &&
      typeof error.path === 'string'
        ? error.path
        : getWritableDataDir();
    if (!recoverWritableDataDirFromError(error, failedPath)) {
      throw error;
    }
    ensureWritableDirectories();
  }

  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  const port = readEnvNumber('PORT', 8080);
  const requestTimeoutMs = readEnvNumber(
    'SERVER_REQUEST_TIMEOUT_MS',
    5 * 60 * 1000,
  );
  const keepAliveTimeoutMs = readEnvNumber(
    'SERVER_KEEP_ALIVE_TIMEOUT_MS',
    5 * 1000,
  );
  const headersTimeoutMs = Math.max(
    readEnvNumber('SERVER_HEADERS_TIMEOUT_MS', 65 * 1000),
    keepAliveTimeoutMs + 1000,
  );
  const configuredOrigins = collectConfiguredOrigins();
  const allowedOrigins = configuredOrigins.length
    ? configuredOrigins
    : [`http://localhost:${port}`];
  const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
  const connectSrc = Array.from(
    new Set(["'self'", 'https:', 'ws:', 'wss:', ...configuredOrigins]),
  );

  expressApp.disable('x-powered-by');
  if (trustProxy !== undefined) {
    expressApp.set('trust proxy', trustProxy);
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedRequestOrigin(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  });
  app.use(
    helmet({
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc,
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
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        },
      },
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
      crossOriginOpenerPolicy: {
        policy: 'same-origin',
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: readEnvNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
      limit: readEnvNumber('RATE_LIMIT_MAX', 400),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: resolveRateLimitClientKey,
      skip: (req) =>
        req.path === '/health' ||
        req.path.startsWith('/chat/uploads/') ||
        req.path === '/chat/attachments' ||
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
      windowMs: readEnvNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // default: 15-minute window
      limit: readEnvNumber('AUTH_RATE_LIMIT_MAX', 20),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: resolveRateLimitClientKey,
      message: {
        message: 'Too many authentication attempts. Please wait and try again.',
      },
    }),
  );
  app.use(
    '/public',
    express.static(resolveAppRootPath('public'), {
      maxAge: '30d',
      immutable: true,
      index: false,
      setHeaders: setStaticAssetHeaders,
    }),
  );
  app.use(
    express.static(resolveAppRootPath('public'), {
      maxAge: '30d',
      immutable: true,
      index: false,
      setHeaders: setStaticAssetHeaders,
    }),
  );
  app.use(
    '/uploads',
    express.static(resolveWritableDataPath('uploads'), {
      maxAge: '30d',
      immutable: true,
      index: false,
      setHeaders: setUploadedAssetHeaders,
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
  console.log('PORT from env:', process.env.PORT);
  console.log('Resolved server port:', port);
  console.log('Writable data directory:', getWritableDataDir());
  const server = await app.listen(port, '0.0.0.0');
  server.requestTimeout = requestTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  console.log(`O-chat server listening on 0.0.0.0:${port}`);
}
bootstrap();
