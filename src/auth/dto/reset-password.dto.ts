import {
  IsEmail,
  IsNotEmpty,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail, Trim } from '../../common/dto/transforms';

export class ResetPasswordDto {
  @NormalizeEmail()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @Trim()
  @Matches(/^\d{6}$/)
  otp: string;

  @Trim()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}

export class VerifyEmailDto {
  @NormalizeEmail()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @Trim()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}
