import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../common/dto/transforms';

export class PublicKeyDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  publicKey: string;

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
