import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { readdir, stat, unlink } from 'fs/promises';
import { basename } from 'path';
import { resolveWritableDataPath } from '../common/app-paths';
import { PrismaService } from '../prisma/prisma.service';
import { ChatAttachmentStorageService } from './chat-attachment-storage.service';

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_RETENTION_CRON = '0 * * * *';
const CLEANUP_BATCH_SIZE = 100;
const RETENTION_CRON_JOB_NAME = 'chat-retention-cleanup';

@Injectable()
export class ChatRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRetentionService.name);

  constructor(
    private prisma: PrismaService,
    private chatAttachmentStorage: ChatAttachmentStorageService,
    private schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    if (!this.isRetentionEnabled()) {
      this.logger.log('Chat retention is disabled via CHAT_RETENTION_ENABLED.');
      return;
    }

    const cronExpression = this.getCronExpression();
    this.registerCronJob(cronExpression);
    this.logger.log(
      `Chat retention is enabled. Messages older than ${this.getRetentionDays()} days will be deleted automatically with cron "${cronExpression}".`,
    );
    void this.runCleanupCycle();
  }

  onModuleDestroy() {
    this.deleteCronJobIfRegistered();
  }

  async cleanupExpiredMessages() {
    const cutoff = this.getRetentionCutoff();
    let deletedMessageCount = 0;
    let deletedAttachmentCount = 0;

    while (true) {
      const expiredMessages = await this.prisma.message.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: 'asc' },
        take: CLEANUP_BATCH_SIZE,
        select: {
          id: true,
          fileUrl: true,
        },
      });

      if (!expiredMessages.length) {
        break;
      }

      const deletableMessageIds: string[] = [];

      for (const message of expiredMessages) {
        if (message.fileUrl) {
          try {
            await this.chatAttachmentStorage.deleteAttachment(message.fileUrl);
            deletedAttachmentCount += 1;
          } catch (error) {
            this.logger.warn(
              `Failed to delete an expired attachment for message ${message.id}. ${this.formatError(error)}`,
            );
            continue;
          }
        }

        deletableMessageIds.push(message.id);
      }

      if (!deletableMessageIds.length) {
        this.logger.warn(
          'Expired chat cleanup skipped a full batch because attachment deletion failed for every expired file in that batch.',
        );
        break;
      }

      const deletedMessages = await this.prisma.message.deleteMany({
        where: {
          id: { in: deletableMessageIds },
        },
      });

      deletedMessageCount += deletedMessages.count;

      if (expiredMessages.length < CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    const { clearedThemePreferenceCount, deletedThemeFileCount } =
      await this.cleanupExpiredThemeUploads(cutoff);

    if (
      deletedMessageCount ||
      deletedAttachmentCount ||
      clearedThemePreferenceCount ||
      deletedThemeFileCount
    ) {
      this.logger.log(
        `Deleted ${deletedMessageCount} expired chat messages, ${deletedAttachmentCount} expired chat attachments, cleared ${clearedThemePreferenceCount} expired chat theme preferences, and deleted ${deletedThemeFileCount} old chat theme uploads older than ${this.getRetentionDays()} days.`,
      );
    }

    return {
      cutoff,
      deletedMessageCount,
      deletedAttachmentCount,
      clearedThemePreferenceCount,
      deletedThemeFileCount,
    };
  }

  private async runCleanupCycle() {
    try {
      await this.cleanupExpiredMessages();
    } catch (error) {
      this.logger.error(
        `Chat retention cleanup failed. ${this.formatError(error)}`,
      );
    }
  }

  private registerCronJob(cronExpression: string) {
    this.deleteCronJobIfRegistered();

    const job = CronJob.from({
      cronTime: cronExpression,
      onTick: () => {
        void this.runCleanupCycle();
      },
      start: false,
    });

    this.schedulerRegistry.addCronJob(RETENTION_CRON_JOB_NAME, job);
    job.start();
  }

  private async cleanupExpiredThemeUploads(cutoff: Date) {
    let clearedThemePreferenceCount = 0;
    const themePathsToDelete = new Set<string>();

    while (true) {
      const expiredThemePreferences =
        await this.prisma.contactPreference.findMany({
          where: {
            updatedAt: { lt: cutoff },
            chatTheme: { startsWith: '/uploads/chat-themes/' },
          },
          orderBy: { updatedAt: 'asc' },
          take: CLEANUP_BATCH_SIZE,
          select: {
            id: true,
            nickname: true,
            chatTheme: true,
          },
        });

      if (!expiredThemePreferences.length) {
        break;
      }

      const deletePreferenceIds: string[] = [];
      const clearPreferenceIds: string[] = [];

      for (const preference of expiredThemePreferences) {
        if (preference.chatTheme) {
          themePathsToDelete.add(preference.chatTheme);
        }

        if (preference.nickname) {
          clearPreferenceIds.push(preference.id);
          continue;
        }

        deletePreferenceIds.push(preference.id);
      }

      if (deletePreferenceIds.length) {
        const deletedPreferences =
          await this.prisma.contactPreference.deleteMany({
            where: {
              id: { in: deletePreferenceIds },
            },
          });
        clearedThemePreferenceCount += deletedPreferences.count;
      }

      if (clearPreferenceIds.length) {
        const updatedPreferences =
          await this.prisma.contactPreference.updateMany({
            where: {
              id: { in: clearPreferenceIds },
            },
            data: {
              chatTheme: null,
            },
          });
        clearedThemePreferenceCount += updatedPreferences.count;
      }

      if (expiredThemePreferences.length < CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    let deletedThemeFileCount = await this.deleteThemePaths(themePathsToDelete);
    deletedThemeFileCount += await this.cleanupOrphanedThemeUploads(cutoff);

    return {
      clearedThemePreferenceCount,
      deletedThemeFileCount,
    };
  }

  private isRetentionEnabled() {
    const value = process.env.CHAT_RETENTION_ENABLED?.trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(value ?? '');
  }

  private getRetentionDays() {
    const value = Number(process.env.CHAT_RETENTION_DAYS);
    if (Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.trunc(value));
    }

    return DEFAULT_RETENTION_DAYS;
  }

  private getRetentionCutoff() {
    return new Date(Date.now() - this.getRetentionDays() * 24 * 60 * 60 * 1000);
  }

  private getCronExpression() {
    const configuredCron = process.env.CHAT_RETENTION_CRON?.trim();
    if (!configuredCron) {
      return DEFAULT_RETENTION_CRON;
    }

    try {
      CronJob.from({
        cronTime: configuredCron,
        onTick: () => undefined,
        start: false,
      });
      return configuredCron;
    } catch (error) {
      this.logger.warn(
        `Invalid CHAT_RETENTION_CRON value "${configuredCron}". Falling back to "${DEFAULT_RETENTION_CRON}". ${this.formatError(error)}`,
      );
      return DEFAULT_RETENTION_CRON;
    }
  }

  private async deleteThemePaths(themePaths: Iterable<string>) {
    let deletedThemeFileCount = 0;
    const uniqueFileNames = new Set<string>();

    for (const themePath of themePaths) {
      const fileName = this.extractThemeFileName(themePath);
      if (fileName) {
        uniqueFileNames.add(fileName);
      }
    }

    for (const fileName of uniqueFileNames) {
      if (await this.deleteThemeFile(fileName)) {
        deletedThemeFileCount += 1;
      }
    }

    return deletedThemeFileCount;
  }

  private async cleanupOrphanedThemeUploads(cutoff: Date) {
    const referencedThemes = await this.prisma.contactPreference.findMany({
      where: {
        chatTheme: { startsWith: '/uploads/chat-themes/' },
      },
      select: {
        chatTheme: true,
      },
    });
    const referencedFileNames = new Set(
      referencedThemes
        .map((preference) => this.extractThemeFileName(preference.chatTheme))
        .filter((fileName): fileName is string => Boolean(fileName)),
    );

    let entries: Array<{ name: string; isFile: () => boolean }>;
    try {
      entries = await readdir(
        resolveWritableDataPath('uploads', 'chat-themes'),
        { withFileTypes: true, encoding: 'utf8' },
      );
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return 0;
      }

      throw error;
    }

    let deletedThemeFileCount = 0;
    for (const entry of entries) {
      if (!entry.isFile() || referencedFileNames.has(entry.name)) {
        continue;
      }

      try {
        const fileStats = await stat(
          resolveWritableDataPath('uploads', 'chat-themes', entry.name),
        );
        if (fileStats.mtime.getTime() >= cutoff.getTime()) {
          continue;
        }
      } catch (error) {
        if (this.isMissingFileError(error)) {
          continue;
        }

        throw error;
      }

      if (await this.deleteThemeFile(entry.name)) {
        deletedThemeFileCount += 1;
      }
    }

    return deletedThemeFileCount;
  }

  private extractThemeFileName(themePath?: string | null) {
    const relativePrefix = '/uploads/chat-themes/';
    if (!themePath || !String(themePath).startsWith(relativePrefix)) {
      return null;
    }

    return basename(
      decodeURIComponent(String(themePath).slice(relativePrefix.length)),
    );
  }

  private async deleteThemeFile(fileName: string) {
    try {
      await unlink(resolveWritableDataPath('uploads', 'chat-themes', fileName));
      return true;
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return false;
      }

      this.logger.warn(
        `Failed to delete an expired chat theme upload "${fileName}". ${this.formatError(error)}`,
      );
      return false;
    }
  }

  private deleteCronJobIfRegistered() {
    try {
      const job = this.schedulerRegistry.getCronJob(RETENTION_CRON_JOB_NAME);
      job.stop();
      this.schedulerRegistry.deleteCronJob(RETENTION_CRON_JOB_NAME);
    } catch {
      // No existing cron job to delete.
    }
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private isMissingFileError(error: unknown) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT',
    );
  }
}
