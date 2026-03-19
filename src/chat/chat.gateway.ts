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

  emitMessageToUser(message: {
    senderId: string;
    receiverId: string;
    [key: string]: unknown;
  }) {
    this.server.to(message.receiverId).emit('receiveMessage', message);
    this.server.to(message.senderId).emit('messageSent', message);
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

  private async authenticateSocketUser(client: Socket, disconnect = false) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        throw new Error('Missing token');
      }

      const payload = this.jwt.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          tokenVersion: true,
        },
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
      select: {
        id: true,
        email: true,
        tokenVersion: true,
      },
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
    @MessageBody() data: { toUserId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = await this.getAuthorizedUser(client);

    if (!sender?.userId || !data?.toUserId) {
      return;
    }

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
      toUserId: string;
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
      ciphertext: data.ciphertext,
      plainText: data.plainText,
      encryptedKey: data.encryptedKey,
      iv: data.iv,
      algorithm: data.algorithm,
      messageType: data.messageType ?? MessageType.TEXT,
    });

    this.emitMessageToUser(savedMessage);

    return savedMessage;
  }
}
