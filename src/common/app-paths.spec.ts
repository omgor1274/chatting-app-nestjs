import { join } from 'path';

describe('app-paths', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('falls back to a temp writable directory when storage is full', async () => {
    const appPaths = require('./app-paths');
    const fallbackDir = appPaths.recoverWritableDataDirFromError(
      Object.assign(new Error('No space left'), {
        code: 'ENOSPC',
        path: '/data/uploads/chat-sessions/assembled',
      }),
      '/data/uploads/chat-sessions/assembled',
    );

    expect(fallbackDir).toContain('ochat-data');
    expect(process.env.APP_DATA_DIR).toBe(fallbackDir);
    expect(appPaths.resolveWritableDataPath('uploads', 'chat')).toBe(
      join(fallbackDir as string, 'uploads', 'chat'),
    );
  });
});
