import { join } from 'path';
import { createUploadDestination } from './upload-storage';

describe('upload-storage', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('resolves the upload directory when the callback runs', () => {
    process.env.APP_DATA_DIR = join(process.cwd(), 'tmp-upload-root');
    const destinationResolver = createUploadDestination('uploads', 'avatars');
    const callback = jest.fn<void, [Error | null, string]>();

    destinationResolver({}, {}, callback);

    expect(callback).toHaveBeenCalledWith(
      null,
      join(process.env.APP_DATA_DIR, 'uploads', 'avatars'),
    );
  });

  it('resolves relative upload roots against the current working directory', () => {
    process.env.APP_DATA_DIR = 'tmp-upload-root-relative';
    const destinationResolver = createUploadDestination('uploads', 'avatars');
    const callback = jest.fn<void, [Error | null, string]>();

    destinationResolver({}, {}, callback);

    expect(callback).toHaveBeenCalledWith(
      null,
      join(process.cwd(), 'tmp-upload-root-relative', 'uploads', 'avatars'),
    );
  });
});
