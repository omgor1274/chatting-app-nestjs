import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '../mail/mail.service';
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
              findFirst: jest.fn(),
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
});
