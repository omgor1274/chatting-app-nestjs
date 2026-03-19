import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MessageType } from '@prisma/client';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

function attachmentFileName(
  req: { user?: { userId?: string } },
  file: { originalname: string },
  callback: (error: Error | null, filename: string) => void,
) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  callback(
    null,
    `${req['user']?.userId ?? 'chat'}-${uniqueSuffix}${extname(file.originalname)}`,
  );
}

@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatGateway: ChatGateway,
  ) {}

  @UseGuards(JwtGuard)
  @Get('messages')
  getMessages(
    @Query('email') otherUserEmail: string,
    @Query('before') before: string | undefined,
    @Req() req,
  ) {
    return this.chatService.getMessages(req.user.userId, otherUserEmail, before);
  }

  @Post('request')
  @UseGuards(JwtGuard)
  async sendRequest(@Body() body: { receiverEmail: string }, @Req() req) {
    const request = await this.chatService.sendRequest(
      req.user.userId,
      body.receiverEmail,
    );
    this.chatGateway.emitRequestUpdate(request);
    return request;
  }

  @Post('accept')
  @UseGuards(JwtGuard)
  async accept(@Body() body: { requestId: string }, @Req() req) {
    const request = await this.chatService.acceptRequest(
      body.requestId,
      req.user.userId,
    );
    this.chatGateway.emitRequestUpdate(request);
    return request;
  }

  @Post('reject')
  @UseGuards(JwtGuard)
  async reject(@Body() body: { requestId: string }, @Req() req) {
    const request = await this.chatService.rejectRequest(
      body.requestId,
      req.user.userId,
    );
    this.chatGateway.emitRequestUpdate(request);
    return request;
  }

  @Get('requests')
  @UseGuards(JwtGuard)
  getRequests(@Req() req) {
    return this.chatService.getPendingRequests(req.user.userId);
  }

  @Get('recent')
  @UseGuards(JwtGuard)
  getRecentChats(@Req() req) {
    return this.chatService.getRecentChats(req.user.userId);
  }

  @Get('permission')
  @UseGuards(JwtGuard)
  getChatPermission(@Req() req, @Query('userId') otherUserId: string) {
    return this.chatService.getChatPermission(req.user.userId, otherUserId);
  }

  @Post('attachments')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/chat',
        filename: attachmentFileName,
      }),
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
      fileFilter: (req, file, callback) => {
        const allowedMimeTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'audio/webm',
          'audio/mpeg',
          'audio/mp4',
          'audio/ogg',
          'audio/wav',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];

        if (!allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException('Unsupported file type'),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  async uploadAttachment(
    @Req() req,
    @Body()
    body: {
      receiverId: string;
      ciphertext?: string;
      encryptedKey?: string;
      iv?: string;
      algorithm?: string;
    },
    @UploadedFile()
    file?: {
      filename: string;
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Attachment file is required');
    }

    const messageType = file.mimetype.startsWith('image/')
      ? MessageType.IMAGE
      : file.mimetype.startsWith('audio/')
        ? MessageType.AUDIO
        : MessageType.DOCUMENT;

    const message = await this.chatService.createEncryptedMessage({
      senderId: req.user.userId,
      receiverId: body.receiverId,
      ciphertext: body.ciphertext,
      encryptedKey: body.encryptedKey,
      iv: body.iv,
      algorithm: body.algorithm,
      fileUrl: `/uploads/chat/${file.filename}`,
      fileName: file.originalname,
      fileMimeType: file.mimetype,
      fileSize: file.size,
      messageType,
    });

    this.chatGateway.emitMessageToUser(message);

    return message;
  }
}
