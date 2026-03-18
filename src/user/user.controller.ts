import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { UserService } from './user.service';

function avatarFileName(
  req: { user?: { userId?: string } },
  file: { originalname: string },
  callback: (error: Error | null, filename: string) => void,
) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  callback(null, `${req['user']?.userId ?? 'user'}-${uniqueSuffix}${extname(file.originalname)}`);
}

@Controller('users')
export class UserController {
  constructor(private userService: UserService) { }

  @UseGuards(JwtGuard)
  @Get('me')
  getProfile(@Req() req) {
    return this.userService.getProfile(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Post('me')
  updateProfile(
    @Req() req,
    @Body() body: { name?: string; email?: string },
  ) {
    return this.userService.updateProfile(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Get()
  searchUsers(@Req() req, @Query('q') query?: string) {
    return this.userService.searchUsers(req.user.userId, query);
  }

  @UseGuards(JwtGuard)
  @Post('keys/public')
  updatePublicKey(@Req() req, @Body() body: { publicKey: string }) {
    return this.userService.updatePublicKey(req.user.userId, body.publicKey);
  }

  @UseGuards(JwtGuard)
  @Post('contacts/nickname')
  updateContactNickname(
    @Req() req,
    @Body() body: { contactUserId: string; nickname: string },
  ) {
    return this.userService.updateContactNickname(
      req.user.userId,
      body.contactUserId,
      body.nickname,
    );
  }

  @Get('notifications/public-key')
  getNotificationPublicKey() {
    return this.userService.getNotificationPublicKey();
  }

  @UseGuards(JwtGuard)
  @Post('notifications/subscribe')
  subscribeToNotifications(@Req() req, @Body() body: {
    endpoint: string;
    expirationTime?: string | null;
    keys?: { p256dh?: string; auth?: string };
  }) {
    return this.userService.subscribeToNotifications(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Post('notifications/unsubscribe')
  unsubscribeFromNotifications(@Req() req, @Body() body: { endpoint: string }) {
    return this.userService.unsubscribeFromNotifications(req.user.userId, body.endpoint);
  }

  @UseGuards(JwtGuard)
  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: 'uploads/avatars',
        filename: avatarFileName,
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(new BadRequestException('Only image uploads are allowed'), false);
        }

        callback(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Req() req,
    @UploadedFile() file?: {
      filename: string;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    return this.userService.updateAvatar(
      req.user.userId,
      `/uploads/avatars/${file.filename}`,
    );
  }
}
