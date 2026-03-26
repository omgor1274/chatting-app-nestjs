import { UserReportStatus } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReviewReportDto {
  @IsOptional()
  @IsIn(Object.values(UserReportStatus))
  status?: UserReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;

  @IsOptional()
  @IsBoolean()
  banTargetUser?: boolean;
}
