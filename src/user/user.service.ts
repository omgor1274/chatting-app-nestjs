import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  AppRole,
  AuthTokenType,
  MessageType,
  User,
  UserReportReason,
  UserReportStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { unlink } from 'fs/promises';
import { basename } from 'path';
import { getBootstrapAdminCredentials } from '../auth/admin.constants';
import { ChatAttachmentStorageService } from '../chat/chat-attachment-storage.service';
import { resolveWritableDataPath } from '../common/app-paths';
import { MailService } from '../mail/mail.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { PrismaService } from '../prisma/prisma.service';

const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_DELETION_GRACE_DAYS = 7;
const RETENTION_DEFAULT_DAYS = 7;
type VerificationTokenType = 'VERIFY_EMAIL' | 'VERIFY_PENDING_EMAIL';
const CHAT_THEME_PRESET_KEYS = new Set([
  'aurora-grid',
  'sunset-circuit',
  'midnight-bloom',
  'paper-wave',
  'neon-signal',
  'copper-noise',
]);

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private prisma: PrismaService,
    private pushNotifications: PushNotificationService,
    private mailService: MailService,
    private chatAttachmentStorage: ChatAttachmentStorageService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) { }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private getUserCacheKeyByEmail(email: string) {
    return `user:email:${this.normalizeEmail(email)}`;
  }

  private getUserCacheKeyById(userId: string) {
    return `user:id:${userId}`;
  }

  private async invalidateUserCache(userId: string, email?: string) {
    const keys = [this.getUserCacheKeyById(userId)];
    if (email) {
      keys.push(this.getUserCacheKeyByEmail(email));
    }
    await Promise.all(keys.map((key) => this.cacheManager.del(key)));
  }

  async findByEmail(email: string): Promise<User | null> {
    const cacheKey = this.getUserCacheKeyByEmail(email);
    const cachedUser = await this.cacheManager.get<User>(cacheKey);
    if (cachedUser) {
      return cachedUser;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
    });

    if (user) {
      await this.cacheManager.set(cacheKey, user, 60);
    }

    return user;
  }

  async findById(userId: string): Promise<User | null> {
    const cacheKey = this.getUserCacheKeyById(userId);
    const cachedUser = await this.cacheManager.get<User>(cacheKey);
    if (cachedUser) {
      return cachedUser;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user) {
      await this.cacheManager.set(cacheKey, user, 60);
    }

    return user;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashOtpToken(scope: string, otp: string) {
    return this.hashToken(`${scope}:${otp}`);
  }

  private verificationScope(
    userId: string,
    type: AuthTokenType,
    email: string,
  ) {
    return `${userId}:${type}:${this.normalizeEmail(email)}`;
  }

  private generateOtpCode() {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async assertEmailAvailable(email: string, exceptUserId?: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const existingUser = await this.prisma.user.findFirst({
      where: {
        id: exceptUserId ? { not: exceptUserId } : undefined,
        OR: [{ email: normalizedEmail }, { pendingEmail: normalizedEmail }],
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException('Email is already in use');
    }
  }

  private serializeProfile(user: {
    id: string;
    email: string;
    pendingEmail?: string | null;
    name: string;
    avatar?: string | null;
    role?: AppRole;
    emailVerified?: boolean;
    isApproved?: boolean;
    approvedAt?: Date | null;
    isBanned?: boolean;
    bannedAt?: Date | null;
    backupEnabled?: boolean;
    backupImages?: boolean;
    backupVideos?: boolean;
    backupFiles?: boolean;
    darkMode?: boolean;
    publicKey?: string | null;
    privateKeyBackupCiphertext?: string | null;
    privateKeyBackupIv?: string | null;
    publicKeyUpdatedAt?: Date | null;
    deletionRequestedAt?: Date | null;
    deletionScheduledFor?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      ...user,
      avatar: user.avatar ?? null,
      pendingEmail: user.pendingEmail ?? null,
      role: user.role ?? AppRole.USER,
      emailVerified: user.emailVerified ?? false,
      isApproved: user.isApproved ?? true,
      approvedAt: user.approvedAt ?? null,
      isBanned: user.isBanned ?? false,
      bannedAt: user.bannedAt ?? null,
      backupEnabled: user.backupEnabled ?? true,
      backupImages: user.backupImages ?? true,
      backupVideos: user.backupVideos ?? true,
      backupFiles: user.backupFiles ?? true,
      darkMode: user.darkMode ?? false,
      publicKey: user.publicKey ?? null,
      privateKeyBackupCiphertext: user.privateKeyBackupCiphertext ?? null,
      privateKeyBackupIv: user.privateKeyBackupIv ?? null,
      publicKeyUpdatedAt: user.publicKeyUpdatedAt ?? null,
      deletionRequestedAt: user.deletionRequestedAt ?? null,
      deletionScheduledFor: user.deletionScheduledFor ?? null,
      isScheduledForDeletion: Boolean(user.deletionScheduledFor),
    };
  }

  private serializeAdminUser(user: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    role: AppRole;
    emailVerified: boolean;
    isApproved: boolean;
    approvedAt?: Date | null;
    isBanned: boolean;
    bannedAt?: Date | null;
    deletionRequestedAt?: Date | null;
    deletionScheduledFor?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const isScheduledForDeletion = Boolean(user.deletionScheduledFor);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar ?? null,
      role: user.role,
      emailVerified: user.emailVerified,
      isApproved: user.isApproved,
      approvedAt: user.approvedAt ?? null,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt ?? null,
      deletionRequestedAt: user.deletionRequestedAt ?? null,
      deletionScheduledFor: user.deletionScheduledFor ?? null,
      isScheduledForDeletion,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isProtectedBootstrapAdmin: this.isProtectedBootstrapAdmin(user.email),
      status: isScheduledForDeletion
        ? 'scheduled-deletion'
        : user.isBanned
          ? 'banned'
          : user.isApproved
            ? 'active'
            : 'pending',
    };
  }

  private previewReportMessage(
    message?: {
      deletedForEveryoneAt?: Date | null;
      messageType?: MessageType | null;
      fileName?: string | null;
      fileMimeType?: string | null;
      content?: string | null;
      ciphertext?: string | null;
    } | null,
  ) {
    if (!message) {
      return null;
    }

    if (message.deletedForEveryoneAt) {
      return 'Message deleted';
    }

    if (message.messageType === MessageType.IMAGE) {
      return 'Image message';
    }

    if (message.messageType === MessageType.AUDIO) {
      return 'Voice message';
    }

    if (
      message.messageType === MessageType.DOCUMENT ||
      message.fileMimeType?.startsWith('video/')
    ) {
      return message.fileMimeType?.startsWith('video/')
        ? 'Video message'
        : message.fileName
          ? `File: ${message.fileName}`
          : 'Document message';
    }

    const rawText = message.content?.trim() || message.ciphertext?.trim() || '';
    if (!rawText) {
      return 'Message';
    }

    return rawText.length > 120 ? `${rawText.slice(0, 117)}...` : rawText;
  }

  private serializeAdminReport(report: {
    id: string;
    reason: UserReportReason;
    details?: string | null;
    status: UserReportStatus;
    adminNote?: string | null;
    handledAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    reporter: {
      id: string;
      name: string;
      email: string;
      avatar?: string | null;
    };
    targetUser?: {
      id: string;
      name: string;
      email: string;
      avatar?: string | null;
      role: AppRole;
      isBanned: boolean;
    } | null;
    group?: {
      id: string;
      name: string;
      avatar?: string | null;
    } | null;
    message?: {
      id: string;
      content?: string | null;
      ciphertext?: string | null;
      messageType?: MessageType | null;
      fileName?: string | null;
      fileMimeType?: string | null;
      deletedForEveryoneAt?: Date | null;
      createdAt: Date;
    } | null;
    handledBy?: {
      id: string;
      name: string;
      email: string;
    } | null;
  }) {
    return {
      id: report.id,
      reason: report.reason,
      details: report.details ?? null,
      status: report.status,
      adminNote: report.adminNote ?? null,
      handledAt: report.handledAt ?? null,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      reporter: {
        id: report.reporter.id,
        name: report.reporter.name,
        email: report.reporter.email,
        avatar: report.reporter.avatar ?? null,
      },
      targetUser: report.targetUser
        ? {
          id: report.targetUser.id,
          name: report.targetUser.name,
          email: report.targetUser.email,
          avatar: report.targetUser.avatar ?? null,
          role: report.targetUser.role,
          isBanned: report.targetUser.isBanned,
        }
        : null,
      group: report.group
        ? {
          id: report.group.id,
          name: report.group.name,
          avatar: report.group.avatar ?? null,
        }
        : null,
      message: report.message
        ? {
          id: report.message.id,
          preview: this.previewReportMessage(report.message),
          createdAt: report.message.createdAt,
        }
        : null,
      handledBy: report.handledBy
        ? {
          id: report.handledBy.id,
          name: report.handledBy.name,
          email: report.handledBy.email,
        }
        : null,
    };
  }

  private getAccountDeletionDeadline(from = new Date()) {
    return new Date(
      from.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  private getRetentionDays() {
    const value = Number(process.env.CHAT_RETENTION_DAYS);
    if (Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.trunc(value));
    }

    return RETENTION_DEFAULT_DAYS;
  }

  private getRetentionCutoff() {
    return new Date(Date.now() - this.getRetentionDays() * 24 * 60 * 60 * 1000);
  }

  private isProtectedBootstrapAdmin(email?: string | null) {
    const bootstrapAdmin = getBootstrapAdminCredentials();
    if (!bootstrapAdmin || !email) {
      return false;
    }

    return this.normalizeEmail(email) === bootstrapAdmin.email;
  }

  private async ensureSelfDeleteAllowed(user: {
    id: string;
    email: string;
    role: AppRole;
  }) {
    if (this.isProtectedBootstrapAdmin(user.email)) {
      throw new BadRequestException(
        'The configured bootstrap admin cannot be scheduled for deletion while BOOTSTRAP_ADMIN_EMAIL is set.',
      );
    }

    if (user.role !== AppRole.ADMIN) {
      return;
    }

    const otherActiveAdminCount = await this.prisma.user.count({
      where: {
        role: AppRole.ADMIN,
        id: { not: user.id },
        deletionScheduledFor: null,
      },
    });

    if (otherActiveAdminCount <= 0) {
      throw new BadRequestException(
        'At least one other active admin account must remain before deleting this account.',
      );
    }
  }

  private async deleteUserPermanentlyInternal(user: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    role: AppRole;
  }) {
    const targetUserId = user.id;
    const groups = await this.prisma.group.findMany({
      where: { createdById: targetUserId },
      select: {
        id: true,
        avatar: true,
      },
    });
    const createdGroupIds = groups.map((group) => group.id);
    const messageDeleteFilters: Array<Record<string, unknown>> = [
      { senderId: targetUserId },
      { receiverId: targetUserId },
    ];

    if (createdGroupIds.length) {
      messageDeleteFilters.push({
        groupId: { in: createdGroupIds },
      });
    }

    const [messages, themePreferences] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          OR: messageDeleteFilters,
        },
        select: {
          fileUrl: true,
        },
      }),
      this.prisma.contactPreference.findMany({
        where: {
          OR: [{ ownerId: targetUserId }, { contactUserId: targetUserId }],
        },
        select: {
          chatTheme: true,
        },
      }),
    ]);

    const attachmentUrls = Array.from(
      new Set(
        messages
          .map((message) => message.fileUrl)
          .filter((fileUrl): fileUrl is string => Boolean(fileUrl)),
      ),
    );
    const themePaths = Array.from(
      new Set(
        themePreferences
          .map((preference) => preference.chatTheme)
          .filter((themePath): themePath is string => Boolean(themePath)),
      ),
    );
    const groupAvatarPaths = Array.from(
      new Set(groups.map((group) => group.avatar).filter(Boolean)),
    );

    await this.prisma.$transaction([
      this.prisma.contactPreference.deleteMany({
        where: {
          OR: [{ ownerId: targetUserId }, { contactUserId: targetUserId }],
        },
      }),
      this.prisma.chatRequest.deleteMany({
        where: {
          OR: [{ senderId: targetUserId }, { receiverId: targetUserId }],
        },
      }),
      this.prisma.pushSubscription.deleteMany({
        where: {
          userId: targetUserId,
        },
      }),
      this.prisma.message.deleteMany({
        where: {
          OR: messageDeleteFilters,
        },
      }),
      this.prisma.user.delete({
        where: {
          id: targetUserId,
        },
      }),
    ]);

    for (const attachmentUrl of attachmentUrls) {
      await this.chatAttachmentStorage
        .deleteAttachment(attachmentUrl)
        .catch((error) => {
          this.logger.warn(
            `Failed to delete a chat attachment for removed user ${targetUserId}. ${error instanceof Error ? error.message : 'Unknown storage error'}`,
          );
        });
    }

    await this.deleteManagedUpload(user.avatar, '/uploads/avatars/', [
      'uploads',
      'avatars',
    ]);

    for (const groupAvatarPath of groupAvatarPaths) {
      await this.deleteManagedUpload(groupAvatarPath, '/uploads/groups/', [
        'uploads',
        'groups',
      ]);
    }

    for (const themePath of themePaths) {
      await this.deleteManagedUpload(themePath, '/uploads/chat-themes/', [
        'uploads',
        'chat-themes',
      ]);
    }

    return {
      success: true,
      deletedUserId: targetUserId,
      message: `Account for ${user.email} was permanently deleted.`,
    };
  }

  private async deleteManagedUpload(
    filePath: string | null | undefined,
    relativePrefix: string,
    storageSegments: string[],
  ) {
    if (!filePath) {
      return false;
    }

    if (/^https?:\/\//i.test(String(filePath))) {
      try {
        await this.chatAttachmentStorage.deleteAttachment(filePath);
        return true;
      } catch (error) {
        this.logger.warn(
          `Failed to delete managed upload "${filePath}". ${error instanceof Error ? error.message : 'Unknown storage error'}`,
        );
        return false;
      }
    }

    if (!String(filePath).startsWith(relativePrefix)) {
      return false;
    }

    const fileName = basename(
      decodeURIComponent(String(filePath).slice(relativePrefix.length)),
    );

    try {
      await unlink(resolveWritableDataPath(...storageSegments, fileName));
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false;
      }

      this.logger.warn(
        `Failed to delete managed upload "${filePath}". ${error instanceof Error ? error.message : 'Unknown filesystem error'}`,
      );
      return false;
    }
  }

  async uploadAvatar(
    userId: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
    },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Avatar file is required');
    }

    const storedAvatar = await this.chatAttachmentStorage.storeUserAvatar({
      buffer: file.buffer,
      fileName: file.originalname,
      fileMimeType: file.mimetype,
      userId,
    });

    return this.updateAvatar(userId, storedAvatar.fileUrl);
  }

  private async ensureContactUser(contactUserId: string, userId: string) {
    if (!contactUserId) {
      throw new BadRequestException('Contact user id is required');
    }

    if (contactUserId === userId) {
      throw new BadRequestException('You cannot update yourself as a contact');
    }

    const contact = await this.findById(contactUserId);

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return contact;
  }

  private async ensureAcceptedConversation(
    userId: string,
    contactUserId: string,
  ) {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedUserId: contactUserId },
          { blockerId: contactUserId, blockedUserId: userId },
        ],
      },
      select: { blockerId: true },
    });

    if (block) {
      throw new ForbiddenException(
        block.blockerId === userId
          ? 'Unblock this user before using this feature'
          : 'This user has blocked you',
      );
    }

    const acceptedRequest = await this.prisma.chatRequest.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          {
            senderId: userId,
            receiverId: contactUserId,
          },
          {
            senderId: contactUserId,
            receiverId: userId,
          },
        ],
      },
      select: { id: true },
    });

    if (!acceptedRequest) {
      throw new ForbiddenException(
        'Accept a chat request before using this feature',
      );
    }
  }

  private async getBlockedUserIds(
    userId: string,
    options: {
      blockedByMe?: boolean;
      blockedMe?: boolean;
    } = { blockedByMe: true, blockedMe: true },
  ) {
    const where: Array<{ blockerId: string } | { blockedUserId: string }> = [];
    if (options.blockedByMe !== false) {
      where.push({ blockerId: userId });
    }
    if (options.blockedMe !== false) {
      where.push({ blockedUserId: userId });
    }
    if (!where.length) {
      return new Set<string>();
    }

    const blocks = await this.prisma.userBlock.findMany({
      where: { OR: where },
      select: {
        blockerId: true,
        blockedUserId: true,
      },
    });

    return new Set(
      blocks.map((block) =>
        block.blockerId === userId ? block.blockedUserId : block.blockerId,
      ),
    );
  }

  private async saveContactPreference(
    userId: string,
    contactUserId: string,
    data: {
      nickname?: string | null;
      chatTheme?: string | null;
    },
  ) {
    const existing = await this.prisma.contactPreference.findUnique({
      where: {
        ownerId_contactUserId: {
          ownerId: userId,
          contactUserId,
        },
      },
    });

    const nextNickname =
      data.nickname !== undefined
        ? data.nickname?.trim() || null
        : (existing?.nickname ?? null);
    const nextTheme =
      data.chatTheme !== undefined
        ? (data.chatTheme ?? null)
        : (existing?.chatTheme ?? null);

    if (!nextNickname && !nextTheme) {
      if (existing) {
        await this.prisma.contactPreference.delete({
          where: {
            ownerId_contactUserId: {
              ownerId: userId,
              contactUserId,
            },
          },
        });
      }

      return {
        nickname: null,
        chatTheme: null,
      };
    }

    const preference = await this.prisma.contactPreference.upsert({
      where: {
        ownerId_contactUserId: {
          ownerId: userId,
          contactUserId,
        },
      },
      update: {
        nickname: nextNickname,
        chatTheme: nextTheme,
      },
      create: {
        ownerId: userId,
        contactUserId,
        nickname: nextNickname,
        chatTheme: nextTheme,
      },
    });

    return {
      nickname: preference.nickname ?? null,
      chatTheme: preference.chatTheme ?? null,
    };
  }

  private async sendVerificationOtp(
    userId: string,
    email: string,
    type: VerificationTokenType,
  ) {
    const normalizedEmail = this.normalizeEmail(email);
    const otp = this.generateOtpCode();

    await this.prisma.authToken.deleteMany({
      where: {
        userId,
        type,
        consumedAt: null,
      },
    });

    await this.prisma.authToken.create({
      data: {
        userId,
        type,
        targetEmail:
          type === AuthTokenType.VERIFY_PENDING_EMAIL ? normalizedEmail : null,
        tokenHash: this.hashOtpToken(
          this.verificationScope(userId, type, normalizedEmail),
          otp,
        ),
        expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
      },
    });

    await this.mailService.sendVerificationEmail(email, otp, EMAIL_OTP_TTL_MS);
  }

  private async getUsableVerificationOtp(
    userId: string,
    type: VerificationTokenType,
    email: string,
    otp: string,
  ) {
    const normalizedEmail = this.normalizeEmail(email);
    const token = await this.prisma.authToken.findFirst({
      where: {
        userId,
        type,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!token || token.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('OTP is invalid or expired');
    }

    const expectedHash = this.hashOtpToken(
      this.verificationScope(userId, type, normalizedEmail),
      otp.trim(),
    );

    if (token.tokenHash !== expectedHash) {
      throw new BadRequestException('OTP is invalid or expired');
    }

    return token;
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.serializeProfile(user);
  }

  async getAdminUserOverview() {
    const retentionCutoff = this.getRetentionCutoff();
    const [
      users,
      acceptedDirectChats,
      groupCount,
      uploadsCount,
      storageUsage,
      expiredMessagesPendingCleanup,
      expiredThemesPendingCleanup,
    ] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          role: true,
          emailVerified: true,
          isApproved: true,
          approvedAt: true,
          isBanned: true,
          bannedAt: true,
          deletionRequestedAt: true,
          deletionScheduledFor: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.chatRequest.count({
        where: {
          status: 'ACCEPTED',
        },
      }),
      this.prisma.group.count(),
      this.prisma.message.count({
        where: {
          fileUrl: { not: null },
        },
      }),
      this.prisma.message.aggregate({
        _sum: {
          fileSize: true,
        },
      }),
      this.prisma.message.count({
        where: {
          createdAt: { lt: retentionCutoff },
        },
      }),
      this.prisma.contactPreference.count({
        where: {
          updatedAt: { lt: retentionCutoff },
          chatTheme: { startsWith: '/uploads/chat-themes/' },
        },
      }),
    ]);

    const serializedUsers = users
      .map((user) => this.serializeAdminUser(user))
      .sort((left, right) => {
        if (left.role === AppRole.ADMIN && right.role !== AppRole.ADMIN) {
          return -1;
        }

        if (left.role !== AppRole.ADMIN && right.role === AppRole.ADMIN) {
          return 1;
        }

        return right.createdAt.getTime() - left.createdAt.getTime();
      });

    const scheduledDeletionUsers = serializedUsers.filter(
      (user) => user.isScheduledForDeletion,
    ).length;

    return {
      summary: {
        totalUsers: serializedUsers.length,
        adminUsers: serializedUsers.filter(
          (user) => user.role === AppRole.ADMIN,
        ).length,
        pendingUsers: serializedUsers.filter(
          (user) => user.status === 'pending',
        ).length,
        activeUsers: serializedUsers.filter((user) => user.status === 'active')
          .length,
        bannedUsers: serializedUsers.filter((user) => user.status === 'banned')
          .length,
        scheduledDeletionUsers,
        activeChats: acceptedDirectChats + groupCount,
        uploadsCount,
        storageUsageBytes: Number(storageUsage._sum.fileSize ?? 0n),
        retentionWindowDays: this.getRetentionDays(),
        expiredMessagesPendingCleanup,
        expiredThemesPendingCleanup,
      },
      users: serializedUsers,
    };
  }

  async approveUserByAdmin(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isApproved: true,
        approvedAt: user.approvedAt ?? new Date(),
        ...(user.isApproved ? {} : { tokenVersion: { increment: 1 } }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: user.isBanned
        ? 'User approved, but the account is still banned until you unban it.'
        : user.isApproved
          ? 'User is already approved.'
          : 'User approved successfully.',
      user: this.serializeAdminUser(updatedUser),
    };
  }

  async banUserByAdmin(adminUserId: string, targetUserId: string) {
    if (adminUserId === targetUserId) {
      throw new BadRequestException('You cannot ban your own admin account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === AppRole.ADMIN) {
      throw new BadRequestException('Admin accounts cannot be banned');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isBanned: true,
        bannedAt: user.bannedAt ?? new Date(),
        ...(user.isBanned ? {} : { tokenVersion: { increment: 1 } }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: user.isBanned
        ? 'User is already banned.'
        : 'User banned successfully.',
      user: this.serializeAdminUser(updatedUser),
    };
  }

  async unbanUserByAdmin(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isBanned: false,
        bannedAt: null,
        ...(user.isBanned ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: user.isBanned
        ? 'User unbanned successfully.'
        : 'User is not banned.',
      user: this.serializeAdminUser(updatedUser),
    };
  }

  async removeAdminRoleByAdmin(adminUserId: string, targetUserId: string) {
    if (adminUserId === targetUserId) {
      throw new BadRequestException(
        'Use another admin account to remove this admin role.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== AppRole.ADMIN) {
      return {
        message: 'User is not an admin.',
        user: this.serializeAdminUser(user),
      };
    }

    if (this.isProtectedBootstrapAdmin(user.email)) {
      throw new BadRequestException(
        'The configured bootstrap admin cannot be removed while BOOTSTRAP_ADMIN_EMAIL is set.',
      );
    }

    const adminCount = await this.prisma.user.count({
      where: { role: AppRole.ADMIN },
    });

    if (adminCount <= 1) {
      throw new BadRequestException('At least one admin account must remain.');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        role: AppRole.USER,
        tokenVersion: { increment: 1 },
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: 'Admin role removed successfully.',
      user: this.serializeAdminUser(updatedUser),
    };
  }

  async deleteUserPermanentlyByAdmin(
    adminUserId: string,
    targetUserId: string,
  ) {
    if (adminUserId === targetUserId) {
      throw new BadRequestException(
        'You cannot permanently delete your own admin account from this panel.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (this.isProtectedBootstrapAdmin(user.email)) {
      throw new BadRequestException(
        'The configured bootstrap admin cannot be permanently deleted while BOOTSTRAP_ADMIN_EMAIL is set.',
      );
    }

    if (user.role === AppRole.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { role: AppRole.ADMIN },
      });

      if (adminCount <= 1) {
        throw new BadRequestException(
          'At least one admin account must remain.',
        );
      }
    }

    return this.deleteUserPermanentlyInternal(user);
  }

  async bulkUpdateUsersByAdmin(
    adminUserId: string,
    data: { action: string; userIds: string[] },
  ) {
    const action = String(data.action || '')
      .trim()
      .toLowerCase();
    const userIds = Array.from(
      new Set(
        (Array.isArray(data.userIds) ? data.userIds : []).filter(Boolean),
      ),
    );

    if (!['approve', 'ban', 'unban'].includes(action)) {
      throw new BadRequestException('Unsupported bulk admin action');
    }
    if (!userIds.length) {
      throw new BadRequestException('Select at least one user first');
    }

    const results: Array<{
      userId: string;
      ok: boolean;
      message: string;
    }> = [];

    for (const userId of userIds) {
      try {
        if (action === 'approve') {
          const result = await this.approveUserByAdmin(userId);
          results.push({
            userId,
            ok: true,
            message: result.message,
          });
          continue;
        }

        if (action === 'ban') {
          const result = await this.banUserByAdmin(adminUserId, userId);
          results.push({
            userId,
            ok: true,
            message: result.message,
          });
          continue;
        }

        const result = await this.unbanUserByAdmin(userId);
        results.push({
          userId,
          ok: true,
          message: result.message,
        });
      } catch (error) {
        results.push({
          userId,
          ok: false,
          message: error instanceof Error ? error.message : 'Action failed',
        });
      }
    }

    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;

    return {
      action,
      requestedCount: userIds.length,
      successCount,
      failureCount,
      results,
      message:
        failureCount > 0
          ? `${successCount} user${successCount === 1 ? '' : 's'} updated, ${failureCount} failed.`
          : `${successCount} user${successCount === 1 ? '' : 's'} updated successfully.`,
    };
  }

  async createReport(
    userId: string,
    data: {
      targetUserId?: string;
      groupId?: string;
      messageId?: string;
      reason: UserReportReason;
      details?: string;
    },
  ) {
    const details = data.details?.trim() || null;
    let targetUserId = data.targetUserId?.trim() || null;
    let groupId = data.groupId?.trim() || null;
    const messageId = data.messageId?.trim() || null;

    if (!targetUserId && !groupId && !messageId) {
      throw new BadRequestException(
        'Choose a user, group, or message to report.',
      );
    }

    if (targetUserId && groupId) {
      throw new BadRequestException(
        'A report can target either one user or one group at a time.',
      );
    }

    if (targetUserId === userId) {
      throw new BadRequestException('You cannot report your own account.');
    }

    if (messageId) {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          groupId: true,
        },
      });

      if (!message) {
        throw new NotFoundException('Message not found.');
      }

      if (message.groupId) {
        const membership = await this.prisma.groupMember.findUnique({
          where: {
            groupId_userId: {
              groupId: message.groupId,
              userId,
            },
          },
          select: { groupId: true },
        });

        if (!membership) {
          throw new ForbiddenException('You cannot report this message.');
        }

        groupId = groupId ?? message.groupId;
      } else {
        const isParticipant =
          message.senderId === userId || message.receiverId === userId;

        if (!isParticipant) {
          throw new ForbiddenException('You cannot report this message.');
        }

        const otherUserId =
          message.senderId === userId ? message.receiverId : message.senderId;

        if (otherUserId) {
          targetUserId = targetUserId ?? otherUserId;
        }
      }
    }

    if (targetUserId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
      });

      if (!targetUser) {
        throw new NotFoundException('Reported user not found.');
      }
    }

    if (groupId) {
      const membership = await this.prisma.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId,
            userId,
          },
        },
        select: { groupId: true },
      });

      if (!membership) {
        throw new ForbiddenException(
          'You can report only groups you belong to.',
        );
      }
    }

    if (!targetUserId && !groupId) {
      throw new BadRequestException('The report target could not be resolved.');
    }

    const report = await this.prisma.userReport.create({
      data: {
        reporterId: userId,
        targetUserId,
        groupId,
        messageId,
        reason: data.reason,
        details,
      },
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        adminNote: true,
        handledAt: true,
        createdAt: true,
        updatedAt: true,
        reporter: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            isBanned: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        message: {
          select: {
            id: true,
            content: true,
            ciphertext: true,
            messageType: true,
            fileName: true,
            fileMimeType: true,
            deletedForEveryoneAt: true,
            createdAt: true,
          },
        },
        handledBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      message:
        'Report submitted. Admins can review it from the moderation queue.',
      report: this.serializeAdminReport(report),
    };
  }

  async getAdminReportOverview() {
    const reports = await this.prisma.userReport.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        adminNote: true,
        handledAt: true,
        createdAt: true,
        updatedAt: true,
        reporter: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            isBanned: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        message: {
          select: {
            id: true,
            content: true,
            ciphertext: true,
            messageType: true,
            fileName: true,
            fileMimeType: true,
            deletedForEveryoneAt: true,
            createdAt: true,
          },
        },
        handledBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const serializedReports = reports.map((report) =>
      this.serializeAdminReport(report),
    );

    return {
      summary: {
        totalReports: serializedReports.length,
        openReports: serializedReports.filter(
          (report) => report.status === UserReportStatus.OPEN,
        ).length,
        inReviewReports: serializedReports.filter(
          (report) => report.status === UserReportStatus.IN_REVIEW,
        ).length,
        resolvedReports: serializedReports.filter(
          (report) => report.status === UserReportStatus.RESOLVED,
        ).length,
        dismissedReports: serializedReports.filter(
          (report) => report.status === UserReportStatus.DISMISSED,
        ).length,
      },
      reports: serializedReports,
    };
  }

  async reviewReportByAdmin(
    adminUserId: string,
    reportId: string,
    data: {
      status?: UserReportStatus;
      adminNote?: string;
      banTargetUser?: boolean;
    },
  ) {
    const report = await this.prisma.userReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        targetUserId: true,
      },
    });

    if (!report) {
      throw new NotFoundException('Report not found.');
    }

    if (data.banTargetUser && !report.targetUserId) {
      throw new BadRequestException(
        'Only reports against a user can ban the reported account.',
      );
    }

    let banMessage: string | null = null;
    if (data.banTargetUser && report.targetUserId) {
      const banResult = await this.banUserByAdmin(
        adminUserId,
        report.targetUserId,
      );
      banMessage = banResult.message;
    }

    const nextStatus =
      data.status ??
      (data.banTargetUser ? UserReportStatus.RESOLVED : undefined);
    const handledAt =
      nextStatus && nextStatus !== UserReportStatus.OPEN ? new Date() : null;

    const updatedReport = await this.prisma.userReport.update({
      where: { id: reportId },
      data: {
        ...(nextStatus ? { status: nextStatus } : {}),
        adminNote:
          data.adminNote === undefined
            ? undefined
            : data.adminNote.trim() || null,
        handledById:
          nextStatus === undefined
            ? undefined
            : nextStatus === UserReportStatus.OPEN
              ? null
              : adminUserId,
        handledAt:
          nextStatus === undefined
            ? undefined
            : nextStatus === UserReportStatus.OPEN
              ? null
              : handledAt,
      },
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        adminNote: true,
        handledAt: true,
        createdAt: true,
        updatedAt: true,
        reporter: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            isBanned: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        message: {
          select: {
            id: true,
            content: true,
            ciphertext: true,
            messageType: true,
            fileName: true,
            fileMimeType: true,
            deletedForEveryoneAt: true,
            createdAt: true,
          },
        },
        handledBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      message: data.banTargetUser
        ? 'Report updated and the reported user action was applied.'
        : 'Report updated successfully.',
      banMessage,
      report: this.serializeAdminReport(updatedReport),
    };
  }

  async requestAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.ensureSelfDeleteAllowed(user);

    if (user.deletionScheduledFor) {
      return {
        ...this.serializeProfile(user),
        message: `Account deletion is already scheduled for ${user.deletionScheduledFor.toLocaleString()}.`,
      };
    }

    const deletionRequestedAt = new Date();
    const deletionScheduledFor =
      this.getAccountDeletionDeadline(deletionRequestedAt);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt,
        deletionScheduledFor,
        tokenVersion: { increment: 1 },
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...this.serializeProfile(updatedUser),
      message: `Account deletion scheduled for ${deletionScheduledFor.toLocaleString()}. Log in before then if you want to cancel it.`,
      logoutRequired: true,
    };
  }

  async cancelAccountDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.deletionScheduledFor) {
      return {
        ...this.serializeProfile(user),
        message: 'Account deletion is not scheduled.',
      };
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: null,
        deletionScheduledFor: null,
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
        deletionRequestedAt: true,
        deletionScheduledFor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...this.serializeProfile(updatedUser),
      message: 'Account deletion cancelled. Your account will stay active.',
    };
  }

  async cleanupExpiredDeletedAccounts() {
    const dueUsers = await this.prisma.user.findMany({
      where: {
        deletionScheduledFor: {
          lte: new Date(),
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
      },
      orderBy: {
        deletionScheduledFor: 'asc',
      },
      take: 25,
    });

    let deletedCount = 0;

    for (const user of dueUsers) {
      try {
        await this.deleteUserPermanentlyInternal(user);
        deletedCount += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to purge expired soft-deleted account ${user.id}. ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    return {
      deletedCount,
      scannedCount: dueUsers.length,
    };
  }

  async searchUsers(userId: string, query?: string) {
    const normalizedQuery = query?.trim();
    const blockedUserIds = await this.getBlockedUserIds(userId, {
      blockedByMe: true,
      blockedMe: true,
    });

    const [users, preferences] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          id: {
            not: userId,
            notIn: Array.from(blockedUserIds),
          },
          isApproved: true,
          isBanned: false,
          deletionScheduledFor: null,
          emailVerified: true,
          OR: normalizedQuery
            ? [
              { id: normalizedQuery },
              {
                email: {
                  contains: normalizedQuery,
                  mode: 'insensitive',
                },
              },
              {
                name: {
                  contains: normalizedQuery,
                  mode: 'insensitive',
                },
              },
            ]
            : undefined,
        },
        select: {
          id: true,
          email: true,
          name: true,
          avatar: true,
          publicKey: true,
        },
        orderBy: { name: 'asc' },
        take: 50,
      }),
      this.prisma.contactPreference.findMany({
        where: { ownerId: userId },
        select: {
          contactUserId: true,
          nickname: true,
          chatTheme: true,
        },
      }),
    ]);

    const preferenceByUserId = new Map(
      preferences.map((item) => [
        item.contactUserId,
        {
          nickname: item.nickname,
          chatTheme: item.chatTheme,
        },
      ]),
    );

    return users.map((user) => {
      const preference = preferenceByUserId.get(user.id);
      const nickname = preference?.nickname ?? null;

      return {
        ...user,
        nickname,
        displayName: nickname ?? user.name,
        chatTheme: preference?.chatTheme ?? null,
      };
    });
  }

  async getBlockedUsers(userId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: {
        blockedUser: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return blocks.map((block) => ({
      id: block.blockedUser.id,
      email: block.blockedUser.email,
      name: block.blockedUser.name,
      avatar: block.blockedUser.avatar,
      blockedAt: block.createdAt,
    }));
  }

  async updatePublicKey(
    userId: string,
    data: {
      publicKey: string;
      privateKeyBackupCiphertext?: string;
      privateKeyBackupIv?: string;
    },
  ) {
    if (!data.publicKey?.trim()) {
      throw new BadRequestException('Public key is required');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        publicKey: data.publicKey.trim(),
        privateKeyBackupCiphertext:
          data.privateKeyBackupCiphertext?.trim() || null,
        privateKeyBackupIv: data.privateKeyBackupIv?.trim() || null,
        publicKeyUpdatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
      },
    });
  }

  async blockUser(userId: string, blockedUserId: string) {
    await this.ensureContactUser(blockedUserId, userId);

    await this.prisma.$transaction([
      this.prisma.userBlock.upsert({
        where: {
          blockerId_blockedUserId: {
            blockerId: userId,
            blockedUserId,
          },
        },
        update: {},
        create: {
          blockerId: userId,
          blockedUserId,
        },
      }),
      this.prisma.chatRequest.deleteMany({
        where: {
          OR: [
            { senderId: userId, receiverId: blockedUserId },
            { senderId: blockedUserId, receiverId: userId },
          ],
        },
      }),
    ]);

    return {
      success: true,
      blockedUserId,
      message:
        'User blocked. A new chat request will be needed after unblocking.',
    };
  }

  async unblockUser(userId: string, blockedUserId: string) {
    await this.ensureContactUser(blockedUserId, userId);

    await this.prisma.userBlock.deleteMany({
      where: {
        blockerId: userId,
        blockedUserId,
      },
    });

    return {
      success: true,
      blockedUserId,
      message:
        'User unblocked. Chat stays locked until a new request is sent and accepted.',
    };
  }

  async updateAvatar(userId: string, avatarPath: string) {
    if (!avatarPath) {
      throw new BadRequestException('Avatar path is required');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatar: true,
      },
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarPath },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
      },
    });

    if (existingUser?.avatar && existingUser.avatar !== avatarPath) {
      await this.deleteManagedUpload(existingUser.avatar, '/uploads/avatars/', [
        'uploads',
        'avatars',
      ]);
    }

    return this.serializeProfile(user);
  }

  async removeAvatar(userId: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatar: true,
      },
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: null },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
      },
    });

    if (existingUser?.avatar) {
      await this.deleteManagedUpload(existingUser.avatar, '/uploads/avatars/', [
        'uploads',
        'avatars',
      ]);
    }

    return this.serializeProfile(user);
  }

  async updateProfile(userId: string, data: { name?: string; email?: string }) {
    const name = data.name?.trim();
    const email = data.email?.trim()
      ? this.normalizeEmail(data.email)
      : undefined;

    if (!name && !email) {
      throw new BadRequestException('Name or email is required');
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
      },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    if (email && email !== currentUser.email) {
      await this.assertEmailAvailable(email, userId);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(name ? { name } : {}),
        ...(email && email !== currentUser.email
          ? { email, pendingEmail: null, emailVerified: true }
          : {}),
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      ...this.serializeProfile(user),
      message:
        email && email !== currentUser.email
          ? `Profile updated. Your email is now ${email}.`
          : 'Profile updated successfully.',
    };
  }

  async resendEmailVerification(_userId: string) {
    return {
      success: true,
      message: 'Email verification is disabled for this app.',
    };
  }

  async verifyPendingEmail(_userId: string, _otp: string) {
    return {
      success: true,
      message: 'Email verification is disabled for this app.',
    };
  }

  async updateSettings(
    userId: string,
    data: {
      darkMode?: boolean;
      backupEnabled?: boolean;
      backupImages?: boolean;
      backupVideos?: boolean;
      backupFiles?: boolean;
    },
  ) {
    if (
      typeof data.darkMode !== 'boolean' &&
      typeof data.backupEnabled !== 'boolean' &&
      typeof data.backupImages !== 'boolean' &&
      typeof data.backupVideos !== 'boolean' &&
      typeof data.backupFiles !== 'boolean'
    ) {
      throw new BadRequestException('At least one setting is required');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(typeof data.darkMode === 'boolean'
          ? { darkMode: data.darkMode }
          : {}),
        ...(typeof data.backupEnabled === 'boolean'
          ? { backupEnabled: data.backupEnabled }
          : {}),
        ...(typeof data.backupImages === 'boolean'
          ? { backupImages: data.backupImages }
          : {}),
        ...(typeof data.backupVideos === 'boolean'
          ? { backupVideos: data.backupVideos }
          : {}),
        ...(typeof data.backupFiles === 'boolean'
          ? { backupFiles: data.backupFiles }
          : {}),
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        role: true,
        emailVerified: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
        bannedAt: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        privateKeyBackupCiphertext: true,
        privateKeyBackupIv: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.serializeProfile(user);
  }

  async changePassword(
    userId: string,
    data: {
      newPassword: string;
      currentPassword?: string;
      privateKeyBackupCiphertext?: string;
      privateKeyBackupIv?: string;
    },
  ) {
    const newPassword = data.newPassword?.trim();

    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException(
        'New password must be at least 6 characters',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (data.currentPassword?.trim()) {
      const currentMatches = await bcrypt.compare(
        data.currentPassword.trim(),
        user.password,
      );

      if (!currentMatches) {
        throw new BadRequestException('Current password is incorrect');
      }
    }

    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password,
        privateKeyBackupCiphertext:
          data.privateKeyBackupCiphertext?.trim() || null,
        privateKeyBackupIv: data.privateKeyBackupIv?.trim() || null,
        tokenVersion: {
          increment: 1,
        },
      },
    });

    return {
      success: true,
      message: 'Password updated successfully.',
    };
  }

  async updateContactNickname(
    userId: string,
    contactUserId: string,
    nickname: string,
  ) {
    const contact = await this.ensureContactUser(contactUserId, userId);
    await this.ensureAcceptedConversation(userId, contactUserId);
    const preference = await this.saveContactPreference(userId, contactUserId, {
      nickname,
    });

    return {
      success: true,
      nickname: preference.nickname,
      chatTheme: preference.chatTheme,
      displayName: preference.nickname ?? contact.name,
    };
  }

  async updateContactTheme(
    userId: string,
    contactUserId: string,
    themePath?: string | null,
  ) {
    await this.ensureContactUser(contactUserId, userId);
    await this.ensureAcceptedConversation(userId, contactUserId);

    if (
      themePath?.startsWith('preset:') &&
      !CHAT_THEME_PRESET_KEYS.has(themePath.slice('preset:'.length))
    ) {
      throw new BadRequestException('Theme preset is invalid');
    }

    const [ownerPreference] = await Promise.all([
      this.saveContactPreference(userId, contactUserId, {
        chatTheme: themePath ?? null,
      }),
      this.saveContactPreference(contactUserId, userId, {
        chatTheme: themePath ?? null,
      }),
    ]);

    return {
      success: true,
      chatTheme: ownerPreference.chatTheme,
      nickname: ownerPreference.nickname,
    };
  }

  getNotificationPublicKey() {
    return {
      publicKey: this.pushNotifications.getPublicKey(),
    };
  }

  async subscribeToNotifications(
    userId: string,
    subscription: {
      endpoint: string;
      expirationTime?: string | null;
      keys?: { p256dh?: string; auth?: string };
    },
  ) {
    if (!this.pushNotifications.getPublicKey()) {
      throw new BadRequestException('Push notifications are not configured');
    }

    await this.pushNotifications.subscribe(userId, subscription);
    return { success: true };
  }

  async unsubscribeFromNotifications(userId: string, endpoint: string) {
    await this.pushNotifications.unsubscribe(userId, endpoint);
    return { success: true };
  }
}
