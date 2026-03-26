import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from '../auth/jwt/admin.guard';
import { ChatModule } from '../chat/chat.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountDeletionService } from './account-deletion.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [
    ChatModule,
    MailModule,
    PrismaModule,
    NotificationsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [UserController],
  providers: [UserService, AccountDeletionService, AdminGuard],
})
export class UserModule {}
