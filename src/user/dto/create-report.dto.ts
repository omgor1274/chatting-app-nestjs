import { UserReportReason } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateReportDto {
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  messageId?: string;

  @IsString()
  @IsIn(Object.values(UserReportReason))
  reason!: UserReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}
