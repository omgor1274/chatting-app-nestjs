const isFileOrigin = window.location.protocol === 'file:';
const defaultApiOrigin =
  window.__OCHAT_RUNTIME_CONFIG__?.defaultApiOrigin || 'http://localhost:8080';
const localBackendOrigin = defaultApiOrigin;
const isHostedOrigin =
  !isFileOrigin && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

let appConfig = {
  apiUrl: localBackendOrigin,
  avatarBaseUrl: 'https://ui-avatars.com/api/',
  stunServers: ['stun:stun.l.google.com:19302'],
};
let API_URL = appConfig.apiUrl;
let configLoadPromise = null;
const DEFAULT_AVATAR_URL = '/icons/default-avatar.svg';

function getConfigCandidates() {
  const candidates = [
    !isFileOrigin && window.location.origin ? window.location.origin : null,
    localBackendOrigin,
  ].filter(Boolean);

  try {
    const parsed = new URL(localBackendOrigin);
    if (parsed.hostname === 'localhost') {
      candidates.push(`${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ''}`);
    } else if (parsed.hostname === '127.0.0.1') {
      candidates.push(`${parsed.protocol}//localhost${parsed.port ? `:${parsed.port}` : ''}`);
    }
  } catch {
    // Ignore invalid env-driven defaults and keep the explicit candidates above.
  }

  return Array.from(new Set(candidates));
}

function resolveHostedApiUrl(candidate, data) {
  const configuredApiUrl = data?.apiUrl;
  if (isHostedOrigin) {
    return candidate || configuredApiUrl || window.location.origin;
  }

  return configuredApiUrl || candidate;
}

export function getApiUrl() {
  return API_URL;
}

export function getToken() {
  return localStorage.getItem('chat_token') || '';
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('chat_token', token);
  } else {
    localStorage.removeItem('chat_token');
  }
}

export function clearToken() {
  localStorage.removeItem('chat_token');
}

export async function hasValidSession(options = {}) {
  const { allowStaleToken = true } = options;
  const token = getToken();
  if (!token) {
    return false;
  }

  try {
    const response = await api('/users/me');
    if (response.ok) {
      return true;
    }

    if (response.status === 401) {
      clearToken();
      return false;
    }

    return allowStaleToken;
  } catch (error) {
    console.error(error);
    return allowStaleToken;
  }
}

export function getAvatarUrl(
  name = 'User',
  avatarBaseUrl = appConfig.avatarBaseUrl,
) {
  if (
    avatarBaseUrl &&
    !String(avatarBaseUrl).includes('ui-avatars.com') &&
    !String(avatarBaseUrl).includes('?name=')
  ) {
    return avatarBaseUrl;
  }

  return DEFAULT_AVATAR_URL;
}

export async function loadPublicConfig() {
  if (configLoadPromise) {
    return configLoadPromise;
  }

  configLoadPromise = (async () => {
    const candidates = isHostedOrigin ? [window.location.origin] : getConfigCandidates();

    for (const candidate of candidates) {
      try {
        const response = await fetch(`${candidate}/config`);
        if (!response.ok) {
          continue;
        }

        const data = await readJsonResponse(response, null);
        if (!data || typeof data !== 'object') {
          continue;
        }

        appConfig = {
          ...appConfig,
          ...data,
          apiUrl: resolveHostedApiUrl(candidate, data),
        };
        API_URL = appConfig.apiUrl || candidate;
        return appConfig;
      } catch (error) {
        console.error(error);
      }
    }

    API_URL = isHostedOrigin ? window.location.origin : localBackendOrigin;
    return appConfig;
  })();

  return configLoadPromise;
}

export async function readJsonResponse(
  response,
  fallbackValue = {},
  fallbackMessage = 'Server returned an invalid response.',
) {
  const raw = await response.text();

  if (!raw) {
    return fallbackValue;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse JSON response', error, raw);
    const textMessage = String(raw || '').trim();

    if (
      fallbackValue &&
      typeof fallbackValue === 'object' &&
      !Array.isArray(fallbackValue)
    ) {
      return {
        ...fallbackValue,
        message: textMessage || fallbackMessage,
      };
    }

    return fallbackValue;
  }
}

export async function api(path, options = {}) {
  await loadPublicConfig();
  const token = getToken();
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
