import { mkdirSync } from 'fs';
import {
  recoverWritableDataDirFromError,
  resolveWritableDataPath,
} from './app-paths';

export function createUploadDestination(...segments: string[]) {
  return (
    _req: unknown,
    _file: { originalname?: string },
    callback: (error: Error | null, destination: string) => void,
  ) => {
    try {
      let destination = resolveWritableDataPath(...segments);

      try {
        mkdirSync(destination, { recursive: true });
      } catch (error) {
        if (!recoverWritableDataDirFromError(error, destination)) {
          throw error;
        }

        destination = resolveWritableDataPath(...segments);
        mkdirSync(destination, { recursive: true });
      }

      callback(null, destination);
    } catch (error) {
      callback(
        error instanceof Error
          ? error
          : new Error('Failed to prepare upload directory'),
        '',
      );
    }
  };
}
