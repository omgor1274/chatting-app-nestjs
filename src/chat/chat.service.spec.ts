import { Test, TestingModule } from '@nestjs/testing';
import { GroupMemberRole } from '@prisma/client';
import { ChatService } from './chat.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
    chatRequest: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    groupMember: {
      update: jest.Mock;
      delete: jest.Mock;
    };
    group: {
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      chatRequest: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      groupMember: {
        update: jest.fn(),
        delete: jest.fn(),
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
          useValue: {
            notifyUser: jest.fn(),
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
});
