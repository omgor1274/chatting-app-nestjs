import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PushNotificationService } from './push-notification.service';

@Module({
  imports: [PrismaModule],
  providers: [PushNotificationService],
  exports: [PushNotificationService],
})
export class NotificationsModule {}
