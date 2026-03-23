import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;

  beforeEach(async () => {
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
          useValue: {
            createEncryptedMessage: jest.fn(),
            assertUsersCanChat: jest.fn(),
          },
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
});
