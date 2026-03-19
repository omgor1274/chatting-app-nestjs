import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../common/dto/transforms';

class NotificationKeysDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  p256dh: string;

  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  auth: string;
}

export class NotificationSubscriptionDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  endpoint: string;

  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  expirationTime?: string | null;

  @IsDefined()
  @ValidateNested()
  @Type(() => NotificationKeysDto)
  keys: NotificationKeysDto;
}

export class NotificationUnsubscribeDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  endpoint: string;
}
