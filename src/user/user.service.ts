import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PushNotificationService } from '../notifications/push-notification.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private pushNotifications: PushNotificationService,
  ) { }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async searchUsers(userId: string, query?: string) {
    const [users, preferences] = await Promise.all([
      this.prisma.user.findMany({
      where: {
        id: { not: userId },
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
      take: 20,
      }),
      this.prisma.contactPreference.findMany({
        where: { ownerId: userId },
        select: {
          contactUserId: true,
          nickname: true,
        },
      }),
    ]);

    const nicknameByUserId = new Map(
      preferences.map((item) => [item.contactUserId, item.nickname]),
    );

    return users.map((user) => ({
      ...user,
      nickname: nicknameByUserId.get(user.id) ?? null,
      displayName: nicknameByUserId.get(user.id) ?? user.name,
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
        name: true,
        avatar: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
      },
    });
  }

  async updateAvatar(userId: string, avatarPath: string) {
    if (!avatarPath) {
      throw new BadRequestException('Avatar path is required');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarPath },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      },
    });
  }

  async updateProfile(userId: string, data: { name?: string; email?: string }) {
    const name = data.name?.trim();
    const email = data.email?.trim().toLowerCase();

    if (!name && !email) {
      throw new BadRequestException('Name or email is required');
    }

    if (email) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          email,
          id: { not: userId },
        },
        select: { id: true },
      });

      if (existingUser) {
        throw new BadRequestException('Email is already in use');
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        publicKey: true,
        publicKeyUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateContactNickname(userId: string, contactUserId: string, nickname: string) {
    if (!contactUserId) {
      throw new BadRequestException('Contact user id is required');
    }

    if (contactUserId === userId) {
      throw new BadRequestException('You cannot rename yourself as a contact');
    }

    const contact = await this.prisma.user.findUnique({
      where: { id: contactUserId },
      select: { id: true },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const trimmedNickname = nickname?.trim();

    if (!trimmedNickname) {
      await this.prisma.contactPreference.deleteMany({
        where: {
          ownerId: userId,
          contactUserId,
        },
      });

      return { success: true, nickname: null };
    }

    const preference = await this.prisma.contactPreference.upsert({
      where: {
        ownerId_contactUserId: {
          ownerId: userId,
          contactUserId,
        },
      },
      update: {
        nickname: trimmedNickname,
      },
      create: {
        ownerId: userId,
        contactUserId,
        nickname: trimmedNickname,
      },
    });

    return { success: true, nickname: preference.nickname };
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
