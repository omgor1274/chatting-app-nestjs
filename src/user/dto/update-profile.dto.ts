import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail, Trim } from '../../common/dto/transforms';

export class UpdateProfileDto {
  @Trim()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @NormalizeEmail()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
