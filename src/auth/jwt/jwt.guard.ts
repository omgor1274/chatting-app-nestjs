import {
  CanActivate,
  ExecutionContext,
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

    try {
      const payload = this.jwt.verify(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          tokenVersion: true,
        },
      });

      if (!user || user.tokenVersion !== payload.tokenVersion) {
        throw new UnauthorizedException(
          'Session expired. Please log in again.',
        );
      }

      request.user = {
        ...payload,
        email: user.email,
        tokenVersion: user.tokenVersion,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
  }
}
