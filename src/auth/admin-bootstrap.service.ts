import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { getBootstrapAdminCredentials } from './admin.constants';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const credentials = getBootstrapAdminCredentials();
    if (!credentials) {
      const existingAdmin = await this.prisma.user.findFirst({
        where: { role: AppRole.ADMIN },
        select: { id: true },
      });

      if (!existingAdmin) {
        this.logger.warn(
          'Bootstrap admin skipped because BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are not configured. Add them to create the first admin account.',
        );
      }

      return;
    }

    const email = credentials.email;
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        isApproved: true,
        approvedAt: true,
        isBanned: true,
      },
    });

    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(credentials.password, 10);

      await this.prisma.user.create({
        data: {
          email,
          name: credentials.name,
          password: hashedPassword,
          role: AppRole.ADMIN,
          emailVerified: true,
          isApproved: true,
          approvedAt: new Date(),
          isBanned: false,
        },
      });

      this.logger.log(`Bootstrap admin created for ${email}.`);
      return;
    }

    const needsRepair =
      existingUser.role !== AppRole.ADMIN ||
      !existingUser.isApproved ||
      existingUser.isBanned ||
      !existingUser.approvedAt;

    if (!needsRepair) {
      return;
    }

    await this.prisma.user.update({
      where: { id: existingUser.id },
      data: {
        role: AppRole.ADMIN,
        name: credentials.name,
        emailVerified: true,
        isApproved: true,
        approvedAt: existingUser.approvedAt ?? new Date(),
        isBanned: false,
        bannedAt: null,
        tokenVersion: { increment: 1 },
      },
    });

    this.logger.log(`Bootstrap admin access restored for ${email}.`);
  }
}
