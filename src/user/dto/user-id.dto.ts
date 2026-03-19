import { IsUUID } from 'class-validator';
import { Trim } from '../../common/dto/transforms';

export class UserIdDto {
  @Trim()
  @IsUUID()
  userId: string;
}
