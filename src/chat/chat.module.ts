import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatBackupService } from './chat-backup.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
    imports: [
        PrismaModule,
        NotificationsModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '1d' },
        }),
    ],
    providers: [ChatGateway, ChatService, ChatBackupService],
    controllers: [ChatController],
})
export class ChatModule { }
