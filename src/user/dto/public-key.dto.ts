import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/dto/transforms';

export class PublicKeyDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  publicKey: string;
}
