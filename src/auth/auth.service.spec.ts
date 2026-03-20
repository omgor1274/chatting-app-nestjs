import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
    authToken: {
      deleteMany: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let mailService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
    isPreviewMailboxEnabled: jest.Mock;
    getPreviewMailboxPath: jest.Mock;
  };

  beforeEach(async () => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      authToken: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    mailService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
      isPreviewMailboxEnabled: jest.fn(() => true),
      getPreviewMailboxPath: jest.fn(() => 'backups/dev-mailbox.log'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: mailService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    process.env.APP_ORIGIN = 'http://127.0.0.1:3310';
  });

  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns a local otp preview after registration when smtp preview mode is enabled', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      avatar: null,
      emailVerified: false,
      pendingEmail: null,
      backupEnabled: true,
      backupImages: true,
      backupVideos: true,
      backupFiles: true,
      darkMode: false,
    });

    const result = await service.register({
      name: 'User',
      email: 'user@example.com',
      password: 'secret123',
    });

    expect(result.devOtp).toMatch(/^\d{6}$/);
    expect(result.devMailboxPath).toBe('backups/dev-mailbox.log');
    expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
      'user@example.com',
      result.devOtp,
      expect.any(Number),
    );
  });

  it('returns a local otp preview for password reset when smtp preview mode is enabled', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    const result = await service.requestPasswordReset('user@example.com');

    expect(result.devOtp).toMatch(/^\d{6}$/);
    expect(result.devMailboxPath).toBe('backups/dev-mailbox.log');
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'user@example.com',
      result.devOtp,
      expect.any(Number),
    );
  });
});
