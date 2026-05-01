import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    CacheModule.register({ ttl: 60, isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    PrismaModule,
    ChatModule,
    NotificationsModule,
    RedisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
