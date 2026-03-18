import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { JwtGuard } from './jwt/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    if (!body.email || !body.name || !body.password) {
      throw new BadRequestException('All fields are required');
    }
    return this.authService.register(body);
  }

  @Post('resend-verification')
  resendVerification(@Body() body: { email: string }) {
    if (!body.email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    return this.authService.resendVerification(body.email);
  }

  @Post('verify-email')
  verifyEmail(@Body() body: { email: string; otp: string }) {
    return this.authService.verifyEmail(body.email, body.otp);
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: { email: string }) {
    if (!body.email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  resetPassword(
    @Body() body: { email: string; otp: string; password: string },
  ) {
    return this.authService.resetPassword(body.email, body.otp, body.password);
  }

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @UseGuards(JwtGuard)
  @Get('profile')
  getProfile(@Req() req) {
    return req.user;
  }
}
