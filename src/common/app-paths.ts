import { accessSync, constants, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';

const FALLBACK_WRITABLE_DATA_DIR = join(tmpdir(), 'ochat-data');
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

function describeStorageError(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown filesystem error';
}

function canFallbackFromStorageError(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return ['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(
    String(error.code || '').toUpperCase(),
  );
}

function applyWritableDataFallback(reason?: unknown, failedPath?: string) {
  cachedWritableDataDir = ensureWritableDirectory(FALLBACK_WRITABLE_DATA_DIR);
  process.env.APP_DATA_DIR = cachedWritableDataDir;
  cachedWritableDataDirSource = cachedWritableDataDir;

  if (!loggedWritableDataDirFallback) {
    loggedWritableDataDirFallback = true;
    const pathNote = failedPath ? ` after failing to use "${failedPath}"` : '';
    console.warn(
      `Writable app storage is unavailable${pathNote}. Falling back to "${cachedWritableDataDir}". ${describeStorageError(reason)}`,
    );
  }

  return cachedWritableDataDir;
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
    cachedWritableDataDir = applyWritableDataFallback(
      preferredError,
      preferredPath,
    );
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

export function recoverWritableDataDirFromError(
  error: unknown,
  failedPath?: string,
) {
  if (!canFallbackFromStorageError(error)) {
    return null;
  }

  return applyWritableDataFallback(error, failedPath);
}
