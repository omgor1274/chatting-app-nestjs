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
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private jwt: JwtService,
    private chatService: ChatService,
  ) { }

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

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { toUserId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    const sender = client.data.user;

    if (!sender?.userId || !data?.toUserId) {
      return;
    }

    this.server.to(data.toUserId).emit('typing', {
      fromUserId: sender.userId,
      isTyping: Boolean(data.isTyping),
    });
  }

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;
      const user = this.jwt.verify(token);

      client.data.user = user;
      client.join(user.userId);

      const sockets = this.onlineUsers.get(user.userId) ?? new Set<string>();
      sockets.add(client.id);
      this.onlineUsers.set(user.userId, sockets);

      this.broadcastOnlineUsers();
    } catch {
      client.disconnect();
    }
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
    const sender = client.data.user;

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
