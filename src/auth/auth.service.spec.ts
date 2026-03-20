import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
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

  it('registers and immediately returns an auth token', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      avatar: null,
      emailVerified: true,
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

    expect(result.token).toBe('signed-token');
    expect(result.user.emailVerified).toBe(true);
    expect(jwtService.sign).toHaveBeenCalled();
  });

  it('rejects password reset when email recovery is disabled', async () => {
    await expect(
      service.requestPasswordReset('user@example.com'),
    ).rejects.toThrow('Password reset by email is disabled');
  });
});
