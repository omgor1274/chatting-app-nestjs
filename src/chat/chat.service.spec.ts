import { Test, TestingModule } from '@nestjs/testing';
import { GroupMemberRole } from '@prisma/client';
import { ChatService } from './chat.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let pushNotifications: {
    notifyUser: jest.Mock;
  };
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    message: {
      findMany: jest.Mock;
    };
    userBlock: {
      findMany: jest.Mock;
    };
    chatRequest: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    contactPreference: {
      findMany: jest.Mock;
    };
    groupMember: {
      update: jest.Mock;
      delete: jest.Mock;
      findMany: jest.Mock;
    };
    group: {
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    pushNotifications = {
      notifyUser: jest.fn(),
    };
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      message: {
        findMany: jest.fn(),
      },
      userBlock: {
        findMany: jest.fn(),
      },
      chatRequest: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      contactPreference: {
        findMany: jest.fn(),
      },
      groupMember: {
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
      group: {
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(async (input) => {
        if (typeof input === 'function') {
          return input(prisma);
        }
        return Promise.all(input);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: PushNotificationService,
          useValue: pushNotifications,
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('promotes the next member to admin when the last admin leaves', async () => {
    jest.spyOn(service as any, 'ensureGroupMember').mockResolvedValue({
      role: GroupMemberRole.ADMIN,
      group: {
        createdById: 'admin-1',
        members: [
          {
            userId: 'admin-1',
            role: GroupMemberRole.ADMIN,
            joinedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            userId: 'member-2',
            role: GroupMemberRole.MEMBER,
            joinedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
      },
    });

    const result = await service.leaveGroup('admin-1', 'group-1');

    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: { createdById: 'member-2' },
    });
    expect(prisma.groupMember.update).toHaveBeenCalledWith({
      where: {
        groupId_userId: {
          groupId: 'group-1',
          userId: 'member-2',
        },
      },
      data: { role: GroupMemberRole.ADMIN },
    });
    expect(result.promotedAdminUserId).toBe('member-2');
  });

  it('allows an admin to promote another member to admin', async () => {
    jest.spyOn(service as any, 'ensureGroupMember').mockResolvedValue({
      role: GroupMemberRole.ADMIN,
      group: {
        members: [
          {
            userId: 'member-2',
            role: GroupMemberRole.MEMBER,
          },
        ],
      },
    });
    jest.spyOn(service, 'getGroupDetails').mockResolvedValue({
      id: 'group-1',
    } as never);

    await service.promoteGroupMember('admin-1', 'group-1', 'member-2');

    expect(prisma.groupMember.update).toHaveBeenCalledWith({
      where: {
        groupId_userId: {
          groupId: 'group-1',
          userId: 'member-2',
        },
      },
      data: {
        role: GroupMemberRole.ADMIN,
      },
    });
  });

  it('returns recent direct chats when the user has no groups', async () => {
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValueOnce([]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-2',
        email: 'user2@example.com',
        name: 'User Two',
        avatar: null,
      },
    ]);
    prisma.contactPreference.findMany.mockResolvedValue([]);

    const result = await service.getRecentChats('user-1');

    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'user-2',
        chatType: 'direct',
        displayName: 'User Two',
      }),
    ]);
  });

  it('treats only the latest pending request as authoritative', async () => {
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.chatRequest.findFirst
      .mockResolvedValueOnce({
        id: 'pending-from-user-2',
        senderId: 'user-2',
        receiverId: 'user-1',
        status: 'PENDING',
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);

    const result = await service.getChatPermission('user-1', 'user-2');

    expect(result).toEqual({
      canChat: false,
      acceptedRequestId: null,
      incomingRequestId: 'pending-from-user-2',
      outgoingRequestId: null,
      blockedByMe: false,
      blockedByUser: false,
    });
  });

  it('does not expose pending state once an accepted request exists', async () => {
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.chatRequest.findFirst
      .mockResolvedValueOnce({
        id: 'stale-pending',
        senderId: 'user-2',
        receiverId: 'user-1',
        status: 'PENDING',
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'accepted-request',
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'ACCEPTED',
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
      });

    const result = await service.getChatPermission('user-1', 'user-2');

    expect(result).toEqual({
      canChat: true,
      acceptedRequestId: 'accepted-request',
      incomingRequestId: null,
      outgoingRequestId: null,
      blockedByMe: false,
      blockedByUser: false,
    });
  });

  it('allows the sender to withdraw a pending request', async () => {
    prisma.chatRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      senderId: 'user-1',
      receiverId: 'user-2',
      status: 'PENDING',
    });
    prisma.chatRequest.update.mockResolvedValue({
      id: 'request-1',
      senderId: 'user-1',
      receiverId: 'user-2',
      status: 'REJECTED',
    });

    const result = await service.withdrawRequest('request-1', 'user-1');

    expect(prisma.chatRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'REJECTED' },
    });
    expect(result).toEqual({
      id: 'request-1',
      senderId: 'user-1',
      receiverId: 'user-2',
      status: 'REJECTED',
    });
  });

  it('sends a push notification when a new chat request is created', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        name: 'Sender',
        email: 'sender@example.com',
      })
      .mockResolvedValueOnce({
        id: 'user-2',
      });
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.chatRequest.findFirst.mockResolvedValue(null);
    prisma.chatRequest.create.mockResolvedValue({
      id: 'request-2',
      senderId: 'user-1',
      receiverId: 'user-2',
      status: 'PENDING',
    });

    const result = await service.sendRequest('user-1', 'receiver@example.com');

    expect(prisma.chatRequest.create).toHaveBeenCalledWith({
      data: {
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'PENDING',
      },
    });
    expect(pushNotifications.notifyUser).toHaveBeenCalledWith('user-2', {
      title: 'New chat request',
      body: 'Sender sent you a chat request',
      tag: 'chat-request-request-2',
      url: '/?chat=user-1',
    });
    expect(result).toEqual({
      id: 'request-2',
      senderId: 'user-1',
      receiverId: 'user-2',
      status: 'PENDING',
    });
  });
});
