import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { MessageType } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

const socketAllowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  process.env.APP_ORIGIN ||
  `http://localhost:${process.env.PORT ?? 3000}`
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@WebSocketGateway({
  cors: {
    origin: socketAllowedOrigins,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private jwt: JwtService,
    private chatService: ChatService,
    private prisma: PrismaService,
  ) {}

  private onlineUsers = new Map<string, Set<string>>();

  private broadcastOnlineUsers() {
    this.server.emit('onlineUsers', Array.from(this.onlineUsers.keys()));
  }

  private async getGroupMemberIds(groupId: string, excludeUserIds: string[] = []) {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    return members
      .map((member) => member.userId)
      .filter((userId) => !excludeUserIds.includes(userId));
  }

  async emitMessageToConversation(message: {
    senderId: string;
    receiverId?: string | null;
    groupId?: string | null;
    [key: string]: unknown;
  }) {
    if (message.groupId) {
      const recipients = await this.getGroupMemberIds(message.groupId, [
        message.senderId,
      ]);
      for (const userId of recipients) {
        this.server.to(userId).emit('receiveMessage', message);
      }
      this.server.to(message.senderId).emit('messageSent', message);
      return;
    }

    if (message.receiverId) {
      this.server.to(message.receiverId).emit('receiveMessage', message);
    }
    this.server.to(message.senderId).emit('messageSent', message);
  }

  async emitMessageUpdated(message: {
    senderId: string;
    receiverId?: string | null;
    groupId?: string | null;
    [key: string]: unknown;
  }) {
    const recipients = message.groupId
      ? await this.getGroupMemberIds(message.groupId)
      : [message.senderId, message.receiverId].filter(Boolean);

    for (const userId of recipients as string[]) {
      this.server.to(userId).emit('message:update', message);
    }
  }

  emitMessageHidden(userId: string, messageId: string) {
    this.server.to(userId).emit('message:hidden', { messageId });
  }

  emitReadReceipt(payload: {
    conversationType: 'direct' | 'group';
    otherUserId?: string;
    groupId?: string;
    readAt: Date;
    userId: string;
  }) {
    if (payload.conversationType === 'direct' && payload.otherUserId) {
      this.server.to(payload.otherUserId).emit('messages:read', payload);
      return;
    }

    if (payload.groupId) {
      this.getGroupMemberIds(payload.groupId, [payload.userId]).then((members) => {
        for (const userId of members) {
          this.server.to(userId).emit('messages:read', payload);
        }
      });
    }
  }

  emitRequestUpdate(request: {
    id: string;
    senderId: string;
    receiverId: string;
    status: string;
  }) {
    this.server.to(request.senderId).emit('request:update', request);
    this.server.to(request.receiverId).emit('request:update', request);
  }

  emitThemeUpdate(payload: {
    userId: string;
    contactUserId: string;
    chatTheme: string | null;
  }) {
    this.server.to(payload.userId).emit('chat-theme:update', payload);
    this.server.to(payload.contactUserId).emit('chat-theme:update', payload);
  }

  emitConversationRefresh(userIds: string[], payload: Record<string, unknown>) {
    for (const userId of Array.from(new Set(userIds.filter(Boolean)))) {
      this.server.to(userId).emit('conversation:refresh', payload);
    }
  }

  private async authenticateSocketUser(client: Socket, disconnect = false) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        throw new Error('Missing token');
      }

      const payload = this.jwt.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, tokenVersion: true },
      });

      if (!user || user.tokenVersion !== payload.tokenVersion) {
        throw new Error('Session expired');
      }

      client.data.user = {
        userId: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
      };

      return client.data.user;
    } catch {
      client.emit('auth:logout');
      if (disconnect) {
        client.disconnect();
      }
      return null;
    }
  }

  private async getAuthorizedUser(client: Socket) {
    const currentUser = client.data.user;
    if (!currentUser?.userId) {
      return this.authenticateSocketUser(client, true);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.userId },
      select: { id: true, email: true, tokenVersion: true },
    });

    if (!user || user.tokenVersion !== currentUser.tokenVersion) {
      client.emit('auth:logout');
      client.disconnect();
      return null;
    }

    client.data.user = {
      userId: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    };
    return client.data.user;
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody()
    data: { toUserId?: string; groupId?: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId) {
      return;
    }

    if (data.groupId) {
      await this.chatService.getGroupDetails(sender.userId, data.groupId);
      const members = await this.getGroupMemberIds(data.groupId, [sender.userId]);
      for (const userId of members) {
        this.server.to(userId).emit('typing', {
          fromUserId: sender.userId,
          groupId: data.groupId,
          isTyping: Boolean(data.isTyping),
        });
      }
      return;
    }

    if (!data.toUserId) {
      return;
    }

    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);

    this.server.to(data.toUserId).emit('typing', {
      fromUserId: sender.userId,
      isTyping: Boolean(data.isTyping),
    });
  }

  @SubscribeMessage('call:offer')
  async handleCallOffer(
    @MessageBody()
    data: {
      toUserId: string;
      offer: Record<string, unknown>;
      callType: 'audio' | 'video';
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId || !data?.toUserId || !data?.offer) {
      return { error: 'Invalid call request' };
    }
    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);
    this.server.to(data.toUserId).emit('call:offer', {
      fromUserId: sender.userId,
      offer: data.offer,
      callType: data.callType === 'video' ? 'video' : 'audio',
    });
    return { success: true };
  }

  @SubscribeMessage('call:answer')
  async handleCallAnswer(
    @MessageBody()
    data: {
      toUserId: string;
      answer: Record<string, unknown>;
      callType: 'audio' | 'video';
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId || !data?.toUserId || !data?.answer) {
      return { error: 'Invalid call answer' };
    }
    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);
    this.server.to(data.toUserId).emit('call:answer', {
      fromUserId: sender.userId,
      answer: data.answer,
      callType: data.callType === 'video' ? 'video' : 'audio',
    });
    return { success: true };
  }

  @SubscribeMessage('call:ice')
  async handleCallIce(
    @MessageBody()
    data: {
      toUserId: string;
      candidate: Record<string, unknown>;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId || !data?.toUserId || !data?.candidate) {
      return { error: 'Invalid ICE candidate' };
    }
    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);
    this.server.to(data.toUserId).emit('call:ice', {
      fromUserId: sender.userId,
      candidate: data.candidate,
    });
    return { success: true };
  }

  @SubscribeMessage('call:decline')
  async handleCallDecline(
    @MessageBody() data: { toUserId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId || !data?.toUserId) {
      return { error: 'Invalid call decline' };
    }
    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);
    this.server.to(data.toUserId).emit('call:decline', {
      fromUserId: sender.userId,
    });
    return { success: true };
  }

  @SubscribeMessage('call:end')
  async handleCallEnd(
    @MessageBody() data: { toUserId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId || !data?.toUserId) {
      return { error: 'Invalid call end' };
    }
    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);
    this.server.to(data.toUserId).emit('call:end', {
      fromUserId: sender.userId,
    });
    return { success: true };
  }

  async handleConnection(client: Socket) {
    const user = await this.authenticateSocketUser(client, true);
    if (!user?.userId) {
      return;
    }
    client.join(user.userId);
    const sockets = this.onlineUsers.get(user.userId) ?? new Set<string>();
    sockets.add(client.id);
    this.onlineUsers.set(user.userId, sockets);
    this.broadcastOnlineUsers();
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (!user?.userId) {
      return;
    }

    const sockets = this.onlineUsers.get(user.userId);
    if (!sockets) {
      return;
    }

    sockets.delete(client.id);
    if (sockets.size === 0) {
      this.onlineUsers.delete(user.userId);
    } else {
      this.onlineUsers.set(user.userId, sockets);
    }

    this.broadcastOnlineUsers();
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody()
    data: {
      ciphertext?: string;
      plainText?: string;
      toUserId?: string;
      groupId?: string;
      encryptedKey?: string;
      iv?: string;
      algorithm?: string;
      messageType?: MessageType;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);
    if (!sender?.userId) {
      return { error: 'Unauthorized' };
    }

    const savedMessage = await this.chatService.createEncryptedMessage({
      senderId: sender.userId,
      receiverId: data.toUserId,
      groupId: data.groupId,
      ciphertext: data.ciphertext,
      plainText: data.plainText,
      encryptedKey: data.encryptedKey,
      iv: data.iv,
      algorithm: data.algorithm,
      messageType: data.messageType ?? MessageType.TEXT,
    });

    await this.emitMessageToConversation(savedMessage);
    return savedMessage;
  }
}
