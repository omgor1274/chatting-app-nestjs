import { isIP } from 'node:net';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

function normalizeIpCandidate(value?: string | null) {
  if (!value) {
    return null;
  }

  let candidate = value.trim();
  if (!candidate || candidate.toLowerCase() === 'unknown') {
    return null;
  }

  if (candidate.toLowerCase().startsWith('for=')) {
    candidate = candidate.slice(4).trim();
  }

  if (
    candidate.length >= 2 &&
    candidate.startsWith('"') &&
    candidate.endsWith('"')
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  if (candidate.startsWith('[')) {
    const closingBracket = candidate.indexOf(']');
    if (closingBracket > 0) {
      candidate = candidate.slice(1, closingBracket);
    }
  }

  const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch) {
    candidate = ipv4WithPortMatch[1];
  }

  if (candidate.includes('%')) {
    candidate = candidate.split('%')[0];
  }

  return isIP(candidate) ? candidate : null;
}

function extractHeaderIp(value?: string | string[]) {
  if (!value) {
    return null;
  }

  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    for (const part of entry.split(',')) {
      const candidate = normalizeIpCandidate(part);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function extractForwardedHeaderIp(value?: string | string[]) {
  if (!value) {
    return null;
  }

  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    for (const forwardedValue of entry.split(',')) {
      const fields = forwardedValue.split(';');
      for (const field of fields) {
        if (!field.trim().toLowerCase().startsWith('for=')) {
          continue;
        }

        const candidate = normalizeIpCandidate(field);
        if (candidate) {
          return candidate;
        }
      }
    }
  }

  return null;
}

export function resolveRateLimitClientIp(request: Request) {
  return (
    extractHeaderIp(request.headers['cf-connecting-ip']) ||
    extractHeaderIp(request.headers['x-real-ip']) ||
    extractHeaderIp(request.headers['x-forwarded-for']) ||
    extractForwardedHeaderIp(request.headers.forwarded) ||
    normalizeIpCandidate(request.ip) ||
    normalizeIpCandidate(request.socket?.remoteAddress) ||
    null
  );
}

export function resolveRateLimitClientKey(request: Request) {
  const clientIp = resolveRateLimitClientIp(request);
  if (clientIp) {
    return ipKeyGenerator(clientIp);
  }

  return 'unknown-client';
}
