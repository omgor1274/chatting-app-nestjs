import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { ChatAttachmentStorageService } from '../chat/chat-attachment-storage.service';
import { MailService } from '../mail/mail.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
    };
    userBlock: {
      findMany: jest.Mock;
    };
    contactPreference: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    chatRequest: {
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
    };
    pushSubscription: {
      deleteMany: jest.Mock;
    };
    message: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    group: {
      findMany: jest.Mock;
    };
    authToken: {
      deleteMany: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let attachmentStorage: {
    deleteAttachment: jest.Mock;
  };
  const originalBootstrapAdminName = process.env.BOOTSTRAP_ADMIN_NAME;
  const originalBootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const originalBootstrapAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  beforeEach(async () => {
    delete process.env.BOOTSTRAP_ADMIN_NAME;
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      userBlock: {
        findMany: jest.fn(),
      },
      contactPreference: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      chatRequest: {
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
      pushSubscription: {
        deleteMany: jest.fn(),
      },
      message: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      group: {
        findMany: jest.fn(),
      },
      authToken: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
    };
    attachmentStorage = {
      deleteAttachment: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: PushNotificationService,
          useValue: {
            getPublicKey: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationEmail: jest.fn(),
          },
        },
        {
          provide: ChatAttachmentStorageService,
          useValue: attachmentStorage,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterAll(() => {
    if (originalBootstrapAdminName === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_NAME;
    } else {
      process.env.BOOTSTRAP_ADMIN_NAME = originalBootstrapAdminName;
    }

    if (originalBootstrapAdminEmail === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    } else {
      process.env.BOOTSTRAP_ADMIN_EMAIL = originalBootstrapAdminEmail;
    }

    if (originalBootstrapAdminPassword === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    } else {
      process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapAdminPassword;
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('excludes users blocked in either direction from search results', async () => {
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'user-1', blockedUserId: 'user-2' },
      { blockerId: 'user-3', blockedUserId: 'user-1' },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-4',
        email: 'user4@example.com',
        name: 'User Four',
        avatar: null,
        publicKey: null,
      },
    ]);
    prisma.contactPreference.findMany.mockResolvedValue([]);

    const result = await service.searchUsers('user-1');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: expect.objectContaining({
            not: 'user-1',
            notIn: expect.arrayContaining(['user-2', 'user-3']),
          }),
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'user-4',
        displayName: 'User Four',
      }),
    ]);
  });

  it('supports exact user id search for detached chat opens', async () => {
    prisma.userBlock.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-9',
        email: 'user9@example.com',
        name: 'User Nine',
        avatar: null,
        publicKey: null,
      },
    ]);
    prisma.contactPreference.findMany.mockResolvedValue([]);

    const result = await service.searchUsers('user-1', 'user-9');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { id: 'user-9' },
            {
              email: {
                contains: 'user-9',
                mode: 'insensitive',
              },
            },
            {
              name: {
                contains: 'user-9',
                mode: 'insensitive',
              },
            },
          ]),
        }),
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'user-9',
        displayName: 'User Nine',
      }),
    ]);
  });

  it('stores the encrypted private key backup when updating the public key', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user1@example.com',
      pendingEmail: null,
      name: 'User One',
      avatar: null,
      emailVerified: true,
      backupEnabled: true,
      backupImages: true,
      backupVideos: true,
      backupFiles: true,
      darkMode: false,
      publicKey: 'public-key',
      privateKeyBackupCiphertext: 'ciphertext',
      privateKeyBackupIv: 'iv-value',
      publicKeyUpdatedAt: new Date('2026-03-23T00:00:00.000Z'),
    });

    await service.updatePublicKey('user-1', {
      publicKey: 'public-key',
      privateKeyBackupCiphertext: 'ciphertext',
      privateKeyBackupIv: 'iv-value',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          publicKey: 'public-key',
          privateKeyBackupCiphertext: 'ciphertext',
          privateKeyBackupIv: 'iv-value',
        }),
      }),
    );
  });

  it('refreshes the encrypted private key backup when changing password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: await bcrypt.hash('old-password', 10),
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
    });

    await service.changePassword('user-1', {
      currentPassword: 'old-password',
      newPassword: 'new-password',
      privateKeyBackupCiphertext: 'new-ciphertext',
      privateKeyBackupIv: 'new-iv',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          privateKeyBackupCiphertext: 'new-ciphertext',
          privateKeyBackupIv: 'new-iv',
          tokenVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('builds an admin overview with user status counts', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        avatar: null,
        role: 'ADMIN',
        emailVerified: true,
        isApproved: true,
        approvedAt: new Date('2026-03-20T00:00:00.000Z'),
        isBanned: false,
        bannedAt: null,
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
      {
        id: 'user-2',
        email: 'pending@example.com',
        name: 'Pending User',
        avatar: null,
        role: 'USER',
        emailVerified: true,
        isApproved: false,
        approvedAt: null,
        isBanned: false,
        bannedAt: null,
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
      },
      {
        id: 'user-3',
        email: 'banned@example.com',
        name: 'Banned User',
        avatar: null,
        role: 'USER',
        emailVerified: true,
        isApproved: true,
        approvedAt: new Date('2026-03-22T00:00:00.000Z'),
        isBanned: true,
        bannedAt: new Date('2026-03-23T00:00:00.000Z'),
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
        updatedAt: new Date('2026-03-23T00:00:00.000Z'),
      },
    ]);

    const result = await service.getAdminUserOverview();

    expect(result.summary).toEqual({
      totalUsers: 3,
      adminUsers: 1,
      pendingUsers: 1,
      activeUsers: 1,
      bannedUsers: 1,
    });
    expect(result.users[0].role).toBe('ADMIN');
    expect(result.users[1].status).toBe('pending');
    expect(result.users[2].status).toBe('banned');
  });

  it('bans a non-admin user and invalidates existing sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: true,
      approvedAt: new Date('2026-03-20T00:00:00.000Z'),
      isBanned: false,
      bannedAt: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: true,
      approvedAt: new Date('2026-03-20T00:00:00.000Z'),
      isBanned: true,
      bannedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    });

    const result = await service.banUserByAdmin('admin-1', 'user-2');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-2' },
        data: expect.objectContaining({
          isBanned: true,
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(result.user.isBanned).toBe(true);
  });

  it('allows one admin to remove admin access from another admin', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-2',
      email: 'other-admin@example.com',
      name: 'Other Admin',
      avatar: null,
      role: 'ADMIN',
      emailVerified: true,
      isApproved: true,
      approvedAt: new Date('2026-03-20T00:00:00.000Z'),
      isBanned: false,
      bannedAt: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue({
      id: 'admin-2',
      email: 'other-admin@example.com',
      name: 'Other Admin',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: true,
      approvedAt: new Date('2026-03-20T00:00:00.000Z'),
      isBanned: false,
      bannedAt: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    });

    const result = await service.removeAdminRoleByAdmin('admin-1', 'admin-2');

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: 'ADMIN' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'admin-2' },
        data: expect.objectContaining({
          role: 'USER',
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(result.user.role).toBe('USER');
  });

  it('permanently deletes a user account and cleans stored chat attachments', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'user2@example.com',
      name: 'User Two',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: true,
      approvedAt: new Date('2026-03-20T00:00:00.000Z'),
      isBanned: false,
      bannedAt: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    prisma.group.findMany.mockResolvedValue([]);
    prisma.message.findMany.mockResolvedValue([
      { fileUrl: '/uploads/chat/file-1.png' },
      { fileUrl: '/uploads/chat/file-2.pdf' },
    ]);
    prisma.contactPreference.findMany.mockResolvedValue([
      { chatTheme: null },
    ]);
    prisma.contactPreference.deleteMany.mockResolvedValue({ count: 1 });
    prisma.chatRequest.deleteMany.mockResolvedValue({ count: 0 });
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
    prisma.message.deleteMany.mockResolvedValue({ count: 2 });
    prisma.user.delete.mockResolvedValue({ id: 'user-2' });

    const result = await service.deleteUserPermanentlyByAdmin('admin-1', 'user-2');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-2' },
    });
    expect(attachmentStorage.deleteAttachment).toHaveBeenCalledWith(
      '/uploads/chat/file-1.png',
    );
    expect(attachmentStorage.deleteAttachment).toHaveBeenCalledWith(
      '/uploads/chat/file-2.pdf',
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        deletedUserId: 'user-2',
      }),
    );
  });
});
