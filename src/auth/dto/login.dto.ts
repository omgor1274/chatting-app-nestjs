import { IsEmail, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail, Trim } from '../../common/dto/transforms';

export class LoginDto {
  @NormalizeEmail()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @Trim()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}
