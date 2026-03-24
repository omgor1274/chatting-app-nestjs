import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { MessageType } from '@prisma/client';
import { ChatUploadService } from './chat-upload.service';
import { CHAT_UPLOAD_CHUNK_SIZE_BYTES } from './chat-upload.constants';

describe('ChatUploadService', () => {
  let tempDir: string;
  let service: ChatUploadService;
  let prisma: {
    groupMember: {
      findUnique: jest.Mock;
    };
  };
  let chatService: {
    assertUsersCanChat: jest.Mock;
    createEncryptedMessage: jest.Mock;
  };
  let attachmentStorage: {
    isR2Enabled: jest.Mock;
    createMultipartUpload: jest.Mock;
    createMultipartPartUploadUrl: jest.Mock;
    completeMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    deleteAttachment: jest.Mock;
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ochat-upload-'));
    process.env.APP_DATA_DIR = tempDir;

    prisma = {
      groupMember: {
        findUnique: jest.fn(),
      },
    };
    chatService = {
      assertUsersCanChat: jest.fn().mockResolvedValue(undefined),
      createEncryptedMessage: jest.fn().mockResolvedValue({
        id: 'message-1',
        messageType: MessageType.DOCUMENT,
      }),
    };
    attachmentStorage = {
      isR2Enabled: jest.fn().mockReturnValue(true),
      createMultipartUpload: jest.fn().mockResolvedValue({
        key: 'chat/user-1/video.mp4',
        uploadId: 'upload-1',
        fileUrl: 'https://cdn.example.com/chat/user-1/video.mp4',
        storageProvider: 'cloudflare-r2',
      }),
      createMultipartPartUploadUrl: jest
        .fn()
        .mockResolvedValueOnce({
          uploadUrl: 'https://signed.example.com/part-1',
          partNumber: 1,
          headers: {},
        })
        .mockResolvedValueOnce({
          uploadUrl: 'https://signed.example.com/part-2',
          partNumber: 2,
          headers: {},
        }),
      completeMultipartUpload: jest.fn().mockResolvedValue({
        fileUrl: 'https://cdn.example.com/chat/user-1/video.mp4',
        storageProvider: 'cloudflare-r2',
      }),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      deleteAttachment: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChatUploadService(
      prisma as never,
      chatService as never,
      attachmentStorage as never,
    );
  });

  afterEach(async () => {
    delete process.env.APP_DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and finalizes an R2 multipart upload session', async () => {
    const session = await service.createSession('user-1', {
      receiverId: 'user-2',
      fileName: 'video.mp4',
      fileMimeType: 'video/mp4',
      fileSize: CHAT_UPLOAD_CHUNK_SIZE_BYTES + 1024,
    });

    expect(session.uploadTransport).toBe('presigned-put');
    expect(session.storageProvider).toBe('cloudflare-r2');

    const firstPart = await service.prepareChunkUpload(
      session.sessionId,
      'user-1',
      0,
    );
    expect(firstPart.uploadUrl).toBe('https://signed.example.com/part-1');

    let nextState = await service.completeChunkUpload(
      session.sessionId,
      'user-1',
      0,
      {
        etag: '"etag-1"',
        size: CHAT_UPLOAD_CHUNK_SIZE_BYTES,
      },
    );
    expect(nextState.nextChunkIndex).toBe(1);

    const secondPart = await service.prepareChunkUpload(
      session.sessionId,
      'user-1',
      1,
    );
    expect(secondPart.uploadUrl).toBe('https://signed.example.com/part-2');

    nextState = await service.completeChunkUpload(
      session.sessionId,
      'user-1',
      1,
      {
        etag: '"etag-2"',
        size: 1024,
      },
    );
    expect(nextState.nextChunkIndex).toBeNull();

    await service.finalizeSession(session.sessionId, 'user-1');

    expect(attachmentStorage.completeMultipartUpload).toHaveBeenCalledWith({
      key: 'chat/user-1/video.mp4',
      uploadId: 'upload-1',
      parts: [
        { partNumber: 1, etag: '"etag-1"', size: CHAT_UPLOAD_CHUNK_SIZE_BYTES },
        { partNumber: 2, etag: '"etag-2"', size: 1024 },
      ],
    });
    expect(chatService.createEncryptedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: 'user-1',
        receiverId: 'user-2',
        fileUrl: 'https://cdn.example.com/chat/user-1/video.mp4',
        fileName: 'video.mp4',
        fileMimeType: 'video/mp4',
        fileSize: CHAT_UPLOAD_CHUNK_SIZE_BYTES + 1024,
      }),
    );
  });

  it('aborts an R2 multipart upload when the session is cancelled', async () => {
    const session = await service.createSession('user-1', {
      receiverId: 'user-2',
      fileName: 'video.mp4',
      fileMimeType: 'video/mp4',
      fileSize: CHAT_UPLOAD_CHUNK_SIZE_BYTES,
    });

    await service.cancelSession(session.sessionId, 'user-1');

    expect(attachmentStorage.abortMultipartUpload).toHaveBeenCalledWith({
      key: 'chat/user-1/video.mp4',
      uploadId: 'upload-1',
    });
  });
});
