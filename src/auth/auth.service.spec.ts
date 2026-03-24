import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
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
  let jwtService: {
    sign: jest.Mock;
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

    jwtService = {
      sign: jest.fn(() => 'signed-token'),
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
          useValue: jwtService,
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

  it('registers new users in a pending approval state', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: false,
      approvedAt: null,
      isBanned: false,
      bannedAt: null,
      pendingEmail: null,
      backupEnabled: true,
      backupImages: true,
      backupVideos: true,
      backupFiles: true,
      darkMode: false,
      tokenVersion: 0,
    });

    const result = await service.register({
      name: 'User',
      email: 'user@example.com',
      password: 'secret123',
    });

    expect(result.token).toBeUndefined();
    expect(result.approvalRequired).toBe(true);
    expect(result.user.isApproved).toBe(false);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('logs in approved users and returns an auth token', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      password: await bcrypt.hash('secret123', 10),
      name: 'User',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: true,
      approvedAt: new Date('2026-03-24T00:00:00.000Z'),
      isBanned: false,
      bannedAt: null,
      pendingEmail: null,
      backupEnabled: true,
      backupImages: true,
      backupVideos: true,
      backupFiles: true,
      darkMode: false,
      tokenVersion: 0,
    });

    const result = await service.login('user@example.com', 'secret123');

    expect(result.token).toBe('signed-token');
    expect(result.user.role).toBe('USER');
    expect(jwtService.sign).toHaveBeenCalled();
  });

  it('blocks login while a user is waiting for admin approval', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      password: await bcrypt.hash('secret123', 10),
      name: 'User',
      avatar: null,
      role: 'USER',
      emailVerified: true,
      isApproved: false,
      approvedAt: null,
      isBanned: false,
      bannedAt: null,
      pendingEmail: null,
      backupEnabled: true,
      backupImages: true,
      backupVideos: true,
      backupFiles: true,
      darkMode: false,
      tokenVersion: 0,
    });

    await expect(
      service.login('user@example.com', 'secret123'),
    ).rejects.toThrow('waiting for admin approval');
  });

  it('rejects password reset when email recovery is disabled', async () => {
    await expect(
      service.requestPasswordReset('user@example.com'),
    ).rejects.toThrow('Password reset by email is disabled');
  });
});
