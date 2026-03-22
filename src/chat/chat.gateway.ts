import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  collectConfiguredOrigins,
  isAllowedRequestOrigin,
} from '../common/origin-config';
import { ChatService } from './chat.service';

const socketAllowedOrigins = collectConfiguredOrigins();

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      callback(null, isAllowedRequestOrigin(origin, socketAllowedOrigins));
    },
  },
})
export class ChatGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly instanceId = randomUUID();
  private redisSubscriber?: Redis;
  private redisEnabled = false;

  private readonly onlineUsersRedisKey = 'ochat:presence:online-users';
  private readonly presenceChannel = 'ochat:presence:sync';
  private readonly typingChannel = 'ochat:typing:relay';
  private readonly realtimeChannel = 'ochat:realtime:relay';

  constructor(
    private jwt: JwtService,
    private chatService: ChatService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  private onlineUsers = new Map<string, Set<string>>();

  async onModuleInit() {
    const redisClient = await this.redisService.getClient();
    if (!redisClient) {
      this.redisEnabled = false;
      this.logger.warn(
        'Redis is unavailable. Realtime sync will stay on this single app instance only.',
      );
      return;
    }

    this.redisEnabled = true;
    this.redisSubscriber = redisClient.duplicate();
    if (this.redisSubscriber.status === 'wait') {
      await this.redisSubscriber.connect();
    }

    await this.redisSubscriber.subscribe(
      this.presenceChannel,
      this.typingChannel,
      this.realtimeChannel,
    );

    this.redisSubscriber.on('message', (channel, rawMessage) => {
      void this.handleRedisMessage(channel, rawMessage);
    });
  }

  async onModuleDestroy() {
    if (!this.redisSubscriber || this.redisSubscriber.status === 'end') {
      return;
    }

    await this.redisSubscriber.quit();
  }

  private async handleRedisMessage(channel: string, rawMessage: string) {
    try {
      const payload = JSON.parse(rawMessage);
      if (payload.instanceId === this.instanceId) {
        return;
      }

      if (channel === this.presenceChannel) {
        await this.broadcastOnlineUsers();
        return;
      }

      if (channel === this.typingChannel) {
        if (!payload.fromUserId || !Array.isArray(payload.recipientUserIds)) {
          return;
        }

        this.emitToUsers(payload.recipientUserIds, 'typing', {
          fromUserId: payload.fromUserId,
          groupId: payload.groupId ?? undefined,
          isTyping: Boolean(payload.isTyping),
        });
        return;
      }

      if (channel === this.realtimeChannel) {
        if (
          typeof payload.eventName !== 'string'
          || !Array.isArray(payload.recipientUserIds)
        ) {
          return;
        }

        this.emitToUsers(
          payload.recipientUserIds,
          payload.eventName,
          payload.payload ?? null,
        );
      }
    } catch {
      return;
    }
  }

  private async getRedisClient() {
    return this.redisService.getClient();
  }

  private async getOnlineUserIds() {
    if (!this.redisEnabled) {
      return Array.from(this.onlineUsers.keys());
    }

    const redis = await this.getRedisClient();
    if (!redis) {
      return Array.from(this.onlineUsers.keys());
    }

    const presenceFields = await redis.hkeys(this.onlineUsersRedisKey);
    return Array.from(
      new Set(
        presenceFields
          .map((field) => field.split(':')[0])
          .filter(Boolean),
      ),
    );
  }

  private async broadcastOnlineUsers() {
    this.server.emit('onlineUsers', await this.getOnlineUserIds());
  }

  private async publishPresenceUpdate() {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    await redis.publish(
      this.presenceChannel,
      JSON.stringify({ instanceId: this.instanceId, type: 'refresh' }),
    );
  }

  private async publishTypingEvent(payload: {
    fromUserId: string;
    recipientUserIds: string[];
    groupId?: string;
    isTyping: boolean;
  }) {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    await redis.publish(
      this.typingChannel,
      JSON.stringify({
        ...payload,
        instanceId: this.instanceId,
      }),
    );
  }

  private emitToUsers(
    userIds: Array<string | null | undefined>,
    eventName: string,
    payload: unknown,
  ) {
    for (const userId of Array.from(new Set(userIds.filter(Boolean)))) {
      this.server.to(userId as string).emit(eventName, payload);
    }
  }

  private async publishRealtimeEvent(
    eventName: string,
    userIds: Array<string | null | undefined>,
    payload: unknown,
  ) {
    const recipientUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (!recipientUserIds.length) {
      return;
    }

    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    await redis.publish(
      this.realtimeChannel,
      JSON.stringify({
        instanceId: this.instanceId,
        eventName,
        recipientUserIds,
        payload,
      }),
    );
  }

  private relayToUsers(
    userIds: Array<string | null | undefined>,
    eventName: string,
    payload: unknown,
  ) {
    this.emitToUsers(userIds, eventName, payload);
    void this.publishRealtimeEvent(eventName, userIds, payload).catch(() => undefined);
  }

  private getPresenceRedisField(userId: string) {
    return `${userId}:${this.instanceId}`;
  }

  private async markUserOnline(userId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    await redis.hset(
      this.onlineUsersRedisKey,
      this.getPresenceRedisField(userId),
      new Date().toISOString(),
    );
  }

  private async markUserOffline(userId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      return;
    }

    await redis.hdel(this.onlineUsersRedisKey, this.getPresenceRedisField(userId));
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
      this.relayToUsers(recipients, 'receiveMessage', message);
      this.relayToUsers([message.senderId], 'messageSent', message);
      return;
    }

    if (message.receiverId) {
      this.relayToUsers([message.receiverId], 'receiveMessage', message);
    }
    this.relayToUsers([message.senderId], 'messageSent', message);
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

    this.relayToUsers(recipients as string[], 'message:update', message);
  }

  emitMessageHidden(userId: string, messageId: string) {
    this.relayToUsers([userId], 'message:hidden', { messageId });
  }

  emitReadReceipt(payload: {
    conversationType: 'direct' | 'group';
    otherUserId?: string;
    groupId?: string;
    readAt: Date;
    userId: string;
  }) {
    if (payload.conversationType === 'direct' && payload.otherUserId) {
      this.relayToUsers([payload.otherUserId], 'messages:read', payload);
      return;
    }

    if (payload.groupId) {
      this.getGroupMemberIds(payload.groupId, [payload.userId]).then((members) => {
        this.relayToUsers(members, 'messages:read', payload);
      });
    }
  }

  emitRequestUpdate(request: {
    id: string;
    senderId: string;
    receiverId: string;
    status: string;
  }) {
    this.relayToUsers(
      [request.senderId, request.receiverId],
      'request:update',
      request,
    );
  }

  emitThemeUpdate(payload: {
    userId: string;
    contactUserId: string;
    chatTheme: string | null;
  }) {
    this.relayToUsers(
      [payload.userId, payload.contactUserId],
      'chat-theme:update',
      payload,
    );
  }

  emitConversationRefresh(userIds: string[], payload: Record<string, unknown>) {
    this.relayToUsers(userIds, 'conversation:refresh', payload);
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
      this.emitToUsers(members, 'typing', {
        fromUserId: sender.userId,
        groupId: data.groupId,
        isTyping: Boolean(data.isTyping),
      });
      await this.publishTypingEvent({
        fromUserId: sender.userId,
        recipientUserIds: members,
        groupId: data.groupId,
        isTyping: Boolean(data.isTyping),
      });
      return;
    }

    if (!data.toUserId) {
      return;
    }

    await this.chatService.assertUsersCanChat(sender.userId, data.toUserId);

    this.emitToUsers([data.toUserId], 'typing', {
      fromUserId: sender.userId,
      isTyping: Boolean(data.isTyping),
    });
    await this.publishTypingEvent({
      fromUserId: sender.userId,
      recipientUserIds: [data.toUserId],
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
    this.relayToUsers([data.toUserId], 'call:offer', {
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
    this.relayToUsers([data.toUserId], 'call:answer', {
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
    this.relayToUsers([data.toUserId], 'call:ice', {
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
    this.relayToUsers([data.toUserId], 'call:decline', {
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
    this.relayToUsers([data.toUserId], 'call:end', {
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
    if (sockets.size === 1) {
      await this.markUserOnline(user.userId);
      await this.publishPresenceUpdate();
    }
    await this.broadcastOnlineUsers();
  }

  async handleDisconnect(client: Socket) {
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
      await this.markUserOffline(user.userId);
      await this.publishPresenceUpdate();
    } else {
      this.onlineUsers.set(user.userId, sockets);
    }

    await this.broadcastOnlineUsers();
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
