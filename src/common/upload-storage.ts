import { mkdirSync } from 'fs';
import { resolveWritableDataPath } from './app-paths';

export function createUploadDestination(...segments: string[]) {
  return (
    _req: unknown,
    _file: { originalname?: string },
    callback: (error: Error | null, destination: string) => void,
  ) => {
    try {
      const destination = resolveWritableDataPath(...segments);
      mkdirSync(destination, { recursive: true });
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
