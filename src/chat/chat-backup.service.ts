import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { MessageType } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { PrismaService } from '../prisma/prisma.service';
import { resolveWritableDataPath } from '../common/app-paths';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ChatBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatBackupService.name);
  private backupTimeout?: NodeJS.Timeout;
  private readonly metadataPath = resolveWritableDataPath(
    'backups',
    'backup-meta.json',
  );
  private readonly backupDir = resolveWritableDataPath('backups');

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    mkdirSync(this.backupDir, { recursive: true });
    if (!this.isBackupEnabled()) {
      this.logger.log('Chat backups are disabled via CHAT_BACKUPS_ENABLED.');
      return;
    }

    this.configureCloudinary();
    await this.scheduleNextBackup();
  }

  onModuleDestroy() {
    if (this.backupTimeout) {
      clearTimeout(this.backupTimeout);
    }
  }

  private readLastBackupAt() {
    if (!existsSync(this.metadataPath)) {
      return 0;
    }

    try {
      const metadata = JSON.parse(readFileSync(this.metadataPath, 'utf-8'));
      return new Date(metadata.lastBackupAt).getTime() || 0;
    } catch {
      return 0;
    }
  }

  private persistLastBackupAt(metadata: {
    lastBackupAt: string;
    backupPath?: string | null;
    cloudBackupUrl?: string | null;
    cloudBackupPublicId?: string | null;
  }) {
    writeFileSync(
      this.metadataPath,
      JSON.stringify(metadata, null, 2),
      'utf-8',
    );
  }

  private configureCloudinary() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (!cloudName || !apiKey || !apiSecret) {
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  private isBackupEnabled() {
    const value = process.env.CHAT_BACKUPS_ENABLED?.trim().toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(value ?? '');
  }

  private isCloudBackupEnabled() {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim(),
    );
  }

  private async uploadBackupToCloudinary(backupPath: string) {
    const folder =
      process.env.CLOUDINARY_BACKUP_FOLDER?.trim() || 'chat-backups';
    const uploaded = await cloudinary.uploader.upload(backupPath, {
      resource_type: 'raw',
      folder,
      use_filename: true,
      unique_filename: true,
      overwrite: false,
    });

    return {
      secureUrl: uploaded.secure_url,
      publicId: uploaded.public_id,
    };
  }

  private shouldIncludeMessageInBackup(
    message: {
      messageType: MessageType;
      fileMimeType?: string | null;
      senderId: string;
      receiverId?: string | null;
    },
    settingsByUserId: Map<
      string,
      {
        backupImages: boolean;
        backupVideos: boolean;
        backupFiles: boolean;
      }
    >,
  ) {
    if (!message.receiverId) {
      return false;
    }

    const senderSettings = settingsByUserId.get(message.senderId);
    const receiverSettings = settingsByUserId.get(message.receiverId);
    if (!senderSettings || !receiverSettings) {
      return false;
    }

    if (message.messageType === MessageType.IMAGE) {
      return senderSettings.backupImages && receiverSettings.backupImages;
    }

    const isVideo = message.fileMimeType?.startsWith('video/');
    if (isVideo) {
      return senderSettings.backupVideos && receiverSettings.backupVideos;
    }

    if (
      message.messageType === MessageType.AUDIO ||
      message.messageType === MessageType.DOCUMENT
    ) {
      return senderSettings.backupFiles && receiverSettings.backupFiles;
    }

    return true;
  }

  private async scheduleNextBackup() {
    const lastBackupAt = this.readLastBackupAt();
    const now = Date.now();
    const elapsed = now - lastBackupAt;

    if (!lastBackupAt || elapsed >= ONE_WEEK_MS) {
      await this.backupChats();
    }

    const nextDelay = Math.max(
      ONE_WEEK_MS - (Date.now() - this.readLastBackupAt()),
      60_000,
    );

    this.backupTimeout = setTimeout(async () => {
      await this.backupChats();
      await this.scheduleNextBackup();
    }, nextDelay);
  }

  async backupChats() {
    if (!this.isBackupEnabled()) {
      return {
        backupPath: null,
        cloudBackupUrl: null,
        cloudBackupPublicId: null,
      };
    }

    const backupEnabledUsers = await this.prisma.user.findMany({
      where: { backupEnabled: true },
      select: {
        id: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
      },
    });

    const enabledUserIds = backupEnabledUsers.map((user) => user.id);
    const settingsByUserId = new Map(
      backupEnabledUsers.map((user) => [
        user.id,
        {
          backupImages: user.backupImages,
          backupVideos: user.backupVideos,
          backupFiles: user.backupFiles,
        },
      ]),
    );

    const [allMessages, requests] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          senderId: { in: enabledUserIds },
          receiverId: { in: enabledUserIds },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.chatRequest.findMany({
        where: {
          senderId: { in: enabledUserIds },
          receiverId: { in: enabledUserIds },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const messages = allMessages.filter((message) =>
      this.shouldIncludeMessageInBackup(message, settingsByUserId),
    );

    const backupTimestamp = new Date().toISOString();
    const backupPath = join(
      this.backupDir,
      `chat-backup-${backupTimestamp.replace(/[:.]/g, '-')}.json`,
    );

    writeFileSync(
      backupPath,
      JSON.stringify(
        {
          generatedAt: backupTimestamp,
          messages,
          requests,
        },
        null,
        2,
      ),
      'utf-8',
    );

    let cloudBackupUrl: string | null = null;
    let cloudBackupPublicId: string | null = null;

    if (this.isCloudBackupEnabled()) {
      try {
        const uploaded = await this.uploadBackupToCloudinary(backupPath);
        cloudBackupUrl = uploaded.secureUrl;
        cloudBackupPublicId = uploaded.publicId;
        this.logger.log(
          `Weekly chat backup uploaded to Cloudinary: ${cloudBackupUrl}`,
        );
        try {
          unlinkSync(backupPath);
        } catch {
          this.logger.warn(
            `Cloud backup uploaded, but local temp file could not be deleted: ${backupPath}`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown Cloudinary upload error';
        this.logger.warn(
          `Cloud backup upload failed. Kept local backup at ${backupPath}. ${message}`,
        );
      }
    } else {
      this.logger.log(`Weekly chat backup created locally at ${backupPath}`);
    }

    this.persistLastBackupAt({
      lastBackupAt: backupTimestamp,
      backupPath: cloudBackupUrl ? null : backupPath,
      cloudBackupUrl,
      cloudBackupPublicId,
    });

    return {
      backupPath: cloudBackupUrl ? null : backupPath,
      cloudBackupUrl,
      cloudBackupPublicId,
    };
  }
}
