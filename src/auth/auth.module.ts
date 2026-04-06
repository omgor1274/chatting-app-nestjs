import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { ensureEnvLoaded } from '../common/env';

ensureEnvLoaded();

@Module({
  imports: [
    MailModule,
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminBootstrapService],
})
export class AuthModule {}
