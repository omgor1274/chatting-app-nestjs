import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../common/dto/transforms';

export class ContactNicknameDto {
  @Trim()
  @IsUUID()
  contactUserId: string;

  @Trim()
  @IsString()
  @MaxLength(60)
  nickname: string;
}
