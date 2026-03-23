import type { Request } from 'express';
import {
  resolveRateLimitClientIp,
  resolveRateLimitClientKey,
} from './rate-limit-client-key';

function createRequest(
  overrides: Partial<Request> & {
    headers?: Record<string, string | string[] | undefined>;
  } = {},
) {
  return {
    headers: {},
    ip: '',
    socket: { remoteAddress: undefined },
    ...overrides,
  } as Request;
}

describe('rate-limit-client-key', () => {
  it('prefers Cloudflare and proxy headers over req.ip', () => {
    const request = createRequest({
      headers: {
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': '203.0.113.20, 10.0.0.2',
      },
      ip: '10.0.0.1',
    });

    expect(resolveRateLimitClientIp(request)).toBe('198.51.100.7');
    expect(resolveRateLimitClientKey(request)).toBe('198.51.100.7');
  });

  it('extracts the first client from x-forwarded-for lists', () => {
    const request = createRequest({
      headers: {
        'x-forwarded-for': '203.0.113.20:443, 10.0.0.2',
      },
      ip: '10.0.0.1',
    });

    expect(resolveRateLimitClientIp(request)).toBe('203.0.113.20');
  });

  it('parses standard Forwarded headers and normalizes IPv6 values', () => {
    const request = createRequest({
      headers: {
        forwarded: 'for="[2001:db8::1234]:4711";proto=https;by=203.0.113.43',
      },
      ip: '10.0.0.1',
    });

    expect(resolveRateLimitClientIp(request)).toBe('2001:db8::1234');
    expect(resolveRateLimitClientKey(request)).toBe('2001:db8::/56');
  });

  it('falls back to the socket address when request.ip is unavailable', () => {
    const request = createRequest({
      socket: { remoteAddress: '::ffff:192.0.2.25' } as Request['socket'],
    });

    expect(resolveRateLimitClientIp(request)).toBe('::ffff:192.0.2.25');
    expect(resolveRateLimitClientKey(request)).toBe('192.0.2.25');
  });
});
