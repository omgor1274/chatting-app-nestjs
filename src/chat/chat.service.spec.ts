import { Test, TestingModule } from '@nestjs/testing';
import { GroupMemberRole, MessageType } from '@prisma/client';
import { ChatService } from './chat.service';
import { ChatAttachmentStorageService } from './chat-attachment-storage.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let pushNotifications: {
    notifyUser: jest.Mock;
  };
  let attachmentStorage: {
    deleteAttachment: jest.Mock;
  };
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    message: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
    userBlock: {
      findMany: jest.Mock;
    };
    chatRequest: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
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
    attachmentStorage = {
      deleteAttachment: jest.fn(),
    };
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      message: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      userBlock: {
        findMany: jest.fn(),
      },
      chatRequest: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
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
          provide: ChatAttachmentStorageService,
          useValue: attachmentStorage,
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

  it('retries large attachment inserts without file size when a legacy int column rejects them', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'sender-1',
        name: 'Sender',
        email: 'sender@example.com',
      })
      .mockResolvedValueOnce({
        id: 'receiver-1',
      });

    jest.spyOn(service, 'assertUsersCanChat').mockResolvedValue(undefined);

    prisma.message.create
      .mockRejectedValueOnce(
        new Error(
          'Unable to fit integer value into an INT4 column for fileSize',
        ),
      )
      .mockResolvedValueOnce({
        id: 'message-1',
        senderId: 'sender-1',
        receiverId: 'receiver-1',
        groupId: null,
        messageType: MessageType.DOCUMENT,
        fileUrl: '/uploads/chat/video.mkv',
        fileName: 'video.mkv',
        fileMimeType: 'video/x-matroska',
        fileSize: null,
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
        readAt: null,
      });

    const result = await service.createEncryptedMessage({
      senderId: 'sender-1',
      receiverId: 'receiver-1',
      fileUrl: '/uploads/chat/video.mkv',
      fileName: 'video.mkv',
      fileMimeType: 'video/x-matroska',
      fileSize: 10n * 1024n * 1024n * 1024n,
      messageType: MessageType.DOCUMENT,
    });

    expect(prisma.message.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          fileSize: 10n * 1024n * 1024n * 1024n,
        }),
      }),
    );
    expect(prisma.message.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          fileSize: null,
        }),
      }),
    );
    expect(result.fileSize).toBeNull();
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
    prisma.chatRequest.findMany.mockResolvedValue([
      {
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'ACCEPTED',
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
      },
    ]);
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
        lastMessagePreview: 'Chat request accepted',
      }),
    ]);
  });

  it('does not return unrelated users without an accepted request or message history', async () => {
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValueOnce([]);
    prisma.chatRequest.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.contactPreference.findMany.mockResolvedValue([]);

    const result = await service.getRecentChats('user-1');

    expect(result).toEqual([]);
  });

  it('returns pending direct requests in the recent chat list until they are resolved', async () => {
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValueOnce([]);
    prisma.chatRequest.findMany.mockResolvedValue([
      {
        senderId: 'user-2',
        receiverId: 'user-1',
        status: 'PENDING',
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
      },
    ]);
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

    expect(result).toEqual([
      expect.objectContaining({
        id: 'user-2',
        chatType: 'direct',
        displayName: 'User Two',
        lastMessagePreview: 'Sent you a chat request',
        lastMessageAt: '2026-03-24T00:00:00.000Z',
      }),
    ]);
  });

  it('hides direct chats when either side has blocked the other user', async () => {
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'user-1', blockedUserId: 'user-2' },
      { blockerId: 'user-3', blockedUserId: 'user-1' },
    ]);
    prisma.groupMember.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValueOnce([]);
    prisma.chatRequest.findMany.mockResolvedValue([
      {
        senderId: 'user-1',
        receiverId: 'user-2',
        status: 'ACCEPTED',
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
      },
      {
        senderId: 'user-3',
        receiverId: 'user-1',
        status: 'PENDING',
        createdAt: new Date('2026-03-23T00:00:00.000Z'),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.contactPreference.findMany.mockResolvedValue([]);

    await service.getRecentChats('user-1');

    expect(prisma.user.findMany).not.toHaveBeenCalled();
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
