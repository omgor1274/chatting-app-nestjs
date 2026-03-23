import { accessSync, constants, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';

let cachedWritableDataDir: string | null = null;
let cachedWritableDataDirSource: string | null = null;
let loggedWritableDataDirFallback = false;

function resolvePathFromCwd(pathValue: string) {
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
}

function ensureWritableDirectory(targetPath: string) {
  mkdirSync(targetPath, { recursive: true });
  accessSync(targetPath, constants.W_OK);
  return targetPath;
}

export function getAppRootDir() {
  return process.env.APP_ROOT_DIR?.trim() || process.cwd();
}

export function getWritableDataDir() {
  const configuredPath = process.env.APP_DATA_DIR?.trim() || null;

  if (
    cachedWritableDataDir &&
    cachedWritableDataDirSource === configuredPath
  ) {
    return cachedWritableDataDir;
  }

  const preferredPath = configuredPath
    ? resolvePathFromCwd(configuredPath)
    : process.cwd();

  try {
    cachedWritableDataDir = ensureWritableDirectory(preferredPath);
  } catch (preferredError) {
    const fallbackPath = join(tmpdir(), 'ochat-data');
    cachedWritableDataDir = ensureWritableDirectory(fallbackPath);

    if (!loggedWritableDataDirFallback) {
      loggedWritableDataDirFallback = true;
      const reason =
        preferredError instanceof Error
          ? preferredError.message
          : 'Unknown filesystem error';
      console.warn(
        `APP_DATA_DIR "${preferredPath}" is not writable. Falling back to "${fallbackPath}". ${reason}`,
      );
    }
  }

  process.env.APP_DATA_DIR = cachedWritableDataDir;
  cachedWritableDataDirSource = configuredPath;
  return cachedWritableDataDir;
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
