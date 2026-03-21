const isFileOrigin = window.location.protocol === 'file:';
const localBackendOrigin = 'http://localhost:3000';

let appConfig = {
  apiUrl: localBackendOrigin,
  avatarBaseUrl: 'https://ui-avatars.com/api/',
  stunServers: ['stun:stun.l.google.com:19302'],
};
let API_URL = appConfig.apiUrl;
let configLoadPromise = null;

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

export function getAvatarUrl(
  name = 'User',
  avatarBaseUrl = appConfig.avatarBaseUrl,
) {
  const label = encodeURIComponent(name || 'User');
  return `${avatarBaseUrl}?name=${label}&background=0F62FE&color=fff&size=256`;
}

export async function loadPublicConfig() {
  if (configLoadPromise) {
    return configLoadPromise;
  }

  configLoadPromise = (async () => {
    const candidates = Array.from(
      new Set(
        [
          !isFileOrigin && window.location.origin
            ? window.location.origin
            : null,
          localBackendOrigin,
          'http://127.0.0.1:3000',
        ].filter(Boolean),
      ),
    );

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
          apiUrl: data.apiUrl || candidate,
        };
        API_URL = appConfig.apiUrl || candidate;
        return appConfig;
      } catch (error) {
        console.error(error);
      }
    }

    API_URL = localBackendOrigin;
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
