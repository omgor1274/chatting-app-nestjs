import { Test, TestingModule } from '@nestjs/testing';
import { PushNotificationService } from '../notifications/push-notification.service';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            contactPreference: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
              upsert: jest.fn(),
            },
          },
        },
        {
          provide: PushNotificationService,
          useValue: {
            getPublicKey: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
