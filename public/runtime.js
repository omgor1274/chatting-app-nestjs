const isFileOrigin = window.location.protocol === 'file:';
const defaultApiOrigin =
  window.__OCHAT_RUNTIME_CONFIG__?.defaultApiOrigin || 'http://localhost:8080';
const localBackendOrigin = defaultApiOrigin;
const isHostedOrigin =
  !isFileOrigin && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
const KEY_BACKUP_UNLOCK_MATERIAL_PREFIX = 'ochat_key_unlock_material_';

let appConfig = {
  apiUrl: localBackendOrigin,
  avatarBaseUrl: 'https://ui-avatars.com/api/',
  stunServers: ['stun:stun.l.google.com:19302'],
};
let API_URL = appConfig.apiUrl;
let configLoadPromise = null;
const DEFAULT_AVATAR_URL = '/icons/default-avatar.svg';

function getBrowserStorage(kind = 'local') {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch (error) {
    console.warn(`Failed to access ${kind}Storage`, error);
    return null;
  }
}

function readStorageValue(storage, key, fallbackValue = '') {
  if (!storage || !key) {
    return fallbackValue;
  }

  try {
    const value = storage.getItem(key);
    return value ?? fallbackValue;
  } catch (error) {
    console.warn('Failed to read stored value', error);
    return fallbackValue;
  }
}

function writeStorageValue(storage, key, value) {
  if (!storage || !key) {
    return;
  }

  try {
    if (value === undefined || value === null || value === '') {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, String(value));
  } catch (error) {
    console.warn('Failed to write stored value', error);
  }
}

function removeStorageValue(storage, key) {
  if (!storage || !key) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch (error) {
    console.warn('Failed to remove stored value', error);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function keyBackupUnlockStorageKey(userId) {
  return `${KEY_BACKUP_UNLOCK_MATERIAL_PREFIX}${userId}`;
}

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
  return readStorageValue(getBrowserStorage('local'), 'chat_token', '');
}

export function setToken(token) {
  writeStorageValue(getBrowserStorage('local'), 'chat_token', token);
}

export function clearToken() {
  removeStorageValue(getBrowserStorage('local'), 'chat_token');
}

export async function deriveKeyBackupUnlockMaterial(password, userId) {
  const normalizedPassword = String(password || '');
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedPassword || !normalizedUserId || !window.crypto?.subtle) {
    return '';
  }

  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizedPassword),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`ochat-key-backup:${normalizedUserId}`),
      iterations: 250000,
    },
    baseKey,
    256,
  );

  return arrayBufferToBase64(bits);
}

export function storeKeyBackupUnlockMaterial(userId, unlockMaterial) {
  if (!userId || !unlockMaterial) {
    return;
  }

  writeStorageValue(
    getBrowserStorage('session'),
    keyBackupUnlockStorageKey(userId),
    String(unlockMaterial),
  );
}

export function readKeyBackupUnlockMaterial(userId) {
  if (!userId) {
    return '';
  }

  return readStorageValue(
    getBrowserStorage('session'),
    keyBackupUnlockStorageKey(userId),
    '',
  );
}

export function clearKeyBackupUnlockMaterial(userId) {
  if (!userId) {
    return;
  }

  removeStorageValue(
    getBrowserStorage('session'),
    keyBackupUnlockStorageKey(userId),
  );
}

async function importKeyBackupKey(unlockMaterial) {
  return window.crypto.subtle.importKey(
    'raw',
    base64ToUint8Array(unlockMaterial),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPrivateKeyBackup(privateKey, unlockMaterial) {
  if (!privateKey || !unlockMaterial || !window.crypto?.subtle) {
    return null;
  }

  const encryptionKey = await importKeyBackupKey(unlockMaterial);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    new TextEncoder().encode(String(privateKey)),
  );

  return {
    privateKeyBackupCiphertext: arrayBufferToBase64(ciphertext),
    privateKeyBackupIv: arrayBufferToBase64(iv),
  };
}

export async function decryptPrivateKeyBackup(
  privateKeyBackupCiphertext,
  privateKeyBackupIv,
  unlockMaterial,
) {
  if (
    !privateKeyBackupCiphertext ||
    !privateKeyBackupIv ||
    !unlockMaterial ||
    !window.crypto?.subtle
  ) {
    return '';
  }

  const encryptionKey = await importKeyBackupKey(unlockMaterial);
  const plaintext = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToUint8Array(privateKeyBackupIv),
    },
    encryptionKey,
    base64ToUint8Array(privateKeyBackupCiphertext),
  );

  return new TextDecoder().decode(plaintext);
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

    if (response.status === 401 || response.status === 403) {
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

window.__OCHAT_KEY_BACKUP__ = {
  deriveKeyBackupUnlockMaterial,
  storeKeyBackupUnlockMaterial,
  readKeyBackupUnlockMaterial,
  clearKeyBackupUnlockMaterial,
  encryptPrivateKeyBackup,
  decryptPrivateKeyBackup,
};
