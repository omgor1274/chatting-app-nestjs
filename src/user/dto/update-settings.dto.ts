import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  darkMode?: boolean;

  @IsOptional()
  @IsBoolean()
  backupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  backupImages?: boolean;

  @IsOptional()
  @IsBoolean()
  backupVideos?: boolean;

  @IsOptional()
  @IsBoolean()
  backupFiles?: boolean;
}
