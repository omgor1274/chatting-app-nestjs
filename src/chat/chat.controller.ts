import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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

function groupAvatarFileName(
  req: { user?: { userId?: string } },
  file: { originalname: string },
  callback: (error: Error | null, filename: string) => void,
) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  callback(
    null,
    `${req['user']?.userId ?? 'group'}-${uniqueSuffix}${extname(file.originalname)}`,
  );
}

function parseIds(value?: string | string[]) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((item) => String(item).trim()).filter(Boolean)
        : [];
    } catch {
      throw new BadRequestException('Invalid id list');
    }
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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
    @Query('email') otherUserEmail: string | undefined,
    @Query('userId') otherUserId: string | undefined,
    @Query('groupId') groupId: string | undefined,
    @Query('before') before: string | undefined,
    @Req() req,
  ) {
    return this.chatService.getMessages(req.user.userId, {
      otherUserEmail,
      otherUserId,
      groupId,
      before,
    });
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

  @Get('groups')
  @UseGuards(JwtGuard)
  getGroups(@Req() req) {
    return this.chatService.getGroups(req.user.userId);
  }

  @Get('groups/invites')
  @UseGuards(JwtGuard)
  getGroupInvites(@Req() req) {
    return this.chatService.getGroupInvites(req.user.userId);
  }

  @Get('groups/:groupId')
  @UseGuards(JwtGuard)
  getGroupDetails(@Req() req, @Param('groupId') groupId: string) {
    return this.chatService.getGroupDetails(req.user.userId, groupId);
  }

  @Post('groups')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: 'uploads/groups',
        filename: groupAvatarFileName,
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image uploads are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async createGroup(
    @Req() req,
    @Body() body: { name: string; memberIds?: string | string[] },
    @UploadedFile() file?: { filename: string },
  ) {
    const group = await this.chatService.createGroup(req.user.userId, {
      name: body.name,
      memberIds: parseIds(body.memberIds),
      avatar: file ? `/uploads/groups/${file.filename}` : null,
    });
    this.chatGateway.emitConversationRefresh(
      [req.user.userId, ...group.pendingInvites.map((invite) => invite.invitedUserId)],
      { groupId: group.id },
    );
    return group;
  }

  @Post('groups/:groupId')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: 'uploads/groups',
        filename: groupAvatarFileName,
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image uploads are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async updateGroup(
    @Req() req,
    @Param('groupId') groupId: string,
    @Body() body: { name?: string; clearAvatar?: string | boolean },
    @UploadedFile() file?: { filename: string },
  ) {
    const clearAvatar =
      body.clearAvatar === true ||
      body.clearAvatar === 'true' ||
      body.clearAvatar === '1';
    const group = await this.chatService.updateGroup(req.user.userId, groupId, {
      name: body.name,
      clearAvatar,
      avatar: file ? `/uploads/groups/${file.filename}` : undefined,
    });
    this.chatGateway.emitConversationRefresh(
      group.members.map((member) => member.userId),
      { groupId: group.id },
    );
    return group;
  }

  @Post('groups/:groupId/invite')
  @UseGuards(JwtGuard)
  async inviteGroupMembers(
    @Req() req,
    @Param('groupId') groupId: string,
    @Body() body: { userIds: string[] | string },
  ) {
    const group = await this.chatService.inviteGroupMembers(
      req.user.userId,
      groupId,
      parseIds(body.userIds),
    );
    this.chatGateway.emitConversationRefresh(
      [req.user.userId, ...group.pendingInvites.map((invite) => invite.invitedUserId)],
      { groupId },
    );
    return group;
  }

  @Post('groups/invites/accept')
  @UseGuards(JwtGuard)
  async acceptGroupInvite(@Req() req, @Body() body: { inviteId: string }) {
    const group = await this.chatService.acceptGroupInvite(
      req.user.userId,
      body.inviteId,
    );
    this.chatGateway.emitConversationRefresh(
      group.members.map((member) => member.userId),
      { groupId: group.id },
    );
    return group;
  }

  @Post('groups/invites/reject')
  @UseGuards(JwtGuard)
  async rejectGroupInvite(@Req() req, @Body() body: { inviteId: string }) {
    const result = await this.chatService.rejectGroupInvite(
      req.user.userId,
      body.inviteId,
    );
    this.chatGateway.emitConversationRefresh([req.user.userId], {});
    return result;
  }

  @Post('groups/:groupId/remove-member')
  @UseGuards(JwtGuard)
  async removeGroupMember(
    @Req() req,
    @Param('groupId') groupId: string,
    @Body() body: { userId: string },
  ) {
    const group = await this.chatService.removeGroupMember(
      req.user.userId,
      groupId,
      body.userId,
    );
    this.chatGateway.emitConversationRefresh(
      Array.from(new Set([body.userId, ...group.members.map((member) => member.userId)])),
      { groupId },
    );
    return group;
  }

  @Get('permission')
  @UseGuards(JwtGuard)
  getChatPermission(@Req() req, @Query('userId') otherUserId: string) {
    return this.chatService.getChatPermission(req.user.userId, otherUserId);
  }

  @Post('messages/read')
  @UseGuards(JwtGuard)
  async markRead(
    @Req() req,
    @Body() body: { otherUserId?: string; groupId?: string },
  ) {
    const result = await this.chatService.markConversationRead(req.user.userId, body);
    this.chatGateway.emitReadReceipt({
      ...(result as {
        conversationType: 'direct' | 'group';
        otherUserId?: string;
        groupId?: string;
        readAt: Date;
      }),
      userId: req.user.userId,
    });
    return result;
  }

  @Post('messages/delete-for-me')
  @UseGuards(JwtGuard)
  async deleteForMe(@Req() req, @Body() body: { messageId: string }) {
    const result = await this.chatService.deleteMessageForMe(
      req.user.userId,
      body.messageId,
    );
    this.chatGateway.emitMessageHidden(req.user.userId, result.messageId);
    return result;
  }

  @Post('messages/delete-for-everyone')
  @UseGuards(JwtGuard)
  async deleteForEveryone(@Req() req, @Body() body: { messageId: string }) {
    const result = await this.chatService.deleteMessageForEveryone(
      req.user.userId,
      body.messageId,
    );
    await this.chatGateway.emitMessageUpdated(result);
    return result;
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
          'video/mp4',
          'video/webm',
          'video/ogg',
          'video/quicktime',
          'video/x-m4v',
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
      receiverId?: string;
      groupId?: string;
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
      groupId: body.groupId,
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

    await this.chatGateway.emitMessageToConversation(message);
    return message;
  }
}
