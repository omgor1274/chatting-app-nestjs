import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ChatAttachmentStorageService } from './chat-attachment-storage.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatUploadService } from './chat-upload.service';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: {
            getMessages: jest.fn(),
            sendRequest: jest.fn(),
            acceptRequest: jest.fn(),
            rejectRequest: jest.fn(),
            getPendingRequests: jest.fn(),
            createEncryptedMessage: jest.fn(),
          },
        },
        {
          provide: ChatGateway,
          useValue: {
            emitMessageToConversation: jest.fn(),
          },
        },
        {
          provide: ChatUploadService,
          useValue: {
            createSession: jest.fn(),
            getSessionStatus: jest.fn(),
            prepareChunkUpload: jest.fn(),
            completeChunkUpload: jest.fn(),
            uploadChunk: jest.fn(),
            finalizeSession: jest.fn(),
            cancelSession: jest.fn(),
          },
        },
        {
          provide: ChatAttachmentStorageService,
          useValue: {
            storeDirectAttachment: jest.fn(),
            deleteAttachment: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
