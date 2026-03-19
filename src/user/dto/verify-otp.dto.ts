import { Length, Matches } from 'class-validator';
import { Trim } from '../../common/dto/transforms';

export class VerifyOtpDto {
  @Trim()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp: string;
}
