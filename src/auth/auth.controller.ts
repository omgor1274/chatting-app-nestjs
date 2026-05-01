import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto, VerifyEmailDto } from './dto/reset-password.dto';
import { JwtGuard } from './jwt/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('resend-verification')
  resendVerification(@Body() body: EmailDto) {
    return this.authService.resendVerification(body.email);
  }

  @Post('verify-email')
  verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body.email, body.otp);
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: EmailDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.email, body.otp, body.password);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @UseGuards(JwtGuard)
  @Get('profile')
  getProfile(@Req() req) {
    return req.user;
  }
}
