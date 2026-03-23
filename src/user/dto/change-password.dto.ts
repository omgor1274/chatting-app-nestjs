import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../common/dto/transforms';

export class ChangePasswordDto {
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  newPassword: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(40000)
  privateKeyBackupCiphertext?: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  privateKeyBackupIv?: string;
}
