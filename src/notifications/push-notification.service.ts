import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

type NotificationPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
};

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly publicKey = process.env.VAPID_PUBLIC_KEY;
  private readonly privateKey = process.env.VAPID_PRIVATE_KEY;
  private readonly subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';

  constructor(private prisma: PrismaService) {
    if (this.publicKey && this.privateKey) {
      webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    } else {
      this.logger.warn('VAPID keys are missing. Push notifications are disabled.');
    }
  }

  getPublicKey() {
    return this.publicKey;
  }

  async subscribe(
    userId: string,
    subscription: {
      endpoint: string;
      expirationTime?: string | null;
      keys?: { p256dh?: string; auth?: string };
    },
  ) {
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error('Invalid push subscription');
    }

    return this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        userId,
        expirationTime: subscription.expirationTime ?? null,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    if (!endpoint) {
      return;
    }

    await this.prisma.pushSubscription.deleteMany({
      where: {
        userId,
        endpoint,
      },
    });
  }

  async notifyUser(userId: string, payload: NotificationPayload) {
    if (!this.publicKey || !this.privateKey) {
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              expirationTime: subscription.expirationTime
                ? Number(subscription.expirationTime)
                : null,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify(payload),
          );
        } catch (error: any) {
          const statusCode = error?.statusCode ?? error?.body?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({
              where: { endpoint: subscription.endpoint },
            });
            return;
          }

          this.logger.warn(`Failed to send push notification: ${error}`);
        }
      }),
    );
  }
}
