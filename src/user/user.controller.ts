import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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
import { AdminGuard } from '../auth/jwt/admin.guard';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { ChatGateway } from '../chat/chat.gateway';
import { createUploadDestination } from '../common/upload-storage';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ContactNicknameDto } from './dto/contact-nickname.dto';
import { CreateReportDto } from './dto/create-report.dto';
import {
  NotificationSubscriptionDto,
  NotificationUnsubscribeDto,
} from './dto/notification-subscription.dto';
import { PublicKeyDto } from './dto/public-key.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UserIdDto } from './dto/user-id.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { UserService } from './user.service';

function avatarFileName(
  req: { user?: { userId?: string } },
  file: { originalname: string },
  callback: (error: Error | null, filename: string) => void,
) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  callback(
    null,
    `${req['user']?.userId ?? 'user'}-${uniqueSuffix}${extname(file.originalname)}`,
  );
}

function contactThemeFileName(
  req: { user?: { userId?: string } },
  file: { originalname: string },
  callback: (error: Error | null, filename: string) => void,
) {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  callback(
    null,
    `${req['user']?.userId ?? 'theme'}-${uniqueSuffix}${extname(file.originalname)}`,
  );
}

@Controller('users')
export class UserController {
  constructor(
    private userService: UserService,
    private chatGateway: ChatGateway,
  ) {}

