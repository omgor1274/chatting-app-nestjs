import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthTokenType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { PrismaService } from '../prisma/prisma.service';

const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
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
  constructor(
    private prisma: PrismaService,
    private pushNotifications: PushNotificationService,
    private mailService: MailService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
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
    emailVerified?: boolean;
    backupEnabled?: boolean;
    backupImages?: boolean;
    backupVideos?: boolean;
    backupFiles?: boolean;
    darkMode?: boolean;
    publicKey?: string | null;
    publicKeyUpdatedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      ...user,
      avatar: user.avatar ?? null,
      pendingEmail: user.pendingEmail ?? null,
      emailVerified: user.emailVerified ?? false,
      backupEnabled: user.backupEnabled ?? true,
      backupImages: user.backupImages ?? true,
      backupVideos: user.backupVideos ?? true,
      backupFiles: user.backupFiles ?? true,
      darkMode: user.darkMode ?? false,
      publicKey: user.publicKey ?? null,
      publicKeyUpdatedAt: user.publicKeyUpdatedAt ?? null,
    };
  }

  private async ensureContactUser(contactUserId: string, userId: string) {
    if (!contactUserId) {
      throw new BadRequestException('Contact user id is required');
    }

    if (contactUserId === userId) {
      throw new BadRequestException('You cannot update yourself as a contact');
    }

    const contact = await this.prisma.user.findUnique({
      where: { id: contactUserId },
      select: { id: true, name: true },
    });

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
        emailVerified: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.serializeProfile(user);
  }

  async searchUsers(userId: string, query?: string) {
    const blockedByOthers = await this.getBlockedUserIds(userId, {
      blockedByMe: false,
      blockedMe: true,
    });

    const [users, preferences] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          id: {
            not: userId,
            notIn: Array.from(blockedByOthers),
          },
          emailVerified: true,
          OR: query
            ? [
                { email: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
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

  async updatePublicKey(userId: string, publicKey: string) {
    if (!publicKey?.trim()) {
      throw new BadRequestException('Public key is required');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        publicKey: publicKey.trim(),
        publicKeyUpdatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        emailVerified: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
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
      message: 'User blocked. A new chat request will be needed after unblocking.',
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
      message: 'User unblocked. Chat stays locked until a new request is sent and accepted.',
    };
  }

  async updateAvatar(userId: string, avatarPath: string) {
    if (!avatarPath) {
      throw new BadRequestException('Avatar path is required');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarPath },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        emailVerified: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
      },
    });

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
        emailVerified: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
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
        emailVerified: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.serializeProfile(user);
  }

  async changePassword(
    userId: string,
    data: { newPassword: string; currentPassword?: string },
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
