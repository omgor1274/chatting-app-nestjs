const isFileOrigin = window.location.protocol === 'file:';
const isDesktopRuntime = Boolean(window.desktopApp?.isDesktop);
const defaultApiOrigin =
  window.__OCHAT_RUNTIME_CONFIG__?.defaultApiOrigin || 'http://localhost:8080';
const localBackendOrigin = defaultApiOrigin;
const isHostedOrigin =
  !isFileOrigin &&
  !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
const PUBLIC_CONFIG_FETCH_TIMEOUT_MS = 5000;
const LOCKED_MOBILE_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';
let appConfig = {
  apiUrl: localBackendOrigin,
  avatarBaseUrl: '/icons/default-avatar.svg',
  stunServers: ['stun:stun.l.google.com:19302'],
};
let API_URL = appConfig.apiUrl;
let configLoadPromise = null;
const DEFAULT_AVATAR_URL = '/icons/default-avatar.svg';
let socket = null;
let socketConnectionKey = '';
let token = null;
let isLogin = true;
let currentUser = null;
let currentPrivateKey = null;
let users = [];
let peopleDirectory = [];
let peopleDirectoryLoaded = false;
let groupInvites = [];
let selectedUser = null;
let onlineUserIds = new Set();
let renderedMessageIds = new Set();
let conversationMessages = new Map();
let recentActivity = new Map();
let swRegistration = null;
let deferredInstallPrompt = null;
let serviceWorkerMessageBound = false;
let typingTimeout = null;
let activeTypingConversation = null;
let activeTypingSignalSent = false;
let lastTypingSignalAt = 0;
let typingUsers = new Map();
let sidebarOpen = false;
let attachmentUploadTasks = [];
let activeAttachmentUploadTaskId = null;
let activeAttachmentUploadRequest = null;
let nextAttachmentUploadTaskId = 0;
let usersRenderFrame = 0;
let headerRenderFrame = 0;
let historyScrollFrame = 0;
let viewportHeightFrame = 0;
let stickToLatestUntil = 0;
let loadUsersPromise = null;
let reloadUsersAfterCurrentLoad = false;
let renderedUserSignatures = new Map();
let composerSendInFlight = false;
let queuedOutgoingTextMessages = [];
let activeOutgoingTextMessage = null;
let outgoingTextQueueProcessing = false;
let pendingOptimisticMessageIdsByRoom = new Map();
let lastSubmittedDraftFingerprint = '';
let lastSubmittedDraftAt = 0;
let composerDraftVersion = 0;
let lastSubmittedDraftVersion = -1;
let activeConversationCacheKey = null;
const conversationHistoryCache = new Map();
const LAST_CHAT_ROUTE_KEY = 'chat_last_route';
let pinnedConversationKeys = new Set();
let archivedConversationKeys = new Set();
let mutedConversationKeys = new Set();
let starredMessagesById = new Map();
let messageReactionsById = new Map();
let conversationDrafts = new Map();
let showArchivedChats = false;
let activeChatListFilter = 'all';
let replyTarget = null;
let revealedSpoilerMessageIds = new Set();
let structuredMessageRefreshTimer = 0;
let specialMessageDraft = createEmptySpecialMessageDraft();
let offlineQueuedMessages = [];
let activeDragCounter = 0;
let ringtonePreference = 'classic';
let callHistoryByConversation = new Map();
let missedCallCountsByConversation = new Map();
let queuedConversationMessageRenders = [];
let queuedConversationMessageFrame = 0;
let scheduledConversationReadTimer = 0;
let messagePagination = {
  nextBefore: null,
  hasMore: false,
  loadingOlder: false,
  loadedForUserId: null,
  scrollReadyAt: 0,
};
let chatPermission = {
  canChat: false,
  acceptedRequestId: null,
  incomingRequestId: null,
  outgoingRequestId: null,
  blockedByMe: false,
  blockedByUser: false,
};
let recordedAudioFile = null;
let recordedAudioUrl = null;
let recordedChunks = [];
let discardRecordedAudioOnStop = false;
let mediaRecorder = null;
let mediaRecorderStream = null;
let pendingIncomingCall = null;
let pendingVerificationEmail = '';
let pendingResetEmail = '';
let blockedUsers = [];
let adminUsersPayload = {
  summary: {},
  users: [],
};
let ignoredPresenceUserIds = new Set();
let sessionExpiryHandled = false;
let messageActionTarget = null;
let requestActionInFlight = '';
let manageGroupAvatarShouldClear = false;
let presenceRefreshPromise = null;
let groupDetailsCache = new Map();
let detachedSelectedUser = false;
let userSearchResults = [];
let userSearchResultsQuery = '';
let userSearchDebounceTimer = 0;
let userSearchRequestToken = 0;
const NOTIFICATION_PERMISSION_KEY = 'ochat_notification_permission_requested';
const SECURITY_WELCOME_NOTICE_VERSION = '2026-04-30';
const MESSAGE_ACTION_TOUCH_HOLD_MS = 420;
const MESSAGE_ACTION_MOVE_TOLERANCE_PX = 10;
const MESSAGE_ACTION_SCROLL_BLOCK_MS = 700;
const TYPING_START_THROTTLE_MS = 900;
const TYPING_STOP_DELAY_MS = 1200;
const MAX_ATTACHMENT_UPLOAD_AUTO_RETRIES = 4;
const STRUCTURED_MESSAGE_PREFIX_PATTERN =
  /^\[\[OCHAT_([A-Z_]+):([A-Za-z0-9+/=_-]+)\]\]\n?/;
const TIME_CAPSULE_MIN_LEAD_MS = 60 * 1000;
const TIME_CAPSULE_MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
let messageActionScrollBlockedUntil = 0;
const MATROSKA_ATTACHMENT_MIME_TYPES = new Set([
  'video/x-matroska',
  'video/matroska',
  'video/mkv',
  'application/x-matroska',
]);

function createEmptySpecialMessageDraft() {
  return {
    capsule: {
      enabled: false,
      unlockAt: '',
      note: '',
    },
    spoiler: false,
  };
}

function createEmptyActiveCallState() {
  return {
    peer: null,
    localStream: null,
    remoteStream: null,
    targetUserId: null,
    callType: null,
    reconnectTimer: null,
    videoDeviceIds: [],
    currentVideoDeviceId: null,
    preferredFacingMode: 'user',
    switchingCamera: false,
  };
}

let activeCall = createEmptyActiveCallState();
let pendingRemoteIceCandidatesByUser = new Map();
let rtcConfig = {
  iceServers: appConfig.stunServers.map((urls) => ({ urls })),
};
let sharedMediaItems = [];
let sharedMediaLoading = false;
let sharedMediaErrorMessage = '';
let sharedMediaBrowserKind = 'image';
const OFFLINE_QUEUE_KEY = 'ochat_offline_message_queue';
const RINGTONE_PREFERENCE_KEY = 'ochat_ringtone_preference';
const CLIENT_CACHE_VERSION = '20260407-desktopwave1';
const CHAT_SHELL_CACHE_TTL_MS = 2 * 60 * 1000;
const CHAT_SHELL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_CACHE_TTL_MS = 90 * 1000;
const CONVERSATION_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_PERSISTED_CONVERSATIONS = 4;
const MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 24;
const CACHE_PERSIST_DEBOUNCE_MS = 180;
const DEFAULT_MEDIA_PLACEHOLDER_SIZE = 320;
let activeIncomingRingtone = null;
let shellCachePersistTimer = 0;
let conversationCachePersistTimer = 0;
let backgroundUsersRefreshTimer = 0;
let backgroundUsersRefreshPromise = null;
let conversationDraftPersistTimer = 0;
const surfaceRefreshTimers = new Map();
let pendingUserListPreviewSyncTimer = 0;
let reportModalTarget = null;
let reportSubmitInFlight = false;
let startupLoaderVisibleSince = 0;
let startupLoaderHideTimer = 0;
const imageDimensionCache = new Map();
const imageDimensionLoadPromises = new Map();
const verifiedThemeUrls = new Map();
let activeThemeValidationToken = 0;

function getConfigCandidates() {
  const candidates = [
    !isFileOrigin && window.location.origin ? window.location.origin : null,
    localBackendOrigin,
  ].filter(Boolean);

  try {
    const parsed = new URL(localBackendOrigin);
    if (parsed.hostname === 'localhost') {
      candidates.push(
        `${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ''}`,
      );
    } else if (parsed.hostname === '127.0.0.1') {
      candidates.push(
        `${parsed.protocol}//localhost${parsed.port ? `:${parsed.port}` : ''}`,
      );
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

async function fetchPublicConfigCandidate(candidate) {
  let timeoutId = null;
  let signal;

  if (
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
  ) {
    signal = AbortSignal.timeout(PUBLIC_CONFIG_FETCH_TIMEOUT_MS);
  } else if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = window.setTimeout(
      () => controller.abort(),
      PUBLIC_CONFIG_FETCH_TIMEOUT_MS,
    );
  }

  try {
    return await fetch(`${candidate}/config`, {
      cache: 'no-store',
      signal,
    });
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function toPositiveImageDimension(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.round(numericValue);
}

function cacheImageDimensions(url, width, height) {
  const normalizedWidth = toPositiveImageDimension(width);
  const normalizedHeight = toPositiveImageDimension(height);
  if (!url || !normalizedWidth || !normalizedHeight) {
    return null;
  }

  const nextDimensions = {
    width: normalizedWidth,
    height: normalizedHeight,
  };
  imageDimensionCache.set(url, nextDimensions);
  return nextDimensions;
}

function getCachedImageDimensions(url) {
  return url ? imageDimensionCache.get(url) || null : null;
}

function ensureImageDimensions(url) {
  if (!url) {
    return Promise.resolve(null);
  }

  const cachedDimensions = getCachedImageDimensions(url);
  if (cachedDimensions) {
    return Promise.resolve(cachedDimensions);
  }

  const inflightPromise = imageDimensionLoadPromises.get(url);
  if (inflightPromise) {
    return inflightPromise;
  }

  const nextPromise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    image.onload = () => {
      const dimensions = cacheImageDimensions(
        url,
        image.naturalWidth,
        image.naturalHeight,
      );
      imageDimensionLoadPromises.delete(url);
      resolve(dimensions);
    };
    image.onerror = () => {
      imageDimensionLoadPromises.delete(url);
      resolve(null);
    };
    image.src = url;
  });

  imageDimensionLoadPromises.set(url, nextPromise);
  return nextPromise;
}

async function warmMessageImageDimensions(messages) {
  const imageUrls = Array.from(
    new Set(
      (messages || [])
        .filter(
          (message) => message?.messageType === 'IMAGE' && message?.fileUrl,
        )
        .map((message) => getFileUrl(message.fileUrl))
        .filter(Boolean),
    ),
  );
  if (!imageUrls.length) {
    return;
  }

  await Promise.allSettled(imageUrls.map((url) => ensureImageDimensions(url)));
}

function getImageMarkupAttributes(url) {
  const dimensions = getCachedImageDimensions(url);
  if (!dimensions) {
    return `width="${DEFAULT_MEDIA_PLACEHOLDER_SIZE}" height="${DEFAULT_MEDIA_PLACEHOLDER_SIZE}"`;
  }

  return `width="${dimensions.width}" height="${dimensions.height}"`;
}

function describeMessageAttachment(message, fallbackLabel) {
  const fileName = String(message?.fileName || '').trim();
  if (fileName) {
    return fileName;
  }

  return fallbackLabel;
}

function attachImageFallback(image, fallbackSrc = DEFAULT_AVATAR_URL) {
  if (!image) {
    return;
  }

  image.addEventListener(
    'error',
    () => {
      if (!fallbackSrc || image.src === fallbackSrc) {
        return;
      }

      image.src = fallbackSrc;
    },
    { once: true },
  );
}

async function validateThemeUrl(themeUrl) {
  if (!themeUrl) {
    return false;
  }

  if (verifiedThemeUrls.has(themeUrl)) {
    return verifiedThemeUrls.get(themeUrl);
  }

  try {
    const response = await fetch(themeUrl, {
      method: 'HEAD',
      cache: 'force-cache',
    });
    const isValid = response.ok;
    verifiedThemeUrls.set(themeUrl, isValid);
    return isValid;
  } catch {
    verifiedThemeUrls.set(themeUrl, false);
    return false;
  }
}

function getById(id) {
  return document.getElementById(id);
}

function setSurfaceRefreshState(id, isRefreshing, delayMs = 120) {
  const element = getById(id);
  if (!element) {
    return;
  }

  const timerKey = `${id}:refresh`;
  const existingTimer = surfaceRefreshTimers.get(timerKey);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    surfaceRefreshTimers.delete(timerKey);
  }

  if (!isRefreshing) {
    element.classList.remove('surface-refreshing');
    return;
  }

  if (delayMs <= 0) {
    element.classList.add('surface-refreshing');
    return;
  }

  const timer = window.setTimeout(() => {
    element.classList.add('surface-refreshing');
    surfaceRefreshTimers.delete(timerKey);
  }, delayMs);
  surfaceRefreshTimers.set(timerKey, timer);
}

function readStorageJson(storage, key, fallbackValue) {
  if (!storage || !key) {
    return fallbackValue;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallbackValue;
    }

    const parsed = JSON.parse(raw);
    return parsed ?? fallbackValue;
  } catch (error) {
    console.error('Failed to read stored JSON', error);
    return fallbackValue;
  }
}

function writeStorageJson(storage, key, value) {
  if (!storage || !key) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to write stored JSON', error);
  }
}

function removeStoredValue(storage, key) {
  if (!storage || !key) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch (error) {
    console.warn('Failed to remove stored value', error);
  }
}

function getBrowserStorage(kind = 'local') {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch (error) {
    console.warn(`Failed to access ${kind}Storage`, error);
    return null;
  }
}

function readStoredJson(key, fallbackValue) {
  return readStorageJson(getBrowserStorage('local'), key, fallbackValue);
}

function writeStoredJson(key, value) {
  writeStorageJson(getBrowserStorage('local'), key, value);
}

function readSessionJson(key, fallbackValue) {
  return readStorageJson(getBrowserStorage('session'), key, fallbackValue);
}

function writeSessionJson(key, value) {
  writeStorageJson(getBrowserStorage('session'), key, value);
}

function removeSessionValue(key) {
  removeStoredValue(getBrowserStorage('session'), key);
}

function readStoredValue(key, fallbackValue = '') {
  const storage = getBrowserStorage('local');
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

function writeStoredValue(key, value) {
  const storage = getBrowserStorage('local');
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

function removeStoredKey(key) {
  removeStoredValue(getBrowserStorage('local'), key);
}

function readSessionValue(key, fallbackValue = '') {
  const storage = getBrowserStorage('session');
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

function writeSessionValue(key, value) {
  const storage = getBrowserStorage('session');
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

function scheduleIdleWork(callback, timeout = 500) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout });
    return;
  }

  window.setTimeout(callback, Math.min(timeout, 180));
}

function getScopedPreferenceKey(suffix) {
  return currentUser?.id ? `ochat_${suffix}_${currentUser.id}` : null;
}

function getShellCacheKey() {
  return getScopedPreferenceKey('shell_cache');
}

function getConversationCacheKeyForStorage() {
  return getScopedPreferenceKey('conversation_cache');
}

function loadLocalConversationPreferences() {
  pinnedConversationKeys = new Set(
    readStoredJson(getScopedPreferenceKey('pinned_conversations'), []),
  );
  archivedConversationKeys = new Set(
    readStoredJson(getScopedPreferenceKey('archived_conversations'), []),
  );
  mutedConversationKeys = new Set(
    readStoredJson(getScopedPreferenceKey('muted_conversations'), []),
  );
  starredMessagesById = new Map(
    Object.entries(
      readStoredJson(getScopedPreferenceKey('starred_messages'), {}),
    ),
  );
  const storedMessageReactions = readStoredJson(
    getScopedPreferenceKey('message_reactions'),
    {},
  );
  messageReactionsById = new Map(
    Object.entries(storedMessageReactions)
      .map(([messageId, reactionValue]) => {
        const normalized = normalizeMessageReactionEntry(reactionValue);
        return normalized?.emoji ? [messageId, normalized] : null;
      })
      .filter(Boolean),
  );
  conversationDrafts = new Map(
    Object.entries(readStoredJson(getScopedPreferenceKey('chat_drafts'), {})),
  );
  callHistoryByConversation = new Map(
    Object.entries(readStoredJson(getScopedPreferenceKey('call_history'), {})),
  );
  missedCallCountsByConversation = new Map(
    Object.entries(
      readStoredJson(getScopedPreferenceKey('missed_calls'), {}),
    ).map(([key, value]) => [key, Number(value) || 0]),
  );
  offlineQueuedMessages = readStoredJson(OFFLINE_QUEUE_KEY, []);
  ringtonePreference = readStoredValue(RINGTONE_PREFERENCE_KEY, 'classic');
}

function persistPinnedConversations() {
  writeStoredJson(
    getScopedPreferenceKey('pinned_conversations'),
    Array.from(pinnedConversationKeys),
  );
}

function persistArchivedConversations() {
  writeStoredJson(
    getScopedPreferenceKey('archived_conversations'),
    Array.from(archivedConversationKeys),
  );
}

function persistMutedConversations() {
  writeStoredJson(
    getScopedPreferenceKey('muted_conversations'),
    Array.from(mutedConversationKeys),
  );
}

function persistStarredMessages() {
  writeStoredJson(
    getScopedPreferenceKey('starred_messages'),
    Object.fromEntries(starredMessagesById),
  );
}

function persistMessageReactions() {
  writeStoredJson(
    getScopedPreferenceKey('message_reactions'),
    Object.fromEntries(messageReactionsById),
  );
}

function persistConversationDrafts() {
  writeStoredJson(
    getScopedPreferenceKey('chat_drafts'),
    Object.fromEntries(conversationDrafts),
  );
}

function schedulePersistConversationDrafts() {
  if (conversationDraftPersistTimer) {
    window.clearTimeout(conversationDraftPersistTimer);
  }

  conversationDraftPersistTimer = window.setTimeout(() => {
    conversationDraftPersistTimer = 0;
    scheduleIdleWork(() => {
      persistConversationDrafts();
    }, 700);
  }, CACHE_PERSIST_DEBOUNCE_MS);
}

function persistCallHistory() {
  writeStoredJson(
    getScopedPreferenceKey('call_history'),
    Object.fromEntries(callHistoryByConversation),
  );
}

function persistMissedCalls() {
  writeStoredJson(
    getScopedPreferenceKey('missed_calls'),
    Object.fromEntries(missedCallCountsByConversation),
  );
}

function persistOfflineQueuedMessages() {
  writeStoredJson(OFFLINE_QUEUE_KEY, offlineQueuedMessages);
}

function getFileUrl(path) {
  if (!path) {
    return '';
  }

  if (
    String(path).startsWith('http://') ||
    String(path).startsWith('https://')
  ) {
    return path;
  }

  return `${API_URL}${path}`;
}

function keyBackupRuntime() {
  return window.__OCHAT_KEY_BACKUP__ || {};
}

function readKeyBackupUnlockMaterial(userId) {
  return keyBackupRuntime().readKeyBackupUnlockMaterial?.(userId) || '';
}

function storeKeyBackupUnlockMaterial(userId, unlockMaterial) {
  keyBackupRuntime().storeKeyBackupUnlockMaterial?.(userId, unlockMaterial);
}

function clearKeyBackupUnlockMaterial(userId) {
  keyBackupRuntime().clearKeyBackupUnlockMaterial?.(userId);
}

async function encryptPrivateKeyBackupForUser(
  privateKey,
  userId,
  unlockMaterial,
) {
  if (!privateKey || !userId) {
    return null;
  }

  const resolvedUnlockMaterial =
    unlockMaterial || readKeyBackupUnlockMaterial(userId);
  if (!resolvedUnlockMaterial) {
    return null;
  }

  return (
    (await keyBackupRuntime().encryptPrivateKeyBackup?.(
      privateKey,
      resolvedUnlockMaterial,
    )) || null
  );
}

async function restorePrivateKeyBackupForUser(
  userId,
  privateKeyBackupCiphertext,
  privateKeyBackupIv,
) {
  const unlockMaterial = readKeyBackupUnlockMaterial(userId);
  if (!userId || !unlockMaterial) {
    return '';
  }

  return (
    (await keyBackupRuntime().decryptPrivateKeyBackup?.(
      privateKeyBackupCiphertext,
      privateKeyBackupIv,
      unlockMaterial,
    )) || ''
  );
}

async function resolveCurrentUserPrivateKeyForBackup() {
  if (!currentUser?.id) {
    return '';
  }

  const storedPrivateKey = readStoredValue(
    privateKeyStorageKey(currentUser.id),
    '',
  );
  if (storedPrivateKey) {
    return storedPrivateKey;
  }

  if (
    !currentUser.privateKeyBackupCiphertext ||
    !currentUser.privateKeyBackupIv
  ) {
    return '';
  }

  try {
    const restoredPrivateKey = await restorePrivateKeyBackupForUser(
      currentUser.id,
      currentUser.privateKeyBackupCiphertext,
      currentUser.privateKeyBackupIv,
    );
    if (!restoredPrivateKey) {
      return '';
    }

    writeStoredValue(privateKeyStorageKey(currentUser.id), restoredPrivateKey);
    if (currentUser.publicKey) {
      writeStoredValue(
        publicKeyStorageKey(currentUser.id),
        currentUser.publicKey,
      );
    }
    return restoredPrivateKey;
  } catch (error) {
    console.warn(
      'Failed to restore your message key before changing password',
      error,
    );
    return '';
  }
}

function canUseWebPush() {
  return (
    !isFileOrigin &&
    !isDesktopRuntime &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function canUseE2EE() {
  return Boolean(window.crypto?.subtle);
}

function privateKeyStorageKey(userId) {
  return `chat_private_key_${userId}`;
}

function publicKeyStorageKey(userId) {
  return `chat_public_key_${userId}`;
}

function normalizeEncryptionKeyValue(value) {
  return String(value || '').trim();
}

function parseEncryptedKeyMap(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (typeof value === 'object' && value !== null) {
    return value;
  }

  return {};
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

async function importPublicEncryptionKey(publicKey) {
  return window.crypto.subtle.importKey(
    'spki',
    base64ToUint8Array(normalizeEncryptionKeyValue(publicKey)),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['encrypt'],
  );
}

async function importPrivateEncryptionKey(privateKey) {
  return window.crypto.subtle.importKey(
    'pkcs8',
    base64ToUint8Array(normalizeEncryptionKeyValue(privateKey)),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['decrypt'],
  );
}

function areUint8ArraysEqual(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

async function doesEncryptionKeyPairMatch(privateKey, publicKey) {
  if (!privateKey || !publicKey || !canUseE2EE()) {
    return false;
  }

  try {
    const importedPrivateKey = await importPrivateEncryptionKey(privateKey);
    const importedPublicKey = await importPublicEncryptionKey(publicKey);
    const probe = window.crypto.getRandomValues(new Uint8Array(32));
    const encryptedProbe = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      importedPublicKey,
      probe,
    );
    const decryptedProbe = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      importedPrivateKey,
      encryptedProbe,
    );

    return areUint8ArraysEqual(probe, new Uint8Array(decryptedProbe));
  } catch (error) {
    console.warn('Failed to validate encryption key pair', error);
    return false;
  }
}

async function generateAndPersistEncryptionKeyPair(userId) {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const privateKey = arrayBufferToBase64(
    await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  );
  const publicKey = arrayBufferToBase64(
    await window.crypto.subtle.exportKey('spki', keyPair.publicKey),
  );

  writeStoredValue(privateKeyStorageKey(userId), privateKey);
  writeStoredValue(publicKeyStorageKey(userId), publicKey);

  return {
    privateKey,
    publicKey,
  };
}

async function ensureEncryptionKeys(forceSync = false) {
  if (!currentUser?.id || !canUseE2EE()) {
    return;
  }

  currentPrivateKey = null;

  let savedPrivateKey = normalizeEncryptionKeyValue(
    readStoredValue(privateKeyStorageKey(currentUser.id), ''),
  );
  let savedPublicKey = normalizeEncryptionKeyValue(
    readStoredValue(publicKeyStorageKey(currentUser.id), ''),
  );
  let generatedNewKeyPair = false;
  const serverPublicKey = String(currentUser.publicKey || '').trim();
  const hasServerKeyBackup = Boolean(
    currentUser.privateKeyBackupCiphertext && currentUser.privateKeyBackupIv,
  );
  let restoredFromServerKeyBackup = false;

  if (savedPrivateKey && savedPublicKey) {
    const keyReference = serverPublicKey || savedPublicKey;
    const localPublicKeyMismatch = Boolean(
      serverPublicKey && savedPublicKey !== serverPublicKey,
    );
    const localKeyPairMatches = await doesEncryptionKeyPairMatch(
      savedPrivateKey,
      keyReference,
    );

    if (localPublicKeyMismatch || !localKeyPairMatches) {
      console.warn(
        'Stored encryption keys are out of sync with the current account key state',
        {
          userId: currentUser.id,
          localPublicKeyMismatch,
          hasServerKeyBackup,
        },
      );

      savedPrivateKey = '';
      savedPublicKey = '';
      writeStoredValue(privateKeyStorageKey(currentUser.id), '');
      writeStoredValue(publicKeyStorageKey(currentUser.id), '');
      if (serverPublicKey) {
        console.warn(
          'Unable to reuse existing encryption keys; generating a fresh key pair for this device.',
          { userId: currentUser.id },
        );
      }
    }
  }

  if (
    (!savedPrivateKey || !savedPublicKey) &&
    currentUser.privateKeyBackupCiphertext &&
    currentUser.privateKeyBackupIv
  ) {
    try {
      const restoredPrivateKey = await restorePrivateKeyBackupForUser(
        currentUser.id,
        currentUser.privateKeyBackupCiphertext,
        currentUser.privateKeyBackupIv,
      );
      if (restoredPrivateKey && currentUser.publicKey) {
        const restoredKeyMatches = await doesEncryptionKeyPairMatch(
          restoredPrivateKey,
          currentUser.publicKey,
        );
        if (!restoredKeyMatches) {
          console.warn(
            'Restored key backup does not match the current account public key. Clearing stale unlock material and falling back to a fresh key pair.',
            { userId: currentUser.id },
          );
          clearKeyBackupUnlockMaterial(currentUser.id);
        } else {
          savedPrivateKey = restoredPrivateKey;
          savedPublicKey = currentUser.publicKey;
          restoredFromServerKeyBackup = true;
          writeStoredValue(
            privateKeyStorageKey(currentUser.id),
            restoredPrivateKey,
          );
          writeStoredValue(
            publicKeyStorageKey(currentUser.id),
            currentUser.publicKey,
          );
        }
      }
    } catch (error) {
      console.error('Failed to restore your message decryption key', error);
    }
  }

  if (!savedPrivateKey || !savedPublicKey) {
    if (hasServerKeyBackup && !restoredFromServerKeyBackup) {
      console.warn(
        'Encrypted key backup could not be restored; generating a new key pair to continue login.',
        { userId: currentUser.id },
      );
    }

    const generatedKeys = await generateAndPersistEncryptionKeyPair(
      currentUser.id,
    );
    savedPrivateKey = generatedKeys.privateKey;
    savedPublicKey = generatedKeys.publicKey;
    generatedNewKeyPair = true;
  }

  currentPrivateKey = await importPrivateEncryptionKey(savedPrivateKey);
  retryConversationDecryption();

  const keyBackupPayload = await encryptPrivateKeyBackupForUser(
    savedPrivateKey,
    currentUser.id,
  );
  const shouldSyncBackup = Boolean(
    keyBackupPayload &&
    (!currentUser.privateKeyBackupCiphertext ||
      !currentUser.privateKeyBackupIv ||
      generatedNewKeyPair ||
      currentUser.publicKey !== savedPublicKey),
  );
  const shouldSyncPublicKey = Boolean(!serverPublicKey && savedPublicKey);

  if (forceSync || shouldSyncPublicKey || shouldSyncBackup) {
    const res = await api('/users/keys/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: savedPublicKey,
        ...(shouldSyncBackup ? keyBackupPayload : {}),
      }),
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to sync your encryption key.',
    );
    if (!res.ok) {
      throw new Error(data.message || 'Failed to sync your encryption key');
    }
    currentUser = {
      ...currentUser,
      ...data,
      publicKey: savedPublicKey,
      ...(shouldSyncBackup ? keyBackupPayload : {}),
    };
  }
}

async function ensureSelectedConversationHasKeys(user = selectedUser) {
  if (!user) {
    throw new Error('No conversation selected');
  }

  let conversation = user;

  if (isGroupConversation(conversation)) {
    const missingMemberKey = !(conversation.members || []).every(
      (member) => member.userId === currentUser.id || member.publicKey,
    );
    if (!conversation.members?.length || missingMemberKey) {
      const res = await api(
        `/chat/groups/${encodeURIComponent(conversation.id)}`,
      );
      const data = await readJsonResponse(
        res,
        {},
        'Failed to load group encryption keys.',
      );
      if (!res.ok) {
        throw new Error(data.message || 'Failed to load group encryption keys');
      }
      const merged = normalizeUser(
        { ...data, chatType: 'group' },
        conversation,
      );
      users = users.map((user) => (user.id === merged.id ? merged : user));
      groupDetailsCache.set(merged.id, merged);
      if (isSameConversation(conversation, selectedUser)) {
        selectedUser = merged;
      }
      conversation = merged;
    }
    return conversation;
  }

  if (!conversation.publicKey) {
    await loadUsers();
    const refreshedConversation = users.find(
      (candidate) =>
        candidate.id === conversation.id &&
        Boolean(isGroupConversation(candidate)) ===
        Boolean(isGroupConversation(conversation)),
    );
    if (refreshedConversation) {
      conversation = refreshedConversation;
      if (isSameConversation(conversation, selectedUser)) {
        selectedUser = refreshedConversation;
      }
    }
  }

  if (!conversation.publicKey) {
    throw new Error(
      `${displayName(conversation)} has not set up encryption yet.`,
    );
  }

  return conversation;
}

async function encryptTextForConversation(plainText, user = selectedUser) {
  await ensureEncryptionKeys();
  const conversation = await ensureSelectedConversationHasKeys(user);

  if (!currentPrivateKey || !currentUser?.publicKey) {
    throw new Error('Your encryption keys are not ready yet.');
  }

  const recipients = isGroupConversation(conversation)
    ? (conversation.members || []).map((member) => ({
      userId: member.userId,
      publicKey:
        member.userId === currentUser.id
          ? currentUser.publicKey
          : member.publicKey,
    }))
    : [
      { userId: currentUser.id, publicKey: currentUser.publicKey },
      { userId: conversation.id, publicKey: conversation.publicKey },
    ];

  if (recipients.some((recipient) => !recipient.publicKey)) {
    throw new Error('One or more recipients are missing encryption keys.');
  }

  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(plainText),
  );

  const encryptedKeyMap = {};
  for (const recipient of recipients) {
    const importedKey = await importPublicEncryptionKey(recipient.publicKey);
    const wrappedKey = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      importedKey,
      rawAesKey,
    );
    encryptedKeyMap[recipient.userId] = arrayBufferToBase64(wrappedKey);
  }

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    encryptedKey: JSON.stringify(encryptedKeyMap),
    iv: arrayBufferToBase64(iv),
    algorithm: 'RSA-OAEP/AES-GCM',
  };
}

async function decryptTextMessage(message) {
  if (!shouldTreatMessageAsEncrypted(message)) {
    return message?.content || message?.ciphertext || '';
  }

  const ciphertextValue =
    message?.ciphertext ||
    (looksEncryptedPayload(message?.content) ? message.content.trim() : '');

  if (!ciphertextValue) {
    return '[Encrypted message]';
  }

  if (
    typeof message.displayText === 'string' &&
    ['[Encrypted message]', '[Unable to decrypt message]'].includes(
      String(message.displayText).trim(),
    )
  ) {
    message.displayText = 'Decrypting message...';
  }

  if (
    typeof message.displayText === 'string' &&
    message.displayText.trim() &&
    !['Decrypting message...', 'Decrypting message…'].includes(
      String(message.displayText),
    )
  ) {
    return message.displayText;
  }

  try {
    await ensureEncryptionKeys();
    const encryptedKeyMap = parseEncryptedKeyMap(message.encryptedKey);
    const wrappedKey = encryptedKeyMap[String(currentUser?.id)];
    if (!wrappedKey || !message.iv || !currentPrivateKey) {
      message.displayText = 'Decrypting message...';
      return message.displayText;
    }

    const rawAesKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      currentPrivateKey,
      base64ToUint8Array(wrappedKey),
    );
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      rawAesKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToUint8Array(message.iv) },
      aesKey,
      base64ToUint8Array(ciphertextValue),
    );
    message.displayText = new TextDecoder().decode(decrypted);
    message.decryptFailedAt = null;
    return message.displayText;
  } catch (error) {
    console.error('Failed to decrypt message', error);
    message.displayText = '[Unable to decrypt message]';
    message.decryptFailedAt = Date.now();
    return message.displayText;
  }
}

async function hydrateMessage(message) {
  if (!message) {
    return message;
  }

  if (message.messageType === 'TEXT') {
    message.displayText = applyStructuredMessageData(
      message,
      await decryptTextMessage(message),
    );
  } else {
    message.displayText = message.content || '';
  }

  return message;
}

function isGroupConversation(user) {
  return user?.chatType === 'group';
}

function conversationRoomId(user) {
  return user?.id || null;
}

function createMessagePaginationState(loadedForUserId = null) {
  return {
    nextBefore: null,
    hasMore: false,
    loadingOlder: false,
    loadedForUserId,
    scrollReadyAt: 0,
  };
}

function getConversationCacheKey(user) {
  if (!user?.id) {
    return null;
  }

  return `${isGroupConversation(user) ? 'group' : 'direct'}:${user.id}`;
}

function isSameConversation(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    Boolean(isGroupConversation(left)) === Boolean(isGroupConversation(right))
  );
}

function isConversationStillActive(user, key = getConversationCacheKey(user)) {
  return Boolean(
    user &&
    key &&
    activeConversationCacheKey === key &&
    isSameConversation(user, selectedUser),
  );
}

function isConversationPinned(user) {
  const key = getConversationCacheKey(user);
  return Boolean(key && pinnedConversationKeys.has(key));
}

function isConversationArchived(user) {
  const key = getConversationCacheKey(user);
  return Boolean(key && archivedConversationKeys.has(key));
}

function isConversationMuted(user) {
  const key = getConversationCacheKey(user);
  return Boolean(key && mutedConversationKeys.has(key));
}

function getConversationDraft(user = selectedUser) {
  const key = getConversationCacheKey(user);
  if (!key) {
    return '';
  }

  return String(conversationDrafts.get(key) || '');
}

function saveConversationDraft(user = selectedUser, text = '') {
  const key = getConversationCacheKey(user);
  if (!key) {
    return;
  }

  const trimmed = String(text || '').trim();
  if (trimmed) {
    conversationDrafts.set(key, text);
  } else {
    conversationDrafts.delete(key);
  }
  schedulePersistConversationDrafts();
  scheduleUserListDraftPreviewSync(user, { immediate: !trimmed });
}

function restoreComposerDraft(user = selectedUser) {
  const input = getById('msg-input');
  if (!input) {
    return;
  }

  input.value = getConversationDraft(user);
}

function clearConversationDraft(user = selectedUser) {
  saveConversationDraft(user, '');
  const input = getById('msg-input');
  if (input && user?.id === selectedUser?.id) {
    input.value = '';
  }
}

function isMessageStarred(messageId) {
  return Boolean(messageId && starredMessagesById.has(messageId));
}

function buildStarredMessageEntry(message) {
  const sender =
    message.senderId === currentUser?.id
      ? { name: 'You' }
      : peopleDirectory.find((user) => user.id === message.senderId) ||
      users.find((user) => user.id === message.senderId) ||
      null;

  return {
    id: message.id,
    conversationKey: message.groupId
      ? `group:${message.groupId}`
      : `direct:${message.senderId === currentUser?.id
        ? message.receiverId
        : message.senderId
      }`,
    preview: getMessagePreview(message),
    createdAt: message.createdAt,
    senderName: sender ? displayName(sender) : 'Someone',
    messageType: message.messageType,
  };
}

function getStarredMessagesForConversation(user = selectedUser) {
  const conversationKey = getConversationCacheKey(user);
  if (!conversationKey) {
    return [];
  }

  return Array.from(starredMessagesById.values())
    .filter((entry) => entry.conversationKey === conversationKey)
    .sort(
      (left, right) =>
        new Date(right.createdAt || 0).getTime() -
        new Date(left.createdAt || 0).getTime(),
    );
}

function createConversationHistoryState(user = null, overrides = {}) {
  return {
    renderedMessageIds: new Set(),
    conversationMessages: new Map(),
    pagination: createMessagePaginationState(user?.id ?? null),
    initialized: false,
    scrollTop: null,
    fetchedAt: 0,
    hydratedFromDisk: false,
    ...overrides,
  };
}

function getConversationHistoryState(user, createIfMissing = true) {
  const key = getConversationCacheKey(user);
  if (!key) {
    return null;
  }

  let state = conversationHistoryCache.get(key);
  if (!state && createIfMissing) {
    state = createConversationHistoryState(user);
    conversationHistoryCache.set(key, state);
  }

  return state;
}

function activateConversationHistory(user) {
  const key = getConversationCacheKey(user);
  const state =
    (key && getConversationHistoryState(user, true)) ||
    createConversationHistoryState(user);

  activeConversationCacheKey = key;
  renderedMessageIds = state.renderedMessageIds;
  conversationMessages = state.conversationMessages;
  messagePagination = state.pagination;

  if (!messagePagination.loadedForUserId) {
    messagePagination.loadedForUserId = user?.id ?? null;
  }

  return state;
}

function rememberActiveConversationScroll() {
  if (!activeConversationCacheKey) {
    return;
  }

  const state = conversationHistoryCache.get(activeConversationCacheKey);
  const container = document.getElementById('message-container');
  if (!state || !container) {
    return;
  }

  state.scrollTop = container.scrollTop;
  schedulePersistConversationHistoryCache();
}

function replaceConversationHistoryState(user, overrides = {}) {
  const key = getConversationCacheKey(user);
  if (!key) {
    return createConversationHistoryState(user, overrides);
  }

  const nextState = createConversationHistoryState(user, overrides);
  conversationHistoryCache.set(key, nextState);

  if (key === activeConversationCacheKey) {
    renderedMessageIds = nextState.renderedMessageIds;
    conversationMessages = nextState.conversationMessages;
    messagePagination = nextState.pagination;
  }

  schedulePersistConversationHistoryCache();
  return nextState;
}

function compareMessagesChronologically(left, right) {
  const leftTime = new Date(left?.createdAt || 0).getTime();
  const rightTime = new Date(right?.createdAt || 0).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function sortMessagesChronologically(messages) {
  return [...messages].sort(compareMessagesChronologically);
}

function getRenderedMessageId(element) {
  const elementId = String(element?.id || '');
  if (!elementId.startsWith('message-')) {
    return '';
  }

  return elementId.slice('message-'.length);
}

function renderMessageInConversationOrder(message, options = {}) {
  if (!selectedUser || !message || !belongsToSelectedConversation(message)) {
    return { rendered: false, insertedAtEnd: false };
  }

  const list = document.getElementById('messages-list');
  if (!list) {
    return { rendered: false, insertedAtEnd: false };
  }

  const existingElement = document.getElementById(`message-${message.id}`);
  conversationMessages.set(message.id, message);
  renderedMessageIds.add(message.id);

  let insertBeforeElement = null;
  for (const child of Array.from(list.children)) {
    const childMessageId = getRenderedMessageId(child);
    if (!childMessageId || childMessageId === message.id) {
      continue;
    }

    const existingMessage = conversationMessages.get(childMessageId);
    if (
      existingMessage &&
      compareMessagesChronologically(message, existingMessage) < 0
    ) {
      insertBeforeElement = child;
      break;
    }
  }

  const nextElement = createMessageElement(message, {
    animate: options.animate !== false && !existingElement,
  });
  existingElement?.remove();

  if (insertBeforeElement) {
    list.insertBefore(nextElement, insertBeforeElement);
    return { rendered: true, insertedAtEnd: false };
  }

  list.appendChild(nextElement);
  return { rendered: true, insertedAtEnd: true };
}

function renderActiveConversationFromCache(options = {}) {
  const list = document.getElementById('messages-list');
  const container = document.getElementById('message-container');
  if (!list || !container) {
    return;
  }

  const messages = sortMessagesChronologically(conversationMessages.values());
  renderedMessageIds.clear();
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    if (message?.id) {
      renderedMessageIds.add(message.id);
    }
    fragment.appendChild(createMessageElement(message, { animate: false }));
  }

  list.innerHTML = '';
  list.appendChild(fragment);
  scheduleStructuredMessageRefresh();

  window.requestAnimationFrame(() => {
    const state = activeConversationCacheKey
      ? conversationHistoryCache.get(activeConversationCacheKey)
      : null;
    if (!state) {
      return;
    }

    if (options.restoreScroll === true && typeof state.scrollTop === 'number') {
      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      container.scrollTop = Math.min(state.scrollTop, maxScrollTop);
      return;
    }

    if (messages.length) {
      scheduleMessageContainerBottom(400);
    } else {
      container.scrollTop = 0;
    }
  });
}

function cacheMessageForConversation(message) {
  if (!message?.id) {
    return;
  }

  const conversationId = message.groupId
    ? message.groupId
    : message.senderId === currentUser?.id
      ? message.receiverId
      : message.senderId;

  if (!conversationId) {
    return;
  }

  const cacheKey = `${message.groupId ? 'group' : 'direct'}:${conversationId}`;
  const state = conversationHistoryCache.get(cacheKey);
  if (!state) {
    return;
  }

  state.conversationMessages.set(message.id, message);
  state.fetchedAt = Date.now();
  schedulePersistConversationHistoryCache();
}

function updateCachedMessageEverywhere(message) {
  if (!message?.id) {
    return;
  }

  for (const state of conversationHistoryCache.values()) {
    if (state.conversationMessages.has(message.id)) {
      state.conversationMessages.set(message.id, message);
      state.fetchedAt = Date.now();
    }
  }

  schedulePersistConversationHistoryCache();
}

function removeCachedMessageEverywhere(messageId) {
  if (!messageId) {
    return;
  }

  for (const state of conversationHistoryCache.values()) {
    state.renderedMessageIds.delete(messageId);
    state.conversationMessages.delete(messageId);
  }

  schedulePersistConversationHistoryCache();
}

function serializeConversationStateForCache(key, state) {
  if (!key || !state?.initialized) {
    return null;
  }

  const messages = sortMessagesChronologically(
    state.conversationMessages.values(),
  )
    .filter((message) => message?.id && !message?.isPending)
    .slice(-MAX_PERSISTED_MESSAGES_PER_CONVERSATION)
    .map((message) => ({ ...message }));

  if (!messages.length) {
    return null;
  }

  return {
    key,
    initialized: true,
    scrollTop:
      typeof state.scrollTop === 'number' && Number.isFinite(state.scrollTop)
        ? Math.max(0, state.scrollTop)
        : null,
    fetchedAt: Number(state.fetchedAt || 0),
    pagination: {
      nextBefore: state.pagination?.nextBefore || null,
      hasMore: Boolean(state.pagination?.hasMore),
      loadedForUserId: state.pagination?.loadedForUserId || null,
    },
    messages,
  };
}

function getPersistedConversationStateEntries() {
  return Array.from(conversationHistoryCache.entries())
    .map(([key, state]) => {
      const conversationId = String(key || '').split(':')[1] || '';
      return {
        key,
        state,
        rank:
          key === activeConversationCacheKey
            ? Number.MAX_SAFE_INTEGER
            : Number(
              recentActivity.get(conversationId)?.lastAt ||
              state?.fetchedAt ||
              0,
            ),
      };
    })
    .sort((left, right) => right.rank - left.rank)
    .slice(0, MAX_PERSISTED_CONVERSATIONS)
    .map(({ key, state }) => serializeConversationStateForCache(key, state))
    .filter(Boolean);
}

function persistConversationHistoryCache() {
  if (!currentUser?.id) {
    return;
  }

  const key = getConversationCacheKeyForStorage();
  const items = getPersistedConversationStateEntries();
  if (!items.length) {
    removeSessionValue(key);
    return;
  }

  writeSessionJson(key, {
    version: CLIENT_CACHE_VERSION,
    savedAt: Date.now(),
    items,
  });
}

function schedulePersistConversationHistoryCache() {
  if (!currentUser?.id) {
    return;
  }

  if (conversationCachePersistTimer) {
    window.clearTimeout(conversationCachePersistTimer);
  }

  conversationCachePersistTimer = window.setTimeout(() => {
    conversationCachePersistTimer = 0;
    scheduleIdleWork(() => {
      persistConversationHistoryCache();
    }, 700);
  }, CACHE_PERSIST_DEBOUNCE_MS);
}

function restoreConversationHistoryCacheFromSession() {
  const payload = readSessionJson(getConversationCacheKeyForStorage(), null);
  if (
    !payload ||
    payload.version !== CLIENT_CACHE_VERSION ||
    !Array.isArray(payload.items) ||
    getCacheAgeMs(payload.savedAt) > CONVERSATION_CACHE_MAX_AGE_MS
  ) {
    return false;
  }

  conversationHistoryCache.clear();
  for (const item of payload.items) {
    if (!item?.key || !Array.isArray(item.messages)) {
      continue;
    }

    const state = createConversationHistoryState(null, {
      initialized: Boolean(item.initialized),
      scrollTop:
        typeof item.scrollTop === 'number' && Number.isFinite(item.scrollTop)
          ? Math.max(0, item.scrollTop)
          : null,
      fetchedAt: Number(item.fetchedAt || 0),
      hydratedFromDisk: true,
      pagination: {
        ...createMessagePaginationState(
          item.pagination?.loadedForUserId ?? null,
        ),
        nextBefore: item.pagination?.nextBefore || null,
        hasMore: Boolean(item.pagination?.hasMore),
        loadedForUserId: item.pagination?.loadedForUserId || null,
      },
    });

    for (const rawMessage of item.messages) {
      const message = createRenderableMessage(rawMessage);
      if (!message?.id) {
        continue;
      }
      state.conversationMessages.set(message.id, message);
      state.renderedMessageIds.add(message.id);
    }

    if (state.conversationMessages.size) {
      conversationHistoryCache.set(item.key, state);
    }
  }

  return conversationHistoryCache.size > 0;
}

function shouldRefreshConversationHistoryState(state) {
  if (!state?.initialized) {
    return true;
  }

  if (state.hydratedFromDisk) {
    return true;
  }

  return getCacheAgeMs(state.fetchedAt) > CONVERSATION_CACHE_TTL_MS;
}

function clearScopedRuntimeCaches() {
  removeStoredKey(getShellCacheKey());
  removeSessionValue(getConversationCacheKeyForStorage());
}

function currentTypingUsers() {
  if (!selectedUser) {
    return [];
  }

  const roomId = conversationRoomId(selectedUser);
  return Array.from(typingUsers.get(roomId) || []);
}

function typingDisplayName(userId) {
  if (!userId) {
    return 'Someone';
  }

  if (isGroupConversation(selectedUser)) {
    const member = (selectedUser?.members || []).find(
      (entry) => entry.userId === userId,
    );
    if (member) {
      return member.name || member.email || 'Someone';
    }
  }

  const user = users.find((entry) => entry.id === userId);
  return displayName(user || selectedUser) || 'Someone';
}

function formatTypingStatus(activeTypingUsers) {
  if (!activeTypingUsers.length) {
    return '';
  }

  const names = activeTypingUsers.map((userId) => typingDisplayName(userId));
  if (names.length === 1) {
    return `${names[0]} is typing...`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing...`;
  }
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more are typing...`;
}

function looksEncryptedPayload(value) {
  const text = String(value || '').trim();
  if (text.length < 24 || /\s/.test(text)) {
    return false;
  }

  return /^[A-Za-z0-9+/=_-]+$/.test(text) && /[+/=]/.test(text);
}

function shouldTreatMessageAsEncrypted(message) {
  if (!message) {
    return false;
  }

  return Boolean(
    message.isEncrypted ||
    message.ciphertext ||
    message.encryptedKey ||
    message.iv ||
    looksEncryptedPayload(message.content) ||
    looksEncryptedPayload(message.displayText),
  );
}

function syncGroupAvatarLabel(inputId, labelId, fallbackLabel) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  const fileName =
    input?.files && input.files[0] ? input.files[0].name : fallbackLabel;
  label.innerText = fileName;
}

function formatMessageTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeTime(value) {
  if (!value) {
    return '';
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDurationCompact(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 'under a minute';
  }

  const totalMinutes = Math.max(1, Math.round(durationMs / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.round(totalMinutes / 60);
  if (totalHours < 48) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

function encodeStructuredPayload(payload) {
  try {
    return window.btoa(
      unescape(encodeURIComponent(JSON.stringify(payload ?? {}))),
    );
  } catch (error) {
    console.error('Failed to encode structured message payload', error);
    return '';
  }
}

function decodeStructuredPayload(payload) {
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(escape(window.atob(payload))));
  } catch {
    return null;
  }
}

function encodeReplyPayload(replyMeta) {
  if (!replyMeta) {
    return '';
  }

  return encodeStructuredPayload({
    id: replyMeta.id,
    senderName: String(replyMeta.senderName || ''),
    preview: String(replyMeta.preview || ''),
  });
}

function decodeReplyPayload(payload) {
  const parsed = decodeStructuredPayload(payload);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  return {
    id: String(parsed.id || ''),
    senderName: String(parsed.senderName || 'Message'),
    preview: String(parsed.preview || ''),
  };
}

function normalizeCapsuleMeta(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const unlockAtValue = String(payload.unlockAt || '').trim();
  const unlockAt = new Date(unlockAtValue);
  if (Number.isNaN(unlockAt.getTime())) {
    return null;
  }

  return {
    unlockAt: unlockAt.toISOString(),
    note: String(payload.note || '')
      .trim()
      .slice(0, 120),
  };
}

function decodeCapsulePayload(payload) {
  return normalizeCapsuleMeta(decodeStructuredPayload(payload));
}

function decodeSpoilerPayload(payload) {
  const parsed = decodeStructuredPayload(payload);
  if (parsed === null) {
    return null;
  }

  return {
    label: String(parsed.label || '')
      .trim()
      .slice(0, 40),
  };
}

function applyStructuredMessageData(message, rawText) {
  let text = String(rawText || '');
  const originalText = text;
  let strippedAnyPrefix = false;

  message.replyMeta = null;
  message.capsuleMeta = null;
  message.spoilerMeta = null;

  while (text) {
    const match = text.match(STRUCTURED_MESSAGE_PREFIX_PATTERN);
    if (!match) {
      break;
    }

    const [prefix, directive, payload] = match;
    let handled = true;
    if (directive === 'REPLY') {
      message.replyMeta = decodeReplyPayload(payload);
    } else if (directive === 'CAPSULE') {
      message.capsuleMeta = decodeCapsulePayload(payload);
    } else if (directive === 'SPOILER') {
      message.spoilerMeta = decodeSpoilerPayload(payload) || { label: '' };
    } else {
      handled = false;
    }

    if (!handled) {
      break;
    }

    strippedAnyPrefix = true;
    text = text.slice(prefix.length);
  }

  return strippedAnyPrefix ? text : originalText;
}

function normalizeStructuredSendOptions(options = {}) {
  if (
    options &&
    typeof options === 'object' &&
    ('replyMeta' in options ||
      'capsuleMeta' in options ||
      'spoilerMeta' in options)
  ) {
    return {
      replyMeta:
        options.replyMeta === undefined ? replyTarget : options.replyMeta,
      capsuleMeta: options.capsuleMeta || null,
      spoilerMeta: options.spoilerMeta || null,
    };
  }

  return {
    replyMeta: options || replyTarget,
    capsuleMeta: null,
    spoilerMeta: null,
  };
}

function encodeMessageForSend(text, options = {}) {
  const trimmed = String(text || '').trim();
  const normalized = normalizeStructuredSendOptions(options);
  const prefixes = [];

  if (normalized.replyMeta) {
    const encodedReply = encodeReplyPayload(normalized.replyMeta);
    if (encodedReply) {
      prefixes.push(`[[OCHAT_REPLY:${encodedReply}]]`);
    }
  }

  if (normalized.capsuleMeta) {
    const capsuleMeta = normalizeCapsuleMeta(normalized.capsuleMeta);
    const encodedCapsule = capsuleMeta
      ? encodeStructuredPayload(capsuleMeta)
      : '';
    if (encodedCapsule) {
      prefixes.push(`[[OCHAT_CAPSULE:${encodedCapsule}]]`);
    }
  }

  if (normalized.spoilerMeta) {
    const encodedSpoiler = encodeStructuredPayload({
      label: String(normalized.spoilerMeta.label || '')
        .trim()
        .slice(0, 40),
    });
    if (encodedSpoiler) {
      prefixes.push(`[[OCHAT_SPOILER:${encodedSpoiler}]]`);
    }
  }

  return prefixes.length ? `${prefixes.join('\n')}\n${trimmed}` : trimmed;
}

function isMessageTimeCapsule(message) {
  return Boolean(message?.capsuleMeta?.unlockAt);
}

function getMessageCapsuleUnlockTimestamp(message) {
  if (!isMessageTimeCapsule(message)) {
    return Number.NaN;
  }

  return new Date(message.capsuleMeta.unlockAt).getTime();
}

function isMessageTimeCapsuleLocked(message) {
  const unlockAt = getMessageCapsuleUnlockTimestamp(message);
  if (!Number.isFinite(unlockAt)) {
    return false;
  }

  return unlockAt > Date.now() && message?.senderId !== currentUser?.id;
}

function isMessageSpoiler(message) {
  return Boolean(message?.spoilerMeta);
}

function isSpoilerMessageRevealed(message) {
  return Boolean(message?.id && revealedSpoilerMessageIds.has(message.id));
}

function isMessageSpoilerHidden(message) {
  return (
    isMessageSpoiler(message) &&
    message?.senderId !== currentUser?.id &&
    !isSpoilerMessageRevealed(message)
  );
}

function getTimeCapsuleUnlockLabel(message) {
  const unlockTimestamp = getMessageCapsuleUnlockTimestamp(message);
  if (!Number.isFinite(unlockTimestamp)) {
    return '';
  }

  const unlockDate = new Date(unlockTimestamp);
  const timeLabel = unlockDate.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const countdown = formatDurationCompact(unlockTimestamp - Date.now());

  if (unlockTimestamp > Date.now()) {
    return `Opens ${timeLabel} (${countdown})`;
  }

  return `Opened ${timeLabel}`;
}

function formatDateTimeInputValue(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDefaultTimeCapsuleUnlockAt(now = Date.now()) {
  return new Date(
    now + Math.max(TIME_CAPSULE_MIN_LEAD_MS, 2 * 60 * 60 * 1000),
  ).toISOString();
}

function syncComposerActionToggle(button, status, isActive) {
  if (!button || !status) {
    return;
  }

  button.classList.toggle('bg-amber-100', isActive);
  button.classList.toggle('text-amber-800', isActive);
  button.classList.toggle('border', isActive);
  button.classList.toggle('border-amber-200', isActive);
  status.textContent = isActive ? 'On' : 'Off';
  status.classList.toggle('text-amber-700', isActive);
  status.classList.toggle('text-slate-400', !isActive);
}

function renderSpecialMessageDraftPreview() {
  const preview = getById('special-message-preview');
  const summary = getById('special-message-summary');
  const note = getById('special-message-note');
  const clearButton = getById('special-message-clear-btn');
  const capsuleControls = getById('time-capsule-controls');
  const spoilerControls = getById('spoiler-controls');
  const capsuleInput = getById('time-capsule-input');
  const capsuleNoteInput = getById('time-capsule-note-input');

  if (
    !preview ||
    !summary ||
    !note ||
    !clearButton ||
    !capsuleControls ||
    !spoilerControls
  ) {
    return;
  }

  const hasCapsule = Boolean(specialMessageDraft.capsule.enabled);
  const hasSpoiler = Boolean(specialMessageDraft.spoiler);
  const hasDraft = hasCapsule || hasSpoiler;
  preview.classList.toggle('hidden', !hasDraft);
  clearButton.classList.toggle('hidden', !hasDraft);
  capsuleControls.classList.toggle('hidden', !hasCapsule);
  spoilerControls.classList.toggle('hidden', !hasSpoiler);

  syncComposerActionToggle(
    getById('composer-time-capsule-btn'),
    getById('composer-time-capsule-status'),
    hasCapsule,
  );
  syncComposerActionToggle(
    getById('composer-spoiler-btn'),
    getById('composer-spoiler-status'),
    hasSpoiler,
  );

  if (!hasDraft) {
    summary.textContent = '';
    note.textContent = '';
    if (capsuleInput) {
      capsuleInput.value = '';
    }
    if (capsuleNoteInput) {
      capsuleNoteInput.value = '';
    }
    return;
  }

  const summaryParts = [];
  const detailParts = [];

  if (hasCapsule) {
    summaryParts.push('Time capsule');
    const normalizedCapsule = normalizeCapsuleMeta({
      unlockAt: specialMessageDraft.capsule.unlockAt,
      note: specialMessageDraft.capsule.note,
    });

    if (capsuleInput) {
      const nextValue = formatDateTimeInputValue(
        specialMessageDraft.capsule.unlockAt || getDefaultTimeCapsuleUnlockAt(),
      );
      if (capsuleInput.value !== nextValue) {
        capsuleInput.value = nextValue;
      }
      capsuleInput.min = formatDateTimeInputValue(
        new Date(Date.now() + TIME_CAPSULE_MIN_LEAD_MS).toISOString(),
      );
      capsuleInput.max = formatDateTimeInputValue(
        new Date(Date.now() + TIME_CAPSULE_MAX_LEAD_MS).toISOString(),
      );
    }

    if (
      capsuleNoteInput &&
      capsuleNoteInput.value !== specialMessageDraft.capsule.note
    ) {
      capsuleNoteInput.value = specialMessageDraft.capsule.note;
    }

    if (normalizedCapsule) {
      const unlockDate = new Date(normalizedCapsule.unlockAt);
      detailParts.push(
        `Opens ${unlockDate.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}.`,
      );
      if (normalizedCapsule.note) {
        detailParts.push(`Note: ${normalizedCapsule.note}`);
      }
    } else {
      detailParts.push('Pick when this message should unlock.');
    }
  } else {
    if (capsuleInput) {
      capsuleInput.value = '';
    }
    if (capsuleNoteInput) {
      capsuleNoteInput.value = '';
    }
  }

  if (hasSpoiler) {
    summaryParts.push('Spoiler cover');
    detailParts.push(
      hasCapsule
        ? 'It will still need to be revealed after it opens.'
        : 'Recipients will need to reveal it manually.',
    );
  }

  summary.textContent = summaryParts.join(' + ');
  note.textContent = detailParts.join(' ');
}

function resetSpecialMessageDraft() {
  specialMessageDraft = createEmptySpecialMessageDraft();
  renderSpecialMessageDraftPreview();
}

function toggleComposerTimeCapsule() {
  if (specialMessageDraft.capsule.enabled) {
    specialMessageDraft.capsule = {
      enabled: false,
      unlockAt: '',
      note: '',
    };
  } else {
    specialMessageDraft.capsule.enabled = true;
    if (
      !normalizeCapsuleMeta({
        unlockAt: specialMessageDraft.capsule.unlockAt,
        note: specialMessageDraft.capsule.note,
      })
    ) {
      specialMessageDraft.capsule.unlockAt = getDefaultTimeCapsuleUnlockAt();
    }
  }

  renderSpecialMessageDraftPreview();
  closeComposerActionsMenu();
  if (specialMessageDraft.capsule.enabled) {
    getById('time-capsule-input')?.focus();
  }
}

function toggleComposerSpoiler() {
  specialMessageDraft.spoiler = !specialMessageDraft.spoiler;
  renderSpecialMessageDraftPreview();
  closeComposerActionsMenu();
}

function updateComposerTimeCapsuleUnlockAt(value) {
  const parsed = new Date(String(value || '').trim());
  specialMessageDraft.capsule.unlockAt = Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toISOString();
  renderSpecialMessageDraftPreview();
}

function updateComposerTimeCapsuleNote(value) {
  specialMessageDraft.capsule.note = String(value || '').slice(0, 120);
  renderSpecialMessageDraftPreview();
}

function buildComposerStructuredSendOptions() {
  const options = {
    replyMeta: replyTarget,
    capsuleMeta: null,
    spoilerMeta: null,
  };

  if (specialMessageDraft.capsule.enabled) {
    const capsuleMeta = normalizeCapsuleMeta({
      unlockAt: specialMessageDraft.capsule.unlockAt,
      note: specialMessageDraft.capsule.note,
    });

    if (!capsuleMeta) {
      throw new Error('Choose a valid unlock time for the time capsule.');
    }

    const unlockAt = new Date(capsuleMeta.unlockAt).getTime();
    const leadMs = unlockAt - Date.now();
    if (leadMs < TIME_CAPSULE_MIN_LEAD_MS) {
      throw new Error('Time capsules must unlock at least 1 minute from now.');
    }
    if (leadMs > TIME_CAPSULE_MAX_LEAD_MS) {
      throw new Error(
        'Time capsules can only be scheduled up to 365 days ahead.',
      );
    }

    options.capsuleMeta = capsuleMeta;
  }

  if (specialMessageDraft.spoiler) {
    options.spoilerMeta = { label: '' };
  }

  return options;
}

function clearStructuredMessageRefreshTimer() {
  if (structuredMessageRefreshTimer) {
    window.clearTimeout(structuredMessageRefreshTimer);
    structuredMessageRefreshTimer = 0;
  }
}

function syncSelectedConversationPreview() {
  if (!selectedUser || !conversationMessages.size) {
    return;
  }

  const messages = sortMessagesChronologically(conversationMessages.values());
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return;
  }

  updateRecentActivity(selectedUser.id, latestMessage, false);
}

function refreshStructuredMessages() {
  const structuredMessages = Array.from(conversationMessages.values()).filter(
    (message) => isMessageTimeCapsule(message),
  );

  if (!structuredMessages.length) {
    return;
  }

  for (const message of structuredMessages) {
    if (document.getElementById(`message-${message.id}`)) {
      replaceRenderedMessage(message);
    }
  }

  syncSelectedConversationPreview();
}

function scheduleStructuredMessageRefresh() {
  clearStructuredMessageRefreshTimer();

  const now = Date.now();
  const futureCapsuleUnlocks = Array.from(conversationMessages.values())
    .filter((message) => isMessageTimeCapsule(message))
    .map((message) => getMessageCapsuleUnlockTimestamp(message))
    .filter((unlockAt) => Number.isFinite(unlockAt) && unlockAt > now);

  if (!futureCapsuleUnlocks.length) {
    return;
  }

  const nextUnlockAt = Math.min(...futureCapsuleUnlocks);
  const msUntilMinuteBoundary = 60 * 1000 - (now % (60 * 1000));
  const delayMs = Math.max(
    1000,
    Math.min(nextUnlockAt - now, msUntilMinuteBoundary),
  );

  structuredMessageRefreshTimer = window.setTimeout(() => {
    structuredMessageRefreshTimer = 0;
    refreshStructuredMessages();
    scheduleStructuredMessageRefresh();
  }, delayMs);
}

function revealSpoilerMessage(messageId) {
  if (!messageId) {
    return;
  }

  revealedSpoilerMessageIds.add(messageId);
  const message = conversationMessages.get(messageId);
  if (message) {
    replaceRenderedMessage(message);
    syncSelectedConversationPreview();
  }
}

function normalizeMessageReactionEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    return {
      emoji: entry,
      ownerId: currentUser?.id || null,
      ownerName: 'You',
    };
  }

  if (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.emoji === 'string'
  ) {
    return {
      emoji: entry.emoji,
      ownerId: entry.ownerId || null,
      ownerName: entry.ownerName || 'Someone',
    };
  }

  return null;
}

function getMessageReactionData(messageId) {
  return normalizeMessageReactionEntry(messageReactionsById.get(messageId));
}

function getMessageReaction(messageId) {
  return getMessageReactionData(messageId)?.emoji || '';
}

function getMessageReactionOwnerName(messageId) {
  const data = getMessageReactionData(messageId);
  if (!data?.emoji) {
    return '';
  }

  if (data.ownerId && data.ownerId === currentUser?.id) {
    return 'You';
  }

  return data.ownerName || 'Someone';
}

function isOwnMessageReaction(messageId) {
  const data = getMessageReactionData(messageId);
  return Boolean(data?.ownerId && data.ownerId === currentUser?.id);
}

function applyIncomingReactionUpdate(payload) {
  if (!payload?.messageId) {
    return;
  }

  const reaction = String(payload.reaction || '').trim();
  const ownerId = payload.fromUserId || null;
  let ownerName = payload.ownerName || '';
  if (!ownerName) {
    ownerName =
      payload.fromUserId === currentUser?.id
        ? 'You'
        : displayName(
          users.find((user) => user.id === payload.fromUserId) ||
          selectedUser,
        ) || 'Someone';
  }

  if (!reaction) {
    messageReactionsById.delete(payload.messageId);
  } else {
    messageReactionsById.set(payload.messageId, {
      emoji: reaction,
      ownerId,
      ownerName,
    });
  }

  persistMessageReactions();

  const message = conversationMessages.get(payload.messageId);
  if (message) {
    replaceRenderedMessage(message);
  }
}

function buildReplyTarget(message) {
  if (!message?.id) {
    return null;
  }

  const sender =
    message.senderId === currentUser?.id
      ? { name: 'You' }
      : peopleDirectory.find((user) => user.id === message.senderId) ||
      users.find((user) => user.id === message.senderId) ||
      null;

  return {
    id: message.id,
    senderName: displayName(sender) || 'Message',
    preview: getMessagePreview(message),
  };
}

function renderReplyPreview() {
  const wrap = getById('reply-preview');
  const author = getById('reply-preview-author');
  const text = getById('reply-preview-text');
  if (!wrap || !author || !text) {
    return;
  }

  if (!replyTarget) {
    wrap.classList.add('hidden');
    author.textContent = '';
    text.textContent = '';
    return;
  }

  wrap.classList.remove('hidden');
  author.textContent = replyTarget.senderName || 'Message';
  text.textContent = replyTarget.preview || 'Reply';
}

function clearReplyTarget() {
  replyTarget = null;
  renderReplyPreview();
}

function setReplyTarget(message) {
  replyTarget = buildReplyTarget(message);
  renderReplyPreview();
}

function startReplyToSelectedMessage() {
  if (!messageActionTarget) {
    return;
  }

  setReplyTarget(messageActionTarget);
  closeMessageActions();
  getById('msg-input')?.focus();
}

async function copySelectedMessageText() {
  if (!messageActionTarget) {
    return;
  }

  const messageId = messageActionTarget.id;
  const text =
    getResolvedMessageText(messageActionTarget) ||
    messageActionTarget.fileName ||
    messageActionTarget.fileUrl ||
    '';

  if (!String(text || '').trim()) {
    alert('There is nothing copyable in this message yet.');
    return;
  }

  try {
    await copyTextToClipboard(text);
    closeMessageActions();
    pulseMessageBubble(messageId);
  } catch (error) {
    alert(error?.message || 'Failed to copy this message.');
  }
}

function getSelectedMessageAttachmentMeta() {
  if (!messageActionTarget?.fileUrl) {
    return null;
  }

  const fileUrl = getFileUrl(messageActionTarget.fileUrl);
  if (!fileUrl) {
    return null;
  }

  const fileName =
    messageActionTarget.fileName ||
    describeMessageAttachment(messageActionTarget, 'attachment');

  return {
    fileUrl,
    fileName,
    messageType: String(messageActionTarget.messageType || '').toUpperCase(),
    fileMimeType: String(messageActionTarget.fileMimeType || ''),
  };
}

function canOpenSelectedMessageAttachment() {
  return Boolean(getSelectedMessageAttachmentMeta());
}

function openSelectedMessageAttachment() {
  const attachment = getSelectedMessageAttachmentMeta();
  if (!attachment) {
    return;
  }

  closeMessageActions();

  if (attachment.messageType === 'IMAGE') {
    openImagePreview(attachment.fileUrl);
    return;
  }

  window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer');
}

async function downloadSelectedMessageAttachment() {
  const attachment = getSelectedMessageAttachmentMeta();
  if (!attachment) {
    return;
  }

  try {
    await downloadFile(attachment.fileUrl, attachment.fileName || 'attachment');
    closeMessageActions();
  } catch (error) {
    alert(error?.message || 'Failed to download attachment.');
  }
}

function showSelectedMessageInfo() {
  if (!messageActionTarget) {
    return;
  }

  const senderLabel =
    messageActionTarget.senderId === currentUser?.id
      ? 'You'
      : messageActionTarget.senderName ||
      messageActionTarget.sender?.name ||
      displayName(selectedUser) ||
      'Someone';
  const typeLabel = String(
    messageActionTarget.messageType || 'TEXT',
  ).toLowerCase();
  const deliveryLabel = messageActionTarget.isPending
    ? messageActionTarget.pendingState === 'queued-offline'
      ? 'Queued offline'
      : 'Queued to send'
    : messageWasRead(messageActionTarget)
      ? 'Read'
      : 'Sent';

  closeMessageActions();
  alert(
    [
      `Sender: ${senderLabel}`,
      `Type: ${typeLabel}`,
      `Time: ${formatShortDate(messageActionTarget.createdAt)} ${formatMessageTime(messageActionTarget.createdAt)}`,
      `Status: ${deliveryLabel}`,
    ].join('\n'),
  );
}

function getMessageBubbleElement(messageId) {
  return getById(`message-${messageId}`)?.querySelector(
    '.message-bubble-shell',
  );
}

function pulseMessageBubble(messageId, className = 'message-bubble-commit') {
  if (!messageId) {
    return;
  }

  window.requestAnimationFrame(() => {
    triggerMotionClass(getMessageBubbleElement(messageId), className, 460);
  });
}

function animateMessageShellExit(messageId, durationMs = 220) {
  return new Promise((resolve) => {
    const shell = getById(`message-${messageId}`);
    if (!shell) {
      resolve(false);
      return;
    }

    shell.classList.add('message-shell-exit');
    window.setTimeout(() => {
      resolve(true);
    }, durationMs);
  });
}

function setMessageActionButtonLabel(button, label) {
  if (!button) {
    return;
  }

  const target = button.querySelector('span') || button;
  if (!button.dataset.idleLabel) {
    button.dataset.idleLabel = target.textContent.trim();
  }

  target.textContent = label || button.dataset.idleLabel;
}

function setMessageActionsBusyState(isBusy, options = {}) {
  const menu = getById('message-actions-menu');
  if (!menu) {
    return;
  }

  const buttons = Array.from(menu.querySelectorAll('button'));
  const reactionButtons = Array.from(
    menu.querySelectorAll('.message-reaction-option'),
  );

  menu.classList.toggle('message-actions-busy', isBusy);
  buttons.forEach((button) => {
    setMessageActionButtonLabel(button);
    button.disabled = Boolean(isBusy);
  });
  reactionButtons.forEach((button) => {
    button.disabled = Boolean(isBusy);
  });

  if (!isBusy) {
    return;
  }

  if (options.buttonId) {
    const busyButton = getById(options.buttonId);
    if (busyButton) {
      busyButton.disabled = true;
      setMessageActionButtonLabel(busyButton, options.label || 'Working...');
    }
  }
}

function toggleSelectedMessageReaction(emoji) {
  if (!messageActionTarget?.id || !emoji) {
    return;
  }

  const messageId = messageActionTarget.id;
  const currentReaction = getMessageReaction(messageId);
  triggerMotionClass(
    getMessageBubbleElement(messageId),
    'message-bubble-processing',
    300,
  );

  if (currentReaction === emoji) {
    messageReactionsById.delete(messageId);
  } else {
    messageReactionsById.set(messageId, {
      emoji,
      ownerId: currentUser?.id || null,
      ownerName: displayName(currentUser) || 'You',
    });
  }

  persistMessageReactions();

  if (!messageActionTarget.isPending && socket?.connected && selectedUser) {
    socket.emit('reaction:update', {
      messageId,
      reaction: currentReaction === emoji ? null : emoji,
      groupId: isGroupConversation(selectedUser) ? selectedUser.id : undefined,
      toUserId: !isGroupConversation(selectedUser)
        ? selectedUser.id
        : undefined,
    });
  }

  if (conversationMessages.has(messageId)) {
    replaceRenderedMessage(
      conversationMessages.get(messageId) || messageActionTarget,
    );
  }
  renderStarredMessages();
  renderSidebarStarredHub();
  closeMessageActions();
  pulseMessageBubble(messageId);
}

function getSidebarPinnedConversations() {
  return getSortedUsers()
    .filter((user) => isConversationPinned(user))
    .slice(0, 6);
}

function renderPinnedConversationsSidebar() {
  const section = getById('sidebar-pinned-section');
  const count = getById('sidebar-pinned-count');
  const list = getById('sidebar-pinned-list');
  if (!section || !count || !list) {
    return;
  }

  const pinned = getSidebarPinnedConversations();
  section.classList.toggle('hidden', pinned.length === 0);
  if (!pinned.length) {
    count.textContent = 'No pinned chats yet.';
    list.innerHTML = '';
    return;
  }

  count.textContent = `${pinned.length} pinned chat${pinned.length === 1 ? '' : 's'}`;
  list.innerHTML = pinned
    .map(
      (user) => `
        <button
          type="button"
          onclick="selectUser('${escapeHtml(user.id)}')"
          class="sidebar-quick-card flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
        >
          <img src="${userAvatar(user)}" alt="${escapeHtml(displayName(user))} profile photo" width="40" height="40" class="h-10 w-10 rounded-2xl object-cover" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(displayName(user))}</p>
            <p class="mt-1 truncate text-xs text-slate-500">${escapeHtml(recentActivity.get(user.id)?.preview || 'Pinned chat')}</p>
          </div>
        </button>
      `,
    )
    .join('');
}

function getAllStarredMessages() {
  return Array.from(starredMessagesById.values()).sort(
    (left, right) =>
      new Date(right.createdAt || 0).getTime() -
      new Date(left.createdAt || 0).getTime(),
  );
}

function openStarredConversation(entry) {
  if (!entry?.conversationKey) {
    return;
  }

  const [, conversationId] = String(entry.conversationKey).split(':');
  if (!conversationId) {
    return;
  }

  selectUser(conversationId);
  window.setTimeout(() => {
    scrollToMessageInConversation(entry.id);
  }, 320);
}

function openStarredConversationById(messageId) {
  const entry = getAllStarredMessages().find((item) => item.id === messageId);
  if (entry) {
    openStarredConversation(entry);
  }
}

function renderSidebarStarredHub() {
  const section = getById('sidebar-starred-section');
  const count = getById('sidebar-starred-count');
  const list = getById('sidebar-starred-list');
  if (!section || !count || !list) {
    return;
  }

  const starred = getAllStarredMessages().slice(0, 5);
  section.classList.toggle('hidden', starred.length === 0);
  if (!starred.length) {
    count.textContent = 'No starred messages yet.';
    list.innerHTML = '';
    return;
  }

  count.textContent = `${starred.length} recent starred message${starred.length === 1 ? '' : 's'
    }`;
  list.innerHTML = starred
    .map(
      (entry) => `
        <button
          type="button"
          onclick="openStarredConversationById('${escapeHtml(entry.id)}')"
          class="sidebar-quick-card w-full px-3 py-3 text-left transition hover:bg-slate-50"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="truncate text-sm font-semibold text-slate-900">${escapeHtml(entry.senderName || 'Message')}</span>
            <span class="text-[11px] text-slate-400">${escapeHtml(formatShortDate(entry.createdAt))}</span>
          </div>
          <p class="mt-1 truncate text-xs text-slate-500">${escapeHtml(entry.preview || 'Starred message')}</p>
        </button>
      `,
    )
    .join('');
}

function getConversationSearchMatches() {
  const query = getById('chat-search-input')?.value.trim().toLowerCase() || '';
  const filter = getById('chat-search-filter')?.value || 'all';
  if (!query && filter === 'all') {
    return [];
  }
  const messages = sortMessagesChronologically(conversationMessages.values());
  return messages.filter((message) => {
    const preview =
      `${getResolvedMessageText(message)} ${message.fileName || ''}`.toLowerCase();
    const isMedia =
      message.messageType === 'IMAGE' ||
      String(message.fileMimeType || '').startsWith('video/');
    const isFile =
      message.messageType === 'DOCUMENT' || message.messageType === 'AUDIO';

    if (filter === 'media' && !isMedia) {
      return false;
    }
    if (filter === 'files' && !(isMedia || isFile)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return preview.includes(query);
  });
}

function renderConversationSearchResults(
  matches = getConversationSearchMatches(),
) {
  const results = getById('chat-search-results');
  const summary = getById('chat-search-summary');
  const query = getById('chat-search-input')?.value.trim().toLowerCase() || '';
  const filter = getById('chat-search-filter')?.value || 'all';
  if (!results || !summary) {
    return;
  }

  if (!selectedUser) {
    summary.textContent = 'Select a chat to search.';
    results.innerHTML = '';
    return;
  }

  if (!query && filter === 'all') {
    summary.textContent =
      'Search loaded messages, jump by date, or filter media.';
    results.innerHTML = '';
    return;
  }

  if (!matches.length) {
    summary.textContent = messagePagination.hasMore
      ? 'No match in loaded messages yet. Try Load Older.'
      : 'No matching messages in this chat.';
    results.innerHTML = '';
    return;
  }

  summary.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'} in loaded messages`;
  results.innerHTML = matches
    .slice(-20)
    .reverse()
    .map(
      (message) => `
        <button
          type="button"
          onclick="scrollToMessageInConversation('${escapeHtml(message.id)}')"
          class="search-result-card w-full px-3 py-3 text-left transition hover:bg-slate-50"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="truncate text-sm font-semibold text-slate-900">${escapeHtml(message.senderId === currentUser?.id ? 'You' : displayName(users.find((user) => user.id === message.senderId) || selectedUser))}</span>
            <span class="text-[11px] text-slate-400">${escapeHtml(formatShortDate(message.createdAt))} ${escapeHtml(formatMessageTime(message.createdAt))}</span>
          </div>
          <p class="mt-1 line-clamp-2 text-sm text-slate-600">${escapeHtml(getMessagePreview(message))}</p>
        </button>
      `,
    )
    .join('');
}

function runConversationSearch() {
  renderConversationSearchResults();
}

function clearConversationSearch() {
  const input = getById('chat-search-input');
  const filter = getById('chat-search-filter');
  const date = getById('chat-search-date');
  if (input) input.value = '';
  if (filter) filter.value = 'all';
  if (date) date.value = '';
  runConversationSearch();
}

function jumpToConversationDate() {
  const dateValue = getById('chat-search-date')?.value;
  if (!dateValue) {
    runConversationSearch();
    return;
  }

  const targetMessage = sortMessagesChronologically(
    conversationMessages.values(),
  ).find((message) => {
    const created = new Date(message.createdAt);
    return (
      !Number.isNaN(created.getTime()) &&
      created.toISOString().slice(0, 10) === dateValue
    );
  });

  if (targetMessage) {
    scrollToMessageInConversation(targetMessage.id);
    renderConversationSearchResults([targetMessage]);
    return;
  }

  renderConversationSearchResults([]);
}

async function loadOlderMessagesForSearch() {
  if (
    !selectedUser ||
    !messagePagination.hasMore ||
    messagePagination.loadingOlder
  ) {
    runConversationSearch();
    return;
  }

  await loadOlderMessages();
  runConversationSearch();
}

function getConversationCallKey(user = selectedUser) {
  return getConversationCacheKey(user);
}

function getConversationCallEntries(user = selectedUser) {
  const key = getConversationCallKey(user);
  if (!key) {
    return [];
  }

  return Array.isArray(callHistoryByConversation.get(key))
    ? callHistoryByConversation.get(key)
    : [];
}

function recordCallHistoryEntry(targetUserId, entry) {
  const user = users.find((item) => item.id === targetUserId) || selectedUser;
  const key = getConversationCallKey(user);
  if (!key) {
    return;
  }

  const currentEntries = getConversationCallEntries(user);
  const nextEntries = [
    {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    },
    ...currentEntries,
  ].slice(0, 20);
  callHistoryByConversation.set(key, nextEntries);
  persistCallHistory();

  if (entry.status === 'missed') {
    const nextCount = Number(missedCallCountsByConversation.get(key) || 0) + 1;
    missedCallCountsByConversation.set(key, nextCount);
    persistMissedCalls();
  }

  renderConversationCallHistory();
  scheduleRenderUsers();
}

function clearConversationCallHistory() {
  const key = getConversationCallKey(selectedUser);
  if (!key) {
    return;
  }

  callHistoryByConversation.delete(key);
  missedCallCountsByConversation.delete(key);
  persistCallHistory();
  persistMissedCalls();
  renderConversationCallHistory();
  scheduleRenderUsers();
}

function markConversationMissedCallsSeen(user = selectedUser) {
  const key = getConversationCallKey(user);
  if (!key || !missedCallCountsByConversation.has(key)) {
    return;
  }

  missedCallCountsByConversation.delete(key);
  persistMissedCalls();
  scheduleRenderUsers();
}

function renderConversationCallHistory() {
  const count = getById('chat-contact-panel-calls-count');
  const list = getById('chat-contact-panel-calls-list');
  if (!count || !list) {
    return;
  }

  const entries = getConversationCallEntries(selectedUser);
  if (!selectedUser || !entries.length) {
    count.textContent = 'No recent calls yet.';
    list.innerHTML = '';
    return;
  }

  count.textContent = `${entries.length} recent call${entries.length === 1 ? '' : 's'}`;
  list.innerHTML = entries
    .map(
      (entry) => `
        <div class="call-history-card px-3 py-3">
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-semibold text-slate-900">${escapeHtml(entry.direction === 'outgoing' ? 'Outgoing' : 'Incoming')} ${escapeHtml(entry.callType === 'video' ? 'video' : 'voice')} call</p>
            <span class="text-[11px] font-semibold uppercase tracking-[0.2em] ${entry.status === 'missed' ? 'text-rose-500' : entry.status === 'connected' ? 'text-emerald-500' : 'text-slate-400'}">${escapeHtml(entry.status || 'ended')}</span>
          </div>
          <p class="mt-1 text-xs text-slate-500">${escapeHtml(formatShortDate(entry.createdAt))} ${escapeHtml(formatMessageTime(entry.createdAt))} · ${escapeHtml(formatRelativeTime(entry.createdAt))}</p>
        </div>
      `,
    )
    .join('');
}

function updateRingtonePreference() {
  const nextValue = getById('settings-ringtone-select')?.value || 'classic';
  ringtonePreference = nextValue;
  writeStoredValue(RINGTONE_PREFERENCE_KEY, nextValue);
}

function syncRingtonePreferenceUI() {
  const select = getById('settings-ringtone-select');
  if (select) {
    select.value = ringtonePreference || 'classic';
  }
}

function stopIncomingCallRingtone() {
  if (!activeIncomingRingtone) {
    return;
  }

  activeIncomingRingtone.stop();
  activeIncomingRingtone = null;
}

function playIncomingCallRingtone() {
  stopIncomingCallRingtone();
  if (ringtonePreference === 'silent') {
    return;
  }

  if (!window.AudioContext && !window.webkitAudioContext) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  let cancelled = false;
  const sequence =
    ringtonePreference === 'soft'
      ? [660, 784]
      : ringtonePreference === 'pulse'
        ? [740, 740, 587]
        : [784, 988, 784];

  const playStep = (index = 0) => {
    if (cancelled) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = ringtonePreference === 'pulse' ? 'square' : 'sine';
    oscillator.frequency.value = sequence[index % sequence.length];
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
    window.setTimeout(() => playStep(index + 1), 420);
  };

  playStep();
  activeIncomingRingtone = {
    stop() {
      cancelled = true;
      context.close().catch(() => undefined);
    },
  };
}

function selectedConversationRoomId(user = selectedUser) {
  if (!user) {
    return null;
  }

  return isGroupConversation(user) ? user.id : user.id;
}

function queueOptimisticMessage(message, user = selectedUser) {
  const roomId = selectedConversationRoomId(user);
  if (!roomId || !message?.id) {
    return;
  }

  const queue = pendingOptimisticMessageIdsByRoom.get(roomId) || [];
  queue.push(message.id);
  pendingOptimisticMessageIdsByRoom.set(roomId, queue);
}

function removePendingOptimisticMessageId(roomId, messageId) {
  if (!roomId || !messageId) {
    return;
  }

  const queue = pendingOptimisticMessageIdsByRoom.get(roomId);
  if (!queue?.length) {
    return;
  }

  const nextQueue = queue.filter((id) => id !== messageId);
  if (nextQueue.length) {
    pendingOptimisticMessageIdsByRoom.set(roomId, nextQueue);
    return;
  }

  pendingOptimisticMessageIdsByRoom.delete(roomId);
}

function removeOptimisticMessage(messageId) {
  if (!messageId) {
    return;
  }

  removeCachedMessageEverywhere(messageId);
  renderedMessageIds.delete(messageId);
  conversationMessages.delete(messageId);
  revealedSpoilerMessageIds.delete(messageId);
  document.getElementById(`message-${messageId}`)?.remove();
  scheduleStructuredMessageRefresh();
}

function getKnownMessageById(messageId) {
  if (!messageId) {
    return null;
  }

  if (conversationMessages.has(messageId)) {
    return conversationMessages.get(messageId) || null;
  }

  for (const state of conversationHistoryCache.values()) {
    const message = state.conversationMessages.get(messageId);
    if (message) {
      return message;
    }
  }

  return null;
}

function updateOptimisticMessage(messageId, patch = {}) {
  const currentMessage = getKnownMessageById(messageId);
  if (!currentMessage) {
    return null;
  }

  const nextMessage = createRenderableMessage({
    ...currentMessage,
    ...patch,
  });

  if (conversationMessages.has(messageId)) {
    conversationMessages.set(messageId, nextMessage);
  }

  updateCachedMessageEverywhere(nextMessage);

  if (belongsToSelectedConversation(nextMessage)) {
    replaceRenderedMessage(nextMessage, {
      animate: false,
      stickToBottom: false,
    });
  }

  return nextMessage;
}

function setOptimisticMessagePendingState(messageId, pendingState = 'sending') {
  return updateOptimisticMessage(messageId, {
    isPending: true,
    pendingState,
  });
}

function resolveOptimisticMessage(message, isOwnMessage) {
  if (!isOwnMessage || message?.messageType !== 'TEXT') {
    return;
  }

  const roomId = message.groupId || message.receiverId;
  const queue = pendingOptimisticMessageIdsByRoom.get(roomId);
  if (!queue?.length) {
    return;
  }

  const exactIndex = queue.indexOf(message.id);
  const pendingId =
    exactIndex >= 0 ? queue.splice(exactIndex, 1)[0] : queue.shift();
  if (!pendingId) {
    return;
  }

  if (!queue.length) {
    pendingOptimisticMessageIdsByRoom.delete(roomId);
  } else {
    pendingOptimisticMessageIdsByRoom.set(roomId, queue);
  }
  removeOptimisticMessage(pendingId);
}

function createRenderableMessage(message) {
  if (!message) {
    return message;
  }

  const renderable = { ...message };
  if (renderable.messageType === 'TEXT') {
    renderable.displayText = applyStructuredMessageData(
      renderable,
      shouldTreatMessageAsEncrypted(renderable)
        ? 'Decrypting message...'
        : renderable.content || renderable.displayText || '',
    );
  } else {
    renderable.displayText = renderable.content || '';
  }

  return renderable;
}

function getResolvedMessageText(message) {
  if (!message) {
    return '[Encrypted message]';
  }

  if (isMessageTimeCapsuleLocked(message)) {
    return 'Time capsule message';
  }

  if (isMessageSpoilerHidden(message)) {
    return 'Spoiler message';
  }

  const text = String(message.displayText || message.content || '').trim();
  if (['[Encrypted message]', '[Unable to decrypt message]'].includes(text)) {
    return text;
  }

  if (text) {
    if (!looksEncryptedPayload(text)) {
      return text;
    }
  }

  if (
    shouldTreatMessageAsEncrypted(message) &&
    message.messageType === 'TEXT'
  ) {
    return 'Decrypting message...';
  }

  return '[Encrypted message]';
}

async function hydrateAndRefreshMessage(message) {
  if (!message || message.messageType !== 'TEXT' || message.isPending) {
    return message;
  }

  const hydrated = await hydrateMessage(message);
  updateCachedMessageEverywhere(hydrated);
  if (conversationMessages.has(hydrated.id)) {
    replaceRenderedMessage(hydrated);
  }
  return hydrated;
}

function hydrateMessagesInBackground(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return;
  }

  for (const message of messages) {
    void hydrateAndRefreshMessage(message).catch((error) => {
      console.error('Failed to hydrate message in background', error);
    });
  }
}

function retryConversationDecryption() {
  const retryableMessages = Array.from(conversationMessages.values()).filter(
    (message) =>
      message?.messageType === 'TEXT' &&
      (message.displayText === '[Unable to decrypt message]' ||
        message.displayText === '[Encrypted message]' ||
        message.displayText === 'Decrypting message...'),
  );

  if (!retryableMessages.length) {
    return;
  }

  hydrateMessagesInBackground(retryableMessages);
}

function createOptimisticTextMessage(
  text,
  user = selectedUser,
  structuredOptions = {},
  pendingState = 'queued',
) {
  const now = new Date().toISOString();
  const structuredText = encodeMessageForSend(text, structuredOptions);
  const optimisticMessage = {
    id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderId: currentUser.id,
    receiverId: isGroupConversation(user) ? null : user.id,
    groupId: isGroupConversation(user) ? user.id : null,
    createdAt: now,
    messageType: 'TEXT',
    content: structuredText,
    displayText: structuredText,
    isPending: true,
    pendingState,
    isEncrypted: false,
    recipientCount: isGroupConversation(user)
      ? Math.max((user.members || []).length - 1, 1)
      : 1,
    readByCount: 0,
  };
  optimisticMessage.displayText = applyStructuredMessageData(
    optimisticMessage,
    structuredText,
  );
  return optimisticMessage;
}

function buildDraftFingerprint({ roomId, text, attachmentFile, voiceFile }) {
  const describeFile = (file) =>
    file
      ? `${file.name || 'file'}:${file.size || 0}:${file.lastModified || 0}:${file.type || ''}`
      : '';

  return [
    roomId || '',
    (text || '').trim(),
    describeFile(attachmentFile),
    describeFile(voiceFile),
  ].join('|');
}

function markDraftSubmitted(fingerprint) {
  if (!fingerprint) {
    return;
  }

  lastSubmittedDraftFingerprint = fingerprint;
  lastSubmittedDraftAt = Date.now();
}

function clearDraftSubmissionGuard(fingerprint) {
  if (!fingerprint || fingerprint !== lastSubmittedDraftFingerprint) {
    return;
  }

  lastSubmittedDraftFingerprint = '';
  lastSubmittedDraftAt = 0;
}

function shouldSkipDuplicateDraft(fingerprint) {
  if (!fingerprint) {
    return false;
  }

  return (
    fingerprint === lastSubmittedDraftFingerprint &&
    composerDraftVersion === lastSubmittedDraftVersion &&
    Date.now() - lastSubmittedDraftAt < 1800
  );
}

function markComposerDraftDirty() {
  composerDraftVersion += 1;
  lastSubmittedDraftVersion = -1;
}

function setComposerSendingState(isSending, label = 'Send') {
  composerSendInFlight = isSending;
  const sendBtn = document.getElementById('send-message-btn');
  const voiceSendBtn = document.getElementById('voice-send-btn');
  const voiceRecordBtn = document.getElementById('voice-record-btn');
  const voiceStopBtn = document.getElementById('voice-stop-btn');
  const voiceDeleteBtn = document.getElementById('voice-delete-btn');
  const input = document.getElementById('msg-input');
  const fileInput = document.getElementById('file-input');
  const composerActionsBtn = document.getElementById('composer-actions-btn');
  const shareFileLabel = document.getElementById('share-file-label');
  const sendStatus = document.getElementById('chat-send-status');
  const sendLabel = sendBtn?.dataset?.idleLabel || 'Send';
  const busyLabel = label || 'Sending...';

  if (sendBtn) {
    if (!sendBtn.dataset.idleLabel) {
      sendBtn.dataset.idleLabel = sendLabel;
    }
    sendBtn.disabled = isSending;
    sendBtn.classList.toggle('opacity-70', isSending);
    sendBtn.classList.toggle('cursor-wait', isSending);
    sendBtn.innerHTML = isSending
      ? `<span class="inline-flex items-center gap-2"><span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"></span><span>${busyLabel}</span></span>`
      : sendBtn.dataset.idleLabel;
  }

  if (voiceSendBtn) {
    voiceSendBtn.disabled = isSending;
    voiceSendBtn.classList.toggle('opacity-70', isSending);
    voiceSendBtn.classList.toggle('cursor-wait', isSending);
  }

  [voiceRecordBtn, voiceStopBtn, voiceDeleteBtn].forEach((button) => {
    if (!button) {
      return;
    }

    button.disabled = isSending;
    button.classList.toggle('opacity-70', isSending);
    button.classList.toggle('cursor-wait', isSending);
  });

  if (input) {
    input.readOnly = isSending;
    input.setAttribute('aria-busy', isSending ? 'true' : 'false');
  }

  if (fileInput) {
    fileInput.disabled = isSending;
  }

  if (composerActionsBtn) {
    composerActionsBtn.disabled = isSending;
    composerActionsBtn.classList.toggle('opacity-70', isSending);
    composerActionsBtn.classList.toggle('cursor-wait', isSending);
  }

  if (shareFileLabel) {
    shareFileLabel.classList.toggle('pointer-events-none', isSending);
    shareFileLabel.classList.toggle('opacity-60', isSending);
  }

  if (sendStatus) {
    if (isSending) {
      sendStatus.textContent = `${busyLabel}...`;
      sendStatus.classList.remove('hidden');
    } else {
      syncChatSendStatus();
    }
  }
}

function setMessageLoadingState(isLoading, label = 'Loading messages...') {
  const indicator = document.getElementById('message-loading-indicator');
  const text = document.getElementById('message-loading-label');
  if (!indicator) {
    return;
  }

  if (text) {
    text.textContent = label;
  }
  indicator.classList.toggle('hidden', !isLoading);
  setSurfaceRefreshState('message-container', isLoading, 130);
}

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (composerSendInFlight) {
    return;
  }

  sendMessage();
}

function messageWasRead(message) {
  return (
    Number(message?.recipientCount || 0) > 0 &&
    Number(message?.readByCount || 0) >= Number(message?.recipientCount || 0)
  );
}

async function loadPublicConfig() {
  if (configLoadPromise) {
    return configLoadPromise;
  }

  const bootstrappedConfig = window.__OCHAT_PUBLIC_CONFIG__;
  if (bootstrappedConfig && typeof bootstrappedConfig === 'object') {
    appConfig = {
      ...appConfig,
      ...bootstrappedConfig,
      apiUrl: resolveHostedApiUrl(window.location.origin, bootstrappedConfig),
    };
    API_URL = appConfig.apiUrl || window.location.origin || localBackendOrigin;
    rtcConfig = {
      iceServers: (appConfig.stunServers || [])
        .filter(Boolean)
        .map((urls) => ({ urls })),
    };
    configLoadPromise = Promise.resolve(appConfig);
    return configLoadPromise;
  }

  configLoadPromise = (async () => {
    const candidates = isHostedOrigin
      ? [window.location.origin]
      : getConfigCandidates();

    for (const candidate of candidates) {
      try {
        const response = await fetchPublicConfigCandidate(candidate);
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
        rtcConfig = {
          iceServers: (appConfig.stunServers || [])
            .filter(Boolean)
            .map((urls) => ({ urls })),
        };
        window.__OCHAT_PUBLIC_CONFIG__ = appConfig;
        return appConfig;
      } catch (error) {
        console.error(`Failed to load public config from ${candidate}`, error);
      }
    }

    API_URL = isHostedOrigin ? window.location.origin : localBackendOrigin;
    return appConfig;
  })();

  return configLoadPromise;
}

async function readJsonResponse(
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

function getApiErrorMessage(data, fallbackMessage) {
  if (Array.isArray(data?.message)) {
    return data.message.join(', ');
  }

  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }

  return fallbackMessage;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 401 && token) {
    forceSessionLogout('Your session expired. Please log in again.');
  }

  return response;
}

function uploadFormDataWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    xhr.timeout = 0;

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.(event.loaded, event.total);
    };

    xhr.onerror = () => {
      reject(
        createUploadRequestError(
          'Network error while uploading attachment',
          xhr.status,
          'Network error while uploading attachment',
          'NETWORK_ERROR',
        ),
      );
    };

    xhr.ontimeout = () => {
      reject(
        createUploadRequestError(
          'Upload timed out while sending the attachment',
          0,
          'Upload timed out while sending the attachment',
          'UPLOAD_TIMEOUT',
        ),
      );
    };

    xhr.onload = () => {
      if (xhr.status === 401 && token) {
        forceSessionLogout('Your session expired. Please log in again.');
        reject(createUploadRequestError('Session expired', 401));
        return;
      }

      let data = {};
      const raw = xhr.responseText || '';
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch (error) {
          console.error('Failed to parse upload response', error, raw);
          data = {
            message:
              raw.trim() ||
              'Failed to upload attachment. The server returned an invalid response.',
          };
        }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          createUploadRequestError(
            data.message || 'Failed to upload attachment',
            xhr.status,
          ),
        );
        return;
      }

      resolve(data);
    };

    xhr.send(formData);
  });
}

function baseName(user) {
  if (isGroupConversation(user)) {
    return user?.name || 'Group';
  }
  return user?.name || user?.email || 'User';
}

function displayName(user) {
  if (isGroupConversation(user)) {
    return user?.name || user?.displayName || 'Group';
  }
  return user?.nickname || user?.displayName || baseName(user);
}

function formatUploadProgress(loaded, total) {
  if (!total) {
    return 'Uploading...';
  }

  return `${formatBytes(loaded)} / ${formatBytes(total)}`;
}

function buildUploadConversationTarget(user = selectedUser) {
  if (!user?.id) {
    return null;
  }

  return {
    id: user.id,
    name: displayName(user),
    chatType: isGroupConversation(user) ? 'group' : 'direct',
    groupId: isGroupConversation(user) ? user.id : null,
    receiverId: isGroupConversation(user) ? null : user.id,
  };
}

function isRecoverableUploadError(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toUpperCase();

  if (['NETWORK_ERROR', 'UPLOAD_TIMEOUT'].includes(code)) {
    return true;
  }

  return !status || [408, 425, 429, 502, 503, 504].includes(status);
}

function createUploadRequestError(
  message,
  status = 0,
  fallbackMessage = 'Upload failed',
  code = 'UPLOAD_FAILED',
) {
  const error = new Error(message || fallbackMessage);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeAttachmentUploadNextChunkIndex(value, fallbackValue = 0) {
  if (value === null) {
    return null;
  }

  if (value === undefined || value === '') {
    return fallbackValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallbackValue;
  }

  return parsed;
}

function resolveAttachmentMimeType(file) {
  const mimeType = String(file?.type || '')
    .trim()
    .toLowerCase();
  const fileName = String(file?.name || '')
    .trim()
    .toLowerCase();

  if (
    MATROSKA_ATTACHMENT_MIME_TYPES.has(mimeType) ||
    fileName.endsWith('.mkv')
  ) {
    return 'video/x-matroska';
  }

  return mimeType;
}

function uploadChunkWithProgress(sessionId, chunkIndex, chunkBlob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('chunk', chunkBlob, `chunk-${chunkIndex}.part`);
    formData.append('chunkIndex', String(chunkIndex));
    xhr.open(
      'POST',
      `${API_URL}/chat/uploads/sessions/${encodeURIComponent(sessionId)}/chunks`,
    );
    xhr.timeout = 0;

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    activeAttachmentUploadRequest = {
      taskId: activeAttachmentUploadTaskId,
      xhr,
    };

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.(event.loaded, event.total);
    };

    xhr.onerror = () => {
      activeAttachmentUploadRequest = null;
      reject(
        createUploadRequestError(
          'Network error while uploading file chunk',
          xhr.status,
        ),
      );
    };

    xhr.ontimeout = () => {
      activeAttachmentUploadRequest = null;
      reject(
        createUploadRequestError(
          'Upload timed out while sending the file chunk',
          0,
          'Upload timed out while sending the file chunk',
          'UPLOAD_TIMEOUT',
        ),
      );
    };

    xhr.onabort = () => {
      activeAttachmentUploadRequest = null;
      const abortReason =
        xhr.__chatAbortReason === 'paused' ? 'paused' : 'cancelled';
      reject(
        createUploadRequestError(
          abortReason === 'paused' ? 'Upload paused' : 'Upload cancelled',
          0,
          abortReason === 'paused' ? 'Upload paused' : 'Upload cancelled',
          abortReason === 'paused' ? 'UPLOAD_PAUSED' : 'UPLOAD_CANCELLED',
        ),
      );
    };

    xhr.onload = () => {
      activeAttachmentUploadRequest = null;
      if (xhr.status === 401 && token) {
        forceSessionLogout('Your session expired. Please log in again.');
        reject(createUploadRequestError('Session expired', 401));
        return;
      }

      let data = {};
      const raw = xhr.responseText || '';
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch (error) {
          console.error('Failed to parse chunk upload response', error, raw);
          reject(
            createUploadRequestError(
              'Failed to upload file chunk. The server returned an invalid response.',
              xhr.status,
            ),
          );
          return;
        }
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          createUploadRequestError(
            data.message || 'Failed to upload file chunk',
            xhr.status,
          ),
        );
        return;
      }

      resolve(data);
    };

    xhr.send(formData);
  });
}

function createAttachmentUploadTask(file, conversation) {
  const previewUrl = file.type.startsWith('image/')
    ? URL.createObjectURL(file)
    : null;
  const resolvedMimeType = resolveAttachmentMimeType(file);

  return {
    id: `upload-task-${Date.now()}-${(nextAttachmentUploadTaskId += 1)}`,
    file,
    resolvedMimeType,
    conversation,
    sessionId: null,
    status: 'pending-send',
    progressBytes: 0,
    uploadedBytes: 0,
    nextChunkIndex: 0,
    totalChunks: 0,
    chunkSize: 0,
    uploadTransport: 'server-relay',
    storageProvider: 'local',
    autoRetryCount: 0,
    directUploadFallbackAttempted: false,
    errorMessage: '',
    previewUrl,
    completedMessageId: null,
    pauseRequested: false,
  };
}

function buildAttachmentUploadFormData(file, conversation) {
  const formData = new FormData();
  formData.append('file', file);

  if (conversation?.groupId) {
    formData.append('groupId', conversation.groupId);
    return formData;
  }

  if (conversation?.receiverId) {
    formData.append('receiverId', conversation.receiverId);
    return formData;
  }

  if (conversation?.chatType === 'group' && conversation?.id) {
    formData.append('groupId', conversation.id);
    return formData;
  }

  if (conversation?.id) {
    formData.append('receiverId', conversation.id);
    return formData;
  }

  throw new Error('No chat selected');
}

async function compressImageFileIfNeeded(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    return file;
  }

  const normalizedType = String(file.type || '').toLowerCase();
  if (normalizedType === 'image/gif' || normalizedType === 'image/svg+xml') {
    return file;
  }

  try {
    const imageBitmap = await createImageBitmap(file);
    const maxDimension = 1600;
    const largestDimension = Math.max(imageBitmap.width, imageBitmap.height);
    const needsResize = largestDimension > maxDimension;
    const needsCompression = file.size > 1.2 * 1024 * 1024 || needsResize;
    if (!needsCompression) {
      imageBitmap.close();
      return file;
    }

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxDimension / largestDimension);
    canvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
    canvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      imageBitmap.close();
      return file;
    }

    context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.8);
    });
    imageBitmap.close();
    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), {
      type: 'image/webp',
      lastModified: file.lastModified || Date.now(),
    });
  } catch (error) {
    console.warn('Image compression skipped', error);
    return file;
  }
}

function getAttachmentTaskConversationKey(task) {
  if (!task?.conversation?.id) {
    return null;
  }

  return `${task.conversation.chatType}:${task.conversation.id}`;
}

function getSelectedConversationTaskKey() {
  const conversation = buildUploadConversationTarget(selectedUser);
  return conversation ? `${conversation.chatType}:${conversation.id}` : null;
}

function cleanupAttachmentUploadTask(task) {
  if (task?.previewUrl) {
    URL.revokeObjectURL(task.previewUrl);
    task.previewUrl = null;
  }
}

function getAttachmentQueueCounts() {
  return attachmentUploadTasks.reduce(
    (summary, task) => {
      if (
        ['queued', 'uploading', 'retrying', 'finalizing'].includes(task.status)
      ) {
        summary.active += 1;
      }
      if (task.status === 'pending-send') {
        summary.pending += 1;
      }
      if (task.status === 'failed') {
        summary.failed += 1;
      }
      if (task.status === 'completed') {
        summary.completed += 1;
      }
      return summary;
    },
    { active: 0, pending: 0, failed: 0, completed: 0 },
  );
}

function renderAttachmentQueueActionButtons(task) {
  const taskId = escapeHtml(task.id);
  const buttonClass =
    'rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100';

  if (task.status === 'pending-send') {
    return `<button type="button" onclick="removeAttachmentUploadTask('${taskId}')" class="${buttonClass}">Remove</button>`;
  }

  if (task.status === 'failed') {
    return `
      <div class="flex items-center gap-2">
        <button type="button" onclick="retryAttachmentUpload('${taskId}')" class="${buttonClass}">Retry</button>
        <button type="button" onclick="removeAttachmentUploadTask('${taskId}')" class="${buttonClass}">Remove</button>
      </div>
    `;
  }

  if (task.status === 'paused') {
    return `
      <div class="flex items-center gap-2">
        <button type="button" onclick="resumeAttachmentUpload('${taskId}')" class="${buttonClass}">Resume</button>
        <button type="button" onclick="cancelAttachmentUpload('${taskId}')" class="${buttonClass}">Stop</button>
      </div>
    `;
  }

  if (
    task.status === 'queued' ||
    task.status === 'uploading' ||
    task.status === 'retrying'
  ) {
    return `<button type="button" onclick="cancelAttachmentUpload('${taskId}')" class="${buttonClass}">Stop</button>`;
  }

  if (task.status === 'cancelled' || task.status === 'completed') {
    return `<button type="button" onclick="removeAttachmentUploadTask('${taskId}')" class="${buttonClass}">Remove</button>`;
  }

  if (task.status === 'finalizing') {
    return '<span class="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Finishing...</span>';
  }

  return `<button type="button" onclick="removeAttachmentUploadTask('${taskId}')" class="${buttonClass}">Remove</button>`;
}

function syncChatSendStatus() {
  const sendStatus = document.getElementById('chat-send-status');
  if (!sendStatus) {
    return;
  }

  const { active, pending, failed } = getAttachmentQueueCounts();
  const queuedMessageCount =
    queuedOutgoingTextMessages.length + (activeOutgoingTextMessage ? 1 : 0);
  if (offlineQueuedMessages.length > 0) {
    sendStatus.textContent =
      offlineQueuedMessages.length === 1
        ? '1 message is queued offline.'
        : `${offlineQueuedMessages.length} messages are queued offline.`;
    sendStatus.classList.remove('hidden');
    return;
  }

  if (queuedMessageCount > 0) {
    sendStatus.textContent =
      queuedMessageCount === 1
        ? '1 message is moving through the send queue.'
        : `${queuedMessageCount} messages are moving through the send queue.`;
    sendStatus.classList.remove('hidden');
    return;
  }

  if (pending > 0) {
    sendStatus.textContent =
      pending === 1
        ? '1 file is ready. Press Send to start it.'
        : `${pending} files are ready. Press Send to start them.`;
    sendStatus.classList.remove('hidden');
    return;
  }

  if (active > 0) {
    sendStatus.textContent =
      active === 1
        ? '1 file is uploading in the background.'
        : `${active} files are uploading in the background.`;
    sendStatus.classList.remove('hidden');
    return;
  }

  if (failed > 0) {
    sendStatus.textContent =
      failed === 1
        ? '1 upload needs attention.'
        : `${failed} uploads need attention.`;
    sendStatus.classList.remove('hidden');
    return;
  }

  sendStatus.textContent = '';
  sendStatus.classList.add('hidden');
}

function renderAttachmentUploadQueue() {
  const preview = document.getElementById('attachment-preview');
  const queueList = document.getElementById('attachment-queue-list');
  const queueSummary = document.getElementById('attachment-queue-summary');
  const queueNote = document.getElementById('attachment-preview-note');
  const clearButton = document.getElementById('attachment-clear-finished-btn');

  if (!preview || !queueList || !queueSummary || !queueNote || !clearButton) {
    syncChatSendStatus();
    return;
  }

  if (!attachmentUploadTasks.length) {
    preview.classList.add('hidden');
    queueList.innerHTML = '';
    queueSummary.textContent = '';
    queueNote.textContent =
      'Choose one or more files and they will upload in the background while you keep chatting.';
    clearButton.classList.add('hidden');
    syncChatSendStatus();
    return;
  }

  const { active, pending, failed, completed } = getAttachmentQueueCounts();
  preview.classList.remove('hidden');
  queueSummary.textContent =
    pending > 0
      ? `${pending} ${pending === 1 ? 'file is' : 'files are'} ready to send`
      : active > 0
        ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}`
        : failed > 0
          ? `${failed} ${failed === 1 ? 'upload needs' : 'uploads need'} attention`
          : `${completed} ${completed === 1 ? 'file is' : 'files are'} ready`;
  queueNote.textContent =
    pending > 0
      ? 'Selected files stay here until you press Send. After that, they upload in the background.'
      : active > 0
        ? 'Uploads keep running in the background, so you can still send normal messages.'
        : failed > 0
          ? 'Retry any failed upload without losing the rest of the queue.'
          : 'Completed uploads can be cleared from this list anytime.';

  clearButton.classList.toggle('hidden', completed === 0);
  queueList.innerHTML = attachmentUploadTasks
    .map((task) => {
      const isDone = task.status === 'completed';
      const isFailed = task.status === 'failed';
      const percentage = task.file?.size
        ? Math.max(
          0,
          Math.min(
            100,
            Math.round((task.progressBytes / task.file.size) * 100),
          ),
        )
        : 0;
      const progressText = isDone
        ? 'Ready in chat'
        : isFailed
          ? task.errorMessage || 'Upload paused'
          : task.status === 'cancelled'
            ? 'Upload stopped'
            : task.status === 'paused'
              ? 'Paused'
              : task.status === 'pending-send'
                ? 'Ready to send'
                : task.status === 'queued'
                  ? 'Waiting in queue'
                  : task.status === 'retrying'
                    ? task.errorMessage || 'Retrying upload...'
                    : task.status === 'finalizing'
                      ? 'Finalizing file...'
                      : formatUploadProgress(
                        task.progressBytes,
                        task.file.size,
                      );
      const actionButton = renderAttachmentQueueActionButtons(task);

      return `
        <div class="rounded-[20px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
          <div class="flex items-start gap-3">
            ${task.previewUrl
          ? `<img src="${escapeHtml(task.previewUrl)}" alt="" class="h-14 w-14 rounded-2xl object-cover" />`
          : `<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-500">${escapeHtml((task.file?.name || 'file').split('.').pop() || 'file')}</div>`
        }
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-slate-800">${escapeHtml(task.file?.name || 'Attachment')}</p>
                  <p class="text-xs leading-5 text-slate-500">${escapeHtml(task.conversation?.name || 'Chat')} · ${escapeHtml(formatAttachmentMeta(task.file) || formatBytes(task.file?.size || 0))}</p>
                </div>
                ${actionButton}
              </div>
              <div class="mt-3 space-y-2">
                <div class="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div class="h-full rounded-full bg-blue-600 transition-all" style="width: ${percentage}%"></div>
                </div>
                <div class="flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>${escapeHtml(progressText)}</span>
                  <span>${task.status === 'pending-send' ? 'Ready' : isDone ? '100%' : `${percentage}%`}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  syncChatSendStatus();
}

async function createAttachmentUploadSession(task) {
  const res = await api('/chat/uploads/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receiverId: task.conversation?.receiverId || undefined,
      groupId: task.conversation?.groupId || undefined,
      fileName: task.file.name,
      fileMimeType: task.resolvedMimeType || task.file.type,
      fileSize: task.file.size,
    }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to prepare the file upload session.',
  );

  if (!res.ok) {
    throw createUploadRequestError(
      data.message || 'Failed to prepare the file upload session',
      res.status,
    );
  }

  task.sessionId = data.sessionId;
  task.chunkSize = data.chunkSize ?? 0;
  task.totalChunks = data.totalChunks ?? 0;
  task.uploadedBytes = data.uploadedBytes ?? 0;
  task.progressBytes = task.uploadedBytes;
  task.uploadTransport = data.uploadTransport || 'server-relay';
  task.storageProvider = data.storageProvider || 'local';
  task.nextChunkIndex = normalizeAttachmentUploadNextChunkIndex(
    data.nextChunkIndex,
    0,
  );
  return data;
}

async function syncAttachmentUploadSession(task) {
  if (!task?.sessionId) {
    return null;
  }

  const res = await api(
    `/chat/uploads/sessions/${encodeURIComponent(task.sessionId)}`,
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to refresh the upload session.',
  );

  if (!res.ok) {
    throw createUploadRequestError(
      data.message || 'Failed to refresh the upload session',
      res.status,
    );
  }

  task.chunkSize = data.chunkSize ?? task.chunkSize ?? 0;
  task.totalChunks = data.totalChunks ?? task.totalChunks ?? 0;
  task.uploadedBytes = data.uploadedBytes ?? 0;
  task.progressBytes = task.uploadedBytes;
  task.uploadTransport =
    data.uploadTransport || task.uploadTransport || 'server-relay';
  task.storageProvider =
    data.storageProvider || task.storageProvider || 'local';
  task.nextChunkIndex = normalizeAttachmentUploadNextChunkIndex(
    data.nextChunkIndex,
    0,
  );
  return data;
}

async function finalizeAttachmentUploadSession(task) {
  const res = await api(
    `/chat/uploads/sessions/${encodeURIComponent(task.sessionId)}/finalize`,
    {
      method: 'POST',
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to finalize the uploaded file.',
  );

  if (!res.ok) {
    throw createUploadRequestError(
      data.message || 'Failed to finalize the uploaded file',
      res.status,
    );
  }

  return data;
}

async function cancelAttachmentUploadSession(task) {
  if (!task?.sessionId) {
    return;
  }

  const res = await api(
    `/chat/uploads/sessions/${encodeURIComponent(task.sessionId)}/cancel`,
    {
      method: 'POST',
    },
  );
  await readJsonResponse(res, {}, 'Failed to cancel the upload session.');
}

async function prepareAttachmentUploadPart(task, chunkIndex) {
  const res = await api(
    `/chat/uploads/sessions/${encodeURIComponent(task.sessionId)}/parts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkIndex }),
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to prepare the file upload part.',
  );

  if (!res.ok) {
    throw createUploadRequestError(
      data.message || 'Failed to prepare the file upload part',
      res.status,
    );
  }

  return data;
}

async function completeAttachmentUploadPart(task, chunkIndex, etag, size) {
  const res = await api(
    `/chat/uploads/sessions/${encodeURIComponent(task.sessionId)}/parts/${encodeURIComponent(String(chunkIndex))}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ etag, size }),
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to confirm the uploaded file part.',
  );

  if (!res.ok) {
    throw createUploadRequestError(
      data.message || 'Failed to confirm the uploaded file part',
      res.status,
    );
  }

  return data;
}

function uploadChunkToSignedUrlWithProgress(uploadUrl, chunkBlob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.timeout = 0;

    activeAttachmentUploadRequest = {
      taskId: activeAttachmentUploadTaskId,
      xhr,
    };

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress?.(event.loaded, event.total);
    };

    xhr.onerror = () => {
      activeAttachmentUploadRequest = null;
      reject(
        createUploadRequestError(
          'Network error while uploading file chunk',
          xhr.status,
          'Network error while uploading file chunk',
          'NETWORK_ERROR',
        ),
      );
    };

    xhr.ontimeout = () => {
      activeAttachmentUploadRequest = null;
      reject(
        createUploadRequestError(
          'Upload timed out while sending the file chunk',
          0,
          'Upload timed out while sending the file chunk',
          'UPLOAD_TIMEOUT',
        ),
      );
    };

    xhr.onabort = () => {
      activeAttachmentUploadRequest = null;
      const abortReason =
        xhr.__chatAbortReason === 'paused' ? 'paused' : 'cancelled';
      reject(
        createUploadRequestError(
          abortReason === 'paused' ? 'Upload paused' : 'Upload cancelled',
          0,
          abortReason === 'paused' ? 'Upload paused' : 'Upload cancelled',
          abortReason === 'paused' ? 'UPLOAD_PAUSED' : 'UPLOAD_CANCELLED',
        ),
      );
    };

    xhr.onload = () => {
      activeAttachmentUploadRequest = null;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          createUploadRequestError('Failed to upload file chunk', xhr.status),
        );
        return;
      }

      const etag =
        xhr.getResponseHeader('etag') || xhr.getResponseHeader('ETag') || '';
      if (!etag) {
        reject(
          createUploadRequestError(
            'Upload succeeded but the storage service did not return an ETag. Check your R2 CORS settings.',
            xhr.status,
          ),
        );
        return;
      }

      resolve({ etag });
    };

    xhr.send(chunkBlob);
  });
}

function shouldAttemptDirectAttachmentUploadFallback(task, error) {
  if (
    !task?.file ||
    !task?.conversation ||
    task.directUploadFallbackAttempted ||
    task.pauseRequested ||
    !navigator.onLine ||
    Number(task.file.size || 0) > 25 * 1024 * 1024
  ) {
    return false;
  }

  if (Number(task.uploadedBytes || 0) > 0) {
    return false;
  }

  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toUpperCase();

  return (
    !status ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    ['NETWORK_ERROR', 'UPLOAD_TIMEOUT'].includes(code)
  );
}

function scheduleAttachmentUploadRetry(task) {
  if (task.autoRetryCount >= MAX_ATTACHMENT_UPLOAD_AUTO_RETRIES) {
    task.status = 'failed';
    task.errorMessage =
      'Upload stopped after repeated connection problems. Press Retry to continue.';
    renderAttachmentUploadQueue();
    return;
  }

  task.autoRetryCount += 1;
  task.status = 'retrying';
  task.errorMessage = `Reconnecting upload${task.autoRetryCount > 1 ? ` (attempt ${task.autoRetryCount})` : ''}...`;
  renderAttachmentUploadQueue();

  const delay = Math.min(2000 * task.autoRetryCount, 10000);
  window.setTimeout(() => {
    if (task.status !== 'retrying') {
      return;
    }

    task.status = 'queued';
    task.errorMessage = '';
    renderAttachmentUploadQueue();
    processAttachmentUploadQueue().catch((error) => {
      console.error('Failed to resume upload queue', error);
    });
  }, delay);
}

async function uploadAttachmentTaskWithDirectEndpoint(task) {
  if (!task?.file || !task.conversation) {
    throw new Error('Upload task is missing file data');
  }

  task.directUploadFallbackAttempted = true;
  task.status = 'uploading';
  task.errorMessage = '';
  task.progressBytes = 0;
  renderAttachmentUploadQueue();

  const message = await uploadFormDataWithProgress(
    '/chat/attachments',
    buildAttachmentUploadFormData(task.file, task.conversation),
    (loaded) => {
      task.progressBytes = Math.min(task.file.size, loaded);
      renderAttachmentUploadQueue();
    },
  );

  task.status = 'completed';
  task.progressBytes = task.file.size;
  task.uploadedBytes = task.file.size;
  task.errorMessage = '';
  renderAttachmentUploadQueue();

  if (task.sessionId) {
    await cancelAttachmentUploadSession(task).catch((error) => {
      console.warn(
        'Failed to clean up chunked upload session after direct upload fallback',
        error,
      );
    });
  }

  await handleIncomingMessage(message, true);
  removeAttachmentUploadTask(task.id);
}

async function uploadAttachmentTask(task) {
  if (!task?.file || !task.conversation) {
    throw new Error('Upload task is missing file data');
  }

  task.status = 'uploading';
  task.errorMessage = '';
  renderAttachmentUploadQueue();

  if (!task.sessionId) {
    await createAttachmentUploadSession(task);
  } else {
    await syncAttachmentUploadSession(task);
  }

  const chunkSize = task.chunkSize || 5 * 1024 * 1024;
  let nextChunkIndex = normalizeAttachmentUploadNextChunkIndex(
    task.nextChunkIndex,
    0,
  );
  task.progressBytes = task.uploadedBytes || 0;

  while (
    nextChunkIndex !== null &&
    nextChunkIndex < Math.max(task.totalChunks || 0, 1)
  ) {
    if (task.pauseRequested) {
      throw new Error('Upload paused');
    }

    const start = nextChunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, task.file.size);
    const chunkBlob = task.file.slice(start, end);
    const confirmedBytes = start;

    task.status = 'uploading';
    renderAttachmentUploadQueue();

    let data;
    if (task.uploadTransport === 'presigned-put') {
      const uploadPart = await prepareAttachmentUploadPart(
        task,
        nextChunkIndex,
      );
      const uploadedPart = await uploadChunkToSignedUrlWithProgress(
        uploadPart.uploadUrl,
        chunkBlob,
        (loaded) => {
          task.progressBytes = Math.min(
            task.file.size,
            confirmedBytes + loaded,
          );
          renderAttachmentUploadQueue();
        },
      );
      data = await completeAttachmentUploadPart(
        task,
        nextChunkIndex,
        uploadedPart.etag,
        chunkBlob.size,
      );
    } else {
      data = await uploadChunkWithProgress(
        task.sessionId,
        nextChunkIndex,
        chunkBlob,
        (loaded) => {
          task.progressBytes = Math.min(
            task.file.size,
            confirmedBytes + loaded,
          );
          renderAttachmentUploadQueue();
        },
      );
    }

    task.uploadedBytes = data.uploadedBytes ?? end;
    task.progressBytes = task.uploadedBytes;
    task.autoRetryCount = 0;
    task.nextChunkIndex = normalizeAttachmentUploadNextChunkIndex(
      data.nextChunkIndex,
      nextChunkIndex + 1,
    );
    nextChunkIndex = task.nextChunkIndex;
    if (nextChunkIndex === null) {
      task.uploadedBytes = task.file.size;
      task.progressBytes = task.file.size;
    }
    renderAttachmentUploadQueue();
  }

  if (task.pauseRequested) {
    throw createUploadRequestError(
      'Upload paused',
      0,
      'Upload paused',
      'UPLOAD_PAUSED',
    );
  }

  task.status = 'finalizing';
  task.progressBytes = task.file.size;
  renderAttachmentUploadQueue();

  const message = await finalizeAttachmentUploadSession(task);
  task.status = 'completed';
  task.progressBytes = task.file.size;
  task.uploadedBytes = task.file.size;
  task.completedMessageId = message.id || null;
  task.errorMessage = '';
  renderAttachmentUploadQueue();
  await handleIncomingMessage(message, true);
  removeAttachmentUploadTask(task.id);
}

async function processAttachmentUploadQueue() {
  if (activeAttachmentUploadTaskId) {
    return;
  }

  const nextTask = attachmentUploadTasks.find(
    (task) => task.status === 'queued',
  );
  if (!nextTask) {
    renderAttachmentUploadQueue();
    return;
  }

  activeAttachmentUploadTaskId = nextTask.id;

  try {
    await uploadAttachmentTask(nextTask);
    nextTask.autoRetryCount = 0;
  } catch (error) {
    console.error('Attachment upload failed', error);

    if (
      nextTask.pauseRequested ||
      error?.code === 'UPLOAD_PAUSED' ||
      String(error?.message || '')
        .toLowerCase()
        .includes('paused')
    ) {
      nextTask.status = 'paused';
      nextTask.errorMessage = 'Upload paused';
      nextTask.pauseRequested = false;
    } else if (
      error?.code === 'UPLOAD_CANCELLED' ||
      String(error?.message || '')
        .toLowerCase()
        .includes('cancel')
    ) {
      nextTask.status = 'cancelled';
      nextTask.errorMessage = 'Upload stopped';
    } else {
      let resolvedError = error;

      if (shouldAttemptDirectAttachmentUploadFallback(nextTask, error)) {
        try {
          await uploadAttachmentTaskWithDirectEndpoint(nextTask);
          nextTask.autoRetryCount = 0;
          return;
        } catch (fallbackError) {
          console.error(
            'Attachment direct upload fallback failed',
            fallbackError,
          );
          resolvedError = fallbackError;
        }
      }

      if (isRecoverableUploadError(resolvedError)) {
        try {
          await syncAttachmentUploadSession(nextTask);
        } catch (syncError) {
          console.error(
            'Failed to sync upload after recoverable error',
            syncError,
          );
        }
        scheduleAttachmentUploadRetry(nextTask);
      } else {
        nextTask.status = 'failed';
        nextTask.errorMessage = resolvedError?.message || 'Upload failed';
      }
    }
  } finally {
    if (activeAttachmentUploadTaskId === nextTask.id) {
      activeAttachmentUploadTaskId = null;
    }
    renderAttachmentUploadQueue();
    if (attachmentUploadTasks.some((task) => task.status === 'queued')) {
      void processAttachmentUploadQueue();
    }
  }
}

function queuePendingAttachmentUploads(
  conversationKey = getSelectedConversationTaskKey(),
) {
  let queuedCount = 0;

  attachmentUploadTasks.forEach((task) => {
    if (
      task.status === 'pending-send' &&
      getAttachmentTaskConversationKey(task) === conversationKey
    ) {
      task.status = 'queued';
      task.errorMessage = '';
      queuedCount += 1;
    }
  });

  if (queuedCount > 0) {
    renderAttachmentUploadQueue();
  }

  return queuedCount;
}

async function startAttachmentUploads(files, conversation) {
  const acceptedFiles = Array.from(files || []).filter(
    (file) => file && file.size,
  );
  if (!acceptedFiles.length) {
    return;
  }

  const preparedFiles = await Promise.all(
    acceptedFiles.map((file) => compressImageFileIfNeeded(file)),
  );
  preparedFiles.forEach((file) => {
    attachmentUploadTasks.push(createAttachmentUploadTask(file, conversation));
  });
  renderAttachmentUploadQueue();
}

async function retryAttachmentUpload(taskId) {
  const task = attachmentUploadTasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  task.status = 'queued';
  task.errorMessage = '';
  task.pauseRequested = false;
  task.autoRetryCount = 0;
  renderAttachmentUploadQueue();
  await processAttachmentUploadQueue();
}

async function resumeAttachmentUpload(taskId) {
  await retryAttachmentUpload(taskId);
}

async function pauseAttachmentUpload(taskId) {
  const task = attachmentUploadTasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  if (task.status === 'finalizing') {
    return;
  }

  task.pauseRequested = true;
  if (activeAttachmentUploadRequest?.taskId === task.id) {
    activeAttachmentUploadRequest.xhr.__chatAbortReason = 'paused';
    activeAttachmentUploadRequest.xhr?.abort();
    return;
  }

  task.status = 'paused';
  task.errorMessage = 'Upload paused';
  renderAttachmentUploadQueue();
}

async function cancelAttachmentUpload(taskId) {
  const task = attachmentUploadTasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }

  if (activeAttachmentUploadRequest?.taskId === task.id) {
    activeAttachmentUploadRequest.xhr.__chatAbortReason = 'cancelled';
    activeAttachmentUploadRequest.xhr?.abort();
    activeAttachmentUploadRequest = null;
  }

  task.status = 'cancelled';
  task.errorMessage = '';
  task.pauseRequested = false;
  renderAttachmentUploadQueue();

  try {
    await cancelAttachmentUploadSession(task);
  } catch (error) {
    console.error('Failed to cancel upload session', error);
  }
}

function removeAttachmentUploadTask(taskId) {
  const nextTasks = [];

  attachmentUploadTasks.forEach((task) => {
    if (task.id === taskId) {
      cleanupAttachmentUploadTask(task);
      return;
    }
    nextTasks.push(task);
  });

  attachmentUploadTasks = nextTasks;
  renderAttachmentUploadQueue();
}

function clearCompletedUploads() {
  const nextTasks = [];

  attachmentUploadTasks.forEach((task) => {
    if (['completed', 'cancelled'].includes(task.status)) {
      cleanupAttachmentUploadTask(task);
      return;
    }
    nextTasks.push(task);
  });

  attachmentUploadTasks = nextTasks;
  renderAttachmentUploadQueue();
}

function clearAttachmentSelection() {
  clearCompletedUploads();
  closeComposerActionsMenu();
}

function normalizeUser(user, existingUser = null) {
  if (!user && !existingUser) {
    return null;
  }

  const merged = {
    ...(existingUser || {}),
    ...(user || {}),
  };
  const nickname = user?.nickname ?? existingUser?.nickname ?? null;
  const name = user?.name ?? existingUser?.name ?? merged.email ?? 'User';
  const avatar = user?.avatar ?? existingUser?.avatar ?? null;
  const chatType = user?.chatType ?? existingUser?.chatType ?? 'direct';

  return {
    ...merged,
    name,
    avatar,
    nickname,
    chatType,
    isChatAccepted:
      user?.isChatAccepted ??
      existingUser?.isChatAccepted ??
      (chatType === 'group' ? null : false),
    memberCount: user?.memberCount ?? existingUser?.memberCount ?? null,
    role: user?.role ?? existingUser?.role ?? null,
    members: user?.members ?? existingUser?.members ?? [],
    pendingInvites: user?.pendingInvites ?? existingUser?.pendingInvites ?? [],
    displayName:
      chatType === 'group'
        ? user?.displayName || existingUser?.displayName || name
        : nickname || user?.displayName || existingUser?.displayName || name,
  };
}

function isAcceptedDirectChatUser(user) {
  if (!user || isGroupConversation(user)) {
    return false;
  }

  if (typeof user.isChatAccepted === 'boolean') {
    return user.isChatAccepted;
  }

  const preview = String(user.lastMessagePreview || '').trim();
  return (
    preview !== 'Chat request sent' && preview !== 'Sent you a chat request'
  );
}

function getAcceptedGroupCandidates() {
  const seen = new Set();
  return (Array.isArray(users) ? users : []).filter((user) => {
    if (
      !isAcceptedDirectChatUser(user) ||
      !user?.id ||
      user.id === currentUser?.id ||
      seen.has(user.id)
    ) {
      return false;
    }

    seen.add(user.id);
    return true;
  });
}

function renderEmptyGroupCandidateState(message) {
  return `
    <div class="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm leading-6 text-slate-500">
      ${escapeHtml(message)}
    </div>
  `;
}

function resetSelectedConversation() {
  rememberActiveConversationScroll();
  selectedUser = null;
  detachedSelectedUser = false;
  clearReplyTarget();
  resetSpecialMessageDraft();
  clearStructuredMessageRefreshTimer();
  renderedMessageIds = new Set();
  conversationMessages = new Map();
  messagePagination = createMessagePaginationState();
  activeConversationCacheKey = null;
  document.getElementById('messages-list').innerHTML = '';
  document.getElementById('empty-state').classList.remove('hidden');
  document.getElementById('chat-header').classList.add('hidden');
  document.getElementById('chat-header').classList.remove('flex');
  document.getElementById('message-container').classList.add('hidden');
  document.getElementById('message-container').classList.remove('flex');
  document.getElementById('input-area').classList.add('hidden');
  document.body.classList.remove('chat-mode-active');
  document.getElementById('mobile-chat-topbar')?.classList.remove('hidden');
  applyChatTheme();
  closeChatActionsMenu();
  closeComposerActionsMenu();
  renderUsers();
  if (!isFileOrigin) {
    writeSessionValue(LAST_CHAT_ROUTE_KEY, '/chat');
    history.replaceState(null, '', '/chat');
  }
}

function syncSelectedUser() {
  if (!selectedUser) {
    return;
  }

  const matchedUser = users.find((user) => user.id === selectedUser.id);
  if (!matchedUser) {
    if (detachedSelectedUser) {
      applyChatTheme();
      return;
    }
    resetSelectedConversation();
    return;
  }

  selectedUser = matchedUser;
  detachedSelectedUser = false;
  applyChatTheme();
}

function updateChatCount() {
  updateChatNavigationState(users.length);
}

function scheduleRenderUsers() {
  if (usersRenderFrame) {
    return;
  }

  usersRenderFrame = window.requestAnimationFrame(() => {
    usersRenderFrame = 0;
    renderUsers();
  });
}

function scheduleHeaderUpdate() {
  if (headerRenderFrame) {
    return;
  }

  headerRenderFrame = window.requestAnimationFrame(() => {
    headerRenderFrame = 0;
    updateSelectedUserHeader();
  });
}

function triggerMotionClass(element, className, durationMs = 420) {
  if (!element || !className) {
    return;
  }

  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => {
    element.classList.remove(className);
  }, durationMs);
}

function getCacheAgeMs(savedAt) {
  const timestamp = Number(savedAt || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Date.now() - timestamp);
}

function serializeRecentActivityEntries() {
  return Array.from(recentActivity.entries()).map(([userId, state]) => [
    userId,
    {
      lastAt: Number(state?.lastAt || 0),
      preview: String(state?.preview || ''),
      unread: Number(state?.unread || 0),
    },
  ]);
}

function hydrateRecentActivityEntries(entries = []) {
  return new Map(
    (Array.isArray(entries) ? entries : []).map(([userId, state]) => [
      userId,
      {
        lastAt: Number(state?.lastAt || 0),
        preview: String(state?.preview || ''),
        unread: Number(state?.unread || 0),
      },
    ]),
  );
}

function restoreChatShellCache() {
  const payload = readStoredJson(getShellCacheKey(), null);
  if (
    !payload ||
    payload.version !== CLIENT_CACHE_VERSION ||
    !Array.isArray(payload.users) ||
    getCacheAgeMs(payload.savedAt) > CHAT_SHELL_CACHE_MAX_AGE_MS
  ) {
    return false;
  }

  users = payload.users.map((user) => normalizeUser(user)).filter(Boolean);
  groupInvites = Array.isArray(payload.groupInvites)
    ? payload.groupInvites
    : [];
  recentActivity = hydrateRecentActivityEntries(payload.recentActivity);
  syncSelectedUser();
  updateChatCount();
  renderGroupInvites();
  renderUsers();
  return true;
}

function persistChatShellCache() {
  if (!currentUser?.id) {
    return;
  }

  writeStoredJson(getShellCacheKey(), {
    version: CLIENT_CACHE_VERSION,
    savedAt: Date.now(),
    users,
    groupInvites,
    recentActivity: serializeRecentActivityEntries(),
  });
}

function schedulePersistChatShellCache() {
  if (!currentUser?.id) {
    return;
  }

  if (shellCachePersistTimer) {
    window.clearTimeout(shellCachePersistTimer);
  }

  shellCachePersistTimer = window.setTimeout(() => {
    shellCachePersistTimer = 0;
    scheduleIdleWork(() => {
      persistChatShellCache();
    });
  }, CACHE_PERSIST_DEBOUNCE_MS);
}

function scheduleUsersRefreshInBackground(options = {}) {
  const { minAgeMs = 0, delayMs = 120 } = options;

  if (
    !currentUser?.id ||
    loadUsersPromise ||
    backgroundUsersRefreshPromise ||
    backgroundUsersRefreshTimer
  ) {
    return;
  }

  const payload = readStoredJson(getShellCacheKey(), null);
  if (
    payload?.version === CLIENT_CACHE_VERSION &&
    getCacheAgeMs(payload.savedAt) < minAgeMs
  ) {
    return;
  }

  backgroundUsersRefreshTimer = window.setTimeout(() => {
    backgroundUsersRefreshTimer = 0;
    backgroundUsersRefreshPromise = loadUsers()
      .catch((error) => {
        console.error('Failed to refresh chat shell in background', error);
      })
      .finally(() => {
        backgroundUsersRefreshPromise = null;
      });
  }, delayMs);
}

function clampStartupProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function showStartupLoader() {
  const loader = getById('startup-loader');
  if (!loader) {
    return;
  }

  if (startupLoaderHideTimer) {
    window.clearTimeout(startupLoaderHideTimer);
    startupLoaderHideTimer = 0;
  }

  startupLoaderVisibleSince = Date.now();
  loader.classList.remove('hidden');
  loader.classList.add('flex');
  document.body.classList.add('startup-loading');
}

function setStartupLoaderProgress(
  percent,
  title = 'Loading your chats',
  detail = 'Opening your secure chats.',
) {
  const loader = getById('startup-loader');
  if (!loader) {
    return;
  }

  const progress = clampStartupProgress(percent);
  const titleNode = getById('startup-loader-title');
  const bar = getById('startup-loader-bar');
  const detailNode = getById('startup-loader-detail');

  if (titleNode) {
    titleNode.textContent = `${title} [${progress}%]`;
  }
  if (bar) {
    bar.style.width = `${Math.max(progress, 6)}%`;
  }
  if (detailNode) {
    detailNode.textContent = detail;
  }
}

function getSecurityWelcomeNoticeSeenKey(userId = currentUser?.id) {
  return userId
    ? `ochat_security_notice_seen:${SECURITY_WELCOME_NOTICE_VERSION}:${userId}`
    : '';
}

function dismissSecurityWelcomeNotice() {
  const notice = getById('security-welcome-notice');
  if (!notice) {
    return;
  }

  notice.classList.remove('is-visible');
  window.setTimeout(() => {
    notice.classList.add('hidden');
  }, 180);
}

function maybeShowSecurityWelcomeNotice() {
  const notice = getById('security-welcome-notice');
  const key = getSecurityWelcomeNoticeSeenKey();
  if (!notice || !key || readStoredValue(key, '') === '1') {
    return;
  }

  writeStoredValue(key, '1');
  notice.classList.remove('hidden');
  window.requestAnimationFrame(() => {
    notice.classList.add('is-visible');
  });
  window.setTimeout(() => {
    dismissSecurityWelcomeNotice();
  }, 6500);
}

function hideStartupLoader(options = {}) {
  const loader = getById('startup-loader');
  if (!loader) {
    return;
  }

  if (startupLoaderHideTimer) {
    window.clearTimeout(startupLoaderHideTimer);
    startupLoaderHideTimer = 0;
  }

  const immediate = Boolean(options.immediate);
  const elapsed = Date.now() - startupLoaderVisibleSince;
  const delayMs = immediate ? 0 : Math.max(0, 320 - elapsed);

  startupLoaderHideTimer = window.setTimeout(() => {
    startupLoaderHideTimer = 0;
    loader.classList.add('hidden');
    loader.classList.remove('flex');
    document.body.classList.remove('startup-loading');
  }, delayMs);
}

function getChatFilterCounts() {
  const activeUsers = users.filter((user) => !isConversationArchived(user));
  const unreadCount = activeUsers.filter(
    (user) => Number(recentActivity.get(user.id)?.unread || 0) > 0,
  ).length;
  const groupCount = activeUsers.filter((user) =>
    isGroupConversation(user),
  ).length;
  const pinnedCount = activeUsers.filter((user) =>
    isConversationPinned(user),
  ).length;
  const archivedCount = users.filter((user) =>
    isConversationArchived(user),
  ).length;

  return {
    activeCount: activeUsers.length,
    unreadCount,
    groupCount,
    pinnedCount,
    archivedCount,
  };
}

function updateChatNavigationState(displayedCount = null) {
  const counts = getChatFilterCounts();
  const appliedCount =
    typeof displayedCount === 'number' && Number.isFinite(displayedCount)
      ? displayedCount
      : counts.activeCount;

  const chatCount = getById('chat-count');
  if (chatCount) {
    chatCount.textContent = String(Math.max(0, appliedCount));
  }

  const chipLabels = {
    all: 'All',
    unread: counts.unreadCount ? `Unread ${counts.unreadCount}` : 'Unread',
    groups: counts.groupCount ? `Groups ${counts.groupCount}` : 'Groups',
    pinned: counts.pinnedCount ? `Pinned ${counts.pinnedCount}` : 'Pinned',
  };

  Object.entries(chipLabels).forEach(([filter, label]) => {
    const button = getById(`chat-filter-${filter}`);
    if (!button) {
      return;
    }

    button.textContent = label;
    button.classList.toggle('is-active', activeChatListFilter === filter);
  });

  const railChatBadge = getById('desktop-rail-chat-badge');
  if (railChatBadge) {
    railChatBadge.textContent = String(Math.max(0, counts.activeCount));
    railChatBadge.classList.toggle('hidden', counts.activeCount === 0);
  }

  const railUnreadBadge = getById('desktop-rail-unread-badge');
  if (railUnreadBadge) {
    railUnreadBadge.textContent = String(Math.max(0, counts.unreadCount));
    railUnreadBadge.classList.toggle('hidden', counts.unreadCount === 0);
  }

  document.querySelectorAll('[data-rail-action]').forEach((button) => {
    const action = button.dataset.railAction || '';
    const isActive =
      (action === 'archived' && showArchivedChats) ||
      (action === activeChatListFilter && !showArchivedChats);
    button.classList.toggle('is-active', isActive);
  });
}

function setActiveChatListFilter(filter = 'all') {
  const nextFilter = ['all', 'unread', 'groups', 'pinned'].includes(filter)
    ? filter
    : 'all';
  activeChatListFilter = nextFilter;
  if (showArchivedChats && nextFilter !== 'all') {
    showArchivedChats = false;
  }
  renderUsers();
}

function focusChatSearch() {
  showUsersList();
  setActiveChatListFilter('all');
  window.setTimeout(() => {
    getById('user-search')?.focus();
  }, 40);
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) {
    throw new Error('Nothing to copy.');
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function handleUserSearchInput() {
  const query = document
    .getElementById('user-search')
    ?.value.trim()
    .toLowerCase();
  if (userSearchDebounceTimer) {
    window.clearTimeout(userSearchDebounceTimer);
    userSearchDebounceTimer = 0;
  }

  if (!query) {
    userSearchRequestToken += 1;
    userSearchResults = [];
    userSearchResultsQuery = '';
    scheduleRenderUsers();
    return;
  }

  userSearchDebounceTimer = window.setTimeout(() => {
    userSearchDebounceTimer = 0;
    void loadUserSearchResults(query).catch((error) => {
      console.error('Failed to search users', error);
    });
  }, 180);

  scheduleRenderUsers();
}

function setFeedbackMessage(elementId, message, type = 'info') {
  const box = getById(elementId);
  box.innerText = message || '';
  box.classList.remove(
    'hidden',
    'bg-red-50',
    'border-red-200',
    'text-red-700',
    'bg-emerald-50',
    'border-emerald-200',
    'text-emerald-700',
    'bg-slate-50',
    'border-slate-200',
    'text-slate-700',
  );

  if (!message) {
    box.classList.add('hidden');
    return;
  }

  if (type === 'error') {
    box.classList.add('bg-red-50', 'border-red-200', 'text-red-700');
  } else if (type === 'success') {
    box.classList.add(
      'bg-emerald-50',
      'border-emerald-200',
      'text-emerald-700',
    );
  } else {
    box.classList.add('bg-slate-50', 'border-slate-200', 'text-slate-700');
  }
}

function showAuthFeedback(message, type = 'info') {
  setFeedbackMessage('auth-feedback', message, type);
}

function showVerificationFeedback(message, type = 'info') {
  setFeedbackMessage('verification-feedback', message, type);
}

function showForgotPasswordFeedback(message, type = 'info') {
  setFeedbackMessage('forgot-password-feedback', message, type);
}

function showResetPasswordFeedback(message, type = 'info') {
  setFeedbackMessage('reset-password-feedback', message, type);
}

function buildOtpPreviewMessage(data, fallbackMessage) {
  const message = fallbackMessage || data?.message || '';

  if (!data?.devOtp) {
    return message;
  }

  const mailboxNote = data.devMailboxPath
    ? `\nLocal mailbox preview: ${data.devMailboxPath}`
    : '';

  return `${message}\n\nLocal OTP preview: ${data.devOtp}${mailboxNote}`;
}

function sanitizeOtpInput(input) {
  input.value = String(input.value || '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

function hideAuxiliaryAuthSteps() {
  document.getElementById('verification-step').classList.add('hidden');
  document.getElementById('forgot-password-step').classList.add('hidden');
  document.getElementById('reset-password-step').classList.add('hidden');
}

function updateAuthModeCopy() {
  document.getElementById('auth-title').innerText = isLogin
    ? 'Welcome back'
    : 'Create your account';
  document.getElementById('auth-subtitle').innerText = isLogin
    ? 'Sign in to open your secure chats.'
    : 'Create your account to start secure chatting.';
  document.getElementById('auth-switch').innerText = isLogin
    ? 'New here? Create an account'
    : 'Already have an account? Sign in';
  document.getElementById('auth-btn').innerText = isLogin
    ? 'Sign in'
    : 'Create account';
  document.getElementById('name-input').classList.toggle('hidden', isLogin);
  document.getElementById('forgot-password-btn').classList.add('hidden');
}

function showAuthForm() {
  hideAuxiliaryAuthSteps();
  document.getElementById('auth-form').classList.remove('hidden');
  showVerificationFeedback('', 'info');
  showForgotPasswordFeedback('', 'info');
  showResetPasswordFeedback('', 'info');
  updateAuthModeCopy();
}

function hideVerificationStep(clearEmail = false) {
  showAuthForm();
  document.getElementById('verification-otp-input').value = '';
  if (clearEmail) {
    pendingVerificationEmail = '';
  }
}

function showVerificationStep(email, message) {
  pendingVerificationEmail =
    email || document.getElementById('email-input').value.trim();
  document.getElementById('email-input').value = pendingVerificationEmail;
  document.getElementById('verification-email').innerText =
    pendingVerificationEmail || 'your email address';
  document.getElementById('verification-message').innerText =
    message || 'Enter the 6-digit OTP sent to your email.';
  pendingResetEmail = '';
  hideAuxiliaryAuthSteps();
  document.getElementById('auth-form').classList.add('hidden');
  document.getElementById('verification-step').classList.remove('hidden');
  document.getElementById('auth-title').innerText = 'Verify Your Email';
  document.getElementById('auth-subtitle').innerText =
    'Enter the code from your email to continue.';
  document.getElementById('auth-feedback').classList.add('hidden');
  showVerificationFeedback('', 'info');
  document.getElementById('verification-otp-input').focus();
}

function showForgotPasswordStep(prefilledEmail = '', message = '') {
  pendingVerificationEmail = '';
  pendingResetEmail =
    prefilledEmail ||
    pendingResetEmail ||
    document.getElementById('email-input').value.trim();
  hideAuxiliaryAuthSteps();
  document.getElementById('auth-form').classList.add('hidden');
  document.getElementById('forgot-password-step').classList.remove('hidden');
  document.getElementById('auth-title').innerText = 'Forgot Password';
  document.getElementById('auth-subtitle').innerText =
    'Request a reset OTP for your account.';
  document.getElementById('auth-feedback').classList.add('hidden');
  document.getElementById('forgot-email-input').value = pendingResetEmail;
  showForgotPasswordFeedback(message, message ? 'success' : 'info');
  document.getElementById('forgot-email-input').focus();
}

function showResetPasswordStep(email = '', message = '') {
  pendingVerificationEmail = '';
  pendingResetEmail =
    email ||
    pendingResetEmail ||
    document.getElementById('forgot-email-input').value.trim() ||
    document.getElementById('email-input').value.trim();
  hideAuxiliaryAuthSteps();
  document.getElementById('auth-form').classList.add('hidden');
  document.getElementById('reset-password-step').classList.remove('hidden');
  document.getElementById('auth-title').innerText = 'Reset Password';
  document.getElementById('auth-subtitle').innerText =
    'Enter the OTP and set a new password.';
  document.getElementById('auth-feedback').classList.add('hidden');
  document.getElementById('reset-password-message').innerText =
    message || 'Enter your email, the 6-digit OTP, and a new password.';
  document.getElementById('reset-email-input').value = pendingResetEmail;
  document.getElementById('reset-otp-input').value = '';
  document.getElementById('reset-password-page-input').value = '';
  showResetPasswordFeedback('', 'info');
  document.getElementById('reset-email-input').focus();
}

async function submitVerificationOtp() {
  const email =
    pendingVerificationEmail ||
    document.getElementById('email-input').value.trim();
  const otp = document.getElementById('verification-otp-input').value.trim();

  if (!email) {
    showVerificationFeedback('Enter your email first.', 'error');
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    showVerificationFeedback('Enter the 6-digit OTP.', 'error');
    return;
  }

  const res = await fetch(`${API_URL}/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to verify email. The server returned an invalid response.',
  );

  if (!res.ok) {
    showVerificationFeedback(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to verify email',
      'error',
    );
    return;
  }

  hideVerificationStep(true);
  setAuthMode(true);
  document.getElementById('email-input').value = email;
  document.getElementById('password-input').value = '';
  showAuthFeedback(
    data.message || `Email verified for ${email}. You can log in now.`,
    'success',
  );
}

function returnToLoginFromAuxStep(message = '') {
  pendingVerificationEmail = '';
  pendingResetEmail = '';
  setAuthMode(true);
  showAuthForm();
  document.getElementById('email-input').value = '';
  document.getElementById('password-input').value = '';
  if (message) {
    showAuthFeedback(message, 'info');
  } else {
    showAuthFeedback('', 'info');
  }
}

function setAuthMode(nextIsLogin) {
  isLogin = nextIsLogin;
  updateAuthModeCopy();
  document
    .getElementById('confirm-password-input')
    .classList.toggle('hidden', isLogin);
}

function applyDarkMode(enabled) {
  const nextEnabled = Boolean(enabled);
  const bodyAlreadyMatches =
    document.body.classList.contains('dark-mode') === nextEnabled;
  writeStoredValue('chat_dark_mode', nextEnabled ? '1' : '0');
  document.documentElement.classList.toggle('prefers-dark-mode', nextEnabled);
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', nextEnabled ? '#191312' : '#f7e8e2');
  }
  const darkModeInput = document.getElementById('settings-darkmode-input');
  if (darkModeInput) {
    darkModeInput.checked = nextEnabled;
  }
  if (bodyAlreadyMatches) {
    return;
  }
  document.documentElement.classList.add('theme-switching');
  document.body.classList.toggle('dark-mode', nextEnabled);
  applyChatTheme();
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-switching');
    });
  });
}

function isStandaloneApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function updateInstallAppUI() {
  const installBtn = getById('install-app-btn');
  const installNote = getById('install-app-note');

  if (!installBtn || !installNote) {
    return;
  }

  const installed = isStandaloneApp();
  installBtn.classList.toggle('hidden', installed);

  if (installed) {
    installNote.innerText = 'O-chat is already installed on this device.';
    return;
  }

  if (deferredInstallPrompt) {
    installNote.innerText =
      'Install O-chat for a desktop-style window and quick access from your taskbar or dock.';
    return;
  }

  installNote.innerText =
    'If the browser does not show an install prompt yet, refresh once and then try the browser menu in Chrome or Edge.';
}

async function promptInstallApp() {
  if (isStandaloneApp()) {
    updateInstallAppUI();
    return;
  }

  if (!deferredInstallPrompt) {
    alert(
      'Your browser has not offered app installation yet. In Chrome or Edge, open the browser menu and choose Install app.',
    );
    updateInstallAppUI();
    return;
  }

  const installPrompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateInstallAppUI();
  await installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  updateInstallAppUI();
}

function updateSettingsUI() {
  if (!currentUser) {
    return;
  }

  const note = document.getElementById('settings-email-note');
  const confirmWrap = document.getElementById('settings-email-confirm-wrap');
  const confirmCopy = document.getElementById('settings-email-confirm-copy');
  const verificationStatus = document.getElementById(
    'settings-verification-status',
  );
  const pendingOtpWrap = document.getElementById(
    'settings-pending-email-otp-wrap',
  );
  const pendingOtpInput = document.getElementById(
    'settings-pending-email-otp-input',
  );
  const confirmOtpInput = document.getElementById(
    'settings-email-confirm-otp-input',
  );
  const accountDeletionStatus = document.getElementById(
    'settings-account-deletion-status',
  );
  const accountDeletionButton = document.getElementById(
    'settings-account-delete-btn',
  );
  const cancelAccountDeletionButton = document.getElementById(
    'settings-account-delete-cancel-btn',
  );
  document.getElementById('profile-name-input').value = currentUser.name || '';
  document.getElementById('profile-email-input').value =
    currentUser.email || '';
  document.getElementById('settings-backup-input').checked =
    currentUser.backupEnabled !== false;
  document.getElementById('settings-backup-images-input').checked =
    currentUser.backupImages !== false;
  document.getElementById('settings-backup-videos-input').checked =
    currentUser.backupVideos !== false;
  document.getElementById('settings-backup-files-input').checked =
    currentUser.backupFiles !== false;
  document.getElementById('settings-darkmode-input').checked = Boolean(
    currentUser.darkMode,
  );
  updateBackupSettingsAvailability();
  syncRingtonePreferenceUI();

  note.classList.add('hidden');
  note.innerText = '';
  confirmWrap.classList.add('hidden');
  confirmCopy.innerText = 'Email changes apply immediately.';
  pendingOtpWrap.classList.add('hidden');
  pendingOtpInput.value = '';
  confirmOtpInput.value = '';
  verificationStatus.innerText = `Email: ${currentUser.email}`;

  if (
    accountDeletionStatus &&
    accountDeletionButton &&
    cancelAccountDeletionButton
  ) {
    if (currentUser.deletionScheduledFor) {
      accountDeletionStatus.innerText = `Account deletion is scheduled for ${formatAdminUserDateTime(
        currentUser.deletionScheduledFor,
      )}. Log in before then if you want to cancel it.`;
      accountDeletionButton.textContent = 'Deletion Scheduled';
      accountDeletionButton.disabled = true;
      accountDeletionButton.classList.add('cursor-not-allowed', 'opacity-60');
      cancelAccountDeletionButton.classList.remove('hidden');
    } else {
      accountDeletionStatus.innerText =
        'Schedule your account for deletion. O-chat keeps it for 7 days in case you change your mind.';
      accountDeletionButton.textContent = 'Delete In 7 Days';
      accountDeletionButton.disabled = false;
      accountDeletionButton.classList.remove(
        'cursor-not-allowed',
        'opacity-60',
      );
      cancelAccountDeletionButton.classList.add('hidden');
    }
  }

  renderBlockedUsers();
  syncAdminPanelVisibility();
  if (currentUser.role === 'ADMIN' && adminUsersPayload.users.length) {
    renderAdminUsers();
  }
}

function updateBackupSettingsAvailability() {
  const backupEnabled = document.getElementById(
    'settings-backup-input',
  )?.checked;
  const container = document.getElementById('settings-backup-media-options');
  const inputs = [
    document.getElementById('settings-backup-images-input'),
    document.getElementById('settings-backup-videos-input'),
    document.getElementById('settings-backup-files-input'),
  ];

  if (!container) {
    return;
  }

  container.classList.toggle('opacity-50', !backupEnabled);
  for (const input of inputs) {
    if (!input) {
      continue;
    }
    input.disabled = !backupEnabled;
  }
}

function renderBlockedUsers() {
  const container = document.getElementById('settings-blocked-users');
  if (!container) {
    return;
  }

  if (!blockedUsers.length) {
    container.innerHTML = `
          <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            You have not blocked anyone.
          </div>
        `;
    return;
  }

  container.innerHTML = blockedUsers
    .map(
      (user) => `
            <div class="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 ${user !== blockedUsers[blockedUsers.length - 1] ? 'mb-3' : ''}">
              <div class="flex min-w-0 items-center gap-3">
                <img src="${userAvatar(user)}" alt="${escapeHtml(displayName(user))} profile photo" width="44" height="44" class="h-11 w-11 rounded-2xl object-cover">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(user.name || user.email || 'Blocked user')}</p>
                  <p class="truncate text-xs text-slate-500">${escapeHtml(user.email || '')}</p>
                </div>
              </div>
              <button onclick="unblockUserFromSettings('${user.id}')"
                class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50">
                Unblock
              </button>
            </div>
          `,
    )
    .join('');
}

function setAdminUsersState(message, type = 'empty') {
  const container = getById('settings-admin-users');
  if (!container) {
    return;
  }

  const toneClass =
    type === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-dashed border-slate-200 bg-slate-50 text-slate-500';

  container.innerHTML = `
    <div class="rounded-2xl border px-4 py-6 text-sm ${toneClass}">
      ${escapeHtml(message || '')}
    </div>
  `;
}

function syncAdminPanelVisibility() {
  const panel = getById('settings-admin-panel');
  if (!panel) {
    return;
  }

  panel.classList.toggle('hidden', currentUser?.role !== 'ADMIN');
}

function formatAdminUserDateTime(value) {
  if (!value) {
    return 'Not set';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not set';
  }

  return parsed.toLocaleString();
}

function filterAdminUsers(usersList, query) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase();
  if (!normalizedQuery) {
    return usersList;
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return usersList.filter((user) => {
    const searchText = [
      user.id,
      user.name,
      user.email,
      user.role,
      user.status,
      user.isApproved ? 'approved' : 'pending',
      user.isBanned ? 'banned' : 'not-banned',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return tokens.every((token) => searchText.includes(token));
  });
}

function renderAdminUsers(payload = adminUsersPayload) {
  const summary = getById('settings-admin-summary');
  const container = getById('settings-admin-users');
  if (!summary || !container) {
    return;
  }

  adminUsersPayload = payload || adminUsersPayload;

  const stats = payload?.summary || {};
  const usersList = Array.isArray(payload?.users) ? payload.users : [];
  const searchQuery =
    getById('settings-admin-search-input')?.value?.trim() || '';
  const filteredUsers = filterAdminUsers(usersList, searchQuery);

  summary.innerHTML = `
    <div class="flex flex-wrap gap-3 text-sm font-medium text-slate-700">
      <span class="rounded-full bg-white px-3 py-2">Total ${stats.totalUsers || 0}</span>
      <span class="rounded-full bg-amber-100 px-3 py-2 text-amber-800">Pending ${stats.pendingUsers || 0}</span>
      <span class="rounded-full bg-emerald-100 px-3 py-2 text-emerald-800">Active ${stats.activeUsers || 0}</span>
      <span class="rounded-full bg-rose-100 px-3 py-2 text-rose-800">Banned ${stats.bannedUsers || 0}</span>
      <span class="rounded-full bg-slate-900 px-3 py-2 text-white">Admins ${stats.adminUsers || 0}</span>
      <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">Showing ${filteredUsers.length} of ${usersList.length}</span>
    </div>
  `;

  if (!usersList.length) {
    setAdminUsersState('No users found yet.');
    return;
  }

  if (!filteredUsers.length) {
    setAdminUsersState(`No users match "${searchQuery}".`);
    return;
  }

  container.innerHTML = filteredUsers
    .map((user) => {
      const statusTone =
        user.status === 'banned'
          ? 'bg-rose-100 text-rose-700'
          : user.status === 'pending'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-emerald-100 text-emerald-700';
      const isAdmin = user.role === 'ADMIN';
      const isCurrentAdmin = user.id === currentUser?.id;
      const isProtectedBootstrapAdmin = Boolean(user.isProtectedBootstrapAdmin);
      const actionButtons = [
        !isAdmin && !user.isApproved
          ? `
              <button
                type="button"
                data-admin-action="approve"
                data-user-id="${user.id}"
                class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
              >
                Approve
              </button>
            `
          : '',
        !isAdmin
          ? user.isBanned
            ? `
                <button
                  type="button"
                  data-admin-action="unban"
                  data-user-id="${user.id}"
                  class="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50"
                >
                  Unban
                </button>
              `
            : `
                <button
                  type="button"
                  data-admin-action="ban"
                  data-user-id="${user.id}"
                  class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
                >
                  Ban
                </button>
              `
          : '',
        isAdmin && !isCurrentAdmin && !isProtectedBootstrapAdmin
          ? `
              <button
                type="button"
                data-admin-action="remove-admin"
                data-user-id="${user.id}"
                class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
              >
                Remove Admin
              </button>
            `
          : '',
        !isCurrentAdmin && !isProtectedBootstrapAdmin
          ? `
              <button
                type="button"
                data-admin-action="delete-user"
                data-user-id="${user.id}"
                class="rounded-xl border border-slate-300 bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
              >
                Delete Account
              </button>
            `
          : '',
      ]
        .filter(Boolean)
        .join('');

      const adminNote = isProtectedBootstrapAdmin
        ? 'This is the configured bootstrap admin. Update the bootstrap admin env vars before removing or deleting this account.'
        : isCurrentAdmin
          ? 'Use another admin account to change this admin role or permanently delete this account.'
          : isAdmin
            ? 'Admins cannot be banned. You can remove admin access or permanently delete this account.'
            : '';

      return `
        <div class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate text-base font-bold text-slate-900">${escapeHtml(user.name || user.email || 'User')}</p>
                <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}">${escapeHtml(user.status)}</span>
                <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">${escapeHtml(user.role)}</span>
                ${isCurrentAdmin ? '<span class="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">You</span>' : ''}
                ${isProtectedBootstrapAdmin ? '<span class="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">Bootstrap Admin</span>' : ''}
              </div>
              <p class="truncate text-sm text-slate-500">${escapeHtml(user.email || '')}</p>
              <p class="truncate text-xs text-slate-400">User ID: ${escapeHtml(user.id || '')}</p>
              <div class="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <p>Created: ${formatAdminUserDateTime(user.createdAt)}</p>
                <p>Approved: ${formatAdminUserDateTime(user.approvedAt)}</p>
                <p>Banned: ${formatAdminUserDateTime(user.bannedAt)}</p>
                <p>Email verified: ${user.emailVerified ? 'Yes' : 'No'}</p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              ${actionButtons}
            </div>
          </div>
          ${adminNote ? `<p class="mt-3 text-xs text-slate-500">${escapeHtml(adminNote)}</p>` : ''}
        </div>
      `;
    })
    .join('');
}

function getBlockedUserIdSet() {
  return new Set(
    (Array.isArray(blockedUsers) ? blockedUsers : [])
      .map((user) => user?.id)
      .filter(Boolean),
  );
}

function isBlockedDirectUser(user, blockedIds = getBlockedUserIdSet()) {
  return Boolean(user && !isGroupConversation(user) && blockedIds.has(user.id));
}

function filterBlockedDirectUsers(
  collection,
  blockedIds = getBlockedUserIdSet(),
) {
  if (!Array.isArray(collection) || !collection.length || !blockedIds.size) {
    return Array.isArray(collection) ? collection : [];
  }

  return collection.filter((user) => !isBlockedDirectUser(user, blockedIds));
}

function applyBlockedUserFilters(options = {}) {
  const { resetSelectedIfBlocked = true } = options;
  const blockedIds = getBlockedUserIdSet();
  if (!blockedIds.size) {
    return false;
  }

  const nextUsers = filterBlockedDirectUsers(users, blockedIds);
  const nextDirectory = filterBlockedDirectUsers(peopleDirectory, blockedIds);
  const nextSearchResults = filterBlockedDirectUsers(
    userSearchResults,
    blockedIds,
  );
  const usersChanged = nextUsers.length !== users.length;
  const directoryChanged = nextDirectory.length !== peopleDirectory.length;
  const searchChanged = nextSearchResults.length !== userSearchResults.length;

  users = nextUsers;
  peopleDirectory = nextDirectory;
  userSearchResults = nextSearchResults;

  let selectionReset = false;
  if (resetSelectedIfBlocked && isBlockedDirectUser(selectedUser, blockedIds)) {
    resetSelectedConversation();
    selectionReset = true;
  }

  if (usersChanged) {
    updateChatCount();
    renderUsers();
    schedulePersistChatShellCache();
  }

  return usersChanged || directoryChanged || searchChanged || selectionReset;
}

async function loadBlockedUsers() {
  const res = await api('/users/blocks');
  const data = await readJsonResponse(res, [], 'Failed to load blocked users.');
  if (!res.ok) {
    throw new Error(data.message || 'Failed to load blocked users');
  }
  blockedUsers = Array.isArray(data) ? data : [];
  applyBlockedUserFilters();
  renderBlockedUsers();
}

async function unblockUserFromSettings(userId) {
  const user = blockedUsers.find((entry) => entry.id === userId);
  const confirmed = window.confirm(
    `Unblock ${displayName(user || { id: userId, name: 'this user' })}? They will still need a new chat request before messaging again.`,
  );
  if (!confirmed) {
    return;
  }

  const res = await api('/users/blocks/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to unblock user.');
  if (!res.ok) {
    alert(data.message || 'Failed to unblock user');
    return;
  }

  blockedUsers = blockedUsers.filter((entry) => entry.id !== userId);
  renderBlockedUsers();
  await Promise.all([loadUsers(), loadPeopleDirectory(true)]);
  scheduleRenderUsers();
  if (selectedUser?.id === userId && !isGroupConversation(selectedUser)) {
    await loadChatPermission();
    updateSelectedUserHeader();
  }
  alert(data.message || 'User unblocked.');
}

async function loadAdminUsers() {
  if (currentUser?.role !== 'ADMIN') {
    return;
  }

  const refreshButton = getById('settings-admin-refresh-btn');
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Loading...';
    refreshButton.classList.add('opacity-70', 'cursor-wait');
  }

  try {
    const res = await api('/users/admin/users');
    const data = await readJsonResponse(
      res,
      { summary: {}, users: [] },
      'Failed to load admin users.',
    );

    if (!res.ok) {
      throw new Error(data.message || 'Failed to load admin users');
    }

    adminUsersPayload = data;
    renderAdminUsers();
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh Users';
      refreshButton.classList.remove('opacity-70', 'cursor-wait');
    }
  }
}

async function approveAdminUser(userId) {
  const res = await api(
    `/users/admin/users/${encodeURIComponent(userId)}/approve`,
    {
      method: 'POST',
    },
  );
  const data = await readJsonResponse(res, {}, 'Failed to approve the user.');

  if (!res.ok) {
    throw new Error(data.message || 'Failed to approve the user');
  }

  await loadAdminUsers();
  alert(data.message || 'User approved.');
}

async function banAdminUser(userId) {
  const confirmed = window.confirm(
    'Ban this user from O-chat? They will lose access immediately.',
  );
  if (!confirmed) {
    return;
  }

  const res = await api(
    `/users/admin/users/${encodeURIComponent(userId)}/ban`,
    {
      method: 'POST',
    },
  );
  const data = await readJsonResponse(res, {}, 'Failed to ban the user.');

  if (!res.ok) {
    throw new Error(data.message || 'Failed to ban the user');
  }

  await loadAdminUsers();
  alert(data.message || 'User banned.');
}

async function unbanAdminUser(userId) {
  const confirmed = window.confirm(
    'Unban this user and restore website access?',
  );
  if (!confirmed) {
    return;
  }

  const res = await api(
    `/users/admin/users/${encodeURIComponent(userId)}/unban`,
    {
      method: 'POST',
    },
  );
  const data = await readJsonResponse(res, {}, 'Failed to unban the user.');

  if (!res.ok) {
    throw new Error(data.message || 'Failed to unban the user');
  }

  await loadAdminUsers();
  alert(data.message || 'User unbanned.');
}

async function removeAdminRoleFromUser(userId) {
  const confirmed = window.confirm('Remove admin access from this account?');
  if (!confirmed) {
    return;
  }

  const res = await api(
    `/users/admin/users/${encodeURIComponent(userId)}/remove-admin`,
    {
      method: 'POST',
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to remove the admin role.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to remove the admin role');
  }

  await loadAdminUsers();
  alert(data.message || 'Admin role removed.');
}

async function deleteAdminUserPermanently(userId) {
  const confirmed = window.confirm(
    'Delete this account permanently? This removes the user and related stored data and cannot be undone.',
  );
  if (!confirmed) {
    return;
  }

  const res = await api(
    `/users/admin/users/${encodeURIComponent(userId)}/delete`,
    {
      method: 'POST',
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to permanently delete the account.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to permanently delete the account');
  }

  await loadAdminUsers();
  alert(data.message || 'Account deleted permanently.');
}

function assetUrl(path) {
  if (!path) return '';
  if (
    String(path).startsWith('http://') ||
    String(path).startsWith('https://')
  ) {
    return path;
  }
  return `${API_URL}${path}`;
}

function applyDefaultChatTheme(container, isDarkMode) {
  if (!container) {
    return;
  }

  container.style.setProperty('--chat-theme-background', 'none');
  container.style.setProperty(
    '--chat-theme-base-color',
    isDarkMode ? '#020617' : '#f8fafc',
  );
}

function applyResolvedChatTheme(container, themeUrl, isDarkMode) {
  if (!container || !themeUrl) {
    return;
  }

  const overlay = isDarkMode
    ? `linear-gradient(rgba(2,6,23,0.18), rgba(15,23,42,0.34)), url("${themeUrl}")`
    : `linear-gradient(rgba(248,250,252,0.18), rgba(241,245,249,0.34)), url("${themeUrl}")`;

  container.style.setProperty(
    '--chat-theme-base-color',
    isDarkMode ? '#0f172a' : '#e2e8f0',
  );
  container.style.setProperty('--chat-theme-background', overlay);
}

function applyChatTheme() {
  const container = document.getElementById('message-container');
  if (!container) {
    return;
  }
  const clearButtons = [
    document.getElementById('chat-theme-clear-btn'),
    document.getElementById('contact-theme-clear-btn'),
  ].filter(Boolean);
  const themeState = document.getElementById('chat-contact-panel-theme-state');
  const themeUrl = selectedUser?.chatTheme
    ? assetUrl(selectedUser.chatTheme)
    : '';
  const isDarkMode = document.body.classList.contains('dark-mode');

  clearButtons.forEach((button) => {
    button.classList.toggle('hidden', !themeUrl);
  });

  if (themeState) {
    if (!selectedUser) {
      themeState.innerText = '';
    } else if (isGroupConversation(selectedUser)) {
      themeState.innerText =
        'Group conversation controls and member options live here.';
    } else if (themeUrl) {
      themeState.innerText =
        'Custom chat background active for this conversation.';
    } else {
      themeState.innerText =
        'Default chat background active for this conversation.';
    }
  }

  if (!themeUrl) {
    applyDefaultChatTheme(container, isDarkMode);
    return;
  }

  const validationToken = ++activeThemeValidationToken;
  void validateThemeUrl(themeUrl).then((isValid) => {
    if (validationToken !== activeThemeValidationToken) {
      return;
    }

    if (!isValid) {
      applyDefaultChatTheme(container, isDarkMode);
      if (themeState) {
        themeState.innerText =
          'The saved chat background could not be loaded, so the default background is active.';
      }
      return;
    }

    applyResolvedChatTheme(container, themeUrl, isDarkMode);
  });
}

function updateSidebarCurrentUser() {
  const avatar = document.getElementById('sidebar-current-user-avatar');
  const name = document.getElementById('sidebar-current-user-name');
  const email = document.getElementById('sidebar-current-user-email');
  const railAvatar = document.getElementById('desktop-rail-avatar');

  if (!avatar || !name || !email) {
    return;
  }

  if (!currentUser) {
    avatar.src = DEFAULT_AVATAR_URL;
    avatar.alt = 'Your profile photo';
    attachImageFallback(avatar);
    name.innerText = 'Your profile';
    email.innerText = 'Open Settings to manage your account.';
    if (railAvatar) {
      railAvatar.src = DEFAULT_AVATAR_URL;
      railAvatar.alt = 'Your profile photo';
      attachImageFallback(railAvatar);
    }
    return;
  }

  avatar.src = userAvatar(currentUser);
  avatar.alt = `${baseName(currentUser)} profile photo`;
  attachImageFallback(avatar);
  name.innerText = currentUser.name || displayName(currentUser);
  email.innerText =
    currentUser.email || 'Open Settings to manage your account.';
  if (railAvatar) {
    railAvatar.src = userAvatar(currentUser);
    railAvatar.alt = `${baseName(currentUser)} profile photo`;
    attachImageFallback(railAvatar);
  }
}

function applyCurrentUser(user) {
  currentUser =
    currentUser?.id && currentUser.id === user?.id
      ? { ...currentUser, ...user }
      : user;
  updateSidebarCurrentUser();
  updateSettingsUI();
  applyDarkMode(Boolean(currentUser.darkMode));
}

function setSidebarVisibility(open) {
  sidebarOpen = open;
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  const isDesktop = window.innerWidth >= 1024;
  const shouldOpen = isDesktop || open;

  sidebar.classList.toggle('sidebar-open', shouldOpen);
  sidebar.classList.toggle('sidebar-closed', !shouldOpen);
  overlay.classList.toggle('hidden', !open || isDesktop);
}

function openSidebar() {
  setSidebarVisibility(true);
}

function showUsersList() {
  if (window.innerWidth < 1024) {
    resetSelectedConversation();
  }
  setSidebarVisibility(true);
}

function closeSidebar() {
  if (window.innerWidth >= 1024) {
    setSidebarVisibility(false);
    return;
  }
  setSidebarVisibility(false);
}

function syncLayout() {
  setSidebarVisibility(window.innerWidth >= 1024 ? true : sidebarOpen);
}

function userAvatar(user) {
  if (user?.avatar) {
    if (
      String(user.avatar).startsWith('http://') ||
      String(user.avatar).startsWith('https://')
    ) {
      return user.avatar;
    }
    return getFileUrl(user.avatar);
  }
  if (
    appConfig.avatarBaseUrl &&
    !String(appConfig.avatarBaseUrl).includes('ui-avatars.com')
  ) {
    return appConfig.avatarBaseUrl;
  }
  return DEFAULT_AVATAR_URL;
}

function openImagePreview(src) {
  if (!src) return;
  document.getElementById('image-preview-src').src = src;
  document.getElementById('image-preview-modal').classList.remove('hidden');
  document.getElementById('image-preview-modal').classList.add('flex');
}

function closeImagePreview() {
  document.getElementById('image-preview-modal').classList.add('hidden');
  document.getElementById('image-preview-modal').classList.remove('flex');
  document.getElementById('image-preview-src').src = '';
}

function openMyAvatarPicker(inputId = 'desktop-avatar-input') {
  const input =
    document.getElementById(inputId) || document.getElementById('avatar-input');
  if (!input) {
    return;
  }

  input.value = '';
  input.click();
}

function toggleComposerActionsMenu() {
  const menu = document.getElementById('composer-actions-menu');
  const button = document.getElementById('composer-actions-btn');
  if (!menu) {
    return;
  }

  menu.classList.toggle('hidden');
  button?.setAttribute(
    'aria-expanded',
    String(!menu.classList.contains('hidden')),
  );
  closeChatActionsMenu();
}

function closeComposerActionsMenu() {
  document.getElementById('composer-actions-menu').classList.add('hidden');
  document
    .getElementById('composer-actions-btn')
    ?.setAttribute('aria-expanded', 'false');
}

function isChatActionsMenuOpen() {
  const menu = document.getElementById('chat-actions-menu');
  return Boolean(menu && !menu.classList.contains('hidden'));
}

function toggleChatActionsMenu(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (isChatActionsMenuOpen()) {
    closeChatActionsMenu();
    return;
  }

  openChatActionsMenu();
}

function openChatActionsMenu() {
  const menu = document.getElementById('chat-actions-menu');
  const backdrop = document.getElementById('chat-actions-backdrop');
  const button = document.getElementById('chat-actions-btn');
  if (!menu || !backdrop || !button) {
    return;
  }

  closeComposerActionsMenu();
  menu.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  button.setAttribute('aria-expanded', 'true');
  window.requestAnimationFrame(() => {
    updateChatActionsMenuPosition();
  });
}

function closeChatActionsMenu() {
  const menu = document.getElementById('chat-actions-menu');
  const backdrop = document.getElementById('chat-actions-backdrop');
  const button = document.getElementById('chat-actions-btn');
  if (!menu) {
    return;
  }
  menu.classList.add('hidden');
  backdrop?.classList.add('hidden');
  button?.setAttribute('aria-expanded', 'false');
  menu.style.position = '';
  menu.style.left = '';
  menu.style.top = '';
  menu.style.right = '';
  menu.style.bottom = '';
  menu.style.width = '';
  menu.style.maxHeight = '';
}

function isChatContactPanelOpen() {
  const panel = document.getElementById('chat-contact-panel');
  return Boolean(panel && !panel.classList.contains('hidden'));
}

function openChatContactPanel() {
  if (!selectedUser) {
    return;
  }

  closeChatActionsMenu();
  closeComposerActionsMenu();
  updateChatContactPanel();

  const panel = document.getElementById('chat-contact-panel');
  if (!panel) {
    return;
  }

  panel.classList.remove('hidden');
  panel.classList.add('flex');
  document.body.classList.add('chat-contact-panel-open');
  void loadSharedMediaForSelectedConversation();
}

function closeChatContactPanel(event) {
  if (event && event.target !== event.currentTarget) {
    return;
  }

  const panel = document.getElementById('chat-contact-panel');
  if (!panel) {
    return;
  }

  panel.classList.add('hidden');
  panel.classList.remove('flex');
  document.body.classList.remove('chat-contact-panel-open');
}

function getSharedMediaItemsByKind(kind = sharedMediaBrowserKind) {
  const normalizedKind = kind === 'video' ? 'video' : 'image';
  return sharedMediaItems.filter((item) => item?.kind === normalizedKind);
}

function getSharedMediaKindLabel(kind, count = 1) {
  const normalizedKind = kind === 'video' ? 'video' : 'image';
  if (normalizedKind === 'video') {
    return count === 1 ? 'video' : 'videos';
  }

  return count === 1 ? 'photo' : 'photos';
}

function getSharedMediaItemById(itemId) {
  return sharedMediaItems.find((item) => item?.id === itemId) || null;
}

function openSharedMediaItem(itemId) {
  const item = getSharedMediaItemById(itemId);
  if (!item?.fileUrl) {
    return;
  }

  const fileUrl = getFileUrl(item.fileUrl);
  if (item.kind === 'video') {
    window.open(fileUrl, '_blank', 'noopener');
    return;
  }

  openImagePreview(fileUrl);
}

function downloadSharedMediaItem(itemId) {
  const item = getSharedMediaItemById(itemId);
  if (!item?.fileUrl) {
    return;
  }

  void downloadFile(
    getFileUrl(item.fileUrl),
    item.fileName || `${item.kind || 'media'}-${item.id}`,
  ).catch((error) => {
    alert(error?.message || 'Failed to download file');
  });
}

function renderSharedMediaGroupCard(kind, items, options = {}) {
  const { loading = false } = options;
  const latestItem = items[0] || null;
  const total = items.length;
  const normalizedKind = kind === 'video' ? 'video' : 'image';
  const isPhoto = normalizedKind === 'image';
  const isDisabled = !loading && total === 0;
  const summary = loading
    ? `Loading ${getSharedMediaKindLabel(normalizedKind, 2)}...`
    : total > 0
      ? `${total} shared ${getSharedMediaKindLabel(normalizedKind, total)}`
      : `No shared ${getSharedMediaKindLabel(normalizedKind, 2)} yet`;
  const latestLabel = latestItem
    ? latestItem.fileName || `Shared ${getSharedMediaKindLabel(normalizedKind)}`
    : isPhoto
      ? 'Photos will appear here'
      : 'Videos will appear here';
  const latestMeta = latestItem?.createdAt
    ? formatShortDate(latestItem.createdAt)
    : loading
      ? 'Syncing...'
      : 'Nothing shared yet';
  const preview = loading
    ? `<div class="h-28 animate-pulse rounded-[22px] bg-slate-100"></div>`
    : isPhoto && latestItem?.fileUrl
      ? `<img src="${escapeHtml(getFileUrl(latestItem.fileUrl))}" alt="${latestLabel}" loading="lazy" decoding="async" class="h-28 w-full rounded-[22px] border border-slate-200 object-cover">`
      : `<div class="flex h-28 items-center justify-center rounded-[22px] border border-slate-200 ${isPhoto ? 'bg-slate-100 text-slate-500' : 'bg-slate-950 text-white'}">
          <div class="text-center">
            <p class="text-xs font-semibold uppercase tracking-[0.22em]">${isPhoto ? 'Photos' : 'Videos'}</p>
            <p class="mt-2 text-sm font-medium ${isPhoto ? 'text-slate-500' : 'text-white/80'}">${escapeHtml(latestMeta)}</p>
          </div>
        </div>`;
  const body = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-sm font-semibold text-slate-900">${isPhoto ? 'Photos' : 'Videos'}</p>
        <p class="mt-1 text-sm text-slate-500">${escapeHtml(summary)}</p>
      </div>
      <span class="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        ${loading ? 'Syncing' : total > 0 ? 'Open' : 'Empty'}
      </span>
    </div>
    <div class="mt-3">${preview}</div>
    <div class="mt-3">
      <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(latestLabel)}</p>
      <p class="mt-1 text-xs text-slate-500">${escapeHtml(latestMeta)}</p>
    </div>
  `;

  if (isDisabled) {
    return `
      <div class="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 opacity-75">
        ${body}
      </div>
    `;
  }

  return `
    <button
      type="button"
      onclick="openSharedMediaBrowser('${normalizedKind}')"
      class="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-blue-200 hover:bg-white hover:shadow-sm"
    >
      ${body}
    </button>
  `;
}

function renderSharedMedia() {
  const grid = document.getElementById('chat-contact-panel-media-groups');
  const count = document.getElementById('chat-contact-panel-media-count');
  if (!grid || !count) {
    return;
  }

  if (!selectedUser) {
    count.textContent = 'No chat selected.';
    grid.innerHTML = '';
    renderSharedMediaBrowser();
    return;
  }

  if (sharedMediaLoading) {
    count.textContent = 'Loading shared media...';
    grid.innerHTML = [
      renderSharedMediaGroupCard('image', [], { loading: true }),
      renderSharedMediaGroupCard('video', [], { loading: true }),
    ].join('');
    renderSharedMediaBrowser();
    return;
  }

  if (sharedMediaErrorMessage) {
    count.textContent = sharedMediaErrorMessage;
  } else if (!sharedMediaItems.length) {
    count.textContent = 'No shared photos or videos yet.';
  } else {
    count.textContent = `${sharedMediaItems.length} shared item${sharedMediaItems.length === 1 ? '' : 's'
      }`;
  }

  grid.innerHTML = [
    renderSharedMediaGroupCard('image', getSharedMediaItemsByKind('image')),
    renderSharedMediaGroupCard('video', getSharedMediaItemsByKind('video')),
  ].join('');
  renderSharedMediaBrowser();
}

function renderSharedMediaBrowser() {
  const title = document.getElementById('shared-media-browser-title');
  const count = document.getElementById('shared-media-browser-count');
  const empty = document.getElementById('shared-media-browser-empty');
  const grid = document.getElementById('shared-media-browser-grid');
  const photosTab = document.getElementById('shared-media-browser-photos-tab');
  const videosTab = document.getElementById('shared-media-browser-videos-tab');
  if (!title || !count || !empty || !grid || !photosTab || !videosTab) {
    return;
  }

  const isPhotoView = sharedMediaBrowserKind !== 'video';
  const items = getSharedMediaItemsByKind(sharedMediaBrowserKind);
  const label = isPhotoView ? 'photos' : 'videos';
  const tabBaseClass =
    'rounded-2xl border px-4 py-3 text-sm font-semibold transition';

  title.textContent = isPhotoView ? 'Shared photos' : 'Shared videos';
  if (!selectedUser) {
    count.textContent = 'No chat selected.';
  } else if (sharedMediaLoading) {
    count.textContent = `Loading ${label}...`;
  } else if (sharedMediaErrorMessage) {
    count.textContent = sharedMediaErrorMessage;
  } else {
    count.textContent = `${items.length} ${getSharedMediaKindLabel(sharedMediaBrowserKind, items.length)} in ${displayName(selectedUser)}`;
  }

  photosTab.className = `${tabBaseClass} ${isPhotoView
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;
  videosTab.className = `${tabBaseClass} ${!isPhotoView
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;

  if (sharedMediaLoading) {
    empty.classList.add('hidden');
    grid.innerHTML = Array.from({ length: 4 })
      .map(
        () => `
          <div class="overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3">
            <div class="h-40 animate-pulse rounded-[20px] bg-slate-100"></div>
            <div class="mt-3 h-4 animate-pulse rounded bg-slate-100"></div>
            <div class="mt-2 h-3 w-24 animate-pulse rounded bg-slate-100"></div>
          </div>
        `,
      )
      .join('');
    return;
  }

  if (!selectedUser || !items.length) {
    empty.classList.remove('hidden');
    empty.textContent = !selectedUser
      ? 'Pick a chat to browse shared media.'
      : `No shared ${label} yet.`;
    grid.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = items
    .map((item) => {
      const itemId = escapeHtml(item.id);
      const fileUrl = escapeHtml(getFileUrl(item.fileUrl));
      const label = escapeHtml(
        item.fileName || `Shared ${getSharedMediaKindLabel(item.kind)}`,
      );
      const dateLabel = escapeHtml(
        formatShortDate(item.createdAt) ||
        formatRelativeTime(item.createdAt) ||
        '',
      );

      if (item.kind === 'video') {
        return `
          <div class="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <button type="button" onclick="openSharedMediaItem('${itemId}')" class="block w-full overflow-hidden bg-slate-950 text-left">
              <div class="relative h-40 bg-slate-950">
                <video src="${fileUrl}" preload="metadata" muted playsinline class="h-full w-full object-cover"></video>
                <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/10 to-transparent"></div>
                <div class="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-900">
                  Video
                </div>
              </div>
            </button>
            <div class="space-y-3 px-4 py-3">
              <div class="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>Shared video</span>
                <span>${dateLabel}</span>
              </div>
              <p class="truncate text-sm font-semibold text-slate-800">${label}</p>
              <div class="flex gap-2">
                <button type="button" onclick="openSharedMediaItem('${itemId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                  Open
                </button>
                <button type="button" onclick="downloadSharedMediaItem('${itemId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                  Download
                </button>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <button type="button" onclick="openSharedMediaItem('${itemId}')" class="block w-full overflow-hidden bg-slate-100 text-left">
            <img src="${fileUrl}" alt="${label}" loading="lazy" decoding="async" class="h-40 w-full object-cover">
          </button>
          <div class="space-y-3 px-4 py-3">
            <div class="flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>Shared photo</span>
              <span>${dateLabel}</span>
            </div>
            <p class="truncate text-sm font-semibold text-slate-800">${label}</p>
            <div class="flex gap-2">
              <button type="button" onclick="openSharedMediaItem('${itemId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                Open
              </button>
              <button type="button" onclick="downloadSharedMediaItem('${itemId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                Download
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function openSharedMediaBrowser(kind = 'image') {
  if (!selectedUser) {
    return;
  }

  sharedMediaBrowserKind = kind === 'video' ? 'video' : 'image';
  renderSharedMediaBrowser();

  const modal = document.getElementById('shared-media-browser-modal');
  if (!modal) {
    return;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeSharedMediaBrowser(event) {
  if (event && event.target !== event.currentTarget) {
    return;
  }

  const modal = document.getElementById('shared-media-browser-modal');
  if (!modal) {
    return;
  }

  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function togglePinnedConversation() {
  if (!selectedUser) {
    return;
  }

  const key = getConversationCacheKey(selectedUser);
  if (!key) {
    return;
  }

  if (pinnedConversationKeys.has(key)) {
    pinnedConversationKeys.delete(key);
  } else {
    pinnedConversationKeys.add(key);
  }

  persistPinnedConversations();
  updateChatContactPanel();
  renderUsers();
}

function toggleMutedConversation() {
  if (!selectedUser) {
    return;
  }

  const key = getConversationCacheKey(selectedUser);
  if (!key) {
    return;
  }

  if (mutedConversationKeys.has(key)) {
    mutedConversationKeys.delete(key);
  } else {
    mutedConversationKeys.add(key);
  }

  persistMutedConversations();
  updateChatContactPanel();
  renderUsers();
}

function toggleArchivedConversation() {
  if (!selectedUser) {
    return;
  }

  const key = getConversationCacheKey(selectedUser);
  if (!key) {
    return;
  }

  if (archivedConversationKeys.has(key)) {
    archivedConversationKeys.delete(key);
  } else {
    archivedConversationKeys.add(key);
  }

  persistArchivedConversations();
  updateChatContactPanel();
  renderUsers();
}

function toggleSelectedMessageStar() {
  if (!messageActionTarget?.id) {
    return;
  }

  const messageId = messageActionTarget.id;
  triggerMotionClass(
    getMessageBubbleElement(messageId),
    'message-bubble-processing',
    300,
  );
  if (isMessageStarred(messageId)) {
    starredMessagesById.delete(messageId);
  } else {
    starredMessagesById.set(
      messageId,
      buildStarredMessageEntry(messageActionTarget),
    );
  }

  persistStarredMessages();
  if (conversationMessages.has(messageId)) {
    replaceRenderedMessage(
      conversationMessages.get(messageId) || messageActionTarget,
    );
  }
  renderStarredMessages();
  renderSidebarStarredHub();
  closeMessageActions();
  pulseMessageBubble(messageId);
}

async function loadSharedMediaForSelectedConversation() {
  const count = document.getElementById('chat-contact-panel-media-count');
  const grid = document.getElementById('chat-contact-panel-media-groups');
  if (!count || !grid) {
    return;
  }

  if (!selectedUser) {
    sharedMediaItems = [];
    sharedMediaLoading = false;
    sharedMediaErrorMessage = '';
    renderSharedMedia();
    return;
  }

  const requestedConversation = selectedUser;
  const requestedConversationKey = getConversationCacheKey(
    requestedConversation,
  );
  sharedMediaItems = [];
  sharedMediaLoading = true;
  sharedMediaErrorMessage = '';
  renderSharedMedia();

  try {
    const query = isGroupConversation(requestedConversation)
      ? `groupId=${encodeURIComponent(requestedConversation.id)}`
      : `userId=${encodeURIComponent(requestedConversation.id)}`;
    const res = await api(`/chat/media?${query}`);
    const data = await readJsonResponse(
      res,
      [],
      'Failed to load shared media.',
    );

    if (!res.ok) {
      throw new Error(data.message || 'Failed to load shared media');
    }

    if (requestedConversationKey !== getConversationCacheKey(selectedUser)) {
      return;
    }

    sharedMediaItems = Array.isArray(data) ? data : [];
  } catch (error) {
    if (requestedConversationKey !== getConversationCacheKey(selectedUser)) {
      return;
    }

    console.error(error);
    sharedMediaItems = [];
    sharedMediaErrorMessage =
      error?.message || 'Failed to load shared media right now.';
  } finally {
    if (requestedConversationKey !== getConversationCacheKey(selectedUser)) {
      return;
    }

    sharedMediaLoading = false;
    renderSharedMedia();
  }
}

async function clearSelectedConversation() {
  if (!selectedUser) {
    return;
  }

  const confirmed = window.confirm(
    `Clear this chat on this device for ${displayName(selectedUser)}?`,
  );
  if (!confirmed) {
    return;
  }

  const body = isGroupConversation(selectedUser)
    ? { groupId: selectedUser.id }
    : { otherUserId: selectedUser.id };
  const res = await api('/chat/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await readJsonResponse(res, {}, 'Failed to clear chat.');

  if (!res.ok) {
    alert(data.message || 'Failed to clear chat');
    return;
  }

  replaceConversationHistoryState(selectedUser, { initialized: true });
  document.getElementById('messages-list').innerHTML = '';
  recentActivity.set(selectedUser.id, {
    ...(recentActivity.get(selectedUser.id) || {}),
    preview: '',
    unread: 0,
  });
  sharedMediaItems = [];
  renderSharedMedia();
  renderUsers();
  alert(data.message || 'Chat cleared.');
}

function getSelectedUserStatusMeta(user = selectedUser) {
  if (!user) {
    return {
      text: 'Offline',
      className: 'text-sm font-medium text-slate-500',
    };
  }

  const activeTypingUsers = currentTypingUsers();
  const isOnline = !isGroupConversation(user) && onlineUserIds.has(user.id);
  const lastActivity = recentActivity.get(user.id)?.lastAt || 0;
  const lastActivityText = lastActivity
    ? `Active ${formatRelativeTime(lastActivity)}`
    : 'Offline';

  return {
    text: activeTypingUsers.length
      ? formatTypingStatus(activeTypingUsers)
      : isGroupConversation(user)
        ? `${user.memberCount || user.members?.length || 0} members${user.role ? ` · ${String(user.role).toLowerCase()}` : ''}`
        : isOnline
          ? 'Online now'
          : lastActivityText,
    className: `text-sm font-medium ${activeTypingUsers.length
      ? 'text-blue-500'
      : isOnline
        ? 'text-emerald-500'
        : 'text-slate-500'
      }`,
  };
}

function updateChatContactPanel() {
  const panelTitle = document.getElementById('chat-contact-panel-title');
  const avatar = document.getElementById('chat-contact-panel-avatar');
  const name = document.getElementById('chat-contact-panel-name');
  const status = document.getElementById('chat-contact-panel-status');
  const pinBtn = document.getElementById('contact-pin-btn');
  const pinLabel = document.getElementById('contact-pin-btn-label');
  const pinCopy = document.getElementById('contact-pin-btn-copy');
  const muteBtn = document.getElementById('contact-mute-btn');
  const muteLabel = document.getElementById('contact-mute-btn-label');
  const muteCopy = document.getElementById('contact-mute-btn-copy');
  const archiveBtn = document.getElementById('contact-archive-btn');
  const archiveLabel = document.getElementById('contact-archive-btn-label');
  const archiveCopy = document.getElementById('contact-archive-btn-copy');
  const themeBtn = document.getElementById('contact-theme-btn');
  const clearThemeBtn = document.getElementById('contact-theme-clear-btn');
  const renameBtn = document.getElementById('contact-rename-btn');
  const blockBtn = document.getElementById('contact-block-btn');
  const reportBtn = document.getElementById('contact-report-btn');
  const manageGroupBtn = document.getElementById('contact-manage-group-btn');

  if (!panelTitle || !avatar || !name || !status) {
    return;
  }

  if (!selectedUser) {
    panelTitle.innerText = 'Contact info';
    name.innerText = 'Contact';
    status.innerText = 'Offline';
    status.className = 'mt-1 text-sm font-medium text-slate-500';
    reportBtn?.classList.add('hidden');
    syncReportModalContent();
    sharedMediaItems = [];
    sharedMediaLoading = false;
    sharedMediaErrorMessage = '';
    closeSharedMediaBrowser();
    renderSharedMedia();
    renderStarredMessages();
    renderConversationSearchResults([]);
    renderConversationCallHistory();
    return;
  }

  const isGroup = isGroupConversation(selectedUser);
  const statusMeta = getSelectedUserStatusMeta(selectedUser);
  const pinned = isConversationPinned(selectedUser);
  const muted = isConversationMuted(selectedUser);
  const archived = isConversationArchived(selectedUser);

  panelTitle.innerText = isGroup ? 'Group info' : 'Contact info';
  avatar.src = userAvatar(selectedUser);
  avatar.alt = `${displayName(selectedUser)} profile photo`;
  attachImageFallback(avatar);
  name.innerText = displayName(selectedUser);
  status.innerText = statusMeta.text;
  status.className = `mt-1 ${statusMeta.className}`;
  if (pinBtn && pinLabel && pinCopy) {
    pinLabel.innerText = pinned ? 'Unpin chat' : 'Pin chat';
    pinCopy.innerText = pinned
      ? 'Move this conversation back into the normal chat order.'
      : 'Keep this conversation at the top of your chat list.';
  }
  if (muteBtn && muteLabel && muteCopy) {
    muteLabel.innerText = muted ? 'Unmute notifications' : 'Mute notifications';
    muteCopy.innerText = muted
      ? 'Allow foreground notifications for this conversation again.'
      : 'Silence foreground notifications for this conversation on this device.';
  }
  if (archiveBtn && archiveLabel && archiveCopy) {
    archiveLabel.innerText = archived ? 'Unarchive chat' : 'Archive chat';
    archiveCopy.innerText = archived
      ? 'Bring this conversation back into your active chat list.'
      : 'Hide this conversation from the active list without deleting it.';
  }
  themeBtn?.classList.toggle('hidden', isGroup);
  clearThemeBtn?.classList.toggle('hidden', isGroup || !selectedUser.chatTheme);
  renameBtn?.classList.toggle('hidden', isGroup);
  blockBtn?.classList.toggle('hidden', isGroup);
  reportBtn?.classList.remove('hidden');
  manageGroupBtn?.classList.toggle('hidden', !isGroup);
  syncReportModalContent(getActiveReportTarget(selectedUser));
  renderSharedMedia();
  renderStarredMessages();
  if (isChatContactPanelOpen()) {
    renderConversationSearchResults();
    renderConversationCallHistory();
  }
}

function bindChatActionsMenu() {
  const button = document.getElementById('chat-actions-btn');
  const menu = document.getElementById('chat-actions-menu');
  const backdrop = document.getElementById('chat-actions-backdrop');
  if (
    !button ||
    !menu ||
    !backdrop ||
    button.dataset.chatActionsBound === '1'
  ) {
    return;
  }

  button.dataset.chatActionsBound = '1';
  button.addEventListener('click', (event) => {
    toggleChatActionsMenu(event);
  });
  menu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  backdrop.addEventListener('click', () => {
    closeChatActionsMenu();
  });
}

function updateChatActionsMenuPosition() {
  const menu = document.getElementById('chat-actions-menu');
  const button = document.getElementById('chat-actions-btn');

  if (!menu || !button || menu.classList.contains('hidden')) {
    return;
  }

  menu.style.position = 'fixed';
  menu.style.zIndex = '130';

  if (window.innerWidth < 1024) {
    menu.style.left = '0.75rem';
    menu.style.right = '0.75rem';
    menu.style.bottom = 'calc(env(safe-area-inset-bottom) + 5.75rem)';
    menu.style.top = '';
    menu.style.width = 'auto';
    menu.style.maxHeight = 'min(55vh, 28rem)';
    return;
  }

  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.right = '';
  menu.style.bottom = '';
  menu.style.width = '13rem';
  menu.style.maxHeight = 'min(70vh, 28rem)';

  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const padding = 16;
  const maxLeft = Math.max(
    padding,
    window.innerWidth - menuRect.width - padding,
  );
  const left = Math.min(
    Math.max(padding, buttonRect.right - menuRect.width),
    maxLeft,
  );
  const wouldOverflowBottom =
    buttonRect.bottom + 10 + menuRect.height > window.innerHeight - padding;
  const top = wouldOverflowBottom
    ? Math.max(padding, buttonRect.top - menuRect.height - 10)
    : buttonRect.bottom + 10;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function applyViewportHeight() {
  const visualViewport =
    window.innerWidth < 1024 && window.visualViewport
      ? window.visualViewport
      : null;
  const viewportHeight = visualViewport
    ? visualViewport.height
    : window.innerHeight;
  const viewportWidth = visualViewport
    ? visualViewport.width
    : window.innerWidth;
  const viewportOffsetTop = visualViewport
    ? Math.max(0, visualViewport.offsetTop)
    : 0;
  const viewportOffsetLeft = visualViewport
    ? Math.max(0, visualViewport.offsetLeft)
    : 0;

  document.documentElement.style.setProperty(
    '--app-shell-height',
    `${Math.round(viewportHeight)}px`,
  );
  document.documentElement.style.setProperty(
    '--app-shell-width',
    `${Math.round(viewportWidth)}px`,
  );
  document.documentElement.style.setProperty(
    '--app-shell-offset-top',
    `${Math.round(viewportOffsetTop)}px`,
  );
  document.documentElement.style.setProperty(
    '--app-shell-offset-left',
    `${Math.round(viewportOffsetLeft)}px`,
  );
}

function scheduleViewportHeight() {
  if (viewportHeightFrame) {
    return;
  }

  viewportHeightFrame = window.requestAnimationFrame(() => {
    viewportHeightFrame = 0;
    applyViewportHeight();
  });
}

function lockMobileViewportPosition() {
  if (window.innerWidth >= 1024) {
    return;
  }

  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function enforceLockedMobileViewport() {
  if (!document.documentElement.classList.contains('chat-page-root')) {
    return;
  }

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (!viewportMeta) {
    return;
  }

  if (viewportMeta.getAttribute('content') !== LOCKED_MOBILE_VIEWPORT_CONTENT) {
    viewportMeta.setAttribute('content', LOCKED_MOBILE_VIEWPORT_CONTENT);
  }
}

function stabilizeMobileKeyboardViewport() {
  if (window.innerWidth >= 1024) {
    return;
  }

  enforceLockedMobileViewport();
  scheduleViewportHeight();
  lockMobileViewportPosition();
  window.requestAnimationFrame(() => {
    lockMobileViewportPosition();
  });
  window.setTimeout(() => {
    lockMobileViewportPosition();
  }, 120);
}

function handleKeyboardState(open) {
  if (window.innerWidth >= 1024) {
    document.body.classList.remove('keyboard-open');
    return;
  }

  document.body.classList.toggle('keyboard-open', Boolean(open));
  if (open) {
    stabilizeMobileKeyboardViewport();
  } else {
    lockMobileViewportPosition();
  }
}

async function openProfileModal() {
  if (!currentUser) return;
  updateSettingsUI();
  updateInstallAppUI();
  try {
    await loadBlockedUsers();
  } catch (error) {
    console.error(error);
  }
  document.getElementById('profile-modal').classList.remove('hidden');
  document.getElementById('profile-modal').classList.add('flex');
}

function closeProfileModal(event) {
  if (event && event.target !== event.currentTarget) {
    return;
  }
  document.getElementById('profile-modal').classList.add('hidden');
  document.getElementById('profile-modal').classList.remove('flex');
}

function getActiveReportTarget(target = reportModalTarget || selectedUser) {
  if (!target?.id) {
    return null;
  }

  return {
    id: target.id,
    name: displayName(target),
    isGroup: isGroupConversation(target),
  };
}

function syncReportModalContent(target = getActiveReportTarget()) {
  const reportLabel = document.getElementById('contact-report-btn-label');
  const reportCopy = document.getElementById('contact-report-btn-copy');
  const modalTitle = document.getElementById('report-modal-title');
  const modalCopy = document.getElementById('report-modal-copy');

  if (reportLabel && reportCopy) {
    reportLabel.innerText = target?.isGroup ? 'Report group' : 'Report user';
    reportCopy.innerText = target?.isGroup
      ? 'Flag spam, abuse, or unsafe group activity for admin review.'
      : 'Flag spam, abuse, or suspicious behavior for admin review.';
  }

  if (modalTitle && modalCopy) {
    if (!target) {
      modalTitle.innerText = 'Report this conversation';
      modalCopy.innerText =
        'Tell the admins what happened so they can review it from the moderation queue.';
      return;
    }

    modalTitle.innerText = target.isGroup
      ? `Report ${target.name || 'this group'}`
      : `Report ${target.name || 'this user'}`;
    modalCopy.innerText = target.isGroup
      ? 'Tell the admins what happened in this group so they can review it from the moderation queue.'
      : 'Tell the admins what happened in this conversation so they can review it from the moderation queue.';
  }
}

function setReportSubmitState(isSubmitting) {
  reportSubmitInFlight = isSubmitting;
  const submitBtn = document.getElementById('report-submit-btn');
  if (!submitBtn) {
    return;
  }

  submitBtn.disabled = isSubmitting;
  submitBtn.classList.toggle('cursor-wait', isSubmitting);
  submitBtn.classList.toggle('opacity-70', isSubmitting);
  submitBtn.textContent = isSubmitting ? 'Sending...' : 'Send Report';
}

function openReportModal() {
  const target = getActiveReportTarget(selectedUser);
  if (!target) {
    alert('Choose a conversation first.');
    return;
  }

  reportModalTarget = target;
  syncReportModalContent(target);
  document.getElementById('report-reason-input').value = 'SPAM';
  document.getElementById('report-details-input').value = '';
  setReportSubmitState(false);
  document.getElementById('report-modal').classList.remove('hidden');
  document.getElementById('report-modal').classList.add('flex');
  document.getElementById('report-details-input')?.focus();
}

function closeReportModal(event) {
  if (event && event.target !== event.currentTarget) {
    return;
  }

  reportModalTarget = null;
  setReportSubmitState(false);
  document.getElementById('report-modal').classList.add('hidden');
  document.getElementById('report-modal').classList.remove('flex');
}

async function submitConversationReport() {
  if (reportSubmitInFlight) {
    return;
  }

  const target = getActiveReportTarget();
  if (!target) {
    alert('Choose a conversation to report first.');
    return;
  }

  const reason = document.getElementById('report-reason-input').value.trim();
  const details = document.getElementById('report-details-input').value.trim();

  setReportSubmitState(true);

  try {
    const res = await api('/users/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason,
        ...(details ? { details } : {}),
        ...(target.isGroup
          ? { groupId: target.id }
          : { targetUserId: target.id }),
      }),
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to submit the report.',
    );

    if (!res.ok) {
      alert(
        Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message || 'Failed to submit the report.',
      );
      return;
    }

    closeReportModal();
    alert(data.message || 'Report submitted successfully.');
  } finally {
    if (document.getElementById('report-modal')) {
      setReportSubmitState(false);
    }
  }
}

async function openRenameModal() {
  if (!selectedUser) return;
  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before using this feature.');
    return;
  }
  document.getElementById('rename-input').value = selectedUser.nickname || '';
  document.getElementById('rename-modal').classList.remove('hidden');
  document.getElementById('rename-modal').classList.add('flex');
}

function closeRenameModal(event) {
  if (event && event.target !== event.currentTarget) {
    return;
  }
  document.getElementById('rename-modal').classList.add('hidden');
  document.getElementById('rename-modal').classList.remove('flex');
}

function openResetPasswordModal(tokenFromLink) {
  showForgotPasswordStep(
    '',
    tokenFromLink
      ? 'Password reset now uses OTP. Request a fresh reset code below.'
      : '',
  );
}

function closeResetPasswordModal(event) {
  if (event && event.target !== event.currentTarget) {
    return;
  }
  document.getElementById('reset-password-modal').classList.add('hidden');
  document.getElementById('reset-password-modal').classList.remove('flex');
  document.getElementById('reset-password-input').value = '';
}

async function submitResetPassword() {
  const email = document.getElementById('reset-email-input').value.trim();
  const otp = document.getElementById('reset-otp-input').value.trim();
  const password = document
    .getElementById('reset-password-page-input')
    .value.trim();

  if (!email) {
    showResetPasswordFeedback('Enter your email first.', 'error');
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    showResetPasswordFeedback('Enter the 6-digit reset OTP.', 'error');
    return;
  }

  const res = await fetch(`${API_URL}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      otp,
      password,
    }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to reset password. The server returned an invalid response.',
  );

  if (!res.ok) {
    showResetPasswordFeedback(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to reset password',
      'error',
    );
    return;
  }

  pendingResetEmail = '';
  returnToLoginFromAuxStep();
  document.getElementById('email-input').value = email;
  showAuthFeedback(data.message || 'Password reset successfully.', 'success');
}

async function sendForgotPassword() {
  const email = document.getElementById('forgot-email-input').value.trim();

  if (!email) {
    showForgotPasswordFeedback('Enter your email first.', 'error');
    return;
  }

  const res = await fetch(`${API_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to request a reset OTP. The server returned an invalid response.',
  );

  if (!res.ok) {
    showForgotPasswordFeedback(
      data.message || 'Failed to send reset OTP',
      'error',
    );
    return;
  }

  showResetPasswordStep(
    email,
    buildOtpPreviewMessage(data, data.message || 'Reset OTP sent.'),
  );
  showResetPasswordFeedback(
    buildOtpPreviewMessage(
      data,
      'Enter the OTP from your email and choose a new password.',
    ),
    'success',
  );
}

async function resendResetPasswordOtp() {
  const email =
    document.getElementById('reset-email-input').value.trim() ||
    pendingResetEmail;

  if (!email) {
    showResetPasswordFeedback('Enter your email first.', 'error');
    return;
  }

  const res = await fetch(`${API_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to resend the reset OTP. The server returned an invalid response.',
  );

  if (!res.ok) {
    showResetPasswordFeedback(
      data.message || 'Failed to resend reset OTP',
      'error',
    );
    return;
  }

  pendingResetEmail = email;
  document.getElementById('reset-email-input').value = email;
  showResetPasswordFeedback(
    buildOtpPreviewMessage(
      data,
      data.message || 'A fresh reset OTP has been sent.',
    ),
    'success',
  );
}

async function resendVerification() {
  const email =
    pendingVerificationEmail ||
    document.getElementById('email-input').value.trim();

  if (!email) {
    showAuthFeedback('Enter your email first.', 'error');
    return;
  }

  const res = await fetch(`${API_URL}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to resend the verification OTP. The server returned an invalid response.',
  );

  if (!res.ok) {
    showAuthFeedback(
      data.message || 'Failed to resend verification OTP',
      'error',
    );
    return;
  }

  if (
    !document.getElementById('verification-step').classList.contains('hidden')
  ) {
    document.getElementById('verification-message').innerText =
      buildOtpPreviewMessage(data, data.message || 'Verification OTP sent.');
    showVerificationFeedback(
      buildOtpPreviewMessage(data, 'A fresh OTP has been sent.'),
      'success',
    );
    return;
  }

  showAuthFeedback(buildOtpPreviewMessage(data, data.message), 'success');
}

async function resendVerificationForCurrentUser() {
  if (!token) {
    return;
  }

  const res = await api('/users/email/resend-verification', {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to resend the verification OTP.',
  );

  if (!res.ok) {
    alert(data.message || 'Failed to resend verification OTP');
    return;
  }

  alert(data.message || 'Verification OTP sent');
  await loadProfile();
}

async function verifyPendingEmailOtp() {
  if (!currentUser?.pendingEmail) {
    alert('There is no pending email change to verify.');
    return;
  }

  const primaryOtpInput = document.getElementById(
    'settings-email-confirm-otp-input',
  );
  const secondaryOtpInput = document.getElementById(
    'settings-pending-email-otp-input',
  );
  const otp = primaryOtpInput.value.trim() || secondaryOtpInput.value.trim();

  if (!/^\d{6}$/.test(otp)) {
    alert('Enter the 6-digit OTP sent to your new email.');
    primaryOtpInput.focus();
    return;
  }

  const res = await api('/users/email/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to verify the new email.',
  );

  if (!res.ok) {
    alert(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to verify the new email',
    );
    return;
  }

  await loadProfile();
  renderUsers();
  updateSelectedUserHeader();
  primaryOtpInput.value = '';
  secondaryOtpInput.value = '';
  alert(data.message || 'Email updated and verified.');
  closeProfileModal();
}

function normalizeSearchParams(paramsToRemove) {
  if (isFileOrigin) {
    return;
  }

  const url = new URL(window.location.href);
  paramsToRemove.forEach((param) => url.searchParams.delete(param));
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function processAuthLink() {
  normalizeSearchParams(['verify', 'reset']);
}

function toggleAuthMode() {
  pendingVerificationEmail = '';
  pendingResetEmail = '';
  setAuthMode(!isLogin);
  showAuthForm();
  showAuthFeedback('', 'info');
}

async function handleAuth() {
  if (configLoadPromise) {
    await configLoadPromise;
  }

  const email = document.getElementById('email-input').value.trim();
  const password = document.getElementById('password-input').value.trim();
  const confirmPassword = document
    .getElementById('confirm-password-input')
    .value.trim();
  const name = document.getElementById('name-input').value.trim();
  const endpoint = isLogin ? '/auth/login' : '/auth/register';
  const payload = isLogin ? { email, password } : { email, password, name };

  if (!isLogin && password !== confirmPassword) {
    showAuthFeedback('Password and confirm password must match.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(
      res,
      {},
      'Authentication failed because the server returned an invalid response.',
    );

    if (!res.ok) {
      const message = Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Auth failed';

      if (
        isLogin &&
        (String(message).toLowerCase().includes('verify your email') ||
          String(message).toLowerCase().includes('email verification') ||
          String(message).toLowerCase().includes('before logging in'))
      ) {
        showVerificationStep(
          email,
          'Complete email verification to log in. Enter the 6-digit OTP sent to your email, or resend it below.',
        );
        return;
      }

      showAuthFeedback(message, 'error');
      return;
    }

    const authToken = data.token || data.access_token;
    if (authToken) {
      if (data.user?.id && password) {
        try {
          const unlockMaterial =
            await keyBackupRuntime().deriveKeyBackupUnlockMaterial?.(
              password,
              data.user.id,
            );
          if (unlockMaterial) {
            storeKeyBackupUnlockMaterial(data.user.id, unlockMaterial);
          }
        } catch (error) {
          console.warn(
            'Failed to prepare message key backup unlock material',
            error,
          );
        }
      }
      token = authToken;
      writeStoredValue('chat_token', token);
      showAuthFeedback('', 'info');
      await startApp();
      return;
    }

    if (isLogin) {
      showAuthFeedback('Authentication failed: No token received', 'error');
      return;
    }

    setAuthMode(true);
    showAuthForm();
    document.getElementById('email-input').value = email;
    document.getElementById('password-input').value = '';
    showAuthFeedback(
      data.message || 'Registration successful. Please log in.',
      'success',
    );
  } catch (error) {
    if (error instanceof TypeError) {
      showAuthFeedback(
        `Cannot reach the backend at ${API_URL}. Start Nest on http://localhost:8080 or serve this page from the backend.`,
        'error',
      );
      return;
    }

    showAuthFeedback(error.message || 'Auth failed', 'error');
  }
}

async function startApp() {
  showStartupLoader();
  setStartupLoaderProgress(8, 'Loading your chats', 'Checking your account.');

  try {
    await loadProfile();
    setStartupLoaderProgress(
      20,
      'Loading your chats',
      'Restoring your local chat shell.',
    );

    loadLocalConversationPreferences();
    const restoredShell = restoreChatShellCache();
    const restoredHistory = restoreConversationHistoryCacheFromSession();
    updateChatNavigationState(restoredShell ? users.length : 0);

    void loadBlockedUsers().catch((error) => {
      console.warn('Blocked users prefetch skipped', error);
    });
    document.getElementById('auth-screen').classList.add('hidden');

    const chatId = new URLSearchParams(window.location.search).get('chat');
    const groupId = new URLSearchParams(window.location.search).get('group');
    const requestedConversationId = groupId || chatId;
    const hasRequestedConversation = requestedConversationId
      ? users.some((user) => user.id === requestedConversationId)
      : true;

    const encryptionPromise = ensureEncryptionKeys(true)
      .then(() => {
        setStartupLoaderProgress(
          restoredShell ? 64 : 74,
          'Loading your chats',
          restoredHistory
            ? 'Encrypted cache unlocked.'
            : 'Secure messages unlocked.',
        );
      })
      .catch((error) => {
        console.warn(
          'Encryption key setup failed, continuing login without unlocked encrypted history.',
          error,
        );
        setStartupLoaderProgress(
          restoredShell ? 64 : 74,
          'Loading your chats',
          'Unable to unlock encrypted messages. You can still use O-chat.',
        );
      });

    if (!users.length || !hasRequestedConversation) {
      setStartupLoaderProgress(
        restoredShell ? 34 : 28,
        'Loading your chats',
        restoredShell
          ? 'Syncing your recent chats.'
          : 'Fetching your recent chats.',
      );
      await loadUsers();
      setStartupLoaderProgress(
        56,
        'Loading your chats',
        'Recent chats are ready.',
      );
      await encryptionPromise;
    } else {
      setStartupLoaderProgress(
        42,
        'Loading your chats',
        restoredHistory
          ? 'Restoring cached conversations.'
          : 'Unlocking encrypted messages.',
      );
      await encryptionPromise;
      setStartupLoaderProgress(
        72,
        'Loading your chats',
        'Refreshing recent chats in the background.',
      );
      scheduleUsersRefreshInBackground({
        minAgeMs: CHAT_SHELL_CACHE_TTL_MS,
      });
    }

    setStartupLoaderProgress(
      82,
      'Loading your chats',
      'Connecting live updates.',
    );
    connectSocket();
    void setupNotifications().catch((error) => {
      console.warn('Push notification setup skipped', error);
    });

    if (groupId) {
      setStartupLoaderProgress(
        94,
        'Loading your chats',
        'Opening your group conversation.',
      );
      await selectUser(groupId);
      setStartupLoaderProgress(
        100,
        'Loading your chats',
        'Conversation ready.',
      );
      hideStartupLoader();
      window.setTimeout(() => {
        maybeShowSecurityWelcomeNotice();
      }, 180);
      return;
    }

    if (chatId) {
      setStartupLoaderProgress(
        90,
        'Loading your chats',
        'Opening your conversation.',
      );
      if (!findKnownDirectUserById(chatId)) {
        try {
          await loadUserSearchResults(chatId);
        } catch (error) {
          console.warn('Detached chat lookup skipped', error);
        }
      }
      await selectUser(chatId);
      setStartupLoaderProgress(
        100,
        'Loading your chats',
        'Conversation ready.',
      );
      hideStartupLoader();
      window.setTimeout(() => {
        maybeShowSecurityWelcomeNotice();
      }, 180);
      return;
    }

    setStartupLoaderProgress(100, 'Loading your chats', 'Chats ready.');
    hideStartupLoader();
    window.setTimeout(() => {
      maybeShowSecurityWelcomeNotice();
    }, 180);
  } catch (error) {
    hideStartupLoader({ immediate: true });
    throw error;
  }
}

async function loadProfile() {
  const res = await api('/users/me');
  if (!res.ok) {
    throw new Error('Failed to load profile');
  }

  const data = await readJsonResponse(
    res,
    null,
    'Failed to load your profile.',
  );

  if (!data?.id) {
    throw new Error(data?.message || 'Failed to load profile');
  }

  applyCurrentUser(data);
}

async function requestAccountDeletion() {
  if (!currentUser) {
    return;
  }

  const confirmed = window.confirm(
    'Schedule your account for deletion in 7 days? You will be logged out right away, and logging back in before the deadline will let you cancel it.',
  );
  if (!confirmed) {
    return;
  }

  const res = await api('/users/account/delete/request', {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to schedule account deletion.',
  );

  if (!res.ok) {
    alert(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to schedule account deletion.',
    );
    return;
  }

  if (data?.id) {
    applyCurrentUser(data);
  }

  if (data.logoutRequired) {
    forceSessionLogout(data.message || 'Account deletion scheduled.');
    return;
  }

  alert(data.message || 'Account deletion scheduled.');
}

async function cancelAccountDeletion() {
  if (!currentUser) {
    return;
  }

  const confirmed = window.confirm(
    'Cancel your scheduled account deletion and keep this account active?',
  );
  if (!confirmed) {
    return;
  }

  const res = await api('/users/account/delete/cancel', {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to cancel account deletion.',
  );

  if (!res.ok) {
    alert(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to cancel account deletion.',
    );
    return;
  }

  if (data?.id) {
    applyCurrentUser(data);
  }

  alert(data.message || 'Scheduled account deletion cancelled.');
}

async function saveProfile() {
  if (!currentUser) return;

  const saveButton = document.getElementById('save-profile-btn');
  const name = document.getElementById('profile-name-input').value.trim();
  const email = document.getElementById('profile-email-input').value.trim();

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.classList.add('opacity-70', 'cursor-wait');
    saveButton.innerHTML =
      '<span class="inline-flex items-center gap-2"><span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"></span><span>Saving...</span></span>';
  }

  try {
    const res = await api('/users/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to update profile. The server returned an invalid response.',
    );

    if (!res.ok) {
      alert(
        Array.isArray(data.message)
          ? data.message.join(', ')
          : data.message || 'Failed to update profile',
      );
      return;
    }

    applyCurrentUser(data);
    users = users.map((user) =>
      user.id === currentUser.id
        ? normalizeUser({ ...user, ...data }, user)
        : user,
    );
    syncSelectedUser();
    renderUsers();
    updateSelectedUserHeader();
    alert(data.message || 'Profile updated');

    if (data.pendingEmail) {
      document.getElementById('settings-email-confirm-otp-input').value = '';
      document.getElementById('settings-pending-email-otp-input').value = '';
      updateSettingsUI();
      document.getElementById('settings-email-confirm-otp-input').focus();
      return;
    }

    closeProfileModal();
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.classList.remove('opacity-70', 'cursor-wait');
      saveButton.textContent = 'Save Profile';
    }
  }
}

async function saveSettings() {
  if (!currentUser) return;

  const darkMode = document.getElementById('settings-darkmode-input').checked;
  const backupEnabled = document.getElementById(
    'settings-backup-input',
  ).checked;
  const backupImages = document.getElementById(
    'settings-backup-images-input',
  ).checked;
  const backupVideos = document.getElementById(
    'settings-backup-videos-input',
  ).checked;
  const backupFiles = document.getElementById(
    'settings-backup-files-input',
  ).checked;

  const res = await api('/users/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      darkMode,
      backupEnabled,
      backupImages,
      backupVideos,
      backupFiles,
    }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to save settings. The server returned an invalid response.',
  );

  if (!res.ok) {
    alert(data.message || 'Failed to save settings');
    return;
  }

  applyCurrentUser(data);
  alert('Settings saved');
}

async function toggleDarkModePreference() {
  if (!currentUser) {
    return;
  }

  const darkModeInput = document.getElementById('settings-darkmode-input');
  if (!darkModeInput) {
    return;
  }

  const nextDarkMode = Boolean(darkModeInput.checked);
  const previousDarkMode = Boolean(currentUser.darkMode);
  currentUser = {
    ...currentUser,
    darkMode: nextDarkMode,
  };
  applyDarkMode(nextDarkMode);

  try {
    const res = await api('/users/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        darkMode: nextDarkMode,
      }),
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to update dark mode. The server returned an invalid response.',
    );

    if (!res.ok) {
      throw new Error(data.message || 'Failed to update dark mode');
    }

    applyCurrentUser(data);
  } catch (error) {
    currentUser = {
      ...currentUser,
      darkMode: previousDarkMode,
    };
    darkModeInput.checked = previousDarkMode;
    applyDarkMode(previousDarkMode);
    alert(error.message || 'Failed to update dark mode');
  }
}

async function changePassword() {
  if (!currentUser) return;

  const currentPassword = document
    .getElementById('current-password-input')
    .value.trim();
  const newPassword = document
    .getElementById('new-password-input')
    .value.trim();
  const confirmNewPassword = document
    .getElementById('confirm-new-password-input')
    .value.trim();

  if (newPassword !== confirmNewPassword) {
    alert('New password and confirm password must match.');
    return;
  }

  let keyBackupPayload = null;
  if (currentUser.id && newPassword) {
    const hasStoredPrivateKeyBackup = Boolean(
      currentUser.privateKeyBackupCiphertext && currentUser.privateKeyBackupIv,
    );
    const privateKey = await resolveCurrentUserPrivateKeyForBackup();
    if (hasStoredPrivateKeyBackup && !privateKey) {
      alert(
        'Please log in again on this device before changing your password so O-chat can refresh your encrypted message key backup.',
      );
      return;
    }
    if (privateKey) {
      try {
        const deriveUnlockMaterial =
          keyBackupRuntime().deriveKeyBackupUnlockMaterial;
        const unlockMaterial = deriveUnlockMaterial
          ? await deriveUnlockMaterial(newPassword, currentUser.id)
          : '';
        keyBackupPayload = await encryptPrivateKeyBackupForUser(
          privateKey,
          currentUser.id,
          unlockMaterial,
        );
      } catch (error) {
        console.warn(
          'Failed to refresh message key backup for password change',
          error,
        );
      }
    }
  }

  const res = await api('/users/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword,
      newPassword,
      ...(keyBackupPayload || {}),
    }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to update password. The server returned an invalid response.',
  );

  if (!res.ok) {
    alert(data.message || 'Failed to update password');
    return;
  }

  document.getElementById('current-password-input').value = '';
  document.getElementById('new-password-input').value = '';
  document.getElementById('confirm-new-password-input').value = '';
  forceSessionLogout(
    data.message ||
    'Password updated successfully. Please log in again on this device.',
  );
}

async function loadUsers() {
  if (loadUsersPromise) {
    reloadUsersAfterCurrentLoad = true;
    return loadUsersPromise;
  }

  setSurfaceRefreshState('users-list', true, 140);
  loadUsersPromise = (async () => {
    const [recentResult, invitesResult] = await Promise.allSettled([
      api('/chat/recent'),
      api('/chat/groups/invites'),
    ]);

    if (recentResult.status !== 'fulfilled') {
      throw new Error(
        recentResult.reason?.message ||
        'Failed to load recent chats. Please try again.',
      );
    }

    const recentRes = recentResult.value;
    const recentUsersData = await readJsonResponse(
      recentRes,
      [],
      'Failed to load recent chats.',
    );

    if (recentRes.status === 401) {
      throw new Error('Your session expired. Please log in again.');
    }
    if (!recentRes.ok) {
      throw new Error(
        getApiErrorMessage(recentUsersData, 'Failed to load recent chats.'),
      );
    }

    const recentUsers = Array.isArray(recentUsersData) ? recentUsersData : [];

    groupInvites = [];
    if (invitesResult.status === 'fulfilled') {
      const invitesRes = invitesResult.value;
      const invitesData = await readJsonResponse(
        invitesRes,
        [],
        'Failed to load group invites.',
      );

      if (invitesRes.status === 401) {
        throw new Error('Your session expired. Please log in again.');
      }

      if (invitesRes.ok) {
        groupInvites = Array.isArray(invitesData) ? invitesData : [];
      } else {
        console.warn(
          'Failed to load group invites without blocking recent chats',
          invitesRes.status,
          invitesData,
        );
      }
    } else {
      console.warn(
        'Failed to request group invites without blocking recent chats',
        invitesResult.reason,
      );
    }

    const existingByKey = new Map(
      users.map((user) => [`${user.chatType || 'direct'}:${user.id}`, user]),
    );
    const recentByKey = new Map(
      recentUsers.map((user) => [
        `${user.chatType || 'direct'}:${user.id}`,
        user,
      ]),
    );

    const directoryById = new Map(
      peopleDirectory.map((user) => [user.id, user]),
    );

    const directUsers = recentUsers
      .filter((user) => (user.chatType || 'direct') !== 'group')
      .map((user) => {
        const key = `direct:${user.id}`;
        const recent = recentByKey.get(key) || user;
        const directoryUser = directoryById.get(user.id);
        return normalizeUser(
          {
            ...(directoryUser || {}),
            ...user,
            chatType: 'direct',
            lastMessagePreview: recent?.lastMessagePreview ?? null,
            lastMessageAt: recent?.lastMessageAt ?? null,
            lastMessageType: recent?.lastMessageType ?? null,
          },
          existingByKey.get(key),
        );
      });

    const groupUsers = recentUsers
      .filter((user) => (user.chatType || 'direct') === 'group')
      .map((group) => {
        const key = `group:${group.id}`;
        const recent = recentByKey.get(key);
        return normalizeUser(
          {
            ...group,
            chatType: 'group',
            displayName: group.name,
            nickname: null,
            email: '',
            chatTheme: null,
            lastMessagePreview:
              recent?.lastMessagePreview ?? group.lastMessagePreview ?? null,
            lastMessageAt: recent?.lastMessageAt ?? group.lastMessageAt ?? null,
            lastMessageType:
              recent?.lastMessageType ?? group.lastMessageType ?? null,
          },
          existingByKey.get(key),
        );
      });

    users = filterBlockedDirectUsers([...directUsers, ...groupUsers]);

    if (selectedUser) {
      const fallbackKey = `${selectedUser.chatType || 'direct'}:${selectedUser.id}`;
      const shouldKeepSelectedConversationVisible =
        isGroupConversation(selectedUser) || recentByKey.has(fallbackKey);
      if (
        shouldKeepSelectedConversationVisible &&
        !users.some((user) => userListKey(user) === fallbackKey)
      ) {
        users = [
          normalizeUser(
            selectedUser,
            existingByKey.get(fallbackKey) || selectedUser,
          ),
          ...users,
        ];
      }
    }

    users
      .filter((user) => !isGroupConversation(user))
      .forEach((user) => ignoredPresenceUserIds.delete(user.id));

    for (const user of users) {
      if (!recentActivity.has(user.id)) {
        recentActivity.set(user.id, {
          lastAt: user.lastMessageAt
            ? new Date(user.lastMessageAt).getTime()
            : 0,
          preview: user.lastMessagePreview || '',
          unread: 0,
        });
      }
    }

    syncSelectedUser();
    updateChatCount();
    renderGroupInvites();
    renderUsers();
    schedulePersistChatShellCache();
  })();

  try {
    await loadUsersPromise;
  } finally {
    loadUsersPromise = null;
    setSurfaceRefreshState('users-list', false);
  }

  if (reloadUsersAfterCurrentLoad) {
    reloadUsersAfterCurrentLoad = false;
    return loadUsers();
  }
}

async function loadPeopleDirectory(force = false) {
  if (peopleDirectoryLoaded && !force) {
    return peopleDirectory;
  }

  const res = await api('/users');
  const data = await readJsonResponse(res, [], 'Failed to load users.');
  if (!res.ok) {
    throw new Error(data.message || 'Failed to load users');
  }

  peopleDirectory = filterBlockedDirectUsers(
    data.map((user) => normalizeUser({ ...user, chatType: 'direct' })),
  );
  peopleDirectoryLoaded = true;
  return peopleDirectory;
}

async function loadUserSearchResults(query) {
  const requestQuery = String(query || '').trim();
  const normalizedQuery = requestQuery.toLowerCase();
  if (!requestQuery) {
    userSearchResults = [];
    userSearchResultsQuery = '';
    scheduleRenderUsers();
    return userSearchResults;
  }

  if (userSearchResultsQuery === normalizedQuery && userSearchResults.length) {
    return userSearchResults;
  }

  const requestToken = ++userSearchRequestToken;
  const res = await api(`/users?q=${encodeURIComponent(requestQuery)}`);
  const data = await readJsonResponse(res, [], 'Failed to search users.');
  if (!res.ok) {
    throw new Error(data.message || 'Failed to search users');
  }

  if (requestToken !== userSearchRequestToken) {
    return userSearchResults;
  }

  userSearchResults = filterBlockedDirectUsers(
    data.map((user) => normalizeUser({ ...user, chatType: 'direct' })),
  );
  userSearchResultsQuery = normalizedQuery;
  scheduleRenderUsers();
  return userSearchResults;
}

function findKnownDirectUserById(userId) {
  if (!userId) {
    return null;
  }

  return (
    users.find((user) => !isGroupConversation(user) && user.id === userId) ||
    userSearchResults.find((user) => user.id === userId) ||
    peopleDirectory.find((user) => user.id === userId) ||
    null
  );
}

function getSearchUserPool() {
  const query = document
    .getElementById('user-search')
    ?.value.trim()
    .toLowerCase();
  const matchingSearchResults =
    query && userSearchResultsQuery === query ? userSearchResults : [];
  const directUsers = matchingSearchResults.length
    ? matchingSearchResults.map((user) => {
      const existing = users.find(
        (entry) => !isGroupConversation(entry) && entry.id === user.id,
      );
      return normalizeUser(
        {
          ...(existing || {}),
          ...user,
          chatType: 'direct',
        },
        existing || user,
      );
    })
    : users.filter((user) => !isGroupConversation(user));

  const merged = new Map();
  [
    ...directUsers,
    ...users.filter((user) => isGroupConversation(user)),
  ].forEach((user) => {
    merged.set(userListKey(user), user);
  });

  return Array.from(merged.values());
}

async function refreshUsersForPresence(ids) {
  if (!currentUser || !Array.isArray(ids) || presenceRefreshPromise) {
    return;
  }

  const knownDirectUserIds = new Set(
    users.filter((user) => !isGroupConversation(user)).map((user) => user.id),
  );
  const unknownUserIds = ids.filter(
    (userId) =>
      userId !== currentUser.id &&
      !knownDirectUserIds.has(userId) &&
      !ignoredPresenceUserIds.has(userId),
  );

  if (!unknownUserIds.length) {
    return;
  }

  unknownUserIds.forEach((userId) => ignoredPresenceUserIds.add(userId));

  presenceRefreshPromise = loadUsers()
    .catch((error) => {
      console.error('Failed to refresh user list for presence', error);
    })
    .finally(() => {
      presenceRefreshPromise = null;
    });

  await presenceRefreshPromise;
}

function applyOnlineUsersSnapshot(ids) {
  onlineUserIds = new Set(
    (Array.isArray(ids) ? ids : []).filter((userId) => Boolean(userId)),
  );
  scheduleRenderUsers();
  scheduleHeaderUpdate();
  void refreshUsersForPresence(Array.from(onlineUserIds)).catch((error) => {
    console.error('Failed to refresh users after presence snapshot', error);
  });
}

function applyPresenceUpdate(userId, isOnline) {
  if (!userId) {
    return;
  }

  if (isOnline) {
    onlineUserIds.add(userId);
  } else {
    onlineUserIds.delete(userId);
  }

  scheduleRenderUsers();
  scheduleHeaderUpdate();

  if (isOnline) {
    void refreshUsersForPresence([userId]).catch((error) => {
      console.error('Failed to refresh users after presence update', error);
    });
  }
}

function getSortedUsers() {
  const query = document
    .getElementById('user-search')
    .value.trim()
    .toLowerCase();
  const sourceUsers = query ? getSearchUserPool() : users;
  return [...sourceUsers]
    .filter((user) => {
      if (query) {
        return true;
      }

      const archived = isConversationArchived(user);
      if (showArchivedChats) {
        return archived;
      }

      return !archived || selectedUser?.id === user.id;
    })
    .filter((user) => {
      switch (activeChatListFilter) {
        case 'unread':
          return Number(recentActivity.get(user.id)?.unread || 0) > 0;
        case 'groups':
          return isGroupConversation(user);
        case 'pinned':
          return isConversationPinned(user);
        default:
          return true;
      }
    })
    .filter((user) => {
      if (!query) return true;
      return [user.name, user.email, user.nickname, user.displayName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .sort((a, b) => {
      const pinnedA = isConversationPinned(a) ? 1 : 0;
      const pinnedB = isConversationPinned(b) ? 1 : 0;
      if (pinnedA !== pinnedB) {
        return pinnedB - pinnedA;
      }

      const recentA = recentActivity.get(a.id)?.lastAt || 0;
      const recentB = recentActivity.get(b.id)?.lastAt || 0;
      if (recentA !== recentB) {
        return recentB - recentA;
      }
      const onlineA = onlineUserIds.has(a.id) ? 1 : 0;
      const onlineB = onlineUserIds.has(b.id) ? 1 : 0;
      if (onlineA !== onlineB) {
        return onlineB - onlineA;
      }
      return displayName(a).localeCompare(displayName(b));
    });
}

function userListKey(user) {
  return `${user?.chatType || 'direct'}:${user?.id}`;
}

function getUserRenderSignature(user) {
  const state = recentActivity.get(user.id) || {
    preview: '',
    unread: 0,
  };
  const draft = getConversationDraft(user);
  const missedCalls = Number(
    missedCallCountsByConversation.get(getConversationCacheKey(user)) || 0,
  );
  return [
    selectedUser?.id === user.id ? 1 : 0,
    !isGroupConversation(user) && onlineUserIds.has(user.id) ? 1 : 0,
    displayName(user),
    user.avatar || '',
    state.preview || '',
    state.unread || 0,
    missedCalls,
    draft,
    isConversationPinned(user) ? 1 : 0,
    isConversationMuted(user) ? 1 : 0,
    isConversationArchived(user) ? 1 : 0,
  ].join('::');
}

function getUserListPreviewMeta(user) {
  const state = recentActivity.get(user.id) || {
    preview: '',
    unread: 0,
  };
  const draft = getConversationDraft(user);
  const activeTypingUsers = Array.from(
    typingUsers.get(conversationRoomId(user)) || [],
  );
  const typingPreview =
    activeTypingUsers.length && !draft
      ? isGroupConversation(user)
        ? formatTypingStatus(activeTypingUsers)
        : 'Typing...'
      : '';

  return {
    state,
    previewText: draft
      ? `Draft: ${draft}`
      : typingPreview || state.preview || 'No recent messages yet',
    previewToneClass: draft
      ? 'font-semibold text-amber-600'
      : typingPreview
        ? 'font-semibold text-blue-600'
        : state.unread
          ? 'font-semibold text-slate-700'
          : 'text-slate-400',
    isTyping: Boolean(typingPreview),
  };
}

function scheduleUserListDraftPreviewSync(user = selectedUser, options = {}) {
  if (pendingUserListPreviewSyncTimer) {
    window.clearTimeout(pendingUserListPreviewSyncTimer);
    pendingUserListPreviewSyncTimer = 0;
  }

  if (!user) {
    return;
  }

  if (options.immediate) {
    syncUserListDraftPreview(user);
    return;
  }

  pendingUserListPreviewSyncTimer = window.setTimeout(() => {
    pendingUserListPreviewSyncTimer = 0;
    syncUserListDraftPreview(user);
  }, 140);
}

function createUserListElement(user, index = 0) {
  const item = document.createElement('li');
  const isSelected = selectedUser?.id === user.id;
  const isOnline = !isGroupConversation(user) && onlineUserIds.has(user.id);
  const { state, previewText, previewToneClass, isTyping } =
    getUserListPreviewMeta(user);
  const lastAtLabel = state.lastAt ? formatMessageTime(state.lastAt) : '';
  const missedCalls = Number(
    missedCallCountsByConversation.get(getConversationCacheKey(user)) || 0,
  );
  const badges = [
    isConversationPinned(user)
      ? '<span class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">Pinned</span>'
      : '',
    isConversationMuted(user)
      ? '<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Muted</span>'
      : '',
    isConversationArchived(user)
      ? '<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Archived</span>'
      : '',
  ]
    .filter(Boolean)
    .join('');

  item.dataset.userKey = userListKey(user);
  item.style.setProperty('--motion-index', String(index % 10));
  item.className = `cursor-pointer rounded-[20px] border px-1.5 py-1 transition-all ${isSelected
    ? 'border-blue-200 bg-blue-50 shadow-sm'
    : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
    }`;
  item.classList.add('chat-list-card');
  item.onclick = () => selectUser(user.id);
  item.innerHTML = `
        <div class="chat-list-card-body flex items-center gap-2.5 rounded-[16px] p-1.5">
          <div class="relative shrink-0">
            <img src="${userAvatar(user)}" alt="${escapeHtml(displayName(user))} profile photo" width="40" height="40" loading="lazy" decoding="async" class="h-10 w-10 rounded-[14px] object-cover shadow-sm">
            ${isGroupConversation(user)
      ? `<span class="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-slate-900 px-1 py-[1px] text-[9px] font-bold uppercase tracking-wide text-white">G</span>`
      : `<span class="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}"></span>`
    }
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-slate-900">${escapeHtml(displayName(user))}</p>
              ${badges}
            </div>
            <p class="user-list-preview mt-0.5 truncate text-[11px] leading-4 ${previewToneClass}${isTyping ? ' typing' : ''}">
              ${escapeHtml(previewText)}
            </p>
          </div>
          <div class="flex flex-col items-end gap-1">
            ${lastAtLabel
      ? `<span class="chat-list-card-time text-[10px] font-semibold text-slate-400">${escapeHtml(lastAtLabel)}</span>`
      : ''
    }
            ${missedCalls
      ? `<span class="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">${missedCalls} missed</span>`
      : ''
    }
            ${state.unread ? `<span class="flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">${state.unread}</span>` : ''}
          </div>
        </div>
      `;

  attachImageFallback(item.querySelector('img'));

  return item;
}

function syncUserListDraftPreview(user = selectedUser) {
  if (!user) {
    return;
  }

  const list = getById('users-list');
  if (!list) {
    return;
  }

  const key = userListKey(user);
  const item = Array.from(list.children).find(
    (child) => child.dataset.userKey === key,
  );
  if (!item) {
    return;
  }

  const preview = item.querySelector('.user-list-preview');
  if (!preview) {
    return;
  }

  const { previewText, previewToneClass } = getUserListPreviewMeta(user);
  if (preview.textContent !== previewText) {
    preview.textContent = previewText;
  }

  const nextPreviewClassName = `user-list-preview mt-0.5 truncate text-[11px] leading-4 ${previewToneClass}`;
  if (preview.className !== nextPreviewClassName) {
    preview.className = nextPreviewClassName;
  }
  renderedUserSignatures.set(key, getUserRenderSignature(user));
}

function renderUsers() {
  const list = getById('users-list');
  if (!list) {
    return;
  }

  const sortedUsers = getSortedUsers();

  if (!sortedUsers.length) {
    renderedUserSignatures = new Map();
    const query = getById('user-search')?.value.trim() || '';
    const emptyLabel = showArchivedChats
      ? 'No archived chats match this view yet.'
      : query
        ? `No chats match "${query}".`
        : activeChatListFilter === 'unread'
          ? 'Nothing unread right now.'
          : activeChatListFilter === 'groups'
            ? 'No groups in this view yet.'
            : activeChatListFilter === 'pinned'
              ? 'Pin a chat to keep it here.'
              : 'Your recent chats will appear here.';
    list.innerHTML = `
      <li class="chat-list-empty rounded-[22px] border border-dashed border-slate-200/80 px-4 py-5 text-center text-sm text-slate-400">
        ${escapeHtml(emptyLabel)}
      </li>
    `;
    updateArchivedChatsToggle();
    renderPinnedConversationsSidebar();
    renderSidebarStarredHub();
    updateChatNavigationState(0);
    return;
  }

  const existingNodes = new Map(
    Array.from(list.children).map((child) => [child.dataset.userKey, child]),
  );
  const nextSignatures = new Map();

  sortedUsers.forEach((user, index) => {
    const key = userListKey(user);
    const signature = getUserRenderSignature(user);
    nextSignatures.set(key, signature);

    const existingNode = existingNodes.get(key);
    const nextNode =
      existingNode && renderedUserSignatures.get(key) === signature
        ? existingNode
        : createUserListElement(user, index);

    list.appendChild(nextNode);
    if (existingNode && existingNode !== nextNode) {
      existingNode.remove();
    }
    existingNodes.delete(key);
  });

  for (const [key, node] of existingNodes.entries()) {
    renderedUserSignatures.delete(key);
    node.remove();
  }

  renderedUserSignatures = nextSignatures;
  updateArchivedChatsToggle();
  renderPinnedConversationsSidebar();
  renderSidebarStarredHub();
  updateChatNavigationState(sortedUsers.length);
}

function updateArchivedChatsToggle() {
  const button = getById('archived-chats-toggle');
  if (!button) {
    return;
  }

  const archivedCount = users.filter((user) =>
    isConversationArchived(user),
  ).length;
  const label = showArchivedChats
    ? 'Back to active chats'
    : archivedCount
      ? `Show archived chats (${archivedCount})`
      : 'Show archived chats';
  button.classList.toggle('hidden', archivedCount === 0 && !showArchivedChats);
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.innerHTML = `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-5 w-5"
      aria-hidden="true"
    >
      ${showArchivedChats
      ? '<path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path>'
      : '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"></path><path d="M23 3H1v5h22V3Z"></path><path d="M10 12h4"></path>'
    }
    </svg>
    <span class="sr-only">${escapeHtml(label)}</span>
    ${!showArchivedChats && archivedCount
      ? `<span class="sidebar-icon-badge">${archivedCount}</span>`
      : ''
    }
  `;
}

function toggleArchivedChatsView() {
  showArchivedChats = !showArchivedChats;
  renderUsers();
}

function scrollToMessageInConversation(messageId) {
  const element = document.getElementById(`message-${messageId}`);
  if (!element) {
    alert(
      'That starred message is not loaded yet. Scroll up to load older messages.',
    );
    return;
  }

  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.add('ring-2', 'ring-amber-300', 'ring-offset-2');
  window.setTimeout(() => {
    element.classList.remove('ring-2', 'ring-amber-300', 'ring-offset-2');
  }, 1800);
}

function renderStarredMessages() {
  const count = getById('chat-contact-panel-starred-count');
  const list = getById('chat-contact-panel-starred-list');
  if (!count || !list) {
    return;
  }

  if (!selectedUser) {
    count.textContent = 'No chat selected.';
    list.innerHTML = '';
    return;
  }

  const starred = getStarredMessagesForConversation(selectedUser);
  if (!starred.length) {
    count.textContent = 'No starred messages yet.';
    list.innerHTML = '';
    return;
  }

  count.textContent = `${starred.length} starred message${starred.length === 1 ? '' : 's'
    }`;
  list.innerHTML = starred
    .slice(0, 8)
    .map(
      (entry) => `
        <button
          type="button"
          onclick="scrollToMessageInConversation('${entry.id}')"
          class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:bg-white"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-bold uppercase tracking-wide text-amber-600">${escapeHtml(entry.senderName || 'Message')}</span>
            <span class="text-[11px] text-slate-400">${escapeHtml(formatMessageTime(entry.createdAt))}</span>
          </div>
          <p class="mt-2 text-sm text-slate-700">${escapeHtml(entry.preview || 'Starred message')}</p>
        </button>
      `,
    )
    .join('');
}

function renderGroupInvites() {
  const container = getById('group-invites');
  if (!container) {
    return;
  }

  if (!groupInvites.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = groupInvites
    .map(
      (invite) => `
              <div class="rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm">
                <p class="text-sm font-semibold text-slate-900">${escapeHtml(invite.group?.name || 'Group invite')}</p>
                <p class="mt-1 text-xs leading-5 text-slate-500">Invite from ${escapeHtml(invite.invitedBy?.name || invite.invitedBy?.email || 'someone')}</p>
                <div class="mt-3 flex gap-2">
                  <button onclick="respondToGroupInvite('${invite.id}', true)" class="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700">Accept</button>
                  <button onclick="respondToGroupInvite('${invite.id}', false)" class="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">Reject</button>
                </div>
              </div>
            `,
    )
    .join('');
}

function emitSocketEvent(eventName, payload) {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Realtime connection is not available.'));
      return;
    }

    socket.timeout(10000).emit(eventName, payload, (error, response) => {
      if (error) {
        reject(new Error('Realtime connection timed out.'));
        return;
      }

      if (response?.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });
}

function disconnectSocketForPageExit() {
  clearOutgoingTypingState({ emit: false });
  if (!socket) {
    socketConnectionKey = '';
    return;
  }

  try {
    socket.disconnect();
  } catch (error) {
    console.warn('Failed to close realtime connection during page exit', error);
  } finally {
    socket = null;
    socketConnectionKey = '';
  }
}

function getTypingConversationPayload(user = selectedUser) {
  if (!user) {
    return null;
  }

  return isGroupConversation(user)
    ? { groupId: user.id }
    : { toUserId: user.id };
}

function getTypingConversationKey(user = selectedUser) {
  if (!user) {
    return '';
  }

  return `${isGroupConversation(user) ? 'group' : 'direct'}:${user.id}`;
}

function emitTypingState(payload, isTyping) {
  if (!socket?.connected || !payload) {
    return;
  }

  socket.emit('typing', {
    ...payload,
    isTyping: Boolean(isTyping),
  });
}

function clearOutgoingTypingState(options = {}) {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }

  if (
    options.emit !== false &&
    activeTypingConversation &&
    activeTypingSignalSent
  ) {
    emitTypingState(activeTypingConversation.payload, false);
  }

  activeTypingConversation = null;
  activeTypingSignalSent = false;
  lastTypingSignalAt = 0;
}

function scheduleOutgoingTypingStop(conversation) {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }

  typingTimeout = setTimeout(() => {
    if (!conversation || activeTypingConversation?.key !== conversation.key) {
      return;
    }

    if (activeTypingSignalSent) {
      emitTypingState(conversation.payload, false);
    }

    activeTypingConversation = null;
    activeTypingSignalSent = false;
    lastTypingSignalAt = 0;
    typingTimeout = null;
  }, TYPING_STOP_DELAY_MS);
}

function signalOutgoingTyping(user = selectedUser) {
  const payload = getTypingConversationPayload(user);
  const key = getTypingConversationKey(user);
  if (!payload || !key || !socket?.connected) {
    return;
  }

  if (activeTypingConversation && activeTypingConversation.key !== key) {
    if (activeTypingSignalSent) {
      emitTypingState(activeTypingConversation.payload, false);
    }
    activeTypingSignalSent = false;
    lastTypingSignalAt = 0;
  }

  const now = Date.now();
  const shouldEmitStart =
    !activeTypingSignalSent ||
    activeTypingConversation?.key !== key ||
    now - lastTypingSignalAt >= TYPING_START_THROTTLE_MS;

  activeTypingConversation = { key, payload };
  if (shouldEmitStart) {
    emitTypingState(payload, true);
    activeTypingSignalSent = true;
    lastTypingSignalAt = now;
  }

  scheduleOutgoingTypingStop(activeTypingConversation);
}

function connectSocket() {
  const nextConnectionKey = `${API_URL}|${token || ''}`;
  if (socket && socketConnectionKey === nextConnectionKey) {
    if (!socket.connected && !socket.active) {
      socket.connect();
    }
    return;
  }

  if (socket) {
    disconnectSocketForPageExit();
  }

  socketConnectionKey = nextConnectionKey;
  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket'],
    upgrade: false,
    rememberUpgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 3000,
    randomizationFactor: 0.2,
    timeout: 8000,
    closeOnBeforeunload: true,
  });

  socket.on('connect', () => {
    void flushOfflineQueuedMessages().catch((error) => {
      console.error('Failed to flush offline queue after reconnect', error);
    });
  });

  socket.on('onlineUsers', (ids) => {
    applyOnlineUsersSnapshot(ids);
  });

  socket.on('presence:update', (payload) => {
    if (!payload?.userId) {
      return;
    }

    applyPresenceUpdate(payload.userId, Boolean(payload.isOnline));
  });

  socket.on('request:update', async (payload) => {
    if (!payload || !currentUser?.id) {
      return;
    }

    const isIncomingPending =
      payload.status === 'PENDING' && payload.receiverId === currentUser.id;
    const otherUserId =
      payload.senderId === currentUser.id
        ? payload.receiverId
        : payload.senderId;

    if (isIncomingPending && otherUserId) {
      let otherUser =
        users.find(
          (user) => !isGroupConversation(user) && user.id === otherUserId,
        ) ||
        peopleDirectory.find((user) => user.id === otherUserId) ||
        null;

      if (!otherUser) {
        try {
          await loadUsers();
          otherUser =
            users.find(
              (user) => !isGroupConversation(user) && user.id === otherUserId,
            ) ||
            peopleDirectory.find((user) => user.id === otherUserId) ||
            null;
        } catch (error) {
          console.error('Failed to refresh users after chat request', error);
        }
      }

      bumpConversationForRequest(
        otherUserId,
        'Sent you a chat request',
        !selectedUser || selectedUser.id !== otherUserId,
      );
      maybeShowRequestNotification(payload, otherUser);
    }

    if (
      selectedUser &&
      !isGroupConversation(selectedUser) &&
      (payload.senderId === selectedUser.id ||
        payload.receiverId === selectedUser.id)
    ) {
      await loadChatPermission();
    }
  });

  socket.on('chat-theme:update', (payload) => {
    if (!currentUser || !payload) {
      return;
    }

    let otherUserId = null;
    if (payload.userId === currentUser.id) {
      otherUserId = payload.contactUserId;
    } else if (payload.contactUserId === currentUser.id) {
      otherUserId = payload.userId;
    }

    if (!otherUserId) {
      return;
    }

    users = users.map((user) =>
      user.id === otherUserId
        ? normalizeUser({ ...user, chatTheme: payload.chatTheme ?? null }, user)
        : user,
    );

    syncSelectedUser();
    scheduleRenderUsers();
    scheduleHeaderUpdate();
  });

  socket.on('auth:logout', () => {
    forceSessionLogout('Your session expired. Please log in again.');
  });

  socket.on('connect_error', (error) => {
    console.error(error);
  });

  socket.on('receiveMessage', async (message) => {
    handleIncomingMessage(message, false);
  });

  socket.on('messageSent', (message) => {
    handleIncomingMessage(message, true);
  });

  socket.on('message:update', (message) => {
    handleMessageUpdated(message);
  });

  socket.on('reaction:update', (payload) => {
    applyIncomingReactionUpdate(payload);
  });

  socket.on('message:commit', (payload) => {
    commitRealtimeMessage(payload?.tempId, payload?.message);
  });

  socket.on('message:rollback', (payload) => {
    rollbackRealtimeMessage(payload);
  });

  socket.on('message:hidden', (payload) => {
    hideMessageLocally(payload?.messageId);
  });

  socket.on('messages:read', async (payload) => {
    if (!payload) {
      return;
    }

    if (
      payload.conversationType === 'direct' &&
      selectedUser &&
      !isGroupConversation(selectedUser) &&
      payload.userId === selectedUser.id
    ) {
      conversationMessages.forEach((message) => {
        if (
          message.senderId === currentUser.id &&
          message.receiverId === selectedUser.id &&
          new Date(message.createdAt).getTime() <=
          new Date(payload.readAt).getTime()
        ) {
          message.readAt = payload.readAt;
          message.readByCount = 1;
          replaceRenderedMessage(message);
        }
      });
      return;
    }

    if (
      payload.conversationType === 'group' &&
      selectedUser &&
      isGroupConversation(selectedUser) &&
      payload.groupId === selectedUser.id
    ) {
      await refreshSelectedConversation({ markRead: false });
    }
  });

  socket.on('conversation:refresh', async (payload) => {
    await loadUsers();
    if (selectedUser) {
      syncSelectedUser();
      if (
        !isGroupConversation(selectedUser) &&
        (!payload?.otherUserId || payload.otherUserId === selectedUser.id)
      ) {
        await loadChatPermission();
      }
      scheduleHeaderUpdate();
      if (!payload?.groupId || payload.groupId === selectedUser.id) {
        await refreshSelectedConversation({ markRead: false });
      }
    }
  });

  socket.on('typing', (payload) => {
    if (!payload?.fromUserId) return;
    const roomId = payload.groupId || payload.fromUserId;
    const roomTypingUsers = new Set(typingUsers.get(roomId) || []);
    if (payload.isTyping) {
      roomTypingUsers.add(payload.fromUserId);
    } else {
      roomTypingUsers.delete(payload.fromUserId);
    }
    if (roomTypingUsers.size) {
      typingUsers.set(roomId, roomTypingUsers);
    } else {
      typingUsers.delete(roomId);
    }

    scheduleHeaderUpdate();
  });

  socket.on('call:offer', (payload) => {
    handleIncomingCallOffer(payload);
  });

  socket.on('call:answer', async (payload) => {
    await handleCallAnswer(payload);
  });

  socket.on('call:ice', async (payload) => {
    await handleCallIce(payload);
  });

  socket.on('call:decline', (payload) => {
    handleCallDecline(payload);
  });

  socket.on('call:end', (payload) => {
    handleCallEnd(payload);
  });
}

function replaceCachedMessageIdentityEverywhere(tempId, message) {
  if (!message?.id) {
    return;
  }

  let changed = false;
  for (const state of conversationHistoryCache.values()) {
    const hadTemp = Boolean(tempId && state.conversationMessages.has(tempId));
    const hadReal = state.conversationMessages.has(message.id);
    if (!hadTemp && !hadReal) {
      continue;
    }

    if (hadTemp) {
      state.conversationMessages.delete(tempId);
      state.renderedMessageIds.delete(tempId);
    }

    state.conversationMessages.set(message.id, message);
    state.renderedMessageIds.add(message.id);
    state.fetchedAt = Date.now();
    changed = true;
  }

  if (changed) {
    schedulePersistConversationHistoryCache();
  }
}

function commitRealtimeMessage(tempId, message) {
  if (!message?.id) {
    return;
  }

  const hydratedMessage = createRenderableMessage(message);
  if (tempId && revealedSpoilerMessageIds.delete(tempId)) {
    revealedSpoilerMessageIds.add(hydratedMessage.id);
  }

  replaceCachedMessageIdentityEverywhere(tempId, hydratedMessage);
  cacheMessageForConversation(hydratedMessage);

  const tempElement = tempId
    ? document.getElementById(`message-${tempId}`)
    : null;
  const existingRealElement = document.getElementById(
    `message-${hydratedMessage.id}`,
  );
  const isActiveConversationMessage =
    belongsToSelectedConversation(hydratedMessage);

  if (tempId && messageReactionsById.has(tempId)) {
    const pendingReaction = messageReactionsById.get(tempId);
    messageReactionsById.delete(tempId);

    if (pendingReaction?.emoji) {
      messageReactionsById.set(hydratedMessage.id, pendingReaction);
      persistMessageReactions();

      if (socket?.connected && selectedUser) {
        socket.emit('reaction:update', {
          messageId: hydratedMessage.id,
          reaction: pendingReaction.emoji,
          groupId: isGroupConversation(selectedUser)
            ? selectedUser.id
            : undefined,
          toUserId: !isGroupConversation(selectedUser)
            ? selectedUser.id
            : undefined,
        });
      }
    }
  }

  if (tempId && conversationMessages.has(tempId)) {
    conversationMessages.delete(tempId);
    renderedMessageIds.delete(tempId);
  }
  if (tempId && tempId !== hydratedMessage.id) {
    renderedMessageIds.delete(tempId);
  }
  if (tempElement) {
    tempElement.remove();
  }

  if (existingRealElement || isActiveConversationMessage) {
    replaceRenderedMessage(hydratedMessage, {
      animate: false,
      stickToBottom: false,
    });

    if (hydratedMessage.senderId === currentUser?.id) {
      pulseMessageBubble(hydratedMessage.id);
    }
  }

  const chatUserId =
    hydratedMessage.groupId ||
    (hydratedMessage.senderId === currentUser?.id
      ? hydratedMessage.receiverId
      : hydratedMessage.senderId);
  updateRecentActivity(chatUserId, hydratedMessage, false);

  void hydrateAndRefreshMessage(hydratedMessage).catch((error) => {
    console.error('Failed to hydrate committed realtime message', error);
  });
}

function rollbackRealtimeMessage(payload) {
  const tempId = String(payload?.tempId || '');
  if (!tempId) {
    return;
  }

  hideMessageLocally(tempId);
  scheduleUsersRefreshInBackground({ delayMs: 0 });

  if (payload?.senderId && payload.senderId === currentUser?.id) {
    alert(payload.reason || 'Message failed to save.');
  }
}

async function handleIncomingMessage(message, isOwnMessage) {
  resolveOptimisticMessage(message, isOwnMessage);
  const hydratedMessage = createRenderableMessage(message);
  const chatUserId =
    message.groupId || (isOwnMessage ? message.receiverId : message.senderId);

  if (chatUserId && !users.some((user) => user.id === chatUserId)) {
    void loadUsers().catch((error) => {
      console.error(
        'Failed to refresh conversations for incoming message',
        error,
      );
    });
  }

  updateRecentActivity(
    chatUserId,
    hydratedMessage,
    !isOwnMessage && selectedUser?.id !== chatUserId,
  );

  if (!isOwnMessage && (!selectedUser || selectedUser.id !== chatUserId)) {
    maybeShowForegroundNotification(hydratedMessage);
  }

  if (selectedUser && belongsToSelectedConversation(hydratedMessage)) {
    queueConversationMessageRender(hydratedMessage, {
      stickToBottom: true,
      markRead: !isOwnMessage,
    });
    scheduleMessageContainerBottom(260);
  }

  cacheMessageForConversation(hydratedMessage);

  void hydrateAndRefreshMessage(hydratedMessage).catch((error) => {
    console.error('Failed to hydrate incoming message', error);
  });
}

async function selectUser(userId) {
  rememberActiveConversationScroll();
  const fallbackUser =
    getSearchUserPool().find((user) => user.id === userId) ||
    findKnownDirectUserById(userId);
  const matchedSidebarUser = users.find((user) => user.id === userId) || null;
  selectedUser = matchedSidebarUser || fallbackUser || null;
  detachedSelectedUser = Boolean(selectedUser && !matchedSidebarUser);

  if (!selectedUser) return;

  const requestedConversation = selectedUser;
  const requestedConversationKey = getConversationCacheKey(
    requestedConversation,
  );

  const conversationState = activateConversationHistory(selectedUser);

  if (
    !detachedSelectedUser &&
    !users.some((user) => user.id === selectedUser.id)
  ) {
    users = [selectedUser, ...users];
  }

  if (window.innerWidth < 1024) {
    closeSidebar();
  }

  const state = recentActivity.get(userId) || {
    lastAt: 0,
    preview: '',
    unread: 0,
  };
  const hadUnread = Boolean(state.unread);
  recentActivity.set(userId, { ...state, unread: 0 });
  schedulePersistChatShellCache();

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('chat-header').classList.remove('hidden');
  document.getElementById('chat-header').classList.add('flex');
  document.getElementById('message-container').classList.remove('hidden');
  document.getElementById('input-area').classList.remove('hidden');
  document.body.classList.add('chat-mode-active');
  document.getElementById('mobile-chat-topbar')?.classList.add('hidden');
  document.getElementById('messages-list').innerHTML = '';
  clearRecordedAudio();
  clearReplyTarget();
  resetSpecialMessageDraft();
  restoreComposerDraft(selectedUser);
  closeChatContactPanel();
  closeChatActionsMenu();
  closeComposerActionsMenu();
  triggerMotionClass(
    document.getElementById('chat-header'),
    'chat-chrome-enter',
  );
  triggerMotionClass(
    document.getElementById('input-area'),
    'chat-chrome-enter',
  );
  triggerMotionClass(
    document.getElementById('messages-list'),
    'chat-chrome-enter',
  );

  updateSelectedUserHeader();
  applyChatTheme();
  renderUsers();
  markConversationMissedCallsSeen(selectedUser);
  runConversationSearch();

  try {
    if (conversationState.initialized) {
      setMessageLoadingState(false);
      renderActiveConversationFromCache();
      const permissionPromise = loadChatPermission(requestedConversation);
      if (shouldRefreshConversationHistoryState(conversationState)) {
        void loadMessageChunk(null, false, {
          markRead: false,
          background: true,
          restoreScroll: true,
        }).catch((error) => {
          console.error('Failed to refresh cached conversation', error);
        });
      }
      await ensureScrollableHistory();
      retryConversationDecryption();
      if (hadUnread) {
        void markSelectedConversationRead();
      }
      await permissionPromise;
    } else {
      setMessageLoadingState(true);
      await Promise.all([
        loadChatPermission(requestedConversation),
        loadMessageChunk(),
      ]);
      await ensureScrollableHistory();
      retryConversationDecryption();
    }
  } catch (error) {
    if (
      isConversationStillActive(requestedConversation, requestedConversationKey)
    ) {
      setMessageLoadingState(false);
      alert(error.message || 'Failed to load this chat');
    }
    return;
  }

  if (
    !isConversationStillActive(requestedConversation, requestedConversationKey)
  ) {
    return;
  }

  if (!isFileOrigin) {
    const nextRoute = isGroupConversation(selectedUser)
      ? `/chat?group=${selectedUser.id}`
      : `/chat?chat=${selectedUser.id}`;
    writeSessionValue(LAST_CHAT_ROUTE_KEY, nextRoute);
    history.replaceState(null, '', nextRoute);
  }
}

async function loadMessageChunk(before = null, prepend = false, options = {}) {
  if (!selectedUser) {
    return;
  }

  const requestedConversation = selectedUser;
  const requestedConversationKey = getConversationCacheKey(
    requestedConversation,
  );
  if (
    options.background &&
    requestedConversationKey === activeConversationCacheKey
  ) {
    rememberActiveConversationScroll();
  }

  if (!prepend) {
    setMessageLoadingState(
      true,
      before ? 'Loading more messages...' : 'Loading messages...',
    );
  }

  try {
    const url = isGroupConversation(requestedConversation)
      ? before
        ? `/chat/messages?groupId=${encodeURIComponent(requestedConversation.id)}&before=${encodeURIComponent(before)}`
        : `/chat/messages?groupId=${encodeURIComponent(requestedConversation.id)}`
      : before
        ? `/chat/messages?userId=${encodeURIComponent(requestedConversation.id)}&before=${encodeURIComponent(before)}`
        : `/chat/messages?userId=${encodeURIComponent(requestedConversation.id)}`;
    const res = await api(url);
    const data = await readJsonResponse(
      res,
      {},
      'Failed to load messages. The server returned an invalid response.',
    );

    if (!res.ok) {
      throw new Error(data.message || 'Failed to load messages');
    }

    const messages = (data.messages || []).map((message) =>
      createRenderableMessage(message),
    );
    await warmMessageImageDimensions(messages);
    if (
      !isConversationStillActive(
        requestedConversation,
        requestedConversationKey,
      )
    ) {
      return;
    }

    const state = requestedConversationKey
      ? conversationHistoryCache.get(requestedConversationKey)
      : null;
    messagePagination.nextBefore = data.nextBefore || null;
    messagePagination.hasMore = Boolean(data.hasMore);
    messagePagination.loadedForUserId = requestedConversation.id;
    if (!prepend) {
      messagePagination.scrollReadyAt = Date.now() + 700;
    }
    if (state) {
      state.fetchedAt = Date.now();
      state.hydratedFromDisk = false;
    }

    if (data.conversation?.id) {
      const merged = normalizeUser(data.conversation, requestedConversation);
      users = users.map((user) => (user.id === merged.id ? merged : user));
      selectedUser = merged;
      groupDetailsCache.set(merged.id, merged);
    }

    if (prepend) {
      prependMessages(messages);
      hydrateMessagesInBackground(messages);
      runConversationSearch();
      if (state) {
        state.initialized = true;
      }
      schedulePersistConversationHistoryCache();
      return;
    }

    for (const message of messages) {
      updateRecentActivity(
        message.senderId === currentUser.id
          ? message.groupId || message.receiverId
          : message.senderId,
        message,
        false,
        { scheduleRender: false },
      );
    }

    if (state) {
      const mergedMessages = options.background
        ? new Map(state.conversationMessages)
        : new Map();
      for (const message of messages) {
        mergedMessages.set(message.id, message);
      }

      state.conversationMessages.clear();
      state.renderedMessageIds.clear();
      for (const message of sortMessagesChronologically(
        mergedMessages.values(),
      )) {
        state.conversationMessages.set(message.id, message);
      }
      state.initialized = true;
      if (!options.background) {
        state.scrollTop = null;
      }
      renderActiveConversationFromCache({
        restoreScroll:
          options.restoreScroll !== false && Boolean(options.background),
      });
    } else {
      appendMessages(messages, { stickToBottom: true });
    }

    hydrateMessagesInBackground(messages);
    scheduleRenderUsers();
    runConversationSearch();
    if (state) {
      state.initialized = true;
    }
    schedulePersistConversationHistoryCache();

    if (options.markRead !== false) {
      await markSelectedConversationRead();
    }
  } finally {
    if (
      isConversationStillActive(requestedConversation, requestedConversationKey)
    ) {
      setMessageLoadingState(false);
    }
  }
}

async function loadOlderMessages() {
  if (
    !selectedUser ||
    !messagePagination.hasMore ||
    !messagePagination.nextBefore ||
    messagePagination.loadingOlder ||
    messagePagination.loadedForUserId !== selectedUser.id
  ) {
    return;
  }

  const container = document.getElementById('message-container');
  const previousHeight = container.scrollHeight;
  messagePagination.loadingOlder = true;

  try {
    await loadMessageChunk(messagePagination.nextBefore, true);
    const nextHeight = container.scrollHeight;
    container.scrollTop = nextHeight - previousHeight + container.scrollTop;
  } catch (error) {
    alert(error.message || 'Failed to load older messages');
  } finally {
    messagePagination.loadingOlder = false;
    setMessageLoadingState(false);
  }
}

async function ensureScrollableHistory() {
  if (!selectedUser || messagePagination.loadedForUserId !== selectedUser.id) {
    return;
  }

  const container = document.getElementById('message-container');

  while (
    messagePagination.hasMore &&
    !messagePagination.loadingOlder &&
    messagePagination.loadedForUserId === selectedUser.id &&
    container.scrollHeight <= container.clientHeight + 24
  ) {
    await loadOlderMessages();
  }
}

async function handleMessageContainerScroll() {
  blockMessageActionsWhileScrolling();

  if (historyScrollFrame) {
    return;
  }

  historyScrollFrame = window.requestAnimationFrame(async () => {
    historyScrollFrame = 0;
    const container = getById('message-container');
    rememberActiveConversationScroll();
    if (Date.now() < (messagePagination.scrollReadyAt || 0)) {
      return;
    }
    if (container.scrollTop > 120) {
      return;
    }

    await loadOlderMessages();
  });
}

async function loadChatPermission(user = selectedUser) {
  if (!user) {
    return null;
  }

  if (isGroupConversation(user)) {
    const nextPermission = {
      canChat: true,
      acceptedRequestId: null,
      incomingRequestId: null,
      outgoingRequestId: null,
      blockedByMe: false,
      blockedByUser: false,
    };
    if (isSameConversation(user, selectedUser)) {
      chatPermission = nextPermission;
      updateChatAccessUI();
    }
    return nextPermission;
  }

  const res = await api(
    `/chat/permission?userId=${encodeURIComponent(user.id)}`,
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to load chat permission.',
  );

  let nextPermission;
  if (!res.ok) {
    nextPermission = {
      canChat: false,
      acceptedRequestId: null,
      incomingRequestId: null,
      outgoingRequestId: null,
      blockedByMe: false,
      blockedByUser: false,
    };
  } else {
    nextPermission = data;
  }

  if (isSameConversation(user, selectedUser)) {
    chatPermission = nextPermission;
    updateChatAccessUI();
  }

  return nextPermission;
}

async function ensureChatPermissionReady(user = selectedUser) {
  if (!user) {
    return false;
  }

  if (isGroupConversation(user)) {
    return true;
  }

  if (isSameConversation(user, selectedUser) && chatPermission.canChat) {
    return true;
  }

  const permission = await loadChatPermission(user);
  return Boolean(permission?.canChat);
}

function applyRequestActionProgressState(actionBtn, rejectBtn) {
  [actionBtn, rejectBtn].filter(Boolean).forEach((button) => {
    button.classList.remove('request-action-busy');
    button.classList.remove('cursor-wait');
  });

  if (!requestActionInFlight) {
    return;
  }

  actionBtn.disabled = true;
  rejectBtn.disabled = true;

  if (requestActionInFlight === 'send') {
    actionBtn.classList.remove('hidden');
    actionBtn.textContent = 'Sending...';
    actionBtn.classList.add('request-action-busy', 'cursor-wait');
    return;
  }

  if (requestActionInFlight === 'accept') {
    actionBtn.classList.remove('hidden');
    actionBtn.textContent = 'Accepting...';
    actionBtn.classList.add('request-action-busy', 'cursor-wait');
    rejectBtn.classList.remove('hidden');
    return;
  }

  rejectBtn.classList.remove('hidden');
  rejectBtn.textContent =
    requestActionInFlight === 'withdraw' ? 'Withdrawing...' : 'Rejecting...';
  rejectBtn.classList.add('request-action-busy', 'cursor-wait');
}

function pulseRequestActionSurface() {
  triggerMotionClass(
    getById('request-action-btn'),
    'request-action-success',
    460,
  );
  triggerMotionClass(
    getById('request-reject-btn'),
    'request-action-success',
    460,
  );
  triggerMotionClass(getById('chat-header'), 'chat-chrome-enter', 320);
}

function updateChatAccessUI() {
  const input = document.getElementById('msg-input');
  const fileInput = document.getElementById('file-input');
  const fileLabel = document.getElementById('share-file-label');
  const composerActionsBtn = document.getElementById('composer-actions-btn');
  const specialMessageClearBtn = document.getElementById(
    'special-message-clear-btn',
  );
  const composerTimeCapsuleBtn = document.getElementById(
    'composer-time-capsule-btn',
  );
  const composerSpoilerBtn = document.getElementById('composer-spoiler-btn');
  const timeCapsuleInput = document.getElementById('time-capsule-input');
  const timeCapsuleNoteInput = document.getElementById(
    'time-capsule-note-input',
  );
  const note = document.getElementById('chat-access-note');
  const panelNote = document.getElementById('chat-contact-panel-access-note');
  const headerActions = document.querySelector('.mobile-chat-header-actions');
  const headerShortcuts = document.getElementById('chat-header-shortcuts');
  const actionBtn = document.getElementById('request-action-btn');
  const rejectBtn = document.getElementById('request-reject-btn');
  const chatActionsBtn = document.getElementById('chat-actions-btn');
  const voiceCallBtn = document.getElementById('voice-call-btn');
  const videoCallBtn = document.getElementById('video-call-btn');
  const themeBtn = document.getElementById('contact-theme-btn');
  const clearThemeBtn = document.getElementById('contact-theme-clear-btn');
  const renameBtn = document.getElementById('contact-rename-btn');
  const blockBtn = document.getElementById('contact-block-btn');
  const blockLabel = document.getElementById('contact-block-btn-label');
  const blockCopy = document.getElementById('contact-block-btn-copy');
  const manageGroupBtn = document.getElementById('manage-group-btn');
  const panelManageGroupBtn = document.getElementById(
    'contact-manage-group-btn',
  );
  const voiceRecordBtn = document.getElementById('voice-record-btn');
  const voiceSendBtn = document.getElementById('voice-send-btn');
  const sendBtn = document.getElementById('send-message-btn');
  const gatedButtons = [
    composerActionsBtn,
    voiceCallBtn,
    videoCallBtn,
    themeBtn,
    clearThemeBtn,
    renameBtn,
    voiceRecordBtn,
    voiceSendBtn,
    sendBtn,
    specialMessageClearBtn,
    composerTimeCapsuleBtn,
    composerSpoilerBtn,
  ].filter(Boolean);

  const applyGatedState = (enabled) => {
    input.disabled = !enabled;
    fileInput.disabled = !enabled;
    fileLabel.classList.toggle('pointer-events-none', !enabled);
    fileLabel.classList.toggle('opacity-50', !enabled);

    if (!enabled) {
      closeComposerActionsMenu();
    }

    for (const button of gatedButtons) {
      button.disabled = !enabled;
      button.classList.toggle('opacity-50', !enabled);
      button.classList.toggle('cursor-not-allowed', !enabled);
    }

    [timeCapsuleInput, timeCapsuleNoteInput]
      .filter(Boolean)
      .forEach((field) => {
        field.disabled = !enabled;
        field.classList.toggle('opacity-60', !enabled);
        field.classList.toggle('cursor-not-allowed', !enabled);
      });

    if (composerSendInFlight) {
      setComposerSendingState(true);
    }
  };

  const syncHeaderActionsVisibility = () => {
    headerActions?.classList.toggle(
      'hidden',
      actionBtn.classList.contains('hidden') &&
      rejectBtn.classList.contains('hidden'),
    );
  };

  const setAccessNote = (message = '') => {
    const hasMessage = Boolean(message);
    note.classList.toggle('hidden', !hasMessage);
    panelNote?.classList.toggle('hidden', !hasMessage);
    note.textContent = hasMessage ? message : '';

    if (panelNote) {
      panelNote.textContent = hasMessage ? message : '';
    }
  };

  const finalizeAccessUI = () => {
    applyRequestActionProgressState(actionBtn, rejectBtn);
    syncHeaderActionsVisibility();
    updateChatContactPanel();
  };

  const isGroup = Boolean(selectedUser && isGroupConversation(selectedUser));

  actionBtn.classList.add('hidden');
  rejectBtn.classList.add('hidden');
  actionBtn.disabled = false;
  setAccessNote('');
  blockBtn?.classList.toggle('hidden', !selectedUser || isGroup);
  manageGroupBtn?.classList.toggle('hidden', !isGroup);
  panelManageGroupBtn?.classList.toggle('hidden', !isGroup);
  renameBtn?.classList.toggle('hidden', isGroup);
  themeBtn?.classList.toggle('hidden', isGroup);
  clearThemeBtn?.classList.toggle(
    'hidden',
    isGroup || !selectedUser?.chatTheme,
  );
  voiceCallBtn?.classList.toggle('hidden', !selectedUser || isGroup);
  videoCallBtn?.classList.toggle('hidden', !selectedUser || isGroup);
  headerShortcuts?.classList.toggle('hidden', !selectedUser || isGroup);

  if (!selectedUser) {
    applyGatedState(false);
    chatActionsBtn?.classList.add('opacity-50', 'cursor-not-allowed');
    if (chatActionsBtn) {
      chatActionsBtn.disabled = true;
    }
    finalizeAccessUI();
    return;
  }

  chatActionsBtn?.classList.remove('opacity-50', 'cursor-not-allowed');
  if (chatActionsBtn) {
    chatActionsBtn.disabled = false;
  }

  if (isGroup) {
    blockBtn?.classList.add('hidden');
    applyGatedState(true);
    finalizeAccessUI();
    return;
  }

  blockBtn?.classList.remove('hidden');

  if (blockBtn && blockLabel && blockCopy) {
    const isBlockedByMe = Boolean(chatPermission.blockedByMe);
    blockLabel.innerText = isBlockedByMe ? 'Unblock user' : 'Block user';
    blockCopy.innerText = isBlockedByMe
      ? 'Allow them again, but a new chat request will still be needed.'
      : 'Stop chat access until you unblock them.';
    blockBtn.classList.toggle('border-rose-200', !isBlockedByMe);
    blockBtn.classList.toggle('bg-rose-50', !isBlockedByMe);
    blockBtn.classList.toggle('hover:bg-rose-100', !isBlockedByMe);
    blockBtn.classList.toggle('border-emerald-200', isBlockedByMe);
    blockBtn.classList.toggle('bg-emerald-50', isBlockedByMe);
    blockBtn.classList.toggle('hover:bg-emerald-100', isBlockedByMe);
    blockLabel.classList.toggle('text-rose-600', !isBlockedByMe);
    blockLabel.classList.toggle('text-emerald-600', isBlockedByMe);
    blockCopy.classList.toggle('text-rose-500', !isBlockedByMe);
    blockCopy.classList.toggle('text-emerald-500', isBlockedByMe);
  }

  if (chatPermission.blockedByMe) {
    applyGatedState(false);
    setAccessNote(
      `You blocked ${displayName(selectedUser)}. Unblock them to chat again.`,
    );
    finalizeAccessUI();
    return;
  }

  if (chatPermission.blockedByUser) {
    applyGatedState(false);
    setAccessNote(`${displayName(selectedUser)} has blocked you.`);
    finalizeAccessUI();
    return;
  }

  if (chatPermission.canChat) {
    applyGatedState(true);
    finalizeAccessUI();
    return;
  }

  applyGatedState(false);

  if (chatPermission.incomingRequestId) {
    actionBtn.textContent = 'Accept Request';
    actionBtn.classList.remove('hidden');
    rejectBtn.classList.remove('hidden');
    rejectBtn.textContent = 'Reject';
    setAccessNote(`${displayName(selectedUser)} sent you a chat request.`);
    finalizeAccessUI();
    return;
  }

  if (chatPermission.outgoingRequestId) {
    actionBtn.textContent = 'Request Pending';
    actionBtn.classList.remove('hidden');
    actionBtn.disabled = true;
    rejectBtn.classList.remove('hidden');
    rejectBtn.textContent = 'Withdraw';
    setAccessNote(
      `Waiting for ${displayName(selectedUser)} to accept your request.`,
    );
    finalizeAccessUI();
    return;
  }

  actionBtn.textContent = 'Send Request';
  actionBtn.classList.remove('hidden');
  actionBtn.disabled = false;
  setAccessNote('Send a request before starting this chat.');
  finalizeAccessUI();
}

async function toggleBlockedUser() {
  if (!selectedUser || isGroupConversation(selectedUser)) {
    return;
  }

  const targetUserId = selectedUser.id;
  const isBlockedByMe = Boolean(chatPermission.blockedByMe);
  const confirmed = window.confirm(
    isBlockedByMe
      ? `Unblock ${displayName(selectedUser)}? They will need a fresh chat request before chatting again.`
      : `Block ${displayName(selectedUser)}? Current chat access will be removed until a new request is sent after unblocking.`,
  );
  if (!confirmed) {
    return;
  }

  const res = await api(
    isBlockedByMe ? '/users/blocks/remove' : '/users/blocks',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUser.id }),
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    isBlockedByMe ? 'Failed to unblock user.' : 'Failed to block user.',
  );

  if (!res.ok) {
    alert(
      data.message ||
      (isBlockedByMe ? 'Failed to unblock user' : 'Failed to block user'),
    );
    return;
  }

  if (!isBlockedByMe) {
    resetSelectedConversation();
  }

  await Promise.all([
    loadUsers(),
    loadPeopleDirectory(true),
    loadBlockedUsers().catch((error) => {
      console.error('Failed to refresh blocked users', error);
    }),
  ]);
  scheduleRenderUsers();
  if (isBlockedByMe) {
    const restoredUser =
      users.find((user) => user.id === targetUserId) ||
      peopleDirectory.find((user) => user.id === targetUserId) ||
      null;
    if (restoredUser) {
      selectedUser = restoredUser;
      await loadChatPermission();
      syncSelectedUser();
      updateSelectedUserHeader();
    }
  }
  alert(data.message || (isBlockedByMe ? 'User unblocked.' : 'User blocked.'));
}

function updateSelectedUserHeader() {
  if (!selectedUser) return;
  getById('target-name').innerText = displayName(selectedUser);
  getById('target-avatar').src = userAvatar(selectedUser);
  getById('target-avatar').alt = `${displayName(selectedUser)} profile photo`;
  attachImageFallback(getById('target-avatar'));
  applyChatTheme();
  const statusMeta = getSelectedUserStatusMeta(selectedUser);
  getById('target-status').innerText = statusMeta.text;
  getById('target-status').className = statusMeta.className;
  updateChatContactPanel();
}

function getMessagePreview(message) {
  if (message.deletedForEveryoneAt) {
    return 'Message deleted';
  }
  if (message.messageType === 'IMAGE') {
    return 'Photo';
  }
  if (message.messageType === 'AUDIO') {
    return 'Voice message';
  }
  if (String(message.fileMimeType || '').startsWith('video/')) {
    return 'Video';
  }
  if (message.messageType === 'DOCUMENT') {
    return message.fileName ? `File: ${message.fileName}` : 'Document';
  }
  return getResolvedMessageText(message);
}

function belongsToSelectedConversation(message) {
  if (!selectedUser || !message) {
    return false;
  }

  if (isGroupConversation(selectedUser)) {
    return message.groupId === selectedUser.id;
  }

  return (
    (message.senderId === currentUser.id &&
      message.receiverId === selectedUser.id) ||
    (message.senderId === selectedUser.id &&
      message.receiverId === currentUser.id)
  );
}

function replaceRenderedMessage(message, options = {}) {
  if (!message?.id) {
    return;
  }

  const shouldStickToBottom =
    options.stickToBottom &&
    (Date.now() <= stickToLatestUntil || isMessageContainerNearBottom());

  updateCachedMessageEverywhere(message);
  const result = renderMessageInConversationOrder(message, {
    animate: options.animate === true,
  });
  if (!result.rendered) {
    return;
  }

  scheduleStructuredMessageRefresh();
  if (shouldStickToBottom) {
    scheduleMessageContainerBottom();
  }
}

function hideMessageLocally(messageId) {
  if (!messageId) {
    return;
  }

  if (starredMessagesById.delete(messageId)) {
    persistStarredMessages();
  }
  if (messageReactionsById.delete(messageId)) {
    persistMessageReactions();
  }
  removeCachedMessageEverywhere(messageId);
  renderedMessageIds.delete(messageId);
  conversationMessages.delete(messageId);
  revealedSpoilerMessageIds.delete(messageId);
  document.getElementById(`message-${messageId}`)?.remove();
  scheduleStructuredMessageRefresh();
  renderStarredMessages();
  renderSidebarStarredHub();
}

function handleMessageUpdated(message) {
  if (!message?.id) {
    return;
  }

  updateCachedMessageEverywhere(message);
  if (isMessageStarred(message.id)) {
    starredMessagesById.set(message.id, buildStarredMessageEntry(message));
    persistStarredMessages();
  }
  if (!belongsToSelectedConversation(message)) {
    updateRecentActivity(
      message.groupId ||
      (message.senderId === currentUser.id
        ? message.receiverId
        : message.senderId),
      message,
      false,
    );
    return;
  }

  replaceRenderedMessage(message);
  updateRecentActivity(
    message.groupId ||
    (message.senderId === currentUser.id
      ? message.receiverId
      : message.senderId),
    message,
    false,
  );
}

async function refreshSelectedConversation(options = {}) {
  if (!selectedUser) {
    return;
  }

  replaceConversationHistoryState(selectedUser);
  document.getElementById('messages-list').innerHTML = '';
  setMessageLoadingState(true);
  await loadMessageChunk(null, false, options);
}

async function markSelectedConversationRead() {
  if (!selectedUser) {
    return;
  }

  const body = isGroupConversation(selectedUser)
    ? { groupId: selectedUser.id }
    : { otherUserId: selectedUser.id };

  await api('/chat/messages/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function scheduleSelectedConversationRead(delayMs = 160) {
  if (!selectedUser) {
    return;
  }

  const conversationKey = getConversationCacheKey(selectedUser);
  if (!conversationKey) {
    return;
  }

  if (scheduledConversationReadTimer) {
    clearTimeout(scheduledConversationReadTimer);
  }

  scheduledConversationReadTimer = window.setTimeout(() => {
    scheduledConversationReadTimer = 0;
    if (getConversationCacheKey(selectedUser) !== conversationKey) {
      return;
    }

    void markSelectedConversationRead().catch((error) => {
      console.error('Failed to mark selected conversation as read', error);
    });
  }, delayMs);
}

function updateRecentActivity(userId, message, incrementUnread, options = {}) {
  const current = recentActivity.get(userId) || {
    lastAt: 0,
    preview: '',
    unread: 0,
  };
  const messageTime = new Date(message.createdAt || Date.now()).getTime();
  const shouldAdvancePreview =
    messageTime >= current.lastAt || !current.preview;
  recentActivity.set(userId, {
    lastAt: shouldAdvancePreview ? messageTime : current.lastAt,
    preview: shouldAdvancePreview
      ? getMessagePreview(message)
      : current.preview,
    unread: incrementUnread ? current.unread + 1 : current.unread,
  });
  if (options.scheduleRender !== false) {
    scheduleRenderUsers();
  }
  schedulePersistChatShellCache();
}

function bumpConversationForRequest(userId, preview, incrementUnread = false) {
  if (!userId) {
    return;
  }

  const current = recentActivity.get(userId) || {
    lastAt: 0,
    preview: '',
    unread: 0,
  };

  recentActivity.set(userId, {
    lastAt: Date.now(),
    preview: preview || current.preview || 'Sent you a chat request',
    unread: incrementUnread ? current.unread + 1 : current.unread,
  });
  scheduleRenderUsers();
  schedulePersistChatShellCache();
}

function queueOfflineTextMessage(user, text, structuredOptions = {}) {
  const queueOptions =
    structuredOptions && typeof structuredOptions === 'object'
      ? structuredOptions.__queueOptions || null
      : null;
  const rawText = String(text || '');
  const trimmed = rawText.trim();
  const encodedMode = Boolean(queueOptions?.encoded);
  if (!user || !(encodedMode ? rawText : trimmed)) {
    return false;
  }

  if (
    queueOptions?.realtimeId &&
    offlineQueuedMessages.some(
      (item) => item.realtimeId && item.realtimeId === queueOptions.realtimeId,
    )
  ) {
    syncChatSendStatus();
    return true;
  }

  const encodedText = encodedMode
    ? rawText
    : encodeMessageForSend(trimmed, structuredOptions);
  offlineQueuedMessages.push({
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    realtimeId: queueOptions?.realtimeId || '',
    conversationId: user.id,
    chatType: isGroupConversation(user) ? 'group' : 'direct',
    text: encodedText,
    createdAt: queueOptions?.createdAt || new Date().toISOString(),
  });
  persistOfflineQueuedMessages();
  const sendStatus = getById('chat-send-status');
  if (sendStatus) {
    sendStatus.textContent = `${offlineQueuedMessages.length} message${offlineQueuedMessages.length === 1 ? '' : 's'
      } queued offline. They will send when you reconnect.`;
    sendStatus.classList.remove('hidden');
  }
  return true;
}

async function flushOfflineQueuedMessages() {
  if (!socket || !offlineQueuedMessages.length) {
    return;
  }

  const pending = [...offlineQueuedMessages];
  const nextQueue = [];
  for (const item of pending) {
    try {
      const targetUser = users.find((user) => user.id === item.conversationId);
      if (!targetUser) {
        nextQueue.push(item);
        continue;
      }

      if (item.realtimeId) {
        setOptimisticMessagePendingState(item.realtimeId, 'sending');
      }

      const encryptedPayload = await encryptTextForConversation(
        item.text,
        targetUser,
      );
      await emitSocketEvent('sendMessage', {
        ...(item.realtimeId ? { realtimeId: item.realtimeId } : {}),
        ...encryptedPayload,
        ...(item.chatType === 'group'
          ? { groupId: item.conversationId }
          : { toUserId: item.conversationId }),
      });
    } catch (error) {
      console.error('Failed to flush offline queued message', error);
      nextQueue.push(item);
    }
  }

  offlineQueuedMessages = nextQueue;
  persistOfflineQueuedMessages();
  syncChatSendStatus();
}

function isRecoverableOutgoingMessageQueueError(error) {
  if (!error) {
    return false;
  }

  if (!navigator.onLine || !socket?.connected) {
    return true;
  }

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('realtime connection') ||
    message.includes('timed out') ||
    message.includes('network')
  );
}

function enqueueOutgoingTextMessage(task) {
  if (!task?.optimisticMessageId || !task?.structuredText) {
    return;
  }

  queuedOutgoingTextMessages.push(task);
  syncChatSendStatus();
  void processOutgoingTextMessageQueue().catch((error) => {
    console.error('Failed to process outgoing text message queue', error);
  });
}

async function processOutgoingTextMessageQueue() {
  if (outgoingTextQueueProcessing) {
    return;
  }

  outgoingTextQueueProcessing = true;
  try {
    while (queuedOutgoingTextMessages.length) {
      activeOutgoingTextMessage = queuedOutgoingTextMessages.shift() || null;
      if (!activeOutgoingTextMessage) {
        continue;
      }

      syncChatSendStatus();
      setOptimisticMessagePendingState(
        activeOutgoingTextMessage.optimisticMessageId,
        'sending',
      );

      try {
        const conversationTarget =
          users.find((user) => user.id === activeOutgoingTextMessage.userId) ||
          activeOutgoingTextMessage.conversationTarget;
        const canChat = await ensureChatPermissionReady(conversationTarget);
        if (!canChat) {
          throw new Error('Accept a chat request before sending messages.');
        }

        if (!navigator.onLine || !socket?.connected) {
          throw new Error('Realtime connection is not available.');
        }

        const encryptedPayload = await encryptTextForConversation(
          activeOutgoingTextMessage.structuredText,
          conversationTarget,
        );

        if (!navigator.onLine || !socket?.connected) {
          throw new Error('Realtime connection is not available.');
        }

        await emitSocketEvent('sendMessage', {
          realtimeId: activeOutgoingTextMessage.optimisticMessageId,
          ...encryptedPayload,
          ...(activeOutgoingTextMessage.chatType === 'group'
            ? { groupId: activeOutgoingTextMessage.userId }
            : { toUserId: activeOutgoingTextMessage.userId }),
        });
      } catch (error) {
        if (isRecoverableOutgoingMessageQueueError(error)) {
          queueOfflineTextMessage(
            activeOutgoingTextMessage.conversationTarget,
            activeOutgoingTextMessage.structuredText,
            {
              __queueOptions: {
                encoded: true,
                realtimeId: activeOutgoingTextMessage.optimisticMessageId,
                createdAt: activeOutgoingTextMessage.createdAt,
              },
            },
          );
          setOptimisticMessagePendingState(
            activeOutgoingTextMessage.optimisticMessageId,
            'queued-offline',
          );
        } else {
          clearDraftSubmissionGuard(activeOutgoingTextMessage.draftFingerprint);
          lastSubmittedDraftVersion = -1;
          removeOptimisticMessage(
            activeOutgoingTextMessage.optimisticMessageId,
          );
          removePendingOptimisticMessageId(
            activeOutgoingTextMessage.roomId,
            activeOutgoingTextMessage.optimisticMessageId,
          );
          if (
            activeOutgoingTextMessage.rawText &&
            selectedConversationRoomId() === activeOutgoingTextMessage.roomId &&
            !getById('msg-input')?.value.trim()
          ) {
            getById('msg-input').value = activeOutgoingTextMessage.rawText;
            saveConversationDraft(
              activeOutgoingTextMessage.conversationTarget,
              activeOutgoingTextMessage.rawText,
            );
          }
          alert(error?.message || 'Failed to send message');
        }
      } finally {
        activeOutgoingTextMessage = null;
        syncChatSendStatus();
      }
    }
  } finally {
    outgoingTextQueueProcessing = false;
    syncChatSendStatus();
  }
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!selectedUser || composerSendInFlight) return;

  const conversationTarget = selectedUser;
  const selectedConversationKey = getConversationCacheKey(conversationTarget)
    ? `${isGroupConversation(conversationTarget) ? 'group' : 'direct'}:${conversationTarget.id}`
    : null;
  const pendingAttachmentCount = attachmentUploadTasks.filter(
    (task) =>
      task.status === 'pending-send' &&
      getAttachmentTaskConversationKey(task) === selectedConversationKey,
  ).length;
  const voiceFile = recordedAudioFile;
  let structuredSendOptions = null;
  let structuredText = '';
  if (text) {
    try {
      structuredSendOptions = buildComposerStructuredSendOptions();
      structuredText = encodeMessageForSend(text, structuredSendOptions);
    } catch (error) {
      alert(error?.message || 'Special message settings are invalid.');
      return;
    }
  }
  const shouldTrackDraftSubmission = Boolean(text || voiceFile);
  const draftFingerprint = shouldTrackDraftSubmission
    ? buildDraftFingerprint({
      roomId: selectedConversationRoomId(conversationTarget),
      text: structuredText || text,
      attachmentFile: null,
      voiceFile,
    })
    : '';

  if (!text && !voiceFile && !pendingAttachmentCount) {
    return;
  }

  if (
    shouldTrackDraftSubmission &&
    composerDraftVersion === lastSubmittedDraftVersion
  ) {
    return;
  }

  if (
    shouldTrackDraftSubmission &&
    shouldSkipDuplicateDraft(draftFingerprint)
  ) {
    return;
  }

  const optimisticMessage = text
    ? createOptimisticTextMessage(
      text,
      conversationTarget,
      structuredSendOptions,
      !navigator.onLine || !socket?.connected ? 'queued-offline' : 'queued',
    )
    : null;
  let textHandedOff = false;

  try {
    if (shouldTrackDraftSubmission) {
      markDraftSubmitted(draftFingerprint);
      lastSubmittedDraftVersion = composerDraftVersion;
    }

    if (optimisticMessage) {
      queueOptimisticMessage(optimisticMessage, conversationTarget);
      appendMessage(optimisticMessage, { stickToBottom: true });
      updateRecentActivity(
        optimisticMessage.groupId || optimisticMessage.receiverId,
        optimisticMessage,
        false,
      );
      input.value = '';
      clearConversationDraft(conversationTarget);
      const focusInput = () => {
        try {
          input.focus({ preventScroll: true });
          input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (error) {
          input.focus();
        }
      };
      window.requestAnimationFrame(() => {
        focusInput();
      });
      window.setTimeout(focusInput, 80);
    }

    if (text) {
      enqueueOutgoingTextMessage({
        optimisticMessageId: optimisticMessage?.id,
        roomId: selectedConversationRoomId(conversationTarget),
        userId: conversationTarget.id,
        chatType: isGroupConversation(conversationTarget) ? 'group' : 'direct',
        rawText: text,
        structuredText,
        createdAt: optimisticMessage?.createdAt || new Date().toISOString(),
        draftFingerprint,
        conversationTarget,
      });
      textHandedOff = true;
    }

    clearOutgoingTypingState();

    const queuedAttachments = queuePendingAttachmentUploads(
      selectedConversationKey,
    );
    if (queuedAttachments > 0) {
      void processAttachmentUploadQueue();
    }

    if (voiceFile) {
      setComposerSendingState(true, 'Uploading');
      try {
        const uploadedVoiceMessage = await uploadAttachment(
          voiceFile,
          conversationTarget,
        );
        await handleIncomingMessage(uploadedVoiceMessage, true);
        clearRecordedAudio();
      } finally {
        setComposerSendingState(false);
      }
    }
    if (text) {
      clearReplyTarget();
      resetSpecialMessageDraft();
    }
  } catch (error) {
    if (shouldTrackDraftSubmission) {
      clearDraftSubmissionGuard(draftFingerprint);
      lastSubmittedDraftVersion = -1;
    }
    if (optimisticMessage && !textHandedOff) {
      removeOptimisticMessage(optimisticMessage.id);
      const roomId = optimisticMessage.groupId || optimisticMessage.receiverId;
      removePendingOptimisticMessageId(roomId, optimisticMessage.id);
      if (!input.value.trim()) {
        input.value = text;
      }
    }
    alert(error.message || 'Failed to send message');
  }
}

async function uploadAttachment(file, user = selectedUser) {
  if (!user) {
    throw new Error('No chat selected');
  }

  const canChat = await ensureChatPermissionReady(user);
  if (!canChat) {
    throw new Error('Accept a chat request before sharing files');
    return;
  }

  const formData = buildAttachmentUploadFormData(
    file,
    buildUploadConversationTarget(user),
  );
  const sendStatus = document.getElementById('chat-send-status');

  if (sendStatus) {
    sendStatus.classList.remove('hidden');
    sendStatus.innerText = `Uploading ${formatUploadProgress(0, file.size)}...`;
  }

  const data = await uploadFormDataWithProgress(
    '/chat/attachments',
    formData,
    (loaded, total) => {
      const progressText = formatUploadProgress(loaded, total);
      if (sendStatus) {
        sendStatus.classList.remove('hidden');
        sendStatus.innerText = `Uploading ${progressText}...`;
      }
    },
  );

  if (sendStatus) {
    sendStatus.classList.remove('hidden');
    sendStatus.innerText = 'Upload complete. Sending...';
  }

  return createRenderableMessage(data);
}

async function handleRequestAction() {
  if (!selectedUser) return;

  if (chatPermission.incomingRequestId) {
    requestActionInFlight = 'accept';
    updateChatAccessUI();
    try {
      const res = await api('/chat/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: chatPermission.incomingRequestId,
        }),
      });
      const data = await readJsonResponse(
        res,
        {},
        'Failed to accept the chat request.',
      );
      if (!res.ok) {
        alert(data.message || 'Failed to accept request');
        return;
      }
      await loadChatPermission();
      pulseRequestActionSurface();
      return;
    } finally {
      requestActionInFlight = '';
      updateChatAccessUI();
    }
  }

  if (chatPermission.outgoingRequestId) {
    return;
  }

  requestActionInFlight = 'send';
  updateChatAccessUI();
  try {
    const res = await api('/chat/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverEmail: selectedUser.email }),
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to send the chat request.',
    );
    if (!res.ok) {
      alert(data.message || 'Failed to send request');
      return;
    }
    await loadChatPermission();
    pulseRequestActionSurface();
  } finally {
    requestActionInFlight = '';
    updateChatAccessUI();
  }
}

async function rejectIncomingRequest() {
  const requestId =
    chatPermission.incomingRequestId || chatPermission.outgoingRequestId;
  if (!requestId) return;

  const isOutgoing = Boolean(chatPermission.outgoingRequestId);
  const endpoint = isOutgoing ? '/chat/withdraw' : '/chat/reject';
  requestActionInFlight = isOutgoing ? 'withdraw' : 'reject';
  updateChatAccessUI();
  try {
    const res = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    });
    const data = await readJsonResponse(
      res,
      {},
      isOutgoing
        ? 'Failed to withdraw the chat request.'
        : 'Failed to reject the chat request.',
    );
    if (!res.ok) {
      alert(
        data.message ||
        (isOutgoing
          ? 'Failed to withdraw request'
          : 'Failed to reject request'),
      );
      return;
    }
    await loadChatPermission();
    pulseRequestActionSurface();
  } finally {
    requestActionInFlight = '';
    updateChatAccessUI();
  }
}

async function openCreateGroupModal() {
  await loadUsers();
  const container = document.getElementById('create-group-members');
  const candidates = getAcceptedGroupCandidates();
  document.getElementById('create-group-name').value = '';
  document.getElementById('create-group-avatar-input').value = '';
  syncGroupAvatarLabel(
    'create-group-avatar-input',
    'create-group-avatar-name',
    'No photo selected',
  );
  container.innerHTML = candidates.length
    ? candidates
      .map(
        (user) => `
                <label class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 transition hover:border-slate-300 hover:bg-slate-50">
                  <input type="checkbox" value="${user.id}" class="h-4 w-4 rounded border-slate-300">
                  <img src="${userAvatar(user)}" alt="${escapeHtml(displayName(user))} profile photo" width="40" height="40" class="h-10 w-10 rounded-xl object-cover">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(displayName(user))}</p>
                    <p class="truncate text-xs text-slate-500">${escapeHtml(user.email || '')}</p>
                  </div>
                </label>
              `,
      )
      .join('')
    : renderEmptyGroupCandidateState(
      'Only accepted one-to-one chats appear here. Accept a chat request first, then create the group.',
    );
  document.getElementById('create-group-modal').classList.remove('hidden');
  document.getElementById('create-group-modal').classList.add('flex');
}

function closeCreateGroupModal(event) {
  if (event && event.target.id !== 'create-group-modal') {
    return;
  }
  document.getElementById('create-group-modal').classList.add('hidden');
  document.getElementById('create-group-modal').classList.remove('flex');
}

async function createGroup() {
  const name = document.getElementById('create-group-name').value.trim();
  const checks = Array.from(
    document.querySelectorAll(
      '#create-group-members input[type="checkbox"]:checked',
    ),
  );
  const memberIds = checks.map((input) => input.value);
  const avatarInput = document.getElementById('create-group-avatar-input');
  const formData = new FormData();
  formData.append('name', name);
  formData.append('memberIds', JSON.stringify(memberIds));
  if (avatarInput.files && avatarInput.files[0]) {
    formData.append('avatar', avatarInput.files[0]);
  }

  const res = await api('/chat/groups', {
    method: 'POST',
    body: formData,
  });
  const data = await readJsonResponse(res, {}, 'Failed to create group.');
  if (!res.ok) {
    alert(data.message || 'Failed to create group');
    return;
  }

  closeCreateGroupModal();
  await loadUsers();
  await selectUser(data.id);
}

async function respondToGroupInvite(inviteId, acceptInvite) {
  const res = await api(
    acceptInvite
      ? '/chat/groups/invites/accept'
      : '/chat/groups/invites/reject',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to respond to the group invite.',
  );
  if (!res.ok) {
    alert(data.message || 'Failed to respond to invite');
    return;
  }

  await loadUsers();
  if (acceptInvite && data.id) {
    await selectUser(data.id);
  }
}

async function openManageGroupModal() {
  if (!selectedUser || !isGroupConversation(selectedUser)) {
    return;
  }

  await loadUsers();

  const res = await api(`/chat/groups/${encodeURIComponent(selectedUser.id)}`);
  const data = await readJsonResponse(res, {}, 'Failed to load group details.');
  if (!res.ok) {
    alert(data.message || 'Failed to load group details');
    return;
  }

  const merged = normalizeUser({ ...data, chatType: 'group' }, selectedUser);
  groupDetailsCache.set(merged.id, merged);
  users = users.map((user) => (user.id === merged.id ? merged : user));
  selectedUser = merged;
  document.getElementById('manage-group-title').innerText =
    merged.name || 'Manage group';
  document.getElementById('manage-group-name').value = merged.name || '';
  manageGroupAvatarShouldClear = false;
  document.getElementById('manage-group-avatar-input').value = '';
  document.getElementById('manage-group-avatar-name').innerText = merged.avatar
    ? 'Current photo saved'
    : 'No photo selected';
  const adminCount = (merged.members || []).filter(
    (member) => member.role === 'ADMIN',
  ).length;
  document.getElementById('manage-group-leave-note').innerText =
    merged.role === 'ADMIN'
      ? adminCount <= 1 && (merged.members || []).length > 1
        ? 'If you leave now, another remaining member will automatically become admin.'
        : 'You are an admin. You can promote members or leave the group at any time.'
      : 'You can leave this group at any time.';

  const memberIds = new Set(
    (merged.members || []).map((member) => member.userId),
  );
  const pendingIds = new Set(
    (merged.pendingInvites || []).map((invite) => invite.invitedUserId),
  );
  document.getElementById('manage-group-members').innerHTML = (
    merged.members || []
  )
    .map(
      (member) => `
              <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <img src="${userAvatar(member)}" alt="${escapeHtml(displayName(member))} profile photo" width="40" height="40" class="h-10 w-10 rounded-xl object-cover">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(member.name)}</p>
                  <p class="truncate text-xs text-slate-500">${escapeHtml(member.role)}${member.userId === currentUser.id ? ' · You' : ''}</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  ${merged.role === 'ADMIN' &&
          member.userId !== currentUser.id &&
          member.role !== 'ADMIN'
          ? `<button onclick="makeGroupAdmin('${member.userId}')" class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100">Make Admin</button>`
          : ''
        }
                  ${merged.role === 'ADMIN' && member.userId !== currentUser.id
          ? `<button onclick="removeMemberFromGroup('${member.userId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Remove</button>`
          : ''
        }
                </div>
              </div>
            `,
    )
    .join('');

  const inviteCandidates = getAcceptedGroupCandidates().filter(
    (person) => !memberIds.has(person.id),
  );
  document.getElementById('manage-group-candidates').innerHTML =
    inviteCandidates.length
      ? inviteCandidates
        .map(
          (person) => `
                  <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <img src="${userAvatar(person)}" alt="${escapeHtml(displayName(person))} profile photo" width="40" height="40" class="h-10 w-10 rounded-xl object-cover">
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(displayName(person))}</p>
                      <p class="truncate text-xs text-slate-500">${escapeHtml(person.email || '')}</p>
                    </div>
                    <button
                      onclick="inviteUserToGroup('${person.id}')"
                      class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      ${selectedUser.role !== 'ADMIN' || pendingIds.has(person.id) ? 'disabled' : ''}
                    >
                      ${pendingIds.has(person.id) ? 'Pending' : 'Invite'}
                    </button>
                  </div>
                `,
        )
        .join('')
      : renderEmptyGroupCandidateState(
        'Only accepted chat contacts can be invited here.',
      );

  document.getElementById('manage-group-modal').classList.remove('hidden');
  document.getElementById('manage-group-modal').classList.add('flex');
}

function closeManageGroupModal(event) {
  if (event && event.target.id !== 'manage-group-modal') {
    return;
  }
  document.getElementById('manage-group-modal').classList.add('hidden');
  document.getElementById('manage-group-modal').classList.remove('flex');
}

function clearManageGroupAvatar() {
  manageGroupAvatarShouldClear = true;
  document.getElementById('manage-group-avatar-input').value = '';
  document.getElementById('manage-group-avatar-name').innerText =
    'Photo will be removed when you save';
}

async function saveGroupSettings() {
  if (!selectedUser || !isGroupConversation(selectedUser)) {
    return;
  }

  const formData = new FormData();
  formData.append(
    'name',
    document.getElementById('manage-group-name').value.trim(),
  );
  if (manageGroupAvatarShouldClear) {
    formData.append('clearAvatar', 'true');
  }
  const avatarInput = document.getElementById('manage-group-avatar-input');
  if (avatarInput.files && avatarInput.files[0]) {
    formData.append('avatar', avatarInput.files[0]);
  }

  const res = await api(`/chat/groups/${encodeURIComponent(selectedUser.id)}`, {
    method: 'POST',
    body: formData,
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to save group settings.',
  );
  if (!res.ok) {
    alert(data.message || 'Failed to save group settings');
    return;
  }

  await loadUsers();
  await selectUser(data.id);
  await openManageGroupModal();
}

async function inviteUserToGroup(userId) {
  if (!selectedUser || !isGroupConversation(selectedUser)) {
    return;
  }

  const res = await api(
    `/chat/groups/${encodeURIComponent(selectedUser.id)}/invite`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [userId] }),
    },
  );
  const data = await readJsonResponse(res, {}, 'Failed to send invite.');
  if (!res.ok) {
    alert(data.message || 'Failed to invite user');
    return;
  }

  users = users.map((user) =>
    user.id === data.id
      ? normalizeUser({ ...data, chatType: 'group' }, user)
      : user,
  );
  syncSelectedUser();
  await openManageGroupModal();
}

async function removeMemberFromGroup(userId) {
  if (!selectedUser || !isGroupConversation(selectedUser)) {
    return;
  }

  const res = await api(
    `/chat/groups/${encodeURIComponent(selectedUser.id)}/remove-member`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    },
  );
  const data = await readJsonResponse(res, {}, 'Failed to remove the member.');
  if (!res.ok) {
    alert(data.message || 'Failed to remove member');
    return;
  }

  users = users.map((user) =>
    user.id === data.id
      ? normalizeUser({ ...data, chatType: 'group' }, user)
      : user,
  );
  syncSelectedUser();
  await openManageGroupModal();
}

async function makeGroupAdmin(userId) {
  if (!selectedUser || !isGroupConversation(selectedUser)) {
    return;
  }

  const confirmed = window.confirm('Make this member an admin of the group?');
  if (!confirmed) {
    return;
  }

  const res = await api(
    `/chat/groups/${encodeURIComponent(selectedUser.id)}/promote-admin`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    },
  );
  const data = await readJsonResponse(
    res,
    {},
    'Failed to promote this member.',
  );
  if (!res.ok) {
    alert(data.message || 'Failed to make member admin');
    return;
  }

  users = users.map((user) =>
    user.id === data.id
      ? normalizeUser({ ...data, chatType: 'group' }, user)
      : user,
  );
  syncSelectedUser();
  await openManageGroupModal();
}

async function leaveCurrentGroup() {
  if (!selectedUser || !isGroupConversation(selectedUser)) {
    return;
  }

  const confirmed = window.confirm(
    selectedUser.role === 'ADMIN'
      ? 'Leave this group? If you are the last admin, another member will automatically become admin.'
      : 'Leave this group?',
  );
  if (!confirmed) {
    return;
  }

  const groupId = selectedUser.id;
  const res = await api(`/chat/groups/${encodeURIComponent(groupId)}/leave`, {
    method: 'POST',
  });
  const data = await readJsonResponse(res, {}, 'Failed to leave the group.');
  if (!res.ok) {
    alert(data.message || 'Failed to leave group');
    return;
  }

  closeManageGroupModal();
  await loadUsers();
  if (selectedUser && selectedUser.id === groupId) {
    syncSelectedUser();
  }
  alert(data.message || 'You left the group.');
}

function openMessageActions(x, y, message) {
  const menu = document.getElementById('message-actions-menu');
  const padding = 12;
  const starButton = document.getElementById('message-action-star');
  const openAttachmentButton = document.getElementById(
    'message-action-open-attachment',
  );
  const downloadAttachmentButton = document.getElementById(
    'message-action-download-attachment',
  );
  const reactionOptions = menu?.querySelectorAll('.message-reaction-option');
  try {
    window.getSelection?.()?.removeAllRanges?.();
  } catch (error) {
    console.warn(
      'Failed to clear text selection before opening actions',
      error,
    );
  }
  messageActionTarget = message;
  if (starButton) {
    starButton.querySelector('span').textContent = isMessageStarred(message.id)
      ? 'Remove star'
      : 'Star message';
  }
  const hasAttachment = Boolean(getSelectedMessageAttachmentMeta());
  openAttachmentButton?.classList.toggle('hidden', !hasAttachment);
  downloadAttachmentButton?.classList.toggle('hidden', !hasAttachment);
  reactionOptions?.forEach((button) => {
    const active = button.textContent.trim() === getMessageReaction(message.id);
    button.classList.toggle('border-blue-300', active);
    button.classList.toggle('bg-blue-50', active);
  });
  document
    .getElementById('message-action-delete-all')
    .classList.toggle(
      'hidden',
      message.senderId !== currentUser.id ||
      Date.now() - new Date(message.createdAt).getTime() > 5 * 60 * 1000 ||
      Boolean(message.deletedForEveryoneAt),
    );
  menu.classList.remove('hidden');

  if (window.innerWidth < 1024) {
    menu.style.left = '0.75rem';
    menu.style.right = '0.75rem';
    menu.style.bottom = 'calc(env(safe-area-inset-bottom) + 5.75rem)';
    menu.style.top = '';
    return;
  }

  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.right = '';
  menu.style.bottom = '';

  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
  const maxTop = Math.max(padding, window.innerHeight - rect.height - padding);
  const left = Math.min(Math.max(padding, x), maxLeft);
  const preferredTop = y + 8;
  const fallbackTop = y - rect.height - 8;
  const top =
    preferredTop <= maxTop
      ? preferredTop
      : Math.max(padding, Math.min(maxTop, fallbackTop));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function blockMessageActionsWhileScrolling(
  durationMs = MESSAGE_ACTION_SCROLL_BLOCK_MS,
) {
  messageActionScrollBlockedUntil = Math.max(
    messageActionScrollBlockedUntil,
    Date.now() + durationMs,
  );
}

function areMessageActionsBlockedByScroll() {
  return Date.now() < messageActionScrollBlockedUntil;
}

function closeMessageActions() {
  const menu = document.getElementById('message-actions-menu');
  setMessageActionsBusyState(false);
  menu.classList.add('hidden');
  menu.style.left = '';
  menu.style.top = '';
  menu.style.right = '';
  menu.style.bottom = '';
  messageActionTarget = null;
}

async function deleteSelectedMessageForMe() {
  if (!messageActionTarget) {
    return;
  }
  const messageId = messageActionTarget.id;
  setMessageActionsBusyState(true, {
    buttonId: 'message-action-delete-me',
    label: 'Deleting...',
  });
  triggerMotionClass(
    getMessageBubbleElement(messageId),
    'message-bubble-processing',
    420,
  );
  const res = await api('/chat/messages/delete-for-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to delete message.');
  if (!res.ok) {
    setMessageActionsBusyState(false);
    alert(data.message || 'Failed to delete message');
    return;
  }
  await animateMessageShellExit(messageId);
  hideMessageLocally(messageId);
  closeMessageActions();
}

async function deleteSelectedMessageForEveryone() {
  if (!messageActionTarget) {
    return;
  }
  const messageId = messageActionTarget.id;
  setMessageActionsBusyState(true, {
    buttonId: 'message-action-delete-all',
    label: 'Unsending...',
  });
  triggerMotionClass(
    getMessageBubbleElement(messageId),
    'message-bubble-processing',
    460,
  );
  const res = await api('/chat/messages/delete-for-everyone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to unsend message.');
  if (!res.ok) {
    setMessageActionsBusyState(false);
    alert(data.message || 'Failed to unsend message');
    return;
  }
  handleMessageUpdated(data);
  closeMessageActions();
  pulseMessageBubble(messageId);
}

async function handleAttachmentSelected() {
  const input = document.getElementById('file-input');
  const files = Array.from(input?.files || []);

  if (input) {
    input.value = '';
  }

  if (!files.length) {
    renderAttachmentUploadQueue();
    return;
  }

  if (!selectedUser) {
    alert('Select a chat before sharing files.');
    return;
  }

  const canChat = await ensureChatPermissionReady();
  if (!canChat) {
    alert('Accept a chat request before sharing files.');
    return;
  }

  closeComposerActionsMenu();
  markComposerDraftDirty();
  await startAttachmentUploads(
    files,
    buildUploadConversationTarget(selectedUser),
  );
}

function updateChatDropzoneState(active) {
  document.body.classList.toggle('chat-dropzone-active', Boolean(active));
}

async function handleAttachmentDrop(files) {
  if (!selectedUser) {
    alert('Select a chat before sharing files.');
    return;
  }

  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before sharing files.');
    return;
  }

  markComposerDraftDirty();
  await startAttachmentUploads(
    files,
    buildUploadConversationTarget(selectedUser),
  );
}

async function uploadMyAvatar(inputId = 'desktop-avatar-input') {
  const preferredInput = inputId ? document.getElementById(inputId) : null;
  const fallbackInput = document.getElementById('avatar-input');
  const input =
    preferredInput && preferredInput.files && preferredInput.files[0]
      ? preferredInput
      : fallbackInput && fallbackInput.files && fallbackInput.files[0]
        ? fallbackInput
        : preferredInput || fallbackInput;
  const button = document.getElementById('profile-avatar-btn');
  if (!input.files || !input.files[0]) return;

  const formData = new FormData();
  formData.append('avatar', input.files[0]);

  if (button) {
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-wait');
    button.textContent = 'Uploading...';
  }

  try {
    const res = await api('/users/profile/avatar', {
      method: 'POST',
      body: formData,
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to upload your avatar.',
    );

    if (!res.ok) {
      alert(data.message || 'Failed to upload avatar');
      return;
    }

    applyCurrentUser(data);
    users = users.map((user) =>
      user.id === data.id ? normalizeUser({ ...user, ...data }, user) : user,
    );
    syncSelectedUser();
    renderUsers();
    updateSelectedUserHeader();
    alert('Profile photo updated');
  } finally {
    input.value = '';
    if (button) {
      button.disabled = false;
      button.classList.remove('opacity-70', 'cursor-wait');
      button.textContent = 'Update Photo';
    }
  }
}

async function removeMyAvatar() {
  const button = document.getElementById('profile-remove-avatar-btn');

  if (button) {
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-wait');
    button.textContent = 'Removing...';
  }

  try {
    const res = await api('/users/profile/avatar/remove', {
      method: 'POST',
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to remove your avatar.',
    );

    if (!res.ok) {
      alert(data.message || 'Failed to remove avatar');
      return;
    }

    applyCurrentUser(data);
    users = users.map((user) =>
      user.id === data.id ? normalizeUser({ ...user, ...data }, user) : user,
    );
    syncSelectedUser();
    renderUsers();
    updateSelectedUserHeader();
    updateChatContactPanel();
    alert('Profile photo removed');
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('opacity-70', 'cursor-wait');
      button.textContent = 'Remove Photo';
    }
  }
}

async function chooseChatTheme() {
  if (!selectedUser) {
    return;
  }

  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before using this feature.');
    return;
  }

  document.getElementById('chat-theme-input').click();
}

async function uploadChatTheme() {
  const input = document.getElementById('chat-theme-input');

  if (!selectedUser || !input.files || !input.files[0]) {
    return;
  }

  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before using this feature.');
    input.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('contactUserId', selectedUser.id);
  formData.append('theme', input.files[0]);

  const res = await api('/users/contacts/theme', {
    method: 'POST',
    body: formData,
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to upload the chat theme.',
  );

  if (!res.ok) {
    alert(data.message || 'Failed to upload chat theme');
    return;
  }

  users = users.map((user) =>
    user.id === selectedUser.id
      ? normalizeUser({ ...user, chatTheme: data.chatTheme }, user)
      : user,
  );
  syncSelectedUser();
  applyChatTheme();
  input.value = '';
}

async function clearChatTheme() {
  if (!selectedUser) {
    return;
  }

  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before using this feature.');
    return;
  }

  const formData = new FormData();
  formData.append('contactUserId', selectedUser.id);
  formData.append('clear', 'true');

  const res = await api('/users/contacts/theme', {
    method: 'POST',
    body: formData,
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to clear the chat theme.',
  );

  if (!res.ok) {
    alert(data.message || 'Failed to clear chat theme');
    return;
  }

  users = users.map((user) =>
    user.id === selectedUser.id
      ? normalizeUser({ ...user, chatTheme: data.chatTheme }, user)
      : user,
  );
  syncSelectedUser();
  applyChatTheme();
}

function stopVoiceRecorderStream() {
  if (mediaRecorderStream) {
    mediaRecorderStream.getTracks().forEach((track) => track.stop());
  }

  mediaRecorderStream = null;
}

function updateVoiceComposerUI() {
  const voiceStatus = getById('voice-status');
  const voicePreview = getById('voice-preview');
  const voicePreviewAudio = getById('voice-preview-audio');
  const voicePreviewNote = getById('voice-preview-note');
  const recordBtn = getById('voice-record-btn');
  const stopBtn = getById('voice-stop-btn');
  const deleteBtn = getById('voice-delete-btn');
  const sendBtn = getById('voice-send-btn');
  const isRecording = Boolean(
    mediaRecorder && mediaRecorder.state === 'recording',
  );
  const hasDraft = Boolean(recordedAudioFile && recordedAudioUrl);

  if (!voiceStatus || !voicePreview || !voicePreviewAudio || !recordBtn) {
    return;
  }

  recordBtn.innerText = 'Record Voice';
  stopBtn?.classList.toggle('hidden', !isRecording);
  deleteBtn?.classList.toggle('hidden', !hasDraft);
  sendBtn?.classList.toggle('hidden', !hasDraft);
  voicePreview.classList.toggle('hidden', !isRecording && !hasDraft);

  if (isRecording) {
    voiceStatus.innerText = 'Recording...';
    voiceStatus.classList.remove('hidden');
    voicePreviewNote.innerText =
      'Tap Stop Recording when your voice message is ready.';
    voicePreviewAudio.pause();
    voicePreviewAudio.removeAttribute('src');
    voicePreviewAudio.classList.add('hidden');
    voicePreviewAudio.load();
    return;
  }

  if (hasDraft) {
    voiceStatus.innerText = 'Voice message ready to send';
    voiceStatus.classList.remove('hidden');
    voicePreviewNote.innerText =
      'Listen to your recording, send it now, or delete it before sending.';
    voicePreviewAudio.src = recordedAudioUrl;
    voicePreviewAudio.classList.remove('hidden');
    return;
  }

  voiceStatus.classList.add('hidden');
  voiceStatus.innerText = '';
  voicePreviewNote.innerText = '';
  voicePreviewAudio.pause();
  voicePreviewAudio.removeAttribute('src');
  voicePreviewAudio.classList.add('hidden');
  voicePreviewAudio.load();
}

function clearRecordedAudio(options = {}) {
  const hadDraft = Boolean(
    recordedAudioFile || recordedAudioUrl || recordedChunks.length,
  );
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    discardRecordedAudioOnStop = true;
    mediaRecorder.stop();
    return;
  }

  if (recordedAudioUrl) {
    URL.revokeObjectURL(recordedAudioUrl);
  }

  discardRecordedAudioOnStop = false;
  recordedChunks = [];
  recordedAudioUrl = null;
  recordedAudioFile = null;
  stopVoiceRecorderStream();

  if (options.keepMenuOpen !== true) {
    closeComposerActionsMenu();
  }

  updateVoiceComposerUI();

  if (hadDraft) {
    markComposerDraftDirty();
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

async function sendRecordedVoiceMessage() {
  if (!recordedAudioFile || composerSendInFlight) {
    return;
  }
  if (composerDraftVersion === lastSubmittedDraftVersion) {
    return;
  }

  const draftFingerprint = buildDraftFingerprint({
    roomId: selectedConversationRoomId(),
    text: '',
    attachmentFile: null,
    voiceFile: recordedAudioFile,
  });
  if (shouldSkipDuplicateDraft(draftFingerprint)) {
    return;
  }

  try {
    setComposerSendingState(true, 'Uploading');
    markDraftSubmitted(draftFingerprint);
    lastSubmittedDraftVersion = composerDraftVersion;
    const uploadedVoiceMessage = await uploadAttachment(recordedAudioFile);
    await handleIncomingMessage(uploadedVoiceMessage, true);
    clearRecordedAudio();
  } catch (error) {
    clearDraftSubmissionGuard(draftFingerprint);
    lastSubmittedDraftVersion = -1;
    alert(error.message || 'Failed to send voice message');
  } finally {
    setComposerSendingState(false);
  }
}

async function toggleVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopVoiceRecording();
    return;
  }

  if (!selectedUser) {
    return;
  }

  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before sending voice messages.');
    return;
  }

  try {
    clearRecordedAudio({ keepMenuOpen: true });
    discardRecordedAudioOnStop = false;
    recordedChunks = [];
    mediaRecorderStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    mediaRecorder = new MediaRecorder(mediaRecorderStream);

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', () => {
      const shouldDiscard = discardRecordedAudioOnStop;
      const mimeType = mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(recordedChunks, { type: mimeType });
      stopVoiceRecorderStream();
      mediaRecorder = null;
      discardRecordedAudioOnStop = false;

      if (shouldDiscard || blob.size === 0) {
        recordedChunks = [];
        updateVoiceComposerUI();
        return;
      }

      const extension = mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('mpeg')
          ? 'mp3'
          : 'webm';

      clearRecordedAudio({ keepMenuOpen: true });
      recordedAudioFile = new File(
        [blob],
        `voice-message-${Date.now()}.${extension}`,
        { type: mimeType },
      );
      recordedAudioUrl = URL.createObjectURL(blob);
      markComposerDraftDirty();
      updateVoiceComposerUI();
    });

    mediaRecorder.start();
    updateVoiceComposerUI();
  } catch (error) {
    stopVoiceRecorderStream();
    mediaRecorder = null;
    alert(error.message || 'Unable to access microphone');
    updateVoiceComposerUI();
  }
}

function closeIncomingCallModal() {
  document.getElementById('incoming-call-modal').classList.add('hidden');
  document.getElementById('incoming-call-modal').classList.remove('flex');
}

function updateActiveCallFlipButton() {
  const button = document.getElementById('active-call-flip-btn');
  if (!button) {
    return;
  }

  const shouldShow =
    activeCall.callType === 'video' && activeCall.videoDeviceIds.length > 1;
  button.classList.toggle('hidden', !shouldShow);
  button.disabled = !shouldShow || activeCall.switchingCamera;
  button.innerText = activeCall.switchingCamera
    ? 'Switching...'
    : 'Flip Camera';
}

async function refreshActiveCallVideoDevices() {
  if (
    activeCall.callType !== 'video' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== 'function'
  ) {
    activeCall.videoDeviceIds = [];
    updateActiveCallFlipButton();
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    activeCall.videoDeviceIds = devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId)
      .map((device) => device.deviceId);
  } catch (error) {
    console.warn('Unable to enumerate camera devices', error);
    activeCall.videoDeviceIds = activeCall.currentVideoDeviceId
      ? [activeCall.currentVideoDeviceId]
      : [];
  }

  if (
    activeCall.currentVideoDeviceId &&
    !activeCall.videoDeviceIds.includes(activeCall.currentVideoDeviceId)
  ) {
    activeCall.currentVideoDeviceId = activeCall.videoDeviceIds[0] || null;
  }

  updateActiveCallFlipButton();
}

function getVideoCallConstraints(options = {}) {
  const { deviceId, facingMode } = options;
  const constraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };

  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  } else if (facingMode) {
    constraints.facingMode = { ideal: facingMode };
  }

  return constraints;
}

function syncActiveCallVideoState(stream) {
  const videoTrack =
    stream && typeof stream.getVideoTracks === 'function'
      ? stream.getVideoTracks()[0] || null
      : null;
  const settings =
    videoTrack && typeof videoTrack.getSettings === 'function'
      ? videoTrack.getSettings()
      : {};

  activeCall.currentVideoDeviceId = settings.deviceId || null;
  if (settings.facingMode === 'environment' || settings.facingMode === 'user') {
    activeCall.preferredFacingMode = settings.facingMode;
  }
}

function openActiveCallPanel(userId, callType, status) {
  const panel = document.getElementById('active-call-panel');
  const user = users.find((item) => item.id === userId) || selectedUser;
  document.getElementById('active-call-title').innerText =
    `${displayName(user)} ${callType === 'video' ? 'video call' : 'voice call'}`;
  document.getElementById('active-call-status').innerText = status || '';
  activeCall.callType = callType;
  updateActiveCallFlipButton();
  panel.classList.remove('hidden');
}

function queueRemoteIceCandidate(userId, candidate) {
  if (!userId || !candidate) {
    return;
  }

  const queue = pendingRemoteIceCandidatesByUser.get(userId) || [];
  queue.push(candidate);
  pendingRemoteIceCandidatesByUser.set(userId, queue);
}

function clearRemoteIceCandidates(userId) {
  if (!userId) {
    return;
  }

  pendingRemoteIceCandidatesByUser.delete(userId);
}

async function flushQueuedRemoteIceCandidates(
  userId = activeCall.targetUserId,
) {
  if (
    !userId ||
    !activeCall.peer ||
    activeCall.targetUserId !== userId ||
    !activeCall.peer.remoteDescription?.type
  ) {
    return;
  }

  const queue = pendingRemoteIceCandidatesByUser.get(userId) || [];
  if (!queue.length) {
    return;
  }

  pendingRemoteIceCandidatesByUser.delete(userId);
  for (const candidate of queue) {
    try {
      await activeCall.peer.addIceCandidate(candidate);
    } catch (error) {
      console.error('Failed to apply queued ICE candidate', error);
    }
  }
}

function cleanupActiveCall(notifyPeer = false) {
  if (notifyPeer && socket && activeCall.targetUserId) {
    socket.emit('call:end', { toUserId: activeCall.targetUserId });
  }

  stopIncomingCallRingtone();
  if (activeCall.reconnectTimer) {
    clearTimeout(activeCall.reconnectTimer);
  }

  if (activeCall.peer) {
    activeCall.peer.close();
  }

  if (activeCall.localStream) {
    activeCall.localStream.getTracks().forEach((track) => track.stop());
  }

  if (activeCall.remoteStream) {
    activeCall.remoteStream.getTracks().forEach((track) => track.stop());
  }

  clearRemoteIceCandidates(activeCall.targetUserId);

  activeCall = createEmptyActiveCallState();

  document.getElementById('active-call-panel').classList.add('hidden');
  document.getElementById('active-call-status').innerText = '';
  document.getElementById('local-video').classList.add('hidden');
  document.getElementById('remote-video').classList.add('hidden');
  document.getElementById('local-video').srcObject = null;
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('remote-audio').srcObject = null;
  updateActiveCallFlipButton();
}

async function createPeerConnection(targetUserId, callType) {
  const peer = new RTCPeerConnection(rtcConfig);
  const remoteStream = new MediaStream();
  const remoteAudio = document.getElementById('remote-audio');
  const remoteVideo = document.getElementById('remote-video');
  activeCall.peer = peer;
  activeCall.remoteStream = remoteStream;
  activeCall.targetUserId = targetUserId;
  activeCall.callType = callType;

  remoteAudio.srcObject = remoteStream;
  remoteVideo.srcObject = remoteStream;

  const ensureRemotePlayback = () => {
    remoteAudio?.play?.().catch(() => undefined);
    if (callType === 'video') {
      remoteVideo?.play?.().catch(() => undefined);
    }
  };

  peer.ontrack = (event) => {
    if (
      event.track &&
      !remoteStream.getTracks().some((track) => track.id === event.track.id)
    ) {
      remoteStream.addTrack(event.track);
    }
    if (callType === 'video') {
      remoteVideo.classList.remove('hidden');
    }
    ensureRemotePlayback();
  };

  peer.onicecandidate = (event) => {
    if (!event.candidate || !socket || !activeCall.targetUserId) {
      return;
    }

    socket.emit('call:ice', {
      toUserId: activeCall.targetUserId,
      candidate: event.candidate.toJSON
        ? event.candidate.toJSON()
        : event.candidate,
    });
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'connected') {
      document.getElementById('active-call-status').innerText = 'Connected';
      if (activeCall.reconnectTimer) {
        clearTimeout(activeCall.reconnectTimer);
        activeCall.reconnectTimer = null;
      }
      ensureRemotePlayback();
    }

    if (peer.connectionState === 'disconnected') {
      document.getElementById('active-call-status').innerText =
        'Reconnecting...';
      if (activeCall.reconnectTimer) {
        clearTimeout(activeCall.reconnectTimer);
      }
      activeCall.reconnectTimer = window.setTimeout(() => {
        cleanupActiveCall(false);
      }, 12000);
      return;
    }

    if (['failed', 'closed'].includes(peer.connectionState)) {
      cleanupActiveCall(false);
    }
  };

  return peer;
}

async function prepareCallStream(callType) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video:
      callType === 'video'
        ? getVideoCallConstraints({
          facingMode: activeCall.preferredFacingMode,
        })
        : false,
  });

  activeCall.localStream = stream;
  document.getElementById('local-video').srcObject = stream;

  if (callType === 'video') {
    syncActiveCallVideoState(stream);
    await refreshActiveCallVideoDevices();
    document.getElementById('local-video').classList.remove('hidden');
  } else {
    activeCall.videoDeviceIds = [];
    activeCall.currentVideoDeviceId = null;
    updateActiveCallFlipButton();
    document.getElementById('local-video').classList.add('hidden');
  }

  return stream;
}

async function flipActiveCamera() {
  if (
    activeCall.callType !== 'video' ||
    activeCall.switchingCamera ||
    !activeCall.localStream
  ) {
    return;
  }

  const currentVideoTrack = activeCall.localStream.getVideoTracks()[0];
  if (!currentVideoTrack) {
    return;
  }

  const availableDeviceIds = activeCall.videoDeviceIds.filter(Boolean);
  const currentVideoSettings =
    typeof currentVideoTrack.getSettings === 'function'
      ? currentVideoTrack.getSettings()
      : {};
  const currentDeviceId =
    activeCall.currentVideoDeviceId || currentVideoSettings.deviceId || null;
  const nextFacingMode =
    activeCall.preferredFacingMode === 'environment' ? 'user' : 'environment';
  let targetDeviceId = null;

  if (availableDeviceIds.length > 1) {
    const currentIndex = currentDeviceId
      ? availableDeviceIds.indexOf(currentDeviceId)
      : -1;
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % availableDeviceIds.length : 0;
    targetDeviceId = availableDeviceIds[nextIndex] || null;
  }

  const nextConstraints = getVideoCallConstraints({
    deviceId: targetDeviceId,
    facingMode: targetDeviceId ? null : nextFacingMode,
  });
  const localAudioTracks = activeCall.localStream.getAudioTracks();
  const statusNode = document.getElementById('active-call-status');
  const previousStatus = statusNode?.innerText || '';

  activeCall.switchingCamera = true;
  updateActiveCallFlipButton();
  if (statusNode) {
    statusNode.innerText = 'Switching camera...';
  }

  try {
    const replacementStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: nextConstraints,
    });
    const nextVideoTrack = replacementStream.getVideoTracks()[0];

    if (!nextVideoTrack) {
      throw new Error('Unable to access another camera');
    }

    const sender = activeCall.peer
      ?.getSenders()
      ?.find((item) => item.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(nextVideoTrack);
    }

    activeCall.localStream = new MediaStream([
      ...localAudioTracks,
      nextVideoTrack,
    ]);
    document.getElementById('local-video').srcObject = activeCall.localStream;

    currentVideoTrack.stop();
    syncActiveCallVideoState(activeCall.localStream);

    if (!targetDeviceId) {
      activeCall.preferredFacingMode = nextFacingMode;
    }

    await refreshActiveCallVideoDevices();
  } catch (error) {
    console.error('Unable to switch camera', error);
    alert(error?.message || 'Unable to switch camera');
  } finally {
    if (statusNode) {
      statusNode.innerText = previousStatus;
    }
    activeCall.switchingCamera = false;
    updateActiveCallFlipButton();
  }
}

async function startCall(callType) {
  if (!selectedUser || !socket) {
    return;
  }

  if (!(await ensureChatPermissionReady())) {
    alert('Accept a chat request before starting a call.');
    return;
  }

  try {
    cleanupActiveCall(false);
    openActiveCallPanel(selectedUser.id, callType, 'Calling...');
    recordCallHistoryEntry(selectedUser.id, {
      direction: 'outgoing',
      callType,
      status: 'calling',
    });
    const peer = await createPeerConnection(selectedUser.id, callType);
    const stream = await prepareCallStream(callType);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    await emitSocketEvent('call:offer', {
      toUserId: selectedUser.id,
      offer: peer.localDescription,
      callType,
    });
  } catch (error) {
    cleanupActiveCall(false);
    alert(error.message || 'Unable to start call');
  }
}

function handleIncomingCallOffer(payload) {
  if (!payload?.fromUserId || !payload?.offer) {
    return;
  }

  if (activeCall.peer || pendingIncomingCall) {
    clearRemoteIceCandidates(payload.fromUserId);
    socket.emit('call:decline', { toUserId: payload.fromUserId });
    return;
  }

  clearRemoteIceCandidates(payload.fromUserId);
  pendingIncomingCall = payload;
  playIncomingCallRingtone();
  const user = users.find((item) => item.id === payload.fromUserId);
  document.getElementById('incoming-call-title').innerText =
    displayName(user) || 'Incoming call';
  document.getElementById('incoming-call-subtitle').innerText =
    payload.callType === 'video' ? 'Video call request' : 'Voice call request';
  document.getElementById('incoming-call-modal').classList.remove('hidden');
  document.getElementById('incoming-call-modal').classList.add('flex');
}

async function acceptIncomingCall() {
  if (!pendingIncomingCall) {
    return;
  }

  const { fromUserId, offer, callType } = pendingIncomingCall;
  closeIncomingCallModal();
  pendingIncomingCall = null;
  stopIncomingCallRingtone();

  try {
    await selectUser(fromUserId);
    recordCallHistoryEntry(fromUserId, {
      direction: 'incoming',
      callType,
      status: 'answered',
    });
    openActiveCallPanel(fromUserId, callType, 'Connecting...');
    const peer = await createPeerConnection(fromUserId, callType);
    const stream = await prepareCallStream(callType);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    await peer.setRemoteDescription(offer);
    await flushQueuedRemoteIceCandidates(fromUserId);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    await emitSocketEvent('call:answer', {
      toUserId: fromUserId,
      answer: peer.localDescription,
      callType,
    });
  } catch (error) {
    cleanupActiveCall(false);
    alert(error.message || 'Unable to answer call');
  }
}

function declineIncomingCall() {
  if (pendingIncomingCall?.fromUserId && socket) {
    clearRemoteIceCandidates(pendingIncomingCall.fromUserId);
    socket.emit('call:decline', {
      toUserId: pendingIncomingCall.fromUserId,
    });
    recordCallHistoryEntry(pendingIncomingCall.fromUserId, {
      direction: 'incoming',
      callType: pendingIncomingCall.callType,
      status: 'missed',
    });
  }

  stopIncomingCallRingtone();
  pendingIncomingCall = null;
  closeIncomingCallModal();
}

async function handleCallAnswer(payload) {
  if (!activeCall.peer || payload?.fromUserId !== activeCall.targetUserId) {
    return;
  }

  await activeCall.peer.setRemoteDescription(payload.answer);
  await flushQueuedRemoteIceCandidates(payload.fromUserId);
  document.getElementById('active-call-status').innerText = 'Connected';
  recordCallHistoryEntry(payload.fromUserId, {
    direction: 'outgoing',
    callType: payload.callType,
    status: 'connected',
  });
}

async function handleCallIce(payload) {
  if (!payload?.fromUserId || !payload?.candidate) {
    return;
  }

  const isActivePeerCandidate = payload.fromUserId === activeCall.targetUserId;
  const isPendingIncomingCandidate =
    payload.fromUserId === pendingIncomingCall?.fromUserId;

  if (!isActivePeerCandidate && !isPendingIncomingCandidate) {
    return;
  }

  if (!activeCall.peer || !isActivePeerCandidate) {
    queueRemoteIceCandidate(payload.fromUserId, payload.candidate);
    return;
  }

  if (!activeCall.peer.remoteDescription?.type) {
    queueRemoteIceCandidate(payload.fromUserId, payload.candidate);
    return;
  }

  try {
    await activeCall.peer.addIceCandidate(payload.candidate);
  } catch (error) {
    console.error('Failed to apply ICE candidate immediately', error);
    queueRemoteIceCandidate(payload.fromUserId, payload.candidate);
  }
}

function handleCallDecline(payload) {
  if (payload?.fromUserId !== activeCall.targetUserId) {
    return;
  }

  clearRemoteIceCandidates(payload.fromUserId);
  recordCallHistoryEntry(payload.fromUserId, {
    direction: 'outgoing',
    callType: activeCall.callType,
    status: 'declined',
  });
  alert('Call declined');
  cleanupActiveCall(false);
}

function handleCallEnd(payload) {
  if (payload?.fromUserId !== activeCall.targetUserId) {
    return;
  }

  clearRemoteIceCandidates(payload.fromUserId);
  recordCallHistoryEntry(payload.fromUserId, {
    direction: 'incoming',
    callType: activeCall.callType,
    status: 'ended',
  });
  cleanupActiveCall(false);
}

function endCurrentCall() {
  if (activeCall.targetUserId) {
    recordCallHistoryEntry(activeCall.targetUserId, {
      direction: 'outgoing',
      callType: activeCall.callType,
      status: 'ended',
    });
  }
  cleanupActiveCall(true);
}

async function saveRename() {
  if (!selectedUser) return;

  const nickname = document.getElementById('rename-input').value;

  const res = await api('/users/contacts/nickname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactUserId: selectedUser.id,
      nickname,
    }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to rename the contact.');

  if (!res.ok) {
    alert(data.message || 'Failed to rename contact');
    return;
  }

  users = users.map((user) =>
    user.id === selectedUser.id
      ? normalizeUser(
        {
          ...user,
          nickname: data.nickname,
          displayName: data.nickname || user.name,
        },
        user,
      )
      : user,
  );

  syncSelectedUser();
  renderUsers();
  updateSelectedUserHeader();
  closeRenameModal();
}

async function downloadFile(url, fileName) {
  const confirmed = window.confirm(`Download ${fileName || 'this file'}?`);
  if (!confirmed) {
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to download file');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

function renderMessageReplySnippetHtml(message, metaTone) {
  if (!message?.replyMeta) {
    return '';
  }

  return `
    <div class="message-reply-snippet mb-2 rounded-xl bg-black/5 px-2.5 py-1.5 text-left">
      <p class="text-[11px] font-semibold uppercase tracking-[0.2em] ${metaTone}">
        ${escapeHtml(message.replyMeta.senderName || 'Message')}
      </p>
      <p class="mt-1 text-xs leading-5 ${metaTone}">
        ${escapeHtml(message.replyMeta.preview || 'Reply')}
      </p>
    </div>
  `;
}

function renderMessageReactionHtml(message) {
  const data = getMessageReactionData(message?.id);
  if (!data?.emoji) {
    return '';
  }

  const ownerLabel = isOwnMessageReaction(message.id)
    ? 'You'
    : escapeHtml(
      data.ownerName ||
      displayName(
        users.find((user) => user.id === data.ownerId) || selectedUser,
      ) ||
      'Someone',
    );

  const chipClasses = `message-reaction-chip ${isOwnMessageReaction(message.id) ? 'is-own-reaction' : ''
    }`;

  return `
    <div class="mt-2">
      <span class="${chipClasses}">${escapeHtml(data.emoji)} <span>${ownerLabel}</span></span>
    </div>
  `;
}

function formatMessageTextHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function renderTimeCapsuleMessageMetaHtml(message, isSent, metaTone) {
  if (!isMessageTimeCapsule(message)) {
    return '';
  }

  const isLocked = isMessageTimeCapsuleLocked(message);
  const surfaceTone = isSent
    ? 'border-white/15 bg-white/10'
    : isLocked
      ? 'border-amber-300/80 bg-amber-50/90'
      : 'border-slate-200/90 bg-black/5';
  const labelTone = isSent
    ? 'text-blue-100/90'
    : isLocked
      ? 'text-amber-700'
      : metaTone;
  const titleTone = isSent
    ? 'text-white'
    : isLocked
      ? 'text-amber-950'
      : 'text-slate-900';
  const note = String(message?.capsuleMeta?.note || '').trim();

  return `
    <div class="mb-3 rounded-2xl border ${surfaceTone} px-3 py-2.5 text-left">
      <p class="text-[11px] font-semibold uppercase tracking-[0.2em] ${labelTone}">
        ${isLocked ? 'Time capsule sealed' : 'Time capsule'}
      </p>
      <p class="mt-1 text-sm font-semibold ${titleTone}">
        ${escapeHtml(getTimeCapsuleUnlockLabel(message) || 'Scheduled message')}
      </p>
      ${note
      ? `<p class="mt-1 text-xs leading-5 ${labelTone}">${escapeHtml(note)}</p>`
      : ''
    }
    </div>
  `;
}

function renderSpoilerMessageMetaHtml(message, isSent, metaTone) {
  if (!isMessageSpoiler(message) || isMessageSpoilerHidden(message)) {
    return '';
  }

  const label = String(message?.spoilerMeta?.label || '').trim();
  const title = label
    ? label
    : message.senderId === currentUser?.id
      ? 'Spoiler cover is on'
      : isSpoilerMessageRevealed(message)
        ? 'Spoiler revealed'
        : 'Spoiler message';

  return `
    <div class="mb-3 rounded-2xl border ${isSent ? 'border-white/15 bg-white/10' : 'border-slate-200/90 bg-black/5'
    } px-3 py-2.5 text-left">
      <p class="text-[11px] font-semibold uppercase tracking-[0.2em] ${metaTone}">
        Spoiler
      </p>
      <p class="mt-1 text-sm font-semibold ${isSent ? 'text-white' : 'text-slate-900'}">
        ${escapeHtml(title)}
      </p>
      <p class="mt-1 text-xs leading-5 ${metaTone}">
        ${message.senderId === currentUser?.id
      ? 'Recipients will reveal this manually.'
      : isSpoilerMessageRevealed(message)
        ? 'Revealed for you.'
        : 'Hidden until you reveal it.'
    }
      </p>
    </div>
  `;
}

function renderTextMessageContentHtml(message, isSent, metaTone) {
  const contentTone = isSent ? 'text-white' : 'text-slate-800';
  const surfaceTone = isSent
    ? 'border-white/15 bg-white/10'
    : 'border-slate-200/90 bg-black/5';
  const capsuleMeta = renderTimeCapsuleMessageMetaHtml(
    message,
    isSent,
    metaTone,
  );

  if (isMessageTimeCapsuleLocked(message)) {
    return `
      ${capsuleMeta}
      <div class="rounded-2xl border border-dashed ${isSent ? 'border-white/25 bg-white/10' : 'border-amber-300 bg-white/85'
      } px-3 py-3 text-left">
        <p class="text-sm font-semibold ${isSent ? 'text-white' : 'text-amber-900'}">
          Message sealed until it opens.
        </p>
        <p class="mt-1 text-xs leading-5 ${isSent ? 'text-blue-100/90' : 'text-amber-800/80'
      }">
          The contents will appear automatically when the unlock time arrives.
        </p>
      </div>
    `;
  }

  if (isMessageSpoilerHidden(message)) {
    const label = String(message?.spoilerMeta?.label || '').trim();
    return `
      ${capsuleMeta}
      <button
        type="button"
        onclick="revealSpoilerMessage('${escapeHtml(message.id)}')"
        class="flex w-full items-center justify-between gap-3 rounded-2xl border ${surfaceTone} px-3 py-3 text-left transition hover:opacity-90"
      >
        <span class="min-w-0 flex-1">
          <span class="block text-[11px] font-semibold uppercase tracking-[0.2em] ${metaTone}">
            Spoiler
          </span>
          <span class="mt-1 block truncate text-sm font-semibold ${contentTone}">
            ${escapeHtml(label || 'Tap to reveal')}
          </span>
          <span class="mt-1 block text-xs leading-5 ${metaTone}">
            Hidden until you choose to reveal it.
          </span>
        </span>
        <span
          class="shrink-0 rounded-full ${isSent ? 'bg-white/15 text-white' : 'bg-white text-slate-600'
      } px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
        >
          Reveal
        </span>
      </button>
    `;
  }

  return `
    ${capsuleMeta}
    ${renderSpoilerMessageMetaHtml(message, isSent, metaTone)}
    <div class="message-text-copy ${contentTone} whitespace-pre-wrap break-words">
      ${formatMessageTextHtml(getResolvedMessageText(message))}
    </div>
  `;
}

function createMessageElement(message, options = {}) {
  const div = document.createElement('div');
  const isSent = message.senderId === currentUser.id;
  const metaTone = isSent ? 'text-white/90' : 'text-slate-600';
  const starredBadge = isMessageStarred(message.id)
    ? '<span class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Starred</span>'
    : '';
  const hasReactionChip = Boolean(getMessageReaction(message.id));
  div.id = `message-${message.id}`;
  div.className = `message-row ${isSent ? 'message-row-outgoing self-end' : 'message-row-incoming self-start'} flex w-full max-w-full`;
  if (options.animate !== false) {
    div.classList.add('chat-message-enter');
    div.style.setProperty('--message-enter-x', isSent ? '14px' : '-14px');
  }

  const bubbleTone = isSent
    ? `rounded-[14px] rounded-br-[4px] text-white shadow-sm ${message.isPending ? 'bg-blue-500/85' : 'bg-blue-600'
    }`
    : 'rounded-[14px] rounded-bl-[4px] border border-slate-200/90 bg-white/95 text-slate-800 shadow-sm';
  const deliveryIndicator = isSent
    ? message.isPending
      ? `<span class="message-inline-check is-pending">${message.pendingState === 'queued-offline' ? '&#9716;' : '&#10003;'}</span>`
      : `<span class="message-inline-check ${messageWasRead(message) ? 'is-read' : ''}">&#10003;&#10003;</span>`
    : '';
  const useInlineTextMeta =
    !hasReactionChip &&
    !message.isPending &&
    !isMessageStarred(message.id) &&
    !message.replyMeta &&
    !isMessageTimeCapsule(message) &&
    !isMessageSpoiler(message);
  const footer = `
          <div class="message-bubble-footer mt-2 flex items-center justify-end gap-1.5 text-[10px] ${metaTone}">
            ${starredBadge}
            ${deliveryIndicator}
            <span>${escapeHtml(formatMessageTime(message.createdAt))}</span>
          </div>
        `;
  const inlineMeta = `
          <span class="message-inline-meta ${metaTone}">
            <span>${escapeHtml(formatMessageTime(message.createdAt))}</span>
            ${deliveryIndicator}
          </span>
        `;
  const replySnippet = renderMessageReplySnippetHtml(message, metaTone);
  const reactionChip = renderMessageReactionHtml(message);
  const textContent = renderTextMessageContentHtml(message, isSent, metaTone);
  const rawMessageFileUrl = message.fileUrl ? getFileUrl(message.fileUrl) : '';
  const messageFileUrl = rawMessageFileUrl ? escapeHtml(rawMessageFileUrl) : '';
  const imageAltText = escapeHtml(
    describeMessageAttachment(message, 'Shared image'),
  );
  const imageLinkLabel = escapeHtml(
    `Open image attachment: ${describeMessageAttachment(message, 'Shared image')}`,
  );
  const fileActionLabel = escapeHtml(
    describeMessageAttachment(message, 'Shared file'),
  );

  if (message.deletedForEveryoneAt) {
    div.innerHTML = `
            <div class="message-bubble-shell message-bubble-status ${bubbleTone} w-fit max-w-[min(100%,34rem)] px-2.5 py-1.5 text-[12px] italic opacity-80">
              <span class="message-text-copy">${escapeHtml(message.senderId === currentUser.id ? 'You unsent this message.' : 'This message was deleted.')}</span>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (message.messageType === 'IMAGE' && message.fileUrl) {
    div.innerHTML = `
            <div class="message-bubble-shell message-bubble-image ${bubbleTone} w-fit max-w-[min(100%,34rem)] overflow-hidden p-1.5">
              ${replySnippet}
              <a href="${messageFileUrl}" target="_blank" rel="noopener noreferrer" class="message-attachment-preview" aria-label="${imageLinkLabel}">
                <img src="${messageFileUrl}" alt="${imageAltText}" ${getImageMarkupAttributes(rawMessageFileUrl)} loading="lazy" decoding="async" class="message-attachment-image rounded-2xl border border-black/5">
              </a>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (message.messageType === 'AUDIO' && message.fileUrl) {
    div.innerHTML = `
            <div class="message-bubble-shell message-bubble-audio ${bubbleTone} w-fit max-w-[min(100%,34rem)] px-2.5 py-2">
              <div class="space-y-3">
                ${replySnippet}
                <p class="text-sm font-semibold">${escapeHtml(message.fileName || 'Voice message')}</p>
                <audio controls src="${messageFileUrl}" class="w-full max-w-md"></audio>
              </div>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (
    message.fileUrl &&
    String(message.fileMimeType || '').startsWith('video/')
  ) {
    div.innerHTML = `
            <div class="message-bubble-shell message-bubble-video ${bubbleTone} w-fit max-w-[min(100%,34rem)] overflow-hidden p-1.5">
              <div class="space-y-3">
                ${replySnippet}
                <video controls playsinline preload="metadata" class="max-h-80 w-full rounded-2xl border border-black/5 bg-black">
                  <source src="${messageFileUrl}" type="${escapeHtml(message.fileMimeType || 'video/mp4')}">
                  Your browser does not support the video tag.
                </video>
              </div>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (message.messageType === 'DOCUMENT' && message.fileUrl) {
    div.innerHTML = `
            <div class="message-bubble-shell message-bubble-document ${bubbleTone} w-fit max-w-[min(100%,34rem)] px-2.5 py-2">
              <div class="space-y-2">
                ${replySnippet}
                <p class="text-sm font-semibold">${escapeHtml(message.fileName || 'Document')}</p>
                <p class="text-xs ${metaTone}">${formatBytes(message.fileSize)}</p>
              </div>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else {
    if (useInlineTextMeta) {
      div.innerHTML = `
            <div class="message-bubble-shell message-bubble-text message-bubble-inline-meta ${bubbleTone} w-fit max-w-[min(100%,34rem)] px-2.5 py-1.5 text-[13px] leading-[1.5]">
              <div class="message-inline-content">
                <span class="message-text-copy ${isSent ? 'text-white' : 'text-slate-800'} whitespace-pre-wrap break-words">${formatMessageTextHtml(getResolvedMessageText(message))}</span>
                ${inlineMeta}
              </div>
              ${reactionChip}
            </div>
          `;
    } else {
      div.innerHTML = `
            <div class="message-bubble-shell message-bubble-text ${bubbleTone} w-fit max-w-[min(100%,34rem)] px-2.5 py-1.5 text-[13px] leading-[1.5]">
              ${replySnippet}
              ${textContent}
              ${footer}
              ${reactionChip}
            </div>
          `;
    }
  }

  div.querySelectorAll('img').forEach((image) => {
    if (image.src !== rawMessageFileUrl) {
      attachImageFallback(image);
    }
    image.addEventListener(
      'load',
      () => {
        cacheImageDimensions(
          image.currentSrc || image.src,
          image.naturalWidth,
          image.naturalHeight,
        );
        if (Date.now() <= stickToLatestUntil) {
          scheduleMessageContainerBottom(600);
        }
      },
      { once: true },
    );
  });

  div.querySelectorAll('video').forEach((video) => {
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (Date.now() <= stickToLatestUntil) {
          scheduleMessageContainerBottom(600);
        }
      },
      { once: true },
    );
  });

  div.oncontextmenu = (event) => {
    event.preventDefault();
    if (window.innerWidth < 1024) {
      return;
    }
    openMessageActions(event.clientX, event.clientY, message);
  };

  const clearHoldTimer = () => {
    if (div._holdTimer) {
      clearTimeout(div._holdTimer);
      div._holdTimer = null;
    }
    div.classList.remove('message-hold-armed');
  };

  div.onpointerdown = (event) => {
    const isTouchLikePointer =
      event.pointerType === 'touch' ||
      event.pointerType === 'pen' ||
      !event.pointerType;
    const interactiveTarget = event.target?.closest(
      'a, button, input, textarea, select, option, label, audio, video, [contenteditable="true"]',
    );
    const mediaPreviewTarget = event.target?.closest(
      '.message-attachment-preview, .message-attachment-image',
    );

    if (!isTouchLikePointer || (interactiveTarget && !mediaPreviewTarget)) {
      return;
    }

    if (areMessageActionsBlockedByScroll()) {
      return;
    }

    clearHoldTimer();
    div.classList.add('message-hold-armed');
    const holdX = event.clientX;
    const holdY = event.clientY;
    div._holdStartX = holdX;
    div._holdStartY = holdY;
    div._holdTimer = window.setTimeout(() => {
      div._holdTimer = null;
      div.classList.remove('message-hold-armed');
      if (areMessageActionsBlockedByScroll()) {
        return;
      }
      openMessageActions(holdX, holdY, message);
    }, MESSAGE_ACTION_TOUCH_HOLD_MS);
  };

  div.onpointermove = (event) => {
    if (!div._holdTimer) {
      return;
    }

    const deltaX = Math.abs(event.clientX - (div._holdStartX ?? event.clientX));
    const deltaY = Math.abs(event.clientY - (div._holdStartY ?? event.clientY));
    if (
      deltaX > MESSAGE_ACTION_MOVE_TOLERANCE_PX ||
      deltaY > MESSAGE_ACTION_MOVE_TOLERANCE_PX
    ) {
      clearHoldTimer();
      blockMessageActionsWhileScrolling();
    }
  };

  div.onpointerup = clearHoldTimer;
  div.onpointerleave = clearHoldTimer;
  div.onpointercancel = clearHoldTimer;
  return div;
}

function isMessageContainerNearBottom(threshold = 96) {
  const container = document.getElementById('message-container');
  if (!container) {
    return true;
  }

  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    threshold
  );
}

function scheduleMessageContainerBottom(durationMs = 900) {
  const container = document.getElementById('message-container');
  if (!container) {
    return;
  }

  stickToLatestUntil = Date.now() + durationMs;
  window.requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
    window.setTimeout(() => {
      if (Date.now() <= stickToLatestUntil) {
        container.scrollTop = container.scrollHeight;
      }
    }, 120);
  });
}

function appendMessages(messages, options = {}) {
  if (!selectedUser || !Array.isArray(messages) || messages.length === 0) {
    return;
  }

  const shouldStickToBottom =
    options.stickToBottom &&
    (Date.now() <= stickToLatestUntil || isMessageContainerNearBottom());
  let renderedCount = 0;

  for (const message of sortMessagesChronologically(messages)) {
    if (!message || renderedMessageIds.has(message.id)) {
      continue;
    }

    const result = renderMessageInConversationOrder(message, options);
    renderedCount += result.rendered ? 1 : 0;
  }

  if (!renderedCount) {
    return;
  }

  scheduleStructuredMessageRefresh();

  if (shouldStickToBottom) {
    scheduleMessageContainerBottom();
  }
}

function appendMessage(message, options = {}) {
  appendMessages([message], {
    stickToBottom: options.stickToBottom !== false,
  });
}

function flushQueuedConversationMessageRenders() {
  queuedConversationMessageFrame = 0;
  if (!queuedConversationMessageRenders.length) {
    return;
  }

  const pending = queuedConversationMessageRenders;
  queuedConversationMessageRenders = [];
  const activeEntries = pending.filter(
    (entry) => entry?.message && belongsToSelectedConversation(entry.message),
  );
  const activeMessages = activeEntries.map((entry) => entry.message);

  if (!activeMessages.length) {
    return;
  }

  appendMessages(activeMessages, {
    stickToBottom: activeEntries.some(
      (entry) => entry?.stickToBottom !== false,
    ),
  });

  if (activeEntries.some((entry) => entry?.markRead)) {
    scheduleSelectedConversationRead();
  }
}

function queueConversationMessageRender(message, options = {}) {
  if (!message) {
    return;
  }

  queuedConversationMessageRenders.push({
    message,
    stickToBottom: options.stickToBottom !== false,
    markRead: Boolean(options.markRead),
  });

  if (queuedConversationMessageFrame) {
    return;
  }

  queuedConversationMessageFrame = window.requestAnimationFrame(() => {
    flushQueuedConversationMessageRenders();
  });
}

function prependMessages(messages) {
  if (!selectedUser || !Array.isArray(messages) || messages.length === 0) {
    return;
  }

  const list = document.getElementById('messages-list');
  const fragment = document.createDocumentFragment();

  for (const message of messages) {
    if (!message || renderedMessageIds.has(message.id)) {
      continue;
    }

    if (!belongsToSelectedConversation(message)) {
      continue;
    }

    renderedMessageIds.add(message.id);
    conversationMessages.set(message.id, message);
    fragment.appendChild(createMessageElement(message, { animate: false }));
  }

  list.prepend(fragment);
  scheduleStructuredMessageRefresh();
}

async function ensureServiceWorkerReady() {
  if (!canUseWebPush()) {
    return null;
  }

  if (!swRegistration) {
    swRegistration = await navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
    });
  }

  swRegistration.update().catch(() => null);

  if (!serviceWorkerMessageBound) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'notification-click' && event.data.url) {
        const url = new URL(event.data.url, window.location.origin);
        const chatId = url.searchParams.get('chat');
        const groupId = url.searchParams.get('group');
        if (groupId) {
          selectUser(groupId);
          return;
        }
        if (chatId) {
          selectUser(chatId);
        }
      }
    });
    serviceWorkerMessageBound = true;
  }

  return swRegistration;
}

async function setupNotifications() {
  if (!canUseWebPush()) {
    return;
  }

  await ensureServiceWorkerReady();
  if (!swRegistration) {
    return;
  }

  if (Notification.permission === 'default') {
    const alreadyRequested =
      readStoredValue(NOTIFICATION_PERMISSION_KEY, '') === '1';

    if (!alreadyRequested) {
      writeStoredValue(NOTIFICATION_PERMISSION_KEY, '1');
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await subscribeForPush();
        }
      } catch (error) {
        console.warn('Notification permission prompt failed', error);
      }
      return;
    }
  }

  if (Notification.permission === 'granted') {
    await subscribeForPush();
  }
}

async function subscribeForPush() {
  if (!swRegistration) {
    return;
  }

  try {
    const keyResponse = await fetch(
      `${API_URL}/users/notifications/public-key`,
    );
    const keyData = await readJsonResponse(
      keyResponse,
      {},
      'Failed to load notification settings.',
    );

    if (!keyResponse.ok || !keyData.publicKey) {
      return;
    }

    let subscription = await swRegistration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });
    }

    const subscribeResponse = await api('/users/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });
    if (!subscribeResponse.ok) {
      const data = await readJsonResponse(
        subscribeResponse,
        {},
        'Failed to save push subscription.',
      );
      console.warn(data.message || 'Push subscription could not be saved.');
    }
  } catch (error) {
    console.warn('Push subscription unavailable', error);
  }
}

function maybeShowForegroundNotification(message) {
  if (Notification.permission !== 'granted') {
    return;
  }

  const conversationKey = message.groupId
    ? `group:${message.groupId}`
    : `direct:${message.senderId === currentUser?.id
      ? message.receiverId
      : message.senderId
    }`;
  if (mutedConversationKeys.has(conversationKey)) {
    return;
  }

  if (!document.hidden && document.hasFocus()) {
    return;
  }

  const sender = peopleDirectory.find((user) => user.id === message.senderId);
  const group = message.groupId
    ? users.find(
      (user) => isGroupConversation(user) && user.id === message.groupId,
    )
    : null;
  const notification = new Notification(
    group
      ? `${displayName(group)} · ${displayName(sender) || 'Member'}`
      : displayName(sender) || 'New message',
    {
      body: getMessagePreview(message),
      icon: group ? userAvatar(group) : sender ? userAvatar(sender) : undefined,
      tag: message.groupId
        ? `group-${message.groupId}`
        : `chat-${message.senderId}`,
    },
  );

  notification.onclick = () => {
    window.focus();
    if (group) {
      selectUser(group.id);
    } else if (sender) {
      selectUser(sender.id);
    }
    notification.close();
  };
}

function maybeShowRequestNotification(request, otherUser) {
  if (Notification.permission !== 'granted') {
    return;
  }

  if (!document.hidden && document.hasFocus()) {
    return;
  }

  const targetUser = otherUser || null;
  const notification = new Notification('New chat request', {
    body: targetUser
      ? `${displayName(targetUser)} sent you a chat request`
      : 'Someone sent you a chat request',
    icon: targetUser ? userAvatar(targetUser) : undefined,
    tag: `chat-request-${request?.id || 'pending'}`,
  });

  notification.onclick = () => {
    window.focus();
    if (targetUser?.id) {
      selectUser(targetUser.id);
    }
    notification.close();
  };
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatAttachmentMeta(file) {
  const parts = [];

  if (file?.type) {
    parts.push(file.type);
  }

  if (typeof file?.size === 'number') {
    parts.push(formatBytes(file.size));
  }

  return parts.join(' • ');
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function forceSessionLogout(message = '') {
  if (sessionExpiryHandled) {
    return;
  }

  sessionExpiryHandled = true;
  clearScopedRuntimeCaches();
  clearKeyBackupUnlockMaterial(currentUser?.id);
  token = null;
  currentUser = null;
  currentPrivateKey = null;

  disconnectSocketForPageExit();
  clearStructuredMessageRefreshTimer();
  hideStartupLoader({ immediate: true });

  if (backgroundUsersRefreshTimer) {
    window.clearTimeout(backgroundUsersRefreshTimer);
    backgroundUsersRefreshTimer = 0;
  }

  removeStoredKey('chat_token');
  document.documentElement.classList.remove('has-session-token');

  if (message) {
    alert(message);
  }

  if (isFileOrigin) {
    location.reload();
    return;
  }

  location.href = '/auth';
}

async function logout() {
  const confirmed = window.confirm('Do you want to log out from this device?');
  if (!confirmed) {
    return;
  }

  try {
    if (swRegistration) {
      const subscription = await swRegistration.pushManager.getSubscription();
      if (subscription) {
        await api('/users/notifications/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
    }
  } catch (error) {
    console.error(error);
  }

  forceSessionLogout();
}

async function restoreSession() {
  const savedToken = readStoredValue('chat_token', '');
  if (!savedToken) {
    document.documentElement.classList.remove('has-session-token');
    applyDarkMode(readStoredValue('chat_dark_mode', '') === '1');
    syncLayout();
    if (!isFileOrigin && window.location.pathname.startsWith('/chat')) {
      window.location.replace('/auth');
    }
    return;
  }
  token = savedToken;
  document.documentElement.classList.add('has-session-token');
  document.getElementById('auth-screen')?.classList.add('hidden');
  try {
    await startApp();
  } catch (error) {
    hideStartupLoader({ immediate: true });
    console.error(error);
    const message = String(error?.message || '').toLowerCase();
    const isAuthFailure =
      message.includes('expired') ||
      message.includes('unauthorized') ||
      message.includes('invalid token');
    const requiresFreshLogin =
      message.includes('log in again on this device') ||
      message.includes('unlock your encrypted messages');

    if (isAuthFailure || requiresFreshLogin) {
      token = null;
      removeStoredKey('chat_token');
      if (requiresFreshLogin && error?.message) {
        alert(error.message);
      }
      if (!isFileOrigin && window.location.pathname.startsWith('/chat')) {
        window.location.replace('/auth');
      }
      return;
    }

    alert(
      error?.message ||
      'We could not refresh chat right now. Please try again in a moment.',
    );
  } finally {
    syncLayout();
  }
}

document.addEventListener('input', (event) => {
  if (event.target?.id !== 'msg-input' || !selectedUser) {
    return;
  }

  markComposerDraftDirty();
  saveConversationDraft(selectedUser, event.target.value);

  if (!socket?.connected) {
    return;
  }

  signalOutgoingTyping(selectedUser);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  closeImagePreview();
  closeSharedMediaBrowser();
  closeComposerActionsMenu();
  closeChatActionsMenu();
  closeChatContactPanel();
  closeMessageActions();
  closeProfileModal();
  closeRenameModal();
  closeCreateGroupModal();
  closeManageGroupModal();
  closeResetPasswordModal();
  declineIncomingCall();

  if (window.innerWidth < 1024) {
    closeSidebar();
  }
});

document.addEventListener('click', (event) => {
  const composerMenu = document.getElementById('composer-actions-menu');
  const composerBtn = document.getElementById('composer-actions-btn');
  const messageMenu = document.getElementById('message-actions-menu');

  if (
    composerMenu &&
    !composerMenu.contains(event.target) &&
    !composerBtn.contains(event.target)
  ) {
    closeComposerActionsMenu();
  }

  if (messageMenu && !messageMenu.contains(event.target)) {
    closeMessageActions();
  }
});

document.addEventListener(
  'focusin',
  (event) => {
    if (
      window.innerWidth < 1024 &&
      ['msg-input', 'rename-input'].includes(event.target?.id)
    ) {
      handleKeyboardState(true);
      stabilizeMobileKeyboardViewport();
    }
  },
  true,
);

document.addEventListener(
  'focusout',
  (event) => {
    if (
      window.innerWidth < 1024 &&
      ['msg-input', 'rename-input'].includes(event.target?.id)
    ) {
      setTimeout(() => {
        if (
          !['msg-input', 'rename-input'].includes(document.activeElement?.id)
        ) {
          handleKeyboardState(false);
          stabilizeMobileKeyboardViewport();
        }
      }, 60);
    }
  },
  true,
);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    retryConversationDecryption();
  }
});

window.addEventListener('beforeunload', () => {
  disconnectSocketForPageExit();
});

window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    return;
  }

  disconnectSocketForPageExit();
});

window.addEventListener('online', () => {
  retryConversationDecryption();
  void flushOfflineQueuedMessages().catch((error) => {
    console.error('Failed to flush offline queue after reconnect', error);
  });
  void processAttachmentUploadQueue().catch((error) => {
    console.error('Failed to resume uploads after reconnect', error);
  });
});

window.addEventListener('resize', syncLayout);
window.addEventListener('resize', enforceLockedMobileViewport);
window.addEventListener('resize', scheduleViewportHeight);
window.addEventListener('resize', updateChatActionsMenuPosition);
window.addEventListener('pageshow', enforceLockedMobileViewport);
window.addEventListener(
  'scroll',
  () => {
    updateChatActionsMenuPosition();
  },
  true,
);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallAppUI();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallAppUI();
});

window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) {
    return;
  }

  activeDragCounter += 1;
  updateChatDropzoneState(Boolean(selectedUser));
});

window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) {
    return;
  }

  event.preventDefault();
  if (selectedUser) {
    event.dataTransfer.dropEffect = 'copy';
    updateChatDropzoneState(true);
  }
});

window.addEventListener('dragleave', () => {
  activeDragCounter = Math.max(0, activeDragCounter - 1);
  if (activeDragCounter === 0) {
    updateChatDropzoneState(false);
  }
});

window.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files?.length) {
    return;
  }

  event.preventDefault();
  activeDragCounter = 0;
  updateChatDropzoneState(false);
  void handleAttachmentDrop(Array.from(event.dataTransfer.files)).catch(
    (error) => {
      console.error('Failed to queue dropped files', error);
    },
  );
});

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleViewportHeight);
  window.visualViewport.addEventListener(
    'resize',
    stabilizeMobileKeyboardViewport,
  );
  window.visualViewport.addEventListener(
    'scroll',
    stabilizeMobileKeyboardViewport,
  );
}

getById('message-container')?.addEventListener(
  'touchmove',
  () => {
    blockMessageActionsWhileScrolling();
  },
  { passive: true },
);

getById('message-container')?.addEventListener(
  'scroll',
  () => {
    blockMessageActionsWhileScrolling();
  },
  { passive: true },
);
getById('settings-admin-refresh-btn')?.addEventListener('click', async () => {
  try {
    await loadAdminUsers();
  } catch (error) {
    console.error(error);
    setAdminUsersState(
      error?.message || 'Failed to load admin users.',
      'error',
    );
    alert(error?.message || 'Failed to load admin users.');
  }
});
getById('settings-admin-search-input')?.addEventListener('input', () => {
  renderAdminUsers();
});
getById('settings-admin-users')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-admin-action]');
  if (!button) {
    return;
  }

  try {
    if (button.dataset.adminAction === 'approve') {
      await approveAdminUser(button.dataset.userId);
      return;
    }

    if (button.dataset.adminAction === 'ban') {
      await banAdminUser(button.dataset.userId);
      return;
    }

    if (button.dataset.adminAction === 'unban') {
      await unbanAdminUser(button.dataset.userId);
      return;
    }

    if (button.dataset.adminAction === 'remove-admin') {
      await removeAdminRoleFromUser(button.dataset.userId);
      return;
    }

    if (button.dataset.adminAction === 'delete-user') {
      await deleteAdminUserPermanently(button.dataset.userId);
    }
  } catch (error) {
    console.error(error);
    alert(error?.message || 'Failed to update the user.');
  }
});

enforceLockedMobileViewport();
applyViewportHeight();
updateInstallAppUI();
updateVoiceComposerUI();
renderAttachmentUploadQueue();
renderSpecialMessageDraftPreview();
bindChatActionsMenu();
ensureServiceWorkerReady().catch((error) => {
  console.error(error);
});
syncLayout();
configLoadPromise = loadPublicConfig();
configLoadPromise.finally(() => {
  processAuthLink().finally(() => {
    restoreSession();
  });
});
