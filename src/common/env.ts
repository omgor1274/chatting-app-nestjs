import { config as loadEnv } from 'dotenv';
import { getEnvFilePath } from './app-paths';

let hasLoadedEnv = false;

export function ensureEnvLoaded() {
  if (hasLoadedEnv) {
    return;
  }

  loadEnv({ path: getEnvFilePath(), override: false });
  hasLoadedEnv = true;
}
