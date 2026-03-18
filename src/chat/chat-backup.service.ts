import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ChatBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatBackupService.name);
  private backupTimeout?: NodeJS.Timeout;
  private readonly metadataPath = join(process.cwd(), 'backups', 'backup-meta.json');

  constructor(private prisma: PrismaService) { }

  async onModuleInit() {
    mkdirSync(join(process.cwd(), 'backups'), { recursive: true });
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

  private persistLastBackupAt(timestamp: string) {
    writeFileSync(
      this.metadataPath,
      JSON.stringify({ lastBackupAt: timestamp }, null, 2),
      'utf-8',
    );
  }

  private async scheduleNextBackup() {
    const lastBackupAt = this.readLastBackupAt();
    const now = Date.now();
    const elapsed = now - lastBackupAt;

    if (!lastBackupAt || elapsed >= ONE_WEEK_MS) {
      await this.backupChats();
    }

    const nextDelay = Math.max(ONE_WEEK_MS - (Date.now() - this.readLastBackupAt()), 60_000);

    this.backupTimeout = setTimeout(async () => {
      await this.backupChats();
      await this.scheduleNextBackup();
    }, nextDelay);
  }

  async backupChats() {
    const [messages, requests] = await Promise.all([
      this.prisma.message.findMany({
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.chatRequest.findMany({
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const backupTimestamp = new Date().toISOString();
    const backupPath = join(
      process.cwd(),
      'backups',
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

    this.persistLastBackupAt(backupTimestamp);
    this.logger.log(`Weekly chat backup created at ${backupPath}`);
    return { backupPath };
  }
}
