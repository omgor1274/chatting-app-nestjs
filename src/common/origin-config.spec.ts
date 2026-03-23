import {
  collectConfiguredOrigins,
  isAllowedCloudflareTunnelOrigin,
  isAllowedRequestOrigin,
  normalizeOrigin,
  resolveDefaultAppOrigin,
  resolveRequestOrigin,
} from './origin-config';

describe('origin-config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.APP_ORIGIN;
    delete process.env.PUBLIC_API_URL;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    delete process.env.PORT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('normalizes configured origins and removes duplicates', () => {
    process.env.ALLOWED_ORIGINS =
      'https://Example.com/, https://chat.example.com';
    process.env.APP_ORIGIN = 'https://example.com';
    process.env.PUBLIC_API_URL = 'https://chat.example.com/';

    expect(collectConfiguredOrigins()).toEqual([
      'https://example.com',
      'https://chat.example.com',
    ]);
  });

  it('includes Railway public domain automatically', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'my-app.up.railway.app';

    expect(collectConfiguredOrigins()).toContain(
      'https://my-app.up.railway.app',
    );
  });

  it('allows normalized request origins and localhost dev origins', () => {
    const allowedOrigins = ['https://my-app.up.railway.app'];

    expect(
      isAllowedRequestOrigin('https://my-app.up.railway.app', allowedOrigins),
    ).toBe(true);
    expect(
      isAllowedRequestOrigin('http://localhost:3000', allowedOrigins),
    ).toBe(true);
    expect(
      isAllowedRequestOrigin('https://other.example.com', allowedOrigins),
    ).toBe(false);
  });

  it('allows Cloudflare trycloudflare tunnel origins', () => {
    const allowedOrigins = ['https://my-app.up.railway.app'];

    expect(
      isAllowedCloudflareTunnelOrigin(
        'https://decorative-dear-unavailable-grande.trycloudflare.com',
      ),
    ).toBe(true);
    expect(
      isAllowedRequestOrigin(
        'https://decorative-dear-unavailable-grande.trycloudflare.com',
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('falls back to Railway public domain for app origin', () => {
    process.env.RAILWAY_PUBLIC_DOMAIN = 'my-app.up.railway.app';

    expect(resolveDefaultAppOrigin()).toBe('https://my-app.up.railway.app');
  });

  it('normalizes origin values safely', () => {
    expect(normalizeOrigin('https://Example.com/')).toBe('https://example.com');
    expect(normalizeOrigin('not-a-url')).toBeNull();
  });

  it('resolves request origin from protocol and host', () => {
    expect(
      resolveRequestOrigin({
        protocol: 'https',
        host: 'chatting-app-nestjs-production.up.railway.app',
      }),
    ).toBe('https://chatting-app-nestjs-production.up.railway.app');
  });
});
