import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../common/dto/transforms';

export class EmailDto {
  @NormalizeEmail()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;
}
