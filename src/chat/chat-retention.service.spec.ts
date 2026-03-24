import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChatAttachmentStorageService } from './chat-attachment-storage.service';
import { ChatRetentionService } from './chat-retention.service';

describe('ChatRetentionService', () => {
  let tempDir: string;
  let service: ChatRetentionService;
  let nowSpy: jest.SpyInstance<number, []>;
  let registeredCronJob:
    | {
        stop: () => void;
      }
    | undefined;
  let prisma: {
    message: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    contactPreference: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let attachmentStorage: {
    deleteAttachment: jest.Mock;
  };
  let schedulerRegistry: {
    addCronJob: jest.Mock;
    getCronJob: jest.Mock;
    deleteCronJob: jest.Mock;
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ochat-retention-'));
    process.env.APP_DATA_DIR = tempDir;
    process.env.CHAT_RETENTION_ENABLED = 'true';
    process.env.CHAT_RETENTION_DAYS = '7';
    process.env.CHAT_RETENTION_CRON = '0 * * * *';

    prisma = {
      message: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      contactPreference: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    attachmentStorage = {
      deleteAttachment: jest.fn().mockResolvedValue(undefined),
    };
    schedulerRegistry = {
      addCronJob: jest.fn((_: string, job: { stop: () => void }) => {
        registeredCronJob = job;
      }),
      getCronJob: jest.fn(() => {
        if (!registeredCronJob) {
          throw new Error('Cron job not found');
        }

        return registeredCronJob;
      }),
      deleteCronJob: jest.fn(() => {
        registeredCronJob = undefined;
      }),
    };

    service = new ChatRetentionService(
      prisma as never,
      attachmentStorage as never,
      schedulerRegistry as never,
    );
    nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-03-24T12:00:00.000Z').getTime());
  });

  afterEach(async () => {
    service.onModuleDestroy();
    registeredCronJob?.stop();
    nowSpy.mockRestore();
    delete process.env.APP_DATA_DIR;
    delete process.env.CHAT_RETENTION_ENABLED;
    delete process.env.CHAT_RETENTION_DAYS;
    delete process.env.CHAT_RETENTION_CRON;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('deletes chat messages and attachments older than the retention window', async () => {
    prisma.message.findMany
      .mockResolvedValueOnce([
        {
          id: 'expired-file',
          fileUrl: 'https://cdn.example.com/chat/user-1/video.mp4',
        },
        {
          id: 'expired-text',
          fileUrl: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.message.deleteMany.mockResolvedValue({ count: 2 });
    prisma.contactPreference.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.cleanupExpiredMessages();

    expect(prisma.message.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          createdAt: {
            lt: new Date('2026-03-17T12:00:00.000Z'),
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          fileUrl: true,
        },
      }),
    );
    expect(attachmentStorage.deleteAttachment).toHaveBeenCalledWith(
      'https://cdn.example.com/chat/user-1/video.mp4',
    );
    expect(prisma.message.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['expired-file', 'expired-text'] },
      },
    });
    expect(result).toEqual({
      cutoff: new Date('2026-03-17T12:00:00.000Z'),
      deletedMessageCount: 2,
      deletedAttachmentCount: 1,
      clearedThemePreferenceCount: 0,
      deletedThemeFileCount: 0,
    });
  });

  it('keeps expired file messages in the database when attachment deletion fails', async () => {
    prisma.message.findMany
      .mockResolvedValueOnce([
        {
          id: 'expired-file',
          fileUrl: 'https://cdn.example.com/chat/user-1/video.mp4',
        },
        {
          id: 'expired-text',
          fileUrl: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.message.deleteMany.mockResolvedValue({ count: 1 });
    prisma.contactPreference.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    attachmentStorage.deleteAttachment.mockRejectedValueOnce(
      new Error('R2 delete failed'),
    );

    const result = await service.cleanupExpiredMessages();

    expect(prisma.message.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['expired-text'] },
      },
    });
    expect(result).toEqual({
      cutoff: new Date('2026-03-17T12:00:00.000Z'),
      deletedMessageCount: 1,
      deletedAttachmentCount: 0,
      clearedThemePreferenceCount: 0,
      deletedThemeFileCount: 0,
    });
  });

  it('clears expired uploaded chat themes but keeps user avatar data untouched', async () => {
    const themeDir = join(tempDir, 'uploads', 'chat-themes');
    await mkdir(themeDir, { recursive: true });

    const expiredThemePath = join(themeDir, 'expired-theme.png');
    const orphanThemePath = join(themeDir, 'orphan-theme.png');
    const currentThemePath = join(themeDir, 'current-theme.png');
    await writeFile(expiredThemePath, 'expired-theme');
    await writeFile(orphanThemePath, 'orphan-theme');
    await writeFile(currentThemePath, 'current-theme');

    const oldTimestamp = new Date('2026-03-10T12:00:00.000Z');
    await utimes(expiredThemePath, oldTimestamp, oldTimestamp);
    await utimes(orphanThemePath, oldTimestamp, oldTimestamp);
    await utimes(currentThemePath, oldTimestamp, oldTimestamp);

    prisma.message.findMany.mockResolvedValueOnce([]);
    prisma.contactPreference.findMany
      .mockResolvedValueOnce([
        {
          id: 'pref-1',
          nickname: 'Friend',
          chatTheme: '/uploads/chat-themes/expired-theme.png',
        },
        {
          id: 'pref-2',
          nickname: null,
          chatTheme: '/uploads/chat-themes/delete-me.png',
        },
      ])
      .mockResolvedValueOnce([
        {
          chatTheme: '/uploads/chat-themes/current-theme.png',
        },
      ]);
    prisma.contactPreference.updateMany.mockResolvedValue({ count: 1 });
    prisma.contactPreference.deleteMany.mockResolvedValue({ count: 1 });

    await writeFile(join(themeDir, 'delete-me.png'), 'delete-me');
    await utimes(join(themeDir, 'delete-me.png'), oldTimestamp, oldTimestamp);

    const result = await service.cleanupExpiredMessages();

    expect(prisma.contactPreference.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['pref-1'] },
      },
      data: {
        chatTheme: null,
      },
    });
    expect(prisma.contactPreference.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['pref-2'] },
      },
    });
    await expect(access(expiredThemePath)).rejects.toBeDefined();
    await expect(access(join(themeDir, 'delete-me.png'))).rejects.toBeDefined();
    await expect(access(orphanThemePath)).rejects.toBeDefined();
    await expect(access(currentThemePath)).resolves.toBeUndefined();
    expect(result).toEqual({
      cutoff: new Date('2026-03-17T12:00:00.000Z'),
      deletedMessageCount: 0,
      deletedAttachmentCount: 0,
      clearedThemePreferenceCount: 2,
      deletedThemeFileCount: 3,
    });
  });

  it('registers a cron job and runs cleanup on startup', async () => {
    const cleanupSpy = jest
      .spyOn(service, 'cleanupExpiredMessages')
      .mockResolvedValue({
        cutoff: new Date('2026-03-17T12:00:00.000Z'),
        deletedMessageCount: 0,
        deletedAttachmentCount: 0,
        clearedThemePreferenceCount: 0,
        deletedThemeFileCount: 0,
      });

    service.onModuleInit();
    await Promise.resolve();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
      'chat-retention-cleanup',
      expect.any(Object),
    );
    expect(cleanupSpy).toHaveBeenCalled();
  });
});
