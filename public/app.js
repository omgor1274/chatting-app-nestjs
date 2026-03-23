const isFileOrigin = window.location.protocol === 'file:';
const isDesktopRuntime = Boolean(window.desktopApp?.isDesktop);
const defaultApiOrigin =
  window.__OCHAT_RUNTIME_CONFIG__?.defaultApiOrigin || 'http://localhost:8080';
const localBackendOrigin = defaultApiOrigin;
const isHostedOrigin =
  !isFileOrigin && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
let appConfig = {
  apiUrl: localBackendOrigin,
  avatarBaseUrl: '/icons/default-avatar.svg',
  stunServers: ['stun:stun.l.google.com:19302'],
};
let API_URL = appConfig.apiUrl;
let configLoadPromise = null;
const DEFAULT_AVATAR_URL = '/icons/default-avatar.svg';
let socket = null;
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
let replyTarget = null;
let offlineQueuedMessages = [];
let activeDragCounter = 0;
let ringtonePreference = 'classic';
let callHistoryByConversation = new Map();
let missedCallCountsByConversation = new Map();
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
const MESSAGE_ACTION_TOUCH_HOLD_MS = 750;
const MESSAGE_ACTION_MOVE_TOLERANCE_PX = 6;
const MESSAGE_ACTION_SCROLL_BLOCK_MS = 700;
const MAX_ATTACHMENT_UPLOAD_AUTO_RETRIES = 4;
let messageActionScrollBlockedUntil = 0;
const MATROSKA_ATTACHMENT_MIME_TYPES = new Set([
  'video/x-matroska',
  'video/matroska',
  'video/mkv',
  'application/x-matroska',
]);

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
let rtcConfig = {
  iceServers: appConfig.stunServers.map((urls) => ({ urls })),
};
let sharedMediaItems = [];
let sharedMediaLoading = false;
let sharedMediaErrorMessage = '';
let sharedMediaBrowserKind = 'image';
const OFFLINE_QUEUE_KEY = 'ochat_offline_message_queue';
const RINGTONE_PREFERENCE_KEY = 'ochat_ringtone_preference';
const CLIENT_CACHE_VERSION = '20260323-smooth20';
const CHAT_SHELL_CACHE_TTL_MS = 2 * 60 * 1000;
const CHAT_SHELL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_CACHE_TTL_MS = 90 * 1000;
const CONVERSATION_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_PERSISTED_CONVERSATIONS = 4;
const MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 24;
const CACHE_PERSIST_DEBOUNCE_MS = 180;
let activeIncomingRingtone = null;
let shellCachePersistTimer = 0;
let conversationCachePersistTimer = 0;
let backgroundUsersRefreshTimer = 0;
let backgroundUsersRefreshPromise = null;
let conversationDraftPersistTimer = 0;
const surfaceRefreshTimers = new Map();
let pendingUserListPreviewSyncTimer = 0;

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
  if (!key) {
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
  if (!key) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Failed to write stored JSON', error);
  }
}

function removeStoredValue(storage, key) {
  if (!key) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch (error) {
    console.warn('Failed to remove stored value', error);
  }
}

function readStoredJson(key, fallbackValue) {
  return readStorageJson(window.localStorage, key, fallbackValue);
}

function writeStoredJson(key, value) {
  writeStorageJson(window.localStorage, key, value);
}

function readSessionJson(key, fallbackValue) {
  return readStorageJson(window.sessionStorage, key, fallbackValue);
}

function writeSessionJson(key, value) {
  writeStorageJson(window.sessionStorage, key, value);
}

