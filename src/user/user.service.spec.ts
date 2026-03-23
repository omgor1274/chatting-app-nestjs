import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
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
    };
    userBlock: {
      findMany: jest.Mock;
    };
    contactPreference: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      upsert: jest.Mock;
    };
    chatRequest: {
      findFirst: jest.Mock;
    };
    authToken: {
      deleteMany: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      userBlock: {
        findMany: jest.fn(),
      },
      contactPreference: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
      },
      chatRequest: {
        findFirst: jest.fn(),
      },
      authToken: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
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
      ],
    }).compile();

    service = module.get<UserService>(UserService);
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
});
