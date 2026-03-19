import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import express from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  mkdirSync(join(process.cwd(), 'uploads', 'avatars'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'chat'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'groups'), { recursive: true });
  mkdirSync(join(process.cwd(), 'uploads', 'chat-themes'), { recursive: true });
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
  mkdirSync(join(process.cwd(), 'public'), { recursive: true });

  const app = await NestFactory.create(AppModule);
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ||
    process.env.APP_ORIGIN ||
    `http://localhost:${process.env.PORT ?? 3000}`
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

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

      callback(new Error('Origin not allowed by CORS'), false);
    },
    credentials: true,
  });
  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
    }),
  );
  // app.use(
  //   rateLimit({
  //     windowMs: 15 * 60 * 1000,
  //     max: 300,
  //     standardHeaders: true,
  //     legacyHeaders: false,
  //   }),
  // );
  app.use(
    express.static(join(process.cwd(), 'public'), {
      maxAge: '1d',
    }),
  );
  app.use(
    '/uploads',
    express.static(join(process.cwd(), 'uploads'), {
      maxAge: '1d',
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
