import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let chatService: {
    createEncryptedMessage: jest.Mock;
    prepareRealtimeMessage: jest.Mock;
    persistPreparedMessage: jest.Mock;
    assertUsersCanChat: jest.Mock;
  };

  beforeEach(async () => {
    chatService = {
      createEncryptedMessage: jest.fn(),
      prepareRealtimeMessage: jest.fn(),
      persistPreparedMessage: jest.fn(),
      assertUsersCanChat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
          },
        },
        {
          provide: ChatService,
          useValue: chatService,
        },
        {
          provide: PrismaService,
          useValue: {
            groupMember: {
              findMany: jest.fn(),
            },
            user: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    (gateway as any).server = {
      emit: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
    };
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('emits a live presence update when a user connects with their first socket', async () => {
    const client = {
      id: 'socket-1',
      data: {},
      join: jest.fn(),
    } as any;

    jest
      .spyOn(gateway as any, 'authenticateSocketUser')
      .mockResolvedValue({ userId: 'user-1' });
    jest.spyOn(gateway as any, 'markUserOnline').mockResolvedValue(undefined);
    jest
      .spyOn(gateway as any, 'publishPresenceUpdate')
      .mockResolvedValue(undefined);
    jest
      .spyOn(gateway as any, 'broadcastOnlineUsers')
      .mockResolvedValue(undefined);

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('user-1');
    expect((gateway as any).server.emit).toHaveBeenCalledWith(
      'presence:update',
      {
        userId: 'user-1',
        isOnline: true,
      },
    );
    expect((gateway as any).publishPresenceUpdate).toHaveBeenCalledWith({
      userId: 'user-1',
      isOnline: true,
    });
  });

  it('emits a live presence update when a user disconnects their last socket', async () => {
    const client = {
      id: 'socket-1',
      data: {
        user: {
          userId: 'user-1',
        },
      },
    } as any;

    (gateway as any).onlineUsers.set('user-1', new Set(['socket-1']));
    jest.spyOn(gateway as any, 'markUserOffline').mockResolvedValue(undefined);
    jest
      .spyOn(gateway as any, 'publishPresenceUpdate')
      .mockResolvedValue(undefined);
    jest
      .spyOn(gateway as any, 'broadcastOnlineUsers')
      .mockResolvedValue(undefined);

    await gateway.handleDisconnect(client);

    expect((gateway as any).server.emit).toHaveBeenCalledWith(
      'presence:update',
      {
        userId: 'user-1',
        isOnline: false,
      },
    );
    expect((gateway as any).publishPresenceUpdate).toHaveBeenCalledWith({
      userId: 'user-1',
      isOnline: false,
    });
  });

  it('emits a live realtime draft immediately and commits it after persistence', async () => {
    const client = {
      id: 'socket-1',
      data: {
        user: {
          userId: 'sender-1',
          tokenVersion: 1,
        },
      },
    } as any;

    const preparedMessage = {
      draftMessage: {
        id: 'live-1',
        senderId: 'sender-1',
        receiverId: 'receiver-1',
      },
      persistence: {
        recipientIds: ['receiver-1'],
      },
    };
    const savedMessage = {
      id: 'message-1',
      senderId: 'sender-1',
      receiverId: 'receiver-1',
    };

    jest
      .spyOn(gateway as any, 'getAuthorizedUser')
      .mockResolvedValue({ userId: 'sender-1' });
    chatService.prepareRealtimeMessage.mockResolvedValue(preparedMessage);
    chatService.persistPreparedMessage.mockResolvedValue(savedMessage);
    jest
      .spyOn(gateway, 'emitMessageToConversation')
      .mockResolvedValue(undefined);
    const commitSpy = jest.spyOn(gateway as any, 'emitRealtimeMessageCommit');

    const response = await gateway.handleMessage(
      {
        realtimeId: 'live-1',
        toUserId: 'receiver-1',
        ciphertext: 'ciphertext',
        encryptedKey: '{"receiver-1":"wrapped"}',
        iv: 'iv',
        algorithm: 'AES-GCM',
        messageType: 'TEXT' as any,
      },
      client,
    );

    expect(response).toEqual({
      accepted: true,
      tempId: 'live-1',
    });
    expect(gateway.emitMessageToConversation).toHaveBeenCalledWith(
      preparedMessage.draftMessage,
      {
        includeSenderReceipt: false,
        recipientUserIds: ['receiver-1'],
      },
    );

    await Promise.resolve();

    expect(chatService.persistPreparedMessage).toHaveBeenCalledWith(
      preparedMessage.persistence,
    );
    expect(commitSpy).toHaveBeenCalledWith(
      'live-1',
      ['receiver-1'],
      savedMessage,
    );
  });
});
