import { join } from 'path';

export function getAppRootDir() {
  return process.env.APP_ROOT_DIR?.trim() || process.cwd();
}

export function getWritableDataDir() {
  return process.env.APP_DATA_DIR?.trim() || process.cwd();
}

export function getEnvFilePath() {
  return process.env.APP_ENV_FILE?.trim() || join(getAppRootDir(), '.env');
}

export function resolveAppRootPath(...segments: string[]) {
  return join(getAppRootDir(), ...segments);
}

export function resolveWritableDataPath(...segments: string[]) {
  return join(getWritableDataDir(), ...segments);
}