  @UseGuards(JwtGuard)
  @Get('me')
  getProfile(@Req() req) {
    return this.userService.getProfile(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Post('me')
  updateProfile(@Req() req, @Body() body: UpdateProfileDto) {
    return this.userService.updateProfile(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Post('account/delete/request')
  requestAccountDeletion(@Req() req) {
    return this.userService.requestAccountDeletion(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Post('account/delete/cancel')
  cancelAccountDeletion(@Req() req) {
    return this.userService.cancelAccountDeletion(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Post('settings')
  updateSettings(
    @Req() req,
    @Body() body: UpdateSettingsDto,
  ) {
    return this.userService.updateSettings(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Post('password')
  changePassword(@Req() req, @Body() body: ChangePasswordDto) {
    return this.userService.changePassword(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Post('email/resend-verification')
  resendEmailVerification(@Req() req) {
    return this.userService.resendEmailVerification(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Post('email/verify')
  verifyPendingEmail(@Req() req, @Body() body: VerifyOtpDto) {
    return this.userService.verifyPendingEmail(req.user.userId, body.otp);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Get('admin/users')
  getAdminUserOverview() {
    return this.userService.getAdminUserOverview();
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/users/:userId/approve')
  approveUserByAdmin(@Param('userId') userId: string) {
    return this.userService.approveUserByAdmin(userId);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/users/:userId/ban')
  banUserByAdmin(@Req() req, @Param('userId') userId: string) {
    return this.userService.banUserByAdmin(req.user.userId, userId);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/users/:userId/unban')
  unbanUserByAdmin(@Param('userId') userId: string) {
    return this.userService.unbanUserByAdmin(userId);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/users/:userId/remove-admin')
  removeAdminRoleByAdmin(@Req() req, @Param('userId') userId: string) {
    return this.userService.removeAdminRoleByAdmin(req.user.userId, userId);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/users/:userId/delete')
  deleteUserPermanentlyByAdmin(@Req() req, @Param('userId') userId: string) {
    return this.userService.deleteUserPermanentlyByAdmin(req.user.userId, userId);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/users/bulk')
  bulkUpdateUsersByAdmin(
    @Req() req,
    @Body() body: { action: string; userIds: string[] },
  ) {
    return this.userService.bulkUpdateUsersByAdmin(req.user.userId, body);
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Get('admin/reports')
  getAdminReportOverview() {
    return this.userService.getAdminReportOverview();
  }

  @UseGuards(JwtGuard, AdminGuard)
  @Post('admin/reports/:reportId/review')
  reviewReportByAdmin(
    @Req() req,
    @Param('reportId') reportId: string,
    @Body() body: ReviewReportDto,
  ) {
    return this.userService.reviewReportByAdmin(
      req.user.userId,
      reportId,
      body,
    );
  }

  @UseGuards(JwtGuard)
  @Get()
  searchUsers(@Req() req, @Query('q') query?: string) {
    return this.userService.searchUsers(req.user.userId, query);
  }

  @UseGuards(JwtGuard)
  @Post('reports')
  createReport(@Req() req, @Body() body: CreateReportDto) {
    return this.userService.createReport(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Get('blocks')
  getBlockedUsers(@Req() req) {
    return this.userService.getBlockedUsers(req.user.userId);
  }

  @UseGuards(JwtGuard)
  @Post('keys/public')
  updatePublicKey(@Req() req, @Body() body: PublicKeyDto) {
    return this.userService.updatePublicKey(req.user.userId, {
      publicKey: body.publicKey,
      privateKeyBackupCiphertext: body.privateKeyBackupCiphertext,
      privateKeyBackupIv: body.privateKeyBackupIv,
    });
  }

  @UseGuards(JwtGuard)
  @Post('blocks')
  async blockUser(@Req() req, @Body() body: UserIdDto) {
    const result = await this.userService.blockUser(req.user.userId, body.userId);
    this.chatGateway.emitConversationRefresh(
      [req.user.userId, body.userId].filter(Boolean),
      {
        otherUserId: body.userId,
        conversationType: 'direct',
      },
    );
    return result;
  }

  @UseGuards(JwtGuard)
  @Post('blocks/remove')
  async unblockUser(@Req() req, @Body() body: UserIdDto) {
    const result = await this.userService.unblockUser(req.user.userId, body.userId);
    this.chatGateway.emitConversationRefresh(
      [req.user.userId, body.userId].filter(Boolean),
      {
        otherUserId: body.userId,
        conversationType: 'direct',
      },
    );
    return result;
  }

  @UseGuards(JwtGuard)
  @Post('contacts/nickname')
  updateContactNickname(
    @Req() req,
    @Body() body: ContactNicknameDto,
  ) {
    return this.userService.updateContactNickname(
      req.user.userId,
      body.contactUserId,
      body.nickname,
    );
  }

  @UseGuards(JwtGuard)
  @Post('contacts/theme')
  @UseInterceptors(
    FileInterceptor('theme', {
      storage: diskStorage({
        destination: createUploadDestination('uploads', 'chat-themes'),
        filename: contactThemeFileName,
      }),
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image uploads are allowed'),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  updateContactTheme(
    @Req() req,
    @Body()
    body: {
      contactUserId: string;
      clear?: string | boolean;
      presetKey?: string;
    },
    @UploadedFile() file?: { filename: string },
  ) {
    const shouldClear =
      body.clear === true || body.clear === 'true' || body.clear === '1';
    const presetKey = body.presetKey?.trim();

    if (!file && !shouldClear && !presetKey) {
      throw new BadRequestException('Theme image or preset is required');
    }

    return this.userService
      .updateContactTheme(
      req.user.userId,
      body.contactUserId,
      shouldClear
        ? null
        : presetKey
          ? `preset:${presetKey}`
          : file
            ? `/uploads/chat-themes/${file.filename}`
            : null,
      )
      .then((result) => {
        this.chatGateway.emitThemeUpdate({
          userId: req.user.userId,
          contactUserId: body.contactUserId,
          chatTheme: result.chatTheme ?? null,
        });

        return result;
      });
  }

  @Get('notifications/public-key')
  getNotificationPublicKey() {
    return this.userService.getNotificationPublicKey();
  }

  @UseGuards(JwtGuard)
  @Post('notifications/subscribe')
  subscribeToNotifications(
    @Req() req,
    @Body() body: NotificationSubscriptionDto,
  ) {
    return this.userService.subscribeToNotifications(req.user.userId, body);
  }

  @UseGuards(JwtGuard)
  @Post('notifications/unsubscribe')
  unsubscribeFromNotifications(
    @Req() req,
    @Body() body: NotificationUnsubscribeDto,
  ) {
    return this.userService.unsubscribeFromNotifications(
      req.user.userId,
      body.endpoint,
    );
  }

  @UseGuards(JwtGuard)
  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: createUploadDestination('uploads', 'avatars'),
        filename: avatarFileName,
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image uploads are allowed'),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Req() req,
    @UploadedFile()
    file?: {
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

  @UseGuards(JwtGuard)
  @Post('profile/avatar/remove')
  removeAvatar(@Req() req) {
    return this.userService.removeAvatar(req.user.userId);
  }
}
