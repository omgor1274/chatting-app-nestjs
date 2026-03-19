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
    const [users, preferences] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          id: { not: userId },
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
        darkMode: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
      },
    });
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
        darkMode: true,
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
          ? { pendingEmail: email }
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
        darkMode: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (email && email !== currentUser.email) {
      await this.sendVerificationOtp(
        userId,
        email,
        AuthTokenType.VERIFY_PENDING_EMAIL,
      );
    }

    return {
      ...this.serializeProfile(user),
      message:
        email && email !== currentUser.email
          ? `Profile updated. Verify ${email} before it replaces your current email.`
          : 'Profile updated successfully.',
    };
  }

  async resendEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        emailVerified: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.pendingEmail) {
      await this.sendVerificationOtp(
        user.id,
        user.pendingEmail,
        AuthTokenType.VERIFY_PENDING_EMAIL,
      );
      return {
        success: true,
        message: `Verification OTP re-sent to ${user.pendingEmail}.`,
      };
    }

    if (user.emailVerified) {
      return {
        success: true,
        message: 'Your current email is already verified.',
      };
    }

    await this.sendVerificationOtp(
      user.id,
      user.email,
      AuthTokenType.VERIFY_EMAIL,
    );

    return {
      success: true,
      message: `Verification OTP re-sent to ${user.email}.`,
    };
  }

  async verifyPendingEmail(userId: string, otp: string) {
    if (!otp?.trim()) {
      throw new BadRequestException('OTP is required');
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      throw new BadRequestException('OTP must be a 6-digit code');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.pendingEmail) {
      throw new BadRequestException('There is no pending email to verify');
    }

    await this.assertEmailAvailable(user.pendingEmail, user.id);
    const token = await this.getUsableVerificationOtp(
      user.id,
      AuthTokenType.VERIFY_PENDING_EMAIL,
      user.pendingEmail,
      otp,
    );

    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.pendingEmail,
          pendingEmail: null,
          emailVerified: true,
        },
      }),
      this.prisma.authToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    return {
      success: true,
      message: 'Email updated and verified successfully.',
    };
  }

  async updateSettings(
    userId: string,
    data: { darkMode?: boolean; backupEnabled?: boolean },
  ) {
    if (
      typeof data.darkMode !== 'boolean' &&
      typeof data.backupEnabled !== 'boolean'
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
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        name: true,
        avatar: true,
        emailVerified: true,
        backupEnabled: true,
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
