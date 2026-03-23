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
});
