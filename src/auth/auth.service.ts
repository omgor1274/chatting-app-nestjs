import { BadRequestException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private signAuthToken(user: Pick<User, 'id' | 'email' | 'tokenVersion'>) {
    return this.jwt.sign({
      userId: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    });
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
      emailVerified: user.emailVerified ?? true,
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
            emailVerified: true,
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
            tokenVersion: true,
          },
        });

        return {
          message: 'Registration successful',
          token: this.signAuthToken(user),
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
        emailVerified: true,
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
        tokenVersion: true,
      },
    });

    return {
      message: 'Registration successful',
      token: this.signAuthToken(user),
      user: this.serializeUser(user),
    };
  }

  async resendVerification(email: string) {
    return {
      message: `Email verification is disabled for this app. ${email ? 'You can log in directly.' : ''}`.trim(),
    };
  }

  async verifyEmail(_email: string, _otp: string) {
    return {
      success: true,
      message: 'Email verification is disabled for this app. You can log in directly.',
    };
  }

  async requestPasswordReset(email: string) {
    throw new BadRequestException(
      `Password reset by email is disabled for this app. Ask the app owner to reset the password for ${email}.`,
    );
  }

  async resetPassword(email: string, _otp: string, _password: string) {
    throw new BadRequestException(
      `Password reset by email is disabled for this app. Ask the app owner to reset the password for ${email || 'this account'}.`,
    );
  }

  async login(email: string, password: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new BadRequestException('Invalid credentials');
    }

    const resolvedUser = user.emailVerified
      ? user
      : await this.prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });

    return {
      message: 'Login successful',
      token: this.signAuthToken(resolvedUser),
      user: this.serializeUser(resolvedUser),
    };
  }
}
