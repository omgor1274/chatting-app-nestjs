import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthTokenType, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_TTL_MS = 10 * 60 * 1000;
type OtpTokenType = 'VERIFY_EMAIL' | 'VERIFY_PENDING_EMAIL' | 'RESET_PASSWORD';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
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

  private signAuthToken(user: Pick<User, 'id' | 'email' | 'tokenVersion'>) {
    return this.jwt.sign({
      userId: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    });
  }

  private async issueOtp(
    userId: string,
    type: OtpTokenType,
    email: string,
    expiresInMs: number,
    targetEmail?: string | null,
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
          targetEmail !== undefined
            ? targetEmail
            : type === AuthTokenType.VERIFY_PENDING_EMAIL
              ? normalizedEmail
              : null,
        tokenHash: this.hashOtpToken(
          this.verificationScope(userId, type, normalizedEmail),
          otp,
        ),
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    });

    return otp;
  }

  private async issueVerificationOtp(
    userId: string,
    type: OtpTokenType,
    email: string,
  ) {
    const otp = await this.issueOtp(userId, type, email, EMAIL_OTP_TTL_MS);
    await this.mailService.sendVerificationEmail(email, otp, EMAIL_OTP_TTL_MS);
  }

  private async issuePasswordResetOtp(userId: string, email: string) {
    const otp = await this.issueOtp(
      userId,
      AuthTokenType.RESET_PASSWORD,
      email,
      RESET_OTP_TTL_MS,
      null,
    );
    await this.mailService.sendPasswordResetEmail(email, otp, RESET_OTP_TTL_MS);
  }

  private async getUsableOtp(
    userId: string,
    type: OtpTokenType,
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

  private serializeUser(user: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    emailVerified?: boolean;
    pendingEmail?: string | null;
    backupEnabled?: boolean;
    backupImages?: boolean;
    backupVideos?: boolean;
    backupFiles?: boolean;
    darkMode?: boolean;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar ?? null,
      emailVerified: user.emailVerified ?? false,
      pendingEmail: user.pendingEmail ?? null,
      backupEnabled: user.backupEnabled ?? true,
      backupImages: user.backupImages ?? true,
      backupVideos: user.backupVideos ?? true,
      backupFiles: user.backupFiles ?? true,
      darkMode: user.darkMode ?? false,
    };
  }

  async register(data: RegisterDto) {
    const email = this.normalizeEmail(data.email);
    const name = data.name.trim();
    const password = data.password.trim();
    const hashedPassword = await bcrypt.hash(password, 10);
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { pendingEmail: email }],
      },
      select: {
        id: true,
        email: true,
        emailVerified: true,
      },
    });

    if (existingUser) {
      if (existingUser.email === email && !existingUser.emailVerified) {
        const user = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name,
            password: hashedPassword,
            pendingEmail: null,
          },
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            emailVerified: true,
            pendingEmail: true,
            backupEnabled: true,
            backupImages: true,
            backupVideos: true,
            backupFiles: true,
            darkMode: true,
          },
        });

        await this.issueVerificationOtp(
          user.id,
          AuthTokenType.VERIFY_EMAIL,
          user.email,
        );

        return {
          message:
            'Finish registration by entering the OTP sent to your email.',
          user: this.serializeUser(user),
        };
      }

      throw new BadRequestException('Email is already in use');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        emailVerified: true,
        pendingEmail: true,
        backupEnabled: true,
        backupImages: true,
        backupVideos: true,
        backupFiles: true,
        darkMode: true,
      },
    });

    await this.issueVerificationOtp(
      user.id,
      AuthTokenType.VERIFY_EMAIL,
      user.email,
    );

    return {
      message:
        'Registration successful. Enter the OTP sent to your email to verify your account.',
      user: this.serializeUser(user),
    };
  }

  async resendVerification(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        emailVerified: true,
      },
    });

    if (!user || user.emailVerified) {
      return {
        message: 'If the account exists, a verification OTP has been sent.',
      };
    }

    await this.issueVerificationOtp(
      user.id,
      AuthTokenType.VERIFY_EMAIL,
      user.email,
    );

    return {
      message: 'If the account exists, a verification OTP has been sent.',
    };
  }

  async verifyEmail(email: string, otp: string) {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    if (!otp?.trim()) {
      throw new BadRequestException('OTP is required');
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      throw new BadRequestException('OTP must be a 6-digit code');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        emailVerified: true,
      },
    });

    if (!user) {
      throw new BadRequestException('OTP is invalid or expired');
    }

    if (user.emailVerified) {
      return {
        success: true,
        message: 'Email already verified. You can log in now.',
      };
    }

    const token = await this.getUsableOtp(
      user.id,
      AuthTokenType.VERIFY_EMAIL,
      user.email,
      otp,
    );

    await this.prisma.user.update({
      where: { id: token.userId },
      data: { emailVerified: true },
    });

    await this.prisma.authToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    return {
      success: true,
      message: 'Email verified successfully. You can log in now.',
    };
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
      },
    });

    if (user) {
      await this.issuePasswordResetOtp(user.id, user.email);
    }

    return {
      message: 'If the account exists, a password reset OTP has been sent.',
    };
  }

  async resetPassword(email: string, otp: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      throw new BadRequestException('Email is required');
    }

    if (!otp?.trim()) {
      throw new BadRequestException('OTP is required');
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      throw new BadRequestException('OTP must be a 6-digit code');
    }

    if (!password?.trim() || password.trim().length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      throw new BadRequestException('OTP is invalid or expired');
    }

    const token = await this.getUsableOtp(
      user.id,
      AuthTokenType.RESET_PASSWORD,
      user.email,
      otp,
    );
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    await Promise.all([
      this.prisma.user.update({
        where: { id: token.userId },
        data: {
          password: hashedPassword,
          tokenVersion: {
            increment: 1,
          },
        },
      }),
      this.prisma.authToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    return {
      success: true,
      message: 'Password reset successfully. You can log in now.',
    };
  }

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }

    if (!user.emailVerified) {
      throw new BadRequestException(
        'Complete email verification during signup before logging in',
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new BadRequestException('Invalid credentials');
    }

    const token = this.signAuthToken(user);

    return {
      message: 'Login successful',
      token,
      user: this.serializeUser(user),
    };
  }
}
