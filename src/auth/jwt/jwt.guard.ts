import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authentication is required');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('Authentication is required');
    }

    let payload: { userId: string; tokenVersion: number; email?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        role: true,
        isApproved: true,
        isBanned: true,
        tokenVersion: true,
      },
    });

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    if (user.isBanned) {
      throw new ForbiddenException(
        'Your account has been banned from O-chat.',
      );
    }

    if (!user.isApproved) {
      throw new ForbiddenException(
        'Your account is waiting for admin approval.',
      );
    }

    request.user = {
      ...payload,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    return true;
  }
}
