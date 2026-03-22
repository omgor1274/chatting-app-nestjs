function safeParseOrigin(value: string) {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeOrigin(value?: string | null) {
  if (!value) {
    return null;
  }

  return safeParseOrigin(value.trim());
}

export function isAllowedLocalDevOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim());
}

function getRailwayPublicOrigin() {
  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (!publicDomain) {
    return null;
  }

  return normalizeOrigin(`https://${publicDomain}`);
}

export function collectConfiguredOrigins() {
  return Array.from(
    new Set(
      [
        process.env.ALLOWED_ORIGINS,
        process.env.APP_ORIGIN,
        process.env.PUBLIC_API_URL,
      ]
        .filter(Boolean)
        .flatMap((value) => String(value).split(','))
        .map((origin) => normalizeOrigin(origin))
        .filter((origin): origin is string => Boolean(origin))
        .concat(getRailwayPublicOrigin() ?? []),
    ),
  );
}

export function isAllowedRequestOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
) {
  if (!origin || origin === 'null') {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return isAllowedLocalDevOrigin(normalizedOrigin);
}

export function resolveDefaultAppOrigin() {
  return (
    normalizeOrigin(process.env.APP_ORIGIN) ??
    getRailwayPublicOrigin() ??
    `http://localhost:${process.env.PORT ?? 8080}`
  );
}
