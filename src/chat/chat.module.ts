import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatAttachmentStorageService } from './chat-attachment-storage.service';
import { ChatBackupService } from './chat-backup.service';
import { ChatController } from './chat.controller';
import { ChatRetentionService } from './chat-retention.service';
import { ChatUploadService } from './chat-upload.service';
import { ChatService } from './chat.service';
import { ensureEnvLoaded } from '../common/env';

ensureEnvLoaded();

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  providers: [
    ChatGateway,
    ChatService,
    ChatBackupService,
    ChatRetentionService,
    ChatUploadService,
    ChatAttachmentStorageService,
  ],
  controllers: [ChatController],
  exports: [ChatGateway, ChatAttachmentStorageService],
})
export class ChatModule {}