function removeSessionValue(key) {
  removeStoredValue(window.sessionStorage, key);
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
  messageReactionsById = new Map(
    Object.entries(
      readStoredJson(getScopedPreferenceKey('message_reactions'), {}),
    ),
  );
  conversationDrafts = new Map(
    Object.entries(readStoredJson(getScopedPreferenceKey('chat_drafts'), {})),
  );
  callHistoryByConversation = new Map(
    Object.entries(
      readStoredJson(getScopedPreferenceKey('call_history'), {}),
    ),
  );
  missedCallCountsByConversation = new Map(
    Object.entries(
      readStoredJson(getScopedPreferenceKey('missed_calls'), {}),
    ).map(([key, value]) => [key, Number(value) || 0]),
  );
  offlineQueuedMessages = readStoredJson(OFFLINE_QUEUE_KEY, []);
  ringtonePreference =
    localStorage.getItem(RINGTONE_PREFERENCE_KEY) || 'classic';
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

  if (String(path).startsWith('http://') || String(path).startsWith('https://')) {
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

function clearKeyBackupUnlockMaterial(userId) {
  keyBackupRuntime().clearKeyBackupUnlockMaterial?.(userId);
}

async function encryptPrivateKeyBackupForUser(privateKey, userId, unlockMaterial) {
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

  const storedPrivateKey = localStorage.getItem(
    privateKeyStorageKey(currentUser.id),
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

    localStorage.setItem(
      privateKeyStorageKey(currentUser.id),
      restoredPrivateKey,
    );
    if (currentUser.publicKey) {
      localStorage.setItem(
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
    base64ToUint8Array(publicKey),
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
    base64ToUint8Array(privateKey),
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['decrypt'],
  );
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

  localStorage.setItem(privateKeyStorageKey(userId), privateKey);
  localStorage.setItem(publicKeyStorageKey(userId), publicKey);

  return {
    privateKey,
    publicKey,
  };
}

async function ensureEncryptionKeys(forceSync = false) {
  if (!currentUser?.id || !canUseE2EE()) {
    return;
  }

  let savedPrivateKey = localStorage.getItem(
    privateKeyStorageKey(currentUser.id),
  );
  let savedPublicKey = localStorage.getItem(
    publicKeyStorageKey(currentUser.id),
  );
  let generatedNewKeyPair = false;
  const hasServerKeyBackup = Boolean(
    currentUser.privateKeyBackupCiphertext && currentUser.privateKeyBackupIv,
  );
  let restoredFromServerKeyBackup = false;

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
        savedPrivateKey = restoredPrivateKey;
        savedPublicKey = currentUser.publicKey;
        restoredFromServerKeyBackup = true;
        localStorage.setItem(
          privateKeyStorageKey(currentUser.id),
          restoredPrivateKey,
        );
        localStorage.setItem(
          publicKeyStorageKey(currentUser.id),
          currentUser.publicKey,
        );
      }
    } catch (error) {
      console.error('Failed to restore your message decryption key', error);
    }
  }

  if (!savedPrivateKey || !savedPublicKey) {
    if (hasServerKeyBackup && !restoredFromServerKeyBackup) {
      throw new Error(
        'Please log in again on this device so O-chat can unlock your encrypted messages.',
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

  if (forceSync || currentUser.publicKey !== savedPublicKey || shouldSyncBackup) {
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
    const encryptedKeyMap = JSON.parse(message.encryptedKey || '{}');
    const wrappedKey = encryptedKeyMap[currentUser?.id];
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
      : `direct:${
          message.senderId === currentUser?.id
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

function sortMessagesChronologically(messages) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.createdAt || 0).getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
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

  const messages = sortMessagesChronologically(state.conversationMessages.values())
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
            : Number(recentActivity.get(conversationId)?.lastAt || state?.fetchedAt || 0),
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
        ...createMessagePaginationState(item.pagination?.loadedForUserId ?? null),
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
  removeStoredValue(window.localStorage, getShellCacheKey());
  removeSessionValue(getConversationCacheKeyForStorage());
}

function prefetchSettingsShell() {
  const hrefs = ['/settings', '/public/settings.js?v=20260323-smooth3'];

  hrefs.forEach((href) => {
    if (document.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  });
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

function encodeReplyPayload(replyMeta) {
  if (!replyMeta) {
    return '';
  }

  try {
    return window.btoa(
      unescape(
        encodeURIComponent(
          JSON.stringify({
            id: replyMeta.id,
            senderName: String(replyMeta.senderName || ''),
            preview: String(replyMeta.preview || ''),
          }),
        ),
      ),
    );
  } catch (error) {
    console.error('Failed to encode reply payload', error);
    return '';
  }
}

function decodeReplyPayload(payload) {
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(escape(window.atob(payload))));
  } catch {
    return null;
  }
}

function applyStructuredMessageData(message, rawText) {
  const text = String(rawText || '');
  const match = text.match(/^\[\[OCHAT_REPLY:([A-Za-z0-9+/=_-]+)\]\]\n?/);
  if (!match) {
    message.replyMeta = null;
    return text;
  }

  const replyMeta = decodeReplyPayload(match[1]);
  if (!replyMeta) {
    message.replyMeta = null;
    return text;
  }

  message.replyMeta = {
    id: String(replyMeta.id || ''),
    senderName: String(replyMeta.senderName || 'Message'),
    preview: String(replyMeta.preview || ''),
  };
  return text.slice(match[0].length);
}

function encodeMessageForSend(text, replyMeta = replyTarget) {
  const trimmed = String(text || '').trim();
  if (!replyMeta) {
    return trimmed;
  }

  const encoded = encodeReplyPayload(replyMeta);
  if (!encoded) {
    return trimmed;
  }

  return `[[OCHAT_REPLY:${encoded}]]\n${trimmed}`;
}

function getMessageReaction(messageId) {
  return String(messageReactionsById.get(messageId) || '');
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

function getMessageBubbleElement(messageId) {
  return getById(`message-${messageId}`)?.querySelector('.message-bubble-shell');
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
  triggerMotionClass(
    getMessageBubbleElement(messageId),
    'message-bubble-processing',
    300,
  );
  if (getMessageReaction(messageActionTarget.id) === emoji) {
    messageReactionsById.delete(messageActionTarget.id);
  } else {
    messageReactionsById.set(messageActionTarget.id, emoji);
  }

  persistMessageReactions();
  if (conversationMessages.has(messageActionTarget.id)) {
    replaceRenderedMessage(
      conversationMessages.get(messageActionTarget.id) || messageActionTarget,
    );
  }
  renderStarredMessages();
  renderSidebarStarredHub();
  closeMessageActions();
  pulseMessageBubble(messageId);
}

function getSidebarPinnedConversations() {
  return getSortedUsers().filter((user) => isConversationPinned(user)).slice(0, 6);
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
          <img src="${userAvatar(user)}" alt="" class="h-10 w-10 rounded-2xl object-cover" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(displayName(user))}</p>
            <p class="mt-1 truncate text-xs text-slate-500">${escapeHtml((recentActivity.get(user.id)?.preview || 'Pinned chat'))}</p>
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

  count.textContent = `${starred.length} recent starred message${
    starred.length === 1 ? '' : 's'
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
    const preview = `${getResolvedMessageText(message)} ${message.fileName || ''}`.toLowerCase();
    const isMedia =
      message.messageType === 'IMAGE' ||
      String(message.fileMimeType || '').startsWith('video/');
    const isFile = message.messageType === 'DOCUMENT' || message.messageType === 'AUDIO';

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

function renderConversationSearchResults(matches = getConversationSearchMatches()) {
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
    summary.textContent = 'Search loaded messages, jump by date, or filter media.';
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

  const targetMessage = sortMessagesChronologically(conversationMessages.values()).find(
    (message) => {
      const created = new Date(message.createdAt);
      return !Number.isNaN(created.getTime()) &&
        created.toISOString().slice(0, 10) === dateValue;
    },
  );

  if (targetMessage) {
    scrollToMessageInConversation(targetMessage.id);
    renderConversationSearchResults([targetMessage]);
    return;
  }

  renderConversationSearchResults([]);
}

async function loadOlderMessagesForSearch() {
  if (!selectedUser || !messagePagination.hasMore || messagePagination.loadingOlder) {
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
  localStorage.setItem(RINGTONE_PREFERENCE_KEY, nextValue);
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

function removeOptimisticMessage(messageId) {
  if (!messageId) {
    return;
  }

  renderedMessageIds.delete(messageId);
  conversationMessages.delete(messageId);
  document.getElementById(`message-${messageId}`)?.remove();
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

  const pendingId = queue.shift();
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

function createOptimisticTextMessage(text, user = selectedUser) {
  const now = new Date().toISOString();
  const structuredText = encodeMessageForSend(text);
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
        rtcConfig = {
          iceServers: (appConfig.stunServers || [])
            .filter(Boolean)
            .map((urls) => ({ urls })),
        };
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
    xhr.timeout = 90 * 1000;

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
  const mimeType = String(file?.type || '').trim().toLowerCase();
  const fileName = String(file?.name || '').trim().toLowerCase();

  if (MATROSKA_ATTACHMENT_MIME_TYPES.has(mimeType) || fileName.endsWith('.mkv')) {
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
    xhr.open('POST', `${API_URL}/chat/uploads/sessions/${encodeURIComponent(sessionId)}/chunks`);
    xhr.timeout = 90 * 1000;

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
      const abortReason = xhr.__chatAbortReason === 'paused' ? 'paused' : 'cancelled';
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
    id: `upload-task-${Date.now()}-${nextAttachmentUploadTaskId += 1}`,
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
  if (
    !file ||
    !String(file.type || '').startsWith('image/') ||
    file.size <= 2.5 * 1024 * 1024
  ) {
    return file;
  }

  try {
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const maxWidth = 1920;
    const scale = Math.min(1, maxWidth / imageBitmap.width);
    canvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
    canvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
    imageBitmap.close();
    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File(
      [blob],
      file.name.replace(/\.[^.]+$/, '.jpg'),
      { type: 'image/jpeg', lastModified: file.lastModified || Date.now() },
    );
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
      if (['queued', 'uploading', 'retrying', 'finalizing'].includes(task.status)) {
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

  if (task.status === 'queued' || task.status === 'uploading' || task.status === 'retrying') {
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
  if (!sendStatus || composerSendInFlight) {
    return;
  }

  const { active, pending, failed } = getAttachmentQueueCounts();
  if (offlineQueuedMessages.length > 0) {
    sendStatus.textContent =
      offlineQueuedMessages.length === 1
        ? '1 message is queued offline.'
        : `${offlineQueuedMessages.length} messages are queued offline.`;
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
            Math.min(100, Math.round((task.progressBytes / task.file.size) * 100)),
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
              : formatUploadProgress(task.progressBytes, task.file.size);
      const actionButton = renderAttachmentQueueActionButtons(task);

      return `
        <div class="rounded-[20px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
          <div class="flex items-start gap-3">
            ${
              task.previewUrl
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

function shouldAttemptDirectAttachmentUploadFallback(task, error) {
  if (
    !task?.file ||
    !task?.conversation ||
    task.directUploadFallbackAttempted ||
    task.pauseRequested ||
    !navigator.onLine
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

    const data = await uploadChunkWithProgress(
      task.sessionId,
      nextChunkIndex,
      chunkBlob,
      (loaded) => {
        task.progressBytes = Math.min(task.file.size, confirmedBytes + loaded);
        renderAttachmentUploadQueue();
      },
    );

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
      String(error?.message || '').toLowerCase().includes('paused')
    ) {
      nextTask.status = 'paused';
      nextTask.errorMessage = 'Upload paused';
      nextTask.pauseRequested = false;
    } else if (
      error?.code === 'UPLOAD_CANCELLED' ||
      String(error?.message || '').toLowerCase().includes('cancel')
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
          console.error('Failed to sync upload after recoverable error', syncError);
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

function queuePendingAttachmentUploads(conversationKey = getSelectedConversationTaskKey()) {
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
  const acceptedFiles = Array.from(files || []).filter((file) => file && file.size);
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

function resetSelectedConversation() {
  rememberActiveConversationScroll();
  selectedUser = null;
  detachedSelectedUser = false;
  clearReplyTarget();
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
  closeChatActionsMenu();
  closeComposerActionsMenu();
  if (!isFileOrigin) {
    sessionStorage.setItem(LAST_CHAT_ROUTE_KEY, '/chat');
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
  const badge = getById('chat-count');
  if (badge) {
    badge.innerText = String(users.length);
  }
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

  users = payload.users
    .map((user) => normalizeUser(user))
    .filter(Boolean);
  groupInvites = Array.isArray(payload.groupInvites) ? payload.groupInvites : [];
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

function handleUserSearchInput() {
  const query = document.getElementById('user-search')?.value.trim().toLowerCase();
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
    ? 'Welcome Back'
    : 'Create Account';
  document.getElementById('auth-subtitle').innerText = isLogin
    ? 'Login to continue.'
    : 'Create your account to start chatting.';
  document.getElementById('auth-switch').innerText = isLogin
    ? 'New here? Create an account'
    : 'Already have an account? Login';
  document.getElementById('auth-btn').innerText = isLogin
    ? 'Login'
    : 'Register';
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
  document.documentElement.classList.add('theme-switching');
  document.body.classList.toggle('dark-mode', Boolean(enabled));
  localStorage.setItem('chat_dark_mode', enabled ? '1' : '0');
  const darkModeInput = document.getElementById('settings-darkmode-input');
  if (darkModeInput) {
    darkModeInput.checked = Boolean(enabled);
  }
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

  renderBlockedUsers();
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
                <img src="${userAvatar(user)}" class="h-11 w-11 rounded-2xl object-cover">
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

function filterBlockedDirectUsers(collection, blockedIds = getBlockedUserIdSet()) {
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
  const nextSearchResults = filterBlockedDirectUsers(userSearchResults, blockedIds);
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

function applyChatTheme() {
  const container = document.getElementById('message-container');
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
    container.style.setProperty('--chat-theme-background', 'none');
    container.style.setProperty(
      '--chat-theme-base-color',
      isDarkMode ? '#020617' : '#f8fafc',
    );
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

function updateSidebarCurrentUser() {
  const avatar = document.getElementById('sidebar-current-user-avatar');
  const name = document.getElementById('sidebar-current-user-name');
  const email = document.getElementById('sidebar-current-user-email');

  if (!avatar || !name || !email) {
    return;
  }

  if (!currentUser) {
    avatar.src = DEFAULT_AVATAR_URL;
    avatar.alt = 'Your profile photo';
    name.innerText = 'Your profile';
    email.innerText = 'Open Settings to manage your account.';
    return;
  }

  avatar.src = userAvatar(currentUser);
  avatar.alt = `${baseName(currentUser)} profile photo`;
  name.innerText = currentUser.name || displayName(currentUser);
  email.innerText =
    currentUser.email || 'Open Settings to manage your account.';
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
  document.getElementById('composer-actions-menu').classList.toggle('hidden');
  closeChatActionsMenu();
}

function closeComposerActionsMenu() {
  document.getElementById('composer-actions-menu').classList.add('hidden');
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
    count.textContent = `${sharedMediaItems.length} shared item${
      sharedMediaItems.length === 1 ? '' : 's'
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

  photosTab.className = `${tabBaseClass} ${
    isPhotoView
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
  }`;
  videosTab.className = `${tabBaseClass} ${
    !isPhotoView
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
  }`;

  if (sharedMediaLoading) {
    empty.classList.add('hidden');
    grid.innerHTML = Array.from({ length: 4 })
      .map(
        () => `
          <div class="overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3">
            <div class="h-44 animate-pulse rounded-[20px] bg-slate-100"></div>
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
        formatShortDate(item.createdAt) || formatRelativeTime(item.createdAt) || '',
      );

      if (item.kind === 'video') {
        return `
          <div class="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <button type="button" onclick="openSharedMediaItem('${itemId}')" class="block w-full overflow-hidden bg-slate-950 text-left">
              <div class="relative h-48 bg-slate-950">
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
            <img src="${fileUrl}" alt="${label}" loading="lazy" decoding="async" class="h-48 w-full object-cover">
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
  const requestedConversationKey = getConversationCacheKey(requestedConversation);
  sharedMediaItems = [];
  sharedMediaLoading = true;
  sharedMediaErrorMessage = '';
  renderSharedMedia();

  try {
    const query = isGroupConversation(requestedConversation)
      ? `groupId=${encodeURIComponent(requestedConversation.id)}`
      : `userId=${encodeURIComponent(requestedConversation.id)}`;
    const res = await api(`/chat/media?${query}`);
    const data = await readJsonResponse(res, [], 'Failed to load shared media.');

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
    className: `text-sm font-medium ${
      activeTypingUsers.length
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
  const manageGroupBtn = document.getElementById('contact-manage-group-btn');

  if (!panelTitle || !avatar || !name || !status) {
    return;
  }

  if (!selectedUser) {
    panelTitle.innerText = 'Contact info';
    name.innerText = 'Contact';
    status.innerText = 'Offline';
    status.className = 'mt-1 text-sm font-medium text-slate-500';
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
  manageGroupBtn?.classList.toggle('hidden', !isGroup);
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
  const viewportHeight =
    window.innerWidth < 1024 && window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

  document.documentElement.style.setProperty(
    '--app-shell-height',
    `${Math.round(viewportHeight)}px`,
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

function stabilizeMobileKeyboardViewport() {
  if (window.innerWidth >= 1024) {
    return;
  }

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
      token = authToken;
      localStorage.setItem('chat_token', token);
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
  await loadProfile();
  loadLocalConversationPreferences();
  restoreChatShellCache();
  restoreConversationHistoryCacheFromSession();
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

  if (!users.length || !hasRequestedConversation) {
    await Promise.all([
      ensureEncryptionKeys(true),
      loadUsers(),
    ]);
  } else {
    await ensureEncryptionKeys(true);
    scheduleUsersRefreshInBackground({
      minAgeMs: CHAT_SHELL_CACHE_TTL_MS,
    });
  }

  prefetchSettingsShell();
  connectSocket();
  void setupNotifications().catch((error) => {
    console.warn('Push notification setup skipped', error);
  });

  if (groupId) {
    await selectUser(groupId);
    return;
  }
  if (chatId) {
    if (!findKnownDirectUserById(chatId)) {
      try {
        await loadUserSearchResults(chatId);
      } catch (error) {
        console.warn('Detached chat lookup skipped', error);
      }
    }
    await selectUser(chatId);
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
    const [recentRes, invitesRes] = await Promise.all([
      api('/chat/recent'),
      api('/chat/groups/invites'),
    ]);

    if (!recentRes.ok || !invitesRes.ok) {
      throw new Error('Failed to load users');
    }

    const recentUsers = await readJsonResponse(
      recentRes,
      [],
      'Failed to load recent chats.',
    );
    groupInvites = await readJsonResponse(
      invitesRes,
      [],
      'Failed to load group invites.',
    );

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
  const query = document.getElementById('user-search')?.value.trim().toLowerCase();
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
  const missedCalls = Number(missedCallCountsByConversation.get(getConversationCacheKey(user)) || 0);
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
  return {
    state,
    previewText: draft ? `Draft: ${draft}` : state.preview || 'No recent messages yet',
    previewToneClass: draft
      ? 'font-semibold text-amber-600'
      : state.unread
        ? 'font-semibold text-slate-700'
        : 'text-slate-400',
  };
}

function scheduleUserListDraftPreviewSync(
  user = selectedUser,
  options = {},
) {
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
  const { state, previewText, previewToneClass } = getUserListPreviewMeta(user);
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
  item.className = `cursor-pointer rounded-[20px] border px-1.5 py-1 transition-all ${
    isSelected
      ? 'border-blue-200 bg-blue-50 shadow-sm'
      : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
  }`;
  item.classList.add('chat-list-card');
  item.onclick = () => selectUser(user.id);
  item.innerHTML = `
        <div class="flex items-center gap-2.5 rounded-[16px] p-1.5">
          <div class="relative shrink-0">
            <img src="${userAvatar(user)}" loading="lazy" decoding="async" class="h-10 w-10 rounded-[14px] object-cover shadow-sm">
            ${
              isGroupConversation(user)
                ? `<span class="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-slate-900 px-1 py-[1px] text-[9px] font-bold uppercase tracking-wide text-white">G</span>`
                : `<span class="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}"></span>`
            }
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="min-w-0 flex-1 truncate text-[0.82rem] font-bold text-slate-900">${escapeHtml(displayName(user))}</p>
              ${badges}
            </div>
            <p class="user-list-preview mt-0.5 truncate text-[11px] leading-4 ${previewToneClass}">
              ${escapeHtml(previewText)}
            </p>
          </div>
          <div class="flex flex-col items-end gap-1">
            ${
              missedCalls
                ? `<span class="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">${missedCalls} missed</span>`
                : ''
            }
            ${state.unread ? `<span class="flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">${state.unread}</span>` : ''}
          </div>
        </div>
      `;

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
  const item = Array.from(list.children).find((child) => child.dataset.userKey === key);
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

  const nextPreviewClassName =
    `user-list-preview mt-0.5 truncate text-[11px] leading-4 ${previewToneClass}`;
  if (preview.className !== nextPreviewClassName) {
    preview.className = nextPreviewClassName;
  }
  renderedUserSignatures.set(key, getUserRenderSignature(user));
}

function renderUsers() {
  const list = getById('users-list');
  const sortedUsers = getSortedUsers();
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
}

function updateArchivedChatsToggle() {
  const button = getById('archived-chats-toggle');
  if (!button) {
    return;
  }

  const archivedCount = users.filter((user) => isConversationArchived(user)).length;
  button.classList.toggle('hidden', archivedCount === 0 && !showArchivedChats);
  button.textContent = showArchivedChats
    ? 'Back to Active Chats'
    : `Show Archived${archivedCount ? ` (${archivedCount})` : ''}`;
}

function toggleArchivedChatsView() {
  showArchivedChats = !showArchivedChats;
  renderUsers();
}

function scrollToMessageInConversation(messageId) {
  const element = document.getElementById(`message-${messageId}`);
  if (!element) {
    alert('That starred message is not loaded yet. Scroll up to load older messages.');
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

  count.textContent = `${starred.length} starred message${
    starred.length === 1 ? '' : 's'
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
  if (!socket) {
    return;
  }

  try {
    socket.disconnect();
  } catch (error) {
    console.warn('Failed to close realtime connection during page exit', error);
  } finally {
    socket = null;
  }
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
  }

  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
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
      payload.senderId === currentUser.id ? payload.receiverId : payload.senderId;

    if (isIncomingPending && otherUserId) {
      let otherUser =
        users.find((user) => !isGroupConversation(user) && user.id === otherUserId) ||
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
      (payload.senderId === selectedUser.id || payload.receiverId === selectedUser.id)
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
    appendMessage(hydratedMessage, {
      stickToBottom: true,
    });
    if (!isOwnMessage) {
      void markSelectedConversationRead();
    }
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
  const requestedConversationKey = getConversationCacheKey(requestedConversation);

  const conversationState = activateConversationHistory(selectedUser);

  if (!detachedSelectedUser && !users.some((user) => user.id === selectedUser.id)) {
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
  restoreComposerDraft(selectedUser);
  closeChatContactPanel();
  closeChatActionsMenu();
  closeComposerActionsMenu();
  triggerMotionClass(document.getElementById('chat-header'), 'chat-chrome-enter');
  triggerMotionClass(document.getElementById('input-area'), 'chat-chrome-enter');
  triggerMotionClass(document.getElementById('messages-list'), 'chat-chrome-enter');

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
    if (isConversationStillActive(requestedConversation, requestedConversationKey)) {
      setMessageLoadingState(false);
      alert(error.message || 'Failed to load this chat');
    }
    return;
  }

  if (!isConversationStillActive(requestedConversation, requestedConversationKey)) {
    return;
  }

  if (!isFileOrigin) {
    const nextRoute = isGroupConversation(selectedUser)
      ? `/chat?group=${selectedUser.id}`
      : `/chat?chat=${selectedUser.id}`;
    sessionStorage.setItem(LAST_CHAT_ROUTE_KEY, nextRoute);
    history.replaceState(
      null,
      '',
      nextRoute,
    );
  }
}

async function loadMessageChunk(before = null, prepend = false, options = {}) {
  if (!selectedUser) {
    return;
  }

  const requestedConversation = selectedUser;
  const requestedConversationKey = getConversationCacheKey(requestedConversation);
  if (options.background && requestedConversationKey === activeConversationCacheKey) {
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
    if (!isConversationStillActive(requestedConversation, requestedConversationKey)) {
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
      for (const message of sortMessagesChronologically(mergedMessages.values())) {
        state.conversationMessages.set(message.id, message);
      }
      state.initialized = true;
      if (!options.background) {
        state.scrollTop = null;
      }
      renderActiveConversationFromCache({
        restoreScroll: options.restoreScroll !== false && Boolean(options.background),
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
    if (isConversationStillActive(requestedConversation, requestedConversationKey)) {
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

  const res = await api(`/chat/permission?userId=${encodeURIComponent(user.id)}`);
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
  triggerMotionClass(getById('request-action-btn'), 'request-action-success', 460);
  triggerMotionClass(getById('request-reject-btn'), 'request-action-success', 460);
  triggerMotionClass(getById('chat-header'), 'chat-chrome-enter', 320);
}

function updateChatAccessUI() {
  const input = document.getElementById('msg-input');
  const fileInput = document.getElementById('file-input');
  const fileLabel = document.getElementById('share-file-label');
  const composerActionsBtn = document.getElementById('composer-actions-btn');
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
  clearThemeBtn?.classList.toggle('hidden', isGroup || !selectedUser?.chatTheme);
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

function replaceRenderedMessage(message) {
  if (!message?.id) {
    return;
  }

  updateCachedMessageEverywhere(message);
  conversationMessages.set(message.id, message);
  const existing = document.getElementById(`message-${message.id}`);
  if (!existing) {
    if (belongsToSelectedConversation(message)) {
      appendMessage(message);
    }
    return;
  }

  const next = createMessageElement(message, { animate: false });
  existing.replaceWith(next);
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
  document.getElementById(`message-${messageId}`)?.remove();
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

function updateRecentActivity(userId, message, incrementUnread, options = {}) {
  const current = recentActivity.get(userId) || {
    lastAt: 0,
    preview: '',
    unread: 0,
  };
  recentActivity.set(userId, {
    lastAt: new Date(message.createdAt || Date.now()).getTime(),
    preview: getMessagePreview(message),
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

function queueOfflineTextMessage(user, text) {
  const trimmed = String(text || '').trim();
  if (!user || !trimmed) {
    return false;
  }

  offlineQueuedMessages.push({
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: user.id,
    chatType: isGroupConversation(user) ? 'group' : 'direct',
    text: encodeMessageForSend(trimmed),
    createdAt: new Date().toISOString(),
  });
  persistOfflineQueuedMessages();
  const sendStatus = getById('chat-send-status');
  if (sendStatus) {
    sendStatus.textContent = `${offlineQueuedMessages.length} message${
      offlineQueuedMessages.length === 1 ? '' : 's'
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

      const encryptedPayload = await encryptTextForConversation(
        item.text,
        targetUser,
      );
      await emitSocketEvent('sendMessage', {
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

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!selectedUser || !socket || composerSendInFlight) return;

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
  const shouldTrackDraftSubmission = Boolean(text || voiceFile);
  const draftFingerprint = shouldTrackDraftSubmission
    ? buildDraftFingerprint({
        roomId: selectedConversationRoomId(conversationTarget),
        text,
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

  if (shouldTrackDraftSubmission && shouldSkipDuplicateDraft(draftFingerprint)) {
    return;
  }

  const optimisticMessage = text
    ? createOptimisticTextMessage(text, conversationTarget)
    : null;

  try {
    setComposerSendingState(
      true,
      pendingAttachmentCount && !text && !voiceFile
        ? 'Starting uploads'
        : voiceFile
          ? text
            ? 'Sending'
            : 'Uploading'
          : 'Sending',
    );
    if (shouldTrackDraftSubmission) {
      markDraftSubmitted(draftFingerprint);
      lastSubmittedDraftVersion = composerDraftVersion;
    }
    const canChat = await ensureChatPermissionReady(conversationTarget);
    if (!canChat) {
      alert('Accept a chat request before sending messages.');
      return;
    }

    if (!navigator.onLine || !socket?.connected) {
      if (text && queueOfflineTextMessage(conversationTarget, text)) {
        input.value = '';
        clearConversationDraft(conversationTarget);
        clearReplyTarget();
        return;
      }
      throw new Error('Realtime connection is not available.');
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
    }

    if (text) {
      const encryptedPayload = await encryptTextForConversation(
        encodeMessageForSend(text),
        conversationTarget,
      );
      await emitSocketEvent('sendMessage', {
        ...encryptedPayload,
        ...(isGroupConversation(conversationTarget)
          ? { groupId: conversationTarget.id }
          : { toUserId: conversationTarget.id }),
      });
    }

    socket.emit('typing', {
      ...(isGroupConversation(conversationTarget)
        ? { groupId: conversationTarget.id }
        : { toUserId: conversationTarget.id }),
      isTyping: false,
    });

    const queuedAttachments = queuePendingAttachmentUploads(selectedConversationKey);
    if (queuedAttachments > 0) {
      void processAttachmentUploadQueue();
    }

    if (voiceFile) {
      const uploadedVoiceMessage = await uploadAttachment(
        voiceFile,
        conversationTarget,
      );
      await handleIncomingMessage(uploadedVoiceMessage, true);
      clearRecordedAudio();
    }
    clearReplyTarget();
  } catch (error) {
    if (shouldTrackDraftSubmission) {
      clearDraftSubmissionGuard(draftFingerprint);
      lastSubmittedDraftVersion = -1;
    }
    if (optimisticMessage) {
      removeOptimisticMessage(optimisticMessage.id);
      const roomId = optimisticMessage.groupId || optimisticMessage.receiverId;
      const queue = pendingOptimisticMessageIdsByRoom.get(roomId) || [];
      pendingOptimisticMessageIdsByRoom.set(
        roomId,
        queue.filter((id) => id !== optimisticMessage.id),
      );
      if (!input.value.trim()) {
        input.value = text;
      }
    }
    alert(error.message || 'Failed to send message');
  } finally {
    setComposerSendingState(false);
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
          (isOutgoing ? 'Failed to withdraw request' : 'Failed to reject request'),
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
  await loadPeopleDirectory();
  const container = document.getElementById('create-group-members');
  document.getElementById('create-group-name').value = '';
  document.getElementById('create-group-avatar-input').value = '';
  syncGroupAvatarLabel(
    'create-group-avatar-input',
    'create-group-avatar-name',
    'No photo selected',
  );
  container.innerHTML = peopleDirectory
    .map(
      (user) => `
              <label class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <input type="checkbox" value="${user.id}" class="h-4 w-4 rounded border-slate-300">
                <img src="${userAvatar(user)}" class="h-10 w-10 rounded-xl object-cover">
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(displayName(user))}</p>
                  <p class="truncate text-xs text-slate-500">${escapeHtml(user.email || '')}</p>
                </div>
              </label>
            `,
    )
    .join('');
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

  await loadPeopleDirectory();

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
                <img src="${userAvatar(member)}" class="h-10 w-10 rounded-xl object-cover">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(member.name)}</p>
                  <p class="truncate text-xs text-slate-500">${escapeHtml(member.role)}${member.userId === currentUser.id ? ' · You' : ''}</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  ${
                    merged.role === 'ADMIN' &&
                    member.userId !== currentUser.id &&
                    member.role !== 'ADMIN'
                      ? `<button onclick="makeGroupAdmin('${member.userId}')" class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100">Make Admin</button>`
                      : ''
                  }
                  ${
                    merged.role === 'ADMIN' && member.userId !== currentUser.id
                      ? `<button onclick="removeMemberFromGroup('${member.userId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Remove</button>`
                      : ''
                  }
                </div>
              </div>
            `,
    )
    .join('');

  document.getElementById('manage-group-candidates').innerHTML = peopleDirectory
    .filter((person) => !memberIds.has(person.id))
    .map(
      (person) => `
            <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
              <img src="${userAvatar(person)}" class="h-10 w-10 rounded-xl object-cover">
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
    .join('');

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
  const reactionOptions = menu?.querySelectorAll('.message-reaction-option');
  messageActionTarget = message;
  if (starButton) {
    starButton.querySelector('span').textContent = isMessageStarred(message.id)
      ? 'Remove star'
      : 'Star message';
  }
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
  await startAttachmentUploads(files, buildUploadConversationTarget(selectedUser));
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
  await startAttachmentUploads(files, buildUploadConversationTarget(selectedUser));
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
  button.innerText = activeCall.switchingCamera ? 'Switching...' : 'Flip Camera';
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
  activeCall.peer = peer;
  activeCall.remoteStream = remoteStream;
  activeCall.targetUserId = targetUserId;
  activeCall.callType = callType;

  document.getElementById('remote-audio').srcObject = remoteStream;
  document.getElementById('remote-video').srcObject = remoteStream;

  peer.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
    if (callType === 'video') {
      document.getElementById('remote-video').classList.remove('hidden');
    }
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
      currentIndex >= 0
        ? (currentIndex + 1) % availableDeviceIds.length
        : 0;
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
    socket.emit('call:decline', { toUserId: payload.fromUserId });
    return;
  }

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
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit('call:answer', {
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
  document.getElementById('active-call-status').innerText = 'Connected';
  recordCallHistoryEntry(payload.fromUserId, {
    direction: 'outgoing',
    callType: payload.callType,
    status: 'connected',
  });
}

async function handleCallIce(payload) {
  if (!activeCall.peer || payload?.fromUserId !== activeCall.targetUserId) {
    return;
  }

  try {
    await activeCall.peer.addIceCandidate(payload.candidate);
  } catch (error) {
    console.error(error);
  }
}

function handleCallDecline(payload) {
  if (payload?.fromUserId !== activeCall.targetUserId) {
    return;
  }

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
    <div class="message-reply-snippet mb-3 rounded-2xl bg-black/5 px-3 py-2 text-left">
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
  const reaction = getMessageReaction(message?.id);
  if (!reaction) {
    return '';
  }

  return `
    <div class="mt-2">
      <span class="message-reaction-chip is-own-reaction">${escapeHtml(reaction)} <span>You</span></span>
    </div>
  `;
}

function createMessageElement(message, options = {}) {
  const div = document.createElement('div');
  const isSent = message.senderId === currentUser.id;
  const metaTone = isSent ? 'text-blue-100/90' : 'text-slate-500';
  const starredBadge = isMessageStarred(message.id)
    ? '<span class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Starred</span>'
    : '';
  div.id = `message-${message.id}`;
  div.className = `${isSent ? 'self-end' : 'self-start'} max-w-full`;
  if (options.animate !== false) {
    div.classList.add('chat-message-enter');
    div.style.setProperty('--message-enter-x', isSent ? '14px' : '-14px');
  }

  const bubbleTone = isSent
    ? `rounded-[18px] rounded-br-sm text-white shadow-sm ${
        message.isPending ? 'bg-blue-500/85' : 'bg-blue-600'
      }`
    : 'rounded-[18px] rounded-bl-sm border border-slate-200/90 bg-white/95 text-slate-800 shadow-sm';
  const eye = isSent
    ? `<span class="inline-flex items-center gap-1 ${messageWasRead(message) ? 'text-emerald-200' : 'opacity-70'}">${messageWasRead(message) ? '&#128065;' : ''}</span>`
    : '';
  const footer = `
          <div class="message-bubble-footer mt-2 flex items-center justify-end gap-1.5 text-[10px] ${metaTone}">
            ${starredBadge}
            ${message.isPending ? '<span class="font-semibold uppercase tracking-wide">Sending</span>' : ''}
            ${eye}
            <span>${escapeHtml(formatMessageTime(message.createdAt))}</span>
          </div>
        `;
  const replySnippet = renderMessageReplySnippetHtml(message, metaTone);
  const reactionChip = renderMessageReactionHtml(message);

  if (message.deletedForEveryoneAt) {
    div.innerHTML = `
            <div class="message-bubble-shell ${bubbleTone} w-fit max-w-[min(100%,40rem)] px-3 py-2 text-[13px] italic opacity-80">
              ${escapeHtml(message.senderId === currentUser.id ? 'You unsent this message.' : 'This message was deleted.')}
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (message.messageType === 'IMAGE' && message.fileUrl) {
    div.innerHTML = `
            <div class="message-bubble-shell ${bubbleTone} w-fit max-w-[min(100%,40rem)] overflow-hidden p-2">
              ${replySnippet}
              <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer">
                <img src="${API_URL}${message.fileUrl}" loading="lazy" decoding="async" class="mb-2 max-h-80 w-auto rounded-2xl border border-black/5">
              </a>
              <div class="flex flex-wrap items-center gap-3 text-xs ${metaTone}">
                <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold underline">Open image</a>
                <button class="font-semibold underline" onclick="downloadFile('${API_URL}${message.fileUrl}', '${escapeHtml(message.fileName || 'image')}')">Download</button>
              </div>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (message.messageType === 'AUDIO' && message.fileUrl) {
    div.innerHTML = `
            <div class="message-bubble-shell ${bubbleTone} w-fit max-w-[min(100%,40rem)] px-3 py-2.5">
              <div class="space-y-3">
                ${replySnippet}
                <p class="text-sm font-semibold">${escapeHtml(message.fileName || 'Voice message')}</p>
                <audio controls src="${API_URL}${message.fileUrl}" class="w-full max-w-md"></audio>
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
            <div class="message-bubble-shell ${bubbleTone} w-fit max-w-[min(100%,40rem)] overflow-hidden p-2">
              <div class="space-y-3">
                ${replySnippet}
                <video controls playsinline preload="metadata" class="max-h-80 w-full rounded-2xl border border-black/5 bg-black">
                  <source src="${API_URL}${message.fileUrl}" type="${escapeHtml(message.fileMimeType || 'video/mp4')}">
                  Your browser does not support the video tag.
                </video>
                <div class="flex flex-wrap items-center gap-3 text-xs ${metaTone}">
                  <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold underline">Open video</a>
                  <button class="font-semibold underline" onclick="downloadFile('${API_URL}${message.fileUrl}', '${escapeHtml(message.fileName || 'video')}')">Download</button>
                </div>
              </div>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else if (message.messageType === 'DOCUMENT' && message.fileUrl) {
    div.innerHTML = `
            <div class="message-bubble-shell ${bubbleTone} w-fit max-w-[min(100%,40rem)] px-3 py-2.5">
              <div class="space-y-2">
                ${replySnippet}
                <p class="text-sm font-semibold">${escapeHtml(message.fileName || 'Document')}</p>
                <p class="text-xs ${metaTone}">${formatBytes(message.fileSize)}</p>
                <div class="flex flex-wrap items-center gap-3 text-xs ${metaTone}">
                  <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold underline">Open file</a>
                  <button class="font-semibold underline" onclick="downloadFile('${API_URL}${message.fileUrl}', '${escapeHtml(message.fileName || 'file')}')">Download</button>
                </div>
              </div>
              ${footer}
              ${reactionChip}
            </div>
          `;
  } else {
    div.innerHTML = `
            <div class="message-bubble-shell ${bubbleTone} w-fit max-w-[min(100%,40rem)] px-3 py-2 text-[14px] leading-[1.55]">
              ${replySnippet}
              ${escapeHtml(getResolvedMessageText(message))}
              ${footer}
              ${reactionChip}
            </div>
          `;
  }

  div.querySelectorAll('img').forEach((image) => {
    image.addEventListener(
      'load',
      () => {
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
  };

  div.onpointerdown = (event) => {
    const isTouchLikePointer =
      event.pointerType === 'touch' ||
      event.pointerType === 'pen' ||
      !event.pointerType;

    if (!isTouchLikePointer) {
      return;
    }

    if (areMessageActionsBlockedByScroll()) {
      return;
    }

    clearHoldTimer();
    const holdX = event.clientX;
    const holdY = event.clientY;
    div._holdStartX = holdX;
    div._holdStartY = holdY;
    div._holdTimer = window.setTimeout(() => {
      div._holdTimer = null;
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

  const list = document.getElementById('messages-list');
  const fragment = document.createDocumentFragment();
  let appendedCount = 0;

  for (const message of messages) {
    if (!message || renderedMessageIds.has(message.id)) {
      continue;
    }

    if (!belongsToSelectedConversation(message)) {
      continue;
    }

    renderedMessageIds.add(message.id);
    conversationMessages.set(message.id, message);
    fragment.appendChild(createMessageElement(message, {
      animate: options.animate !== false,
    }));
    appendedCount += 1;
  }

  if (!appendedCount) {
    return;
  }

  list.appendChild(fragment);

  if (options.stickToBottom) {
    scheduleMessageContainerBottom();
  }
}

function appendMessage(message, options = {}) {
  appendMessages([message], {
    stickToBottom: options.stickToBottom !== false,
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
}

async function ensureServiceWorkerReady() {
  if (!canUseWebPush()) {
    return null;
  }

  if (!swRegistration) {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
  }

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
      localStorage.getItem(NOTIFICATION_PERMISSION_KEY) === '1';

    if (!alreadyRequested) {
      localStorage.setItem(NOTIFICATION_PERMISSION_KEY, '1');
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
    : `direct:${
        message.senderId === currentUser?.id
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

  disconnectSocketForPageExit();

  if (backgroundUsersRefreshTimer) {
    window.clearTimeout(backgroundUsersRefreshTimer);
    backgroundUsersRefreshTimer = 0;
  }

  localStorage.removeItem('chat_token');
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
  const savedToken = localStorage.getItem('chat_token');
  if (!savedToken) {
    document.documentElement.classList.remove('has-session-token');
    applyDarkMode(localStorage.getItem('chat_dark_mode') === '1');
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
    console.error(error);
    const message = String(error?.message || '').toLowerCase();
    const isAuthFailure =
      message.includes('expired') ||
      message.includes('unauthorized') ||
      message.includes('invalid token');

    if (isAuthFailure) {
      token = null;
      localStorage.removeItem('chat_token');
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

  if (!socket) {
    return;
  }

  socket.emit('typing', {
    ...(isGroupConversation(selectedUser)
      ? { groupId: selectedUser.id }
      : { toUserId: selectedUser.id }),
    isTyping: true,
  });

  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }

  typingTimeout = setTimeout(() => {
    socket.emit('typing', {
      ...(isGroupConversation(selectedUser)
        ? { groupId: selectedUser.id }
        : { toUserId: selectedUser.id }),
      isTyping: false,
    });
  }, 1200);
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
window.addEventListener('resize', scheduleViewportHeight);
window.addEventListener('resize', updateChatActionsMenuPosition);
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
  window.visualViewport.addEventListener('resize', stabilizeMobileKeyboardViewport);
  window.visualViewport.addEventListener('scroll', stabilizeMobileKeyboardViewport);
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

applyViewportHeight();
updateInstallAppUI();
updateVoiceComposerUI();
renderAttachmentUploadQueue();
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
