const isFileOrigin = window.location.protocol === 'file:';
    const isDesktopRuntime = Boolean(window.desktopApp?.isDesktop);
    const localBackendOrigin = 'http://localhost:3000';
    let appConfig = {
      apiUrl: localBackendOrigin,
      avatarBaseUrl: 'https://ui-avatars.com/api/',
      stunServers: ['stun:stun.l.google.com:19302'],
    };
    let API_URL = appConfig.apiUrl;
    let configLoadPromise = null;
    let socket = null;
      let token = null;
      let isLogin = true;
      let currentUser = null;
      let currentPrivateKey = null;
      let users = [];
    let peopleDirectory = [];
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
    let attachmentPreviewUrl = null;
    let usersRenderFrame = 0;
    let headerRenderFrame = 0;
    let historyScrollFrame = 0;
    let viewportHeightFrame = 0;
    let loadUsersPromise = null;
    let reloadUsersAfterCurrentLoad = false;
    let renderedUserSignatures = new Map();
    let messagePagination = {
      nextBefore: null,
      hasMore: false,
      loadingOlder: false,
      loadedForUserId: null,
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
      let manageGroupAvatarShouldClear = false;
      let presenceRefreshPromise = null;
      let groupDetailsCache = new Map();
    let activeCall = {
      peer: null,
      localStream: null,
      remoteStream: null,
      targetUserId: null,
      callType: null,
    };
    let rtcConfig = {
      iceServers: appConfig.stunServers.map((urls) => ({ urls })),
    };

    function getById(id) {
      return document.getElementById(id);
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

      if (!savedPrivateKey || !savedPublicKey) {
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
        savedPrivateKey = arrayBufferToBase64(
          await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
        );
        savedPublicKey = arrayBufferToBase64(
          await window.crypto.subtle.exportKey('spki', keyPair.publicKey),
        );
        localStorage.setItem(
          privateKeyStorageKey(currentUser.id),
          savedPrivateKey,
        );
        localStorage.setItem(publicKeyStorageKey(currentUser.id), savedPublicKey);
      }

      currentPrivateKey = await importPrivateEncryptionKey(savedPrivateKey);

      if (forceSync || currentUser.publicKey !== savedPublicKey) {
        const res = await api('/users/keys/public', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: savedPublicKey }),
        });
        const data = await readJsonResponse(
          res,
          {},
          'Failed to sync your encryption key.',
        );
        if (!res.ok) {
          throw new Error(data.message || 'Failed to sync your encryption key');
        }
        currentUser = { ...currentUser, publicKey: savedPublicKey };
      }
    }

    async function ensureSelectedConversationHasKeys() {
      if (!selectedUser) {
        throw new Error('No conversation selected');
      }

      if (isGroupConversation(selectedUser)) {
        const missingMemberKey = !(selectedUser.members || []).every(
          (member) => member.userId === currentUser.id || member.publicKey,
        );
        if (!selectedUser.members?.length || missingMemberKey) {
          const res = await api(`/chat/groups/${encodeURIComponent(selectedUser.id)}`);
          const data = await readJsonResponse(
            res,
            {},
            'Failed to load group encryption keys.',
          );
          if (!res.ok) {
            throw new Error(
              data.message || 'Failed to load group encryption keys',
            );
          }
          const merged = normalizeUser({ ...data, chatType: 'group' }, selectedUser);
          users = users.map((user) => (user.id === merged.id ? merged : user));
          selectedUser = merged;
        }
        return;
      }

      if (!selectedUser.publicKey) {
        await loadUsers();
        syncSelectedUser();
      }

      if (!selectedUser.publicKey) {
        throw new Error(
          `${displayName(selectedUser)} has not set up encryption yet.`,
        );
      }
    }

    async function encryptTextForConversation(plainText) {
      await ensureEncryptionKeys();
      await ensureSelectedConversationHasKeys();

      if (!currentPrivateKey || !currentUser?.publicKey) {
        throw new Error('Your encryption keys are not ready yet.');
      }

      const recipients = isGroupConversation(selectedUser)
        ? (selectedUser.members || []).map((member) => ({
            userId: member.userId,
            publicKey:
              member.userId === currentUser.id
                ? currentUser.publicKey
                : member.publicKey,
          }))
        : [
            { userId: currentUser.id, publicKey: currentUser.publicKey },
            { userId: selectedUser.id, publicKey: selectedUser.publicKey },
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
      if (!message?.isEncrypted || !message?.ciphertext) {
        return message?.content || message?.ciphertext || '';
      }

      if (message.displayText !== undefined) {
        return message.displayText;
      }

      try {
        await ensureEncryptionKeys();
        const encryptedKeyMap = JSON.parse(message.encryptedKey || '{}');
        const wrappedKey = encryptedKeyMap[currentUser?.id];
        if (!wrappedKey || !message.iv || !currentPrivateKey) {
          message.displayText = '[Encrypted message]';
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
          base64ToUint8Array(message.ciphertext),
        );
        message.displayText = new TextDecoder().decode(decrypted);
        return message.displayText;
      } catch (error) {
        console.error('Failed to decrypt message', error);
        message.displayText = '[Unable to decrypt message]';
        return message.displayText;
      }
    }

    async function hydrateMessage(message) {
      if (!message) {
        return message;
      }

      if (message.messageType === 'TEXT') {
        message.displayText = await decryptTextMessage(message);
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

    function messageWasRead(message) {
      return Number(message?.recipientCount || 0) > 0
        && Number(message?.readByCount || 0) >= Number(message?.recipientCount || 0);
    }

    async function loadPublicConfig() {
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
          rtcConfig = {
            iceServers: (appConfig.stunServers || [])
              .filter(Boolean)
              .map((urls) => ({ urls })),
          };
          return;
        } catch (error) {
          console.error(error);
        }
      }

      API_URL = localBackendOrigin;
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
      const chatType =
        user?.chatType ?? existingUser?.chatType ?? 'direct';

      return {
        ...merged,
        name,
        avatar,
        nickname,
        chatType,
        memberCount:
          user?.memberCount ?? existingUser?.memberCount ?? null,
        role: user?.role ?? existingUser?.role ?? null,
        members: user?.members ?? existingUser?.members ?? [],
        pendingInvites:
          user?.pendingInvites ?? existingUser?.pendingInvites ?? [],
        displayName:
          chatType === 'group'
            ? user?.displayName || existingUser?.displayName || name
            : nickname
            || user?.displayName
            || existingUser?.displayName
            || name,
      };
    }

    function resetSelectedConversation() {
      selectedUser = null;
      renderedMessageIds = new Set();
      conversationMessages = new Map();
      messagePagination = {
        nextBefore: null,
        hasMore: false,
        loadingOlder: false,
        loadedForUserId: null,
      };
      document.getElementById('messages-list').innerHTML = '';
      document.getElementById('empty-state').classList.remove('hidden');
      document.getElementById('chat-header').classList.add('hidden');
      document.getElementById('chat-header').classList.remove('flex');
      document.getElementById('message-container').classList.add('hidden');
      document.getElementById('message-container').classList.remove('flex');
      document.getElementById('input-area').classList.add('hidden');
      closeChatActionsMenu();
      closeComposerActionsMenu();
      if (!isFileOrigin) {
        history.replaceState(null, '', '/');
      }
    }

    function syncSelectedUser() {
      if (!selectedUser) {
        return;
      }

      const matchedUser = users.find((user) => user.id === selectedUser.id);
      if (!matchedUser) {
        resetSelectedConversation();
        return;
      }

      selectedUser = matchedUser;
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

    function handleUserSearchInput() {
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
        box.classList.add(
          'bg-slate-50',
          'border-slate-200',
          'text-slate-700',
        );
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
      document
        .getElementById('name-input')
        .classList.toggle('hidden', isLogin);
      document
        .getElementById('forgot-password-btn')
        .classList.add('hidden');
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
      document
        .getElementById('forgot-password-step')
        .classList.remove('hidden');
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
      document
        .getElementById('reset-password-step')
        .classList.remove('hidden');
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
      const otp = document
        .getElementById('verification-otp-input')
        .value.trim();

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
      document.body.classList.toggle('dark-mode', Boolean(enabled));
      localStorage.setItem('chat_dark_mode', enabled ? '1' : '0');
      const darkModeInput = document.getElementById(
        'settings-darkmode-input',
      );
      if (darkModeInput) {
        darkModeInput.checked = Boolean(enabled);
      }
      applyChatTheme();
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
      const confirmWrap = document.getElementById(
        'settings-email-confirm-wrap',
      );
      const confirmCopy = document.getElementById(
        'settings-email-confirm-copy',
      );
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
      document.getElementById('profile-name-input').value =
        currentUser.name || '';
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

    async function loadBlockedUsers() {
      const res = await api('/users/blocks');
      const data = await readJsonResponse(
        res,
        [],
        'Failed to load blocked users.',
      );
      if (!res.ok) {
        throw new Error(data.message || 'Failed to load blocked users');
      }
      blockedUsers = Array.isArray(data) ? data : [];
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
      const data = await readJsonResponse(
        res,
        {},
        'Failed to unblock user.',
      );
      if (!res.ok) {
        alert(data.message || 'Failed to unblock user');
        return;
      }

      blockedUsers = blockedUsers.filter((entry) => entry.id !== userId);
      renderBlockedUsers();
      await loadUsers();
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
      const clearButton = document.getElementById('chat-theme-clear-btn');
      const themeUrl = selectedUser?.chatTheme
        ? assetUrl(selectedUser.chatTheme)
        : '';
      const isDarkMode = document.body.classList.contains('dark-mode');

      clearButton.classList.toggle('hidden', !themeUrl);

      if (!themeUrl) {
        container.style.setProperty('--chat-theme-background', 'none');
        container.style.setProperty(
          '--chat-theme-base-color',
          isDarkMode ? '#020617' : '#f8fafc',
        );
        return;
      }

      const overlay = isDarkMode
        ? `linear-gradient(rgba(2,6,23,0.48), rgba(15,23,42,0.62)), url("${themeUrl}")`
        : `linear-gradient(rgba(248,250,252,0.18), rgba(241,245,249,0.34)), url("${themeUrl}")`;

      container.style.setProperty(
        '--chat-theme-base-color',
        isDarkMode ? '#020617' : '#e2e8f0',
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
        avatar.src =
          'https://ui-avatars.com/api/?name=You&background=E2E8F0&color=475569&size=256';
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
      currentUser = user;
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
        return `${API_URL}${user.avatar}`;
      }
      const label = encodeURIComponent(displayName(user));
      return `${appConfig.avatarBaseUrl}?name=${label}&background=0F62FE&color=fff&size=256`;
    }

    function openImagePreview(src) {
      if (!src) return;
      document.getElementById('image-preview-src').src = src;
      document
        .getElementById('image-preview-modal')
        .classList.remove('hidden');
      document.getElementById('image-preview-modal').classList.add('flex');
    }

    function closeImagePreview() {
      document.getElementById('image-preview-modal').classList.add('hidden');
      document.getElementById('image-preview-modal').classList.remove('flex');
      document.getElementById('image-preview-src').src = '';
    }

    function toggleComposerActionsMenu() {
      document
        .getElementById('composer-actions-menu')
        .classList.toggle('hidden');
      closeChatActionsMenu();
    }

    function closeComposerActionsMenu() {
      document.getElementById('composer-actions-menu').classList.add('hidden');
    }

    function toggleChatActionsMenu() {
      document.getElementById('chat-actions-menu').classList.toggle('hidden');
      closeComposerActionsMenu();
    }

    function closeChatActionsMenu() {
      document.getElementById('chat-actions-menu').classList.add('hidden');
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

    function handleKeyboardState(open) {
      if (window.innerWidth >= 1024) {
        document.body.classList.remove('keyboard-open');
        return;
      }

      document.body.classList.toggle('keyboard-open', Boolean(open));
    }

    function clearAttachmentSelection() {
      const input = document.getElementById('file-input');
      const preview = document.getElementById('attachment-preview');
      const previewImage = document.getElementById(
        'attachment-preview-image',
      );

      if (attachmentPreviewUrl) {
        URL.revokeObjectURL(attachmentPreviewUrl);
        attachmentPreviewUrl = null;
      }

      if (input) {
        input.value = '';
      }

      document.getElementById('attachment-preview-title').innerText = '';
      document.getElementById('attachment-preview-meta').innerText = '';
      document.getElementById('attachment-preview-note').innerText =
        'This file will be sent when you press Send.';
      preview.classList.add('hidden');
      previewImage.classList.add('hidden');
      previewImage.src = '';
      previewImage.onclick = null;
      closeComposerActionsMenu();
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
      document.getElementById('rename-input').value =
        selectedUser.nickname || '';
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
      document
        .getElementById('reset-password-modal')
        .classList.remove('flex');
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
      showAuthFeedback(
        data.message || 'Password reset successfully.',
        'success',
      );
    }

    async function sendForgotPassword() {
      const email = document
        .getElementById('forgot-email-input')
        .value.trim();

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
        !document
          .getElementById('verification-step')
          .classList.contains('hidden')
      ) {
        document.getElementById('verification-message').innerText =
          buildOtpPreviewMessage(
            data,
            data.message || 'Verification OTP sent.',
          );
        showVerificationFeedback(
          buildOtpPreviewMessage(data, 'A fresh OTP has been sent.'),
          'success',
        );
        return;
      }

      showAuthFeedback(
        buildOtpPreviewMessage(data, data.message),
        'success',
      );
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
      const otp =
        primaryOtpInput.value.trim() || secondaryOtpInput.value.trim();

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
      history.replaceState(
        null,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
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
      const payload = isLogin
        ? { email, password }
        : { email, password, name };

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
            (
              String(message).toLowerCase().includes('verify your email') ||
              String(message).toLowerCase().includes('email verification') ||
              String(message).toLowerCase().includes('before logging in')
            )
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
          showAuthFeedback(
            'Authentication failed: No token received',
            'error',
          );
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
            `Cannot reach the backend at ${API_URL}. Start Nest on http://localhost:3000 or serve this page from the backend.`,
            'error',
          );
          return;
        }

        showAuthFeedback(error.message || 'Auth failed', 'error');
      }
    }

    async function startApp() {
      await loadProfile();
      await ensureEncryptionKeys(true);
      await loadUsers();
      connectSocket();
      try {
        await setupNotifications();
      } catch (error) {
        console.warn('Push notification setup skipped', error);
      }
      document.getElementById('auth-screen').classList.add('hidden');

      const chatId = new URLSearchParams(window.location.search).get('chat');
      const groupId = new URLSearchParams(window.location.search).get('group');
      if (groupId) {
        await selectUser(groupId);
        return;
      }
      if (chatId) {
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

      const name = document.getElementById('profile-name-input').value.trim();
      const email = document
        .getElementById('profile-email-input')
        .value.trim();

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
        document.getElementById('settings-email-confirm-otp-input').value =
          '';
        document.getElementById('settings-pending-email-otp-input').value =
          '';
        updateSettingsUI();
        document.getElementById('settings-email-confirm-otp-input').focus();
        return;
      }

      closeProfileModal();
    }

    async function saveSettings() {
      if (!currentUser) return;

      const darkMode = document.getElementById(
        'settings-darkmode-input',
      ).checked;
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

      const res = await api('/users/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
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

      loadUsersPromise = (async () => {
        const [recentRes, allUsersRes, groupsRes, invitesRes] = await Promise.all([
          api('/chat/recent'),
          api('/users'),
          api('/chat/groups'),
          api('/chat/groups/invites'),
        ]);

        if (!recentRes.ok || !allUsersRes.ok || !groupsRes.ok || !invitesRes.ok) {
          throw new Error('Failed to load users');
        }

        const recentUsers = await readJsonResponse(
          recentRes,
          [],
          'Failed to load recent chats.',
        );
        const allUsers = await readJsonResponse(
          allUsersRes,
          [],
          'Failed to load users.',
        );
        const groups = await readJsonResponse(
          groupsRes,
          [],
          'Failed to load groups.',
        );
        groupInvites = await readJsonResponse(
          invitesRes,
          [],
          'Failed to load group invites.',
        );

        peopleDirectory = allUsers.map((user) =>
          normalizeUser({ ...user, chatType: 'direct' }),
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

        const directUsers = peopleDirectory.map((user) => {
          const key = `direct:${user.id}`;
          const recent = recentByKey.get(key);
          return normalizeUser(
            {
              ...user,
              chatType: 'direct',
              lastMessagePreview: recent?.lastMessagePreview ?? null,
              lastMessageAt: recent?.lastMessageAt ?? null,
              lastMessageType: recent?.lastMessageType ?? null,
            },
            existingByKey.get(key),
          );
        });

        const groupUsers = groups.map((group) => {
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
              lastMessageAt:
                recent?.lastMessageAt ?? group.lastMessageAt ?? null,
              lastMessageType:
                recent?.lastMessageType ?? group.lastMessageType ?? null,
            },
            existingByKey.get(key),
          );
        });

        users = [...directUsers, ...groupUsers];
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
      })();

      try {
        await loadUsersPromise;
      } finally {
        loadUsersPromise = null;
      }

      if (reloadUsersAfterCurrentLoad) {
        reloadUsersAfterCurrentLoad = false;
        return loadUsers();
      }
    }

    async function refreshUsersForPresence(ids) {
      if (!currentUser || !Array.isArray(ids) || presenceRefreshPromise) {
        return;
      }

      const knownDirectUserIds = new Set(
        users
          .filter((user) => !isGroupConversation(user))
          .map((user) => user.id),
      );
      const unknownUserIds = ids.filter(
        (userId) =>
          userId !== currentUser.id
          && !knownDirectUserIds.has(userId)
          && !ignoredPresenceUserIds.has(userId),
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

    function getSortedUsers() {
      const query = document
        .getElementById('user-search')
        .value.trim()
        .toLowerCase();
      return [...users]
        .filter((user) => {
          if (!query) return true;
          return [user.name, user.email, user.nickname, user.displayName]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
        })
        .sort((a, b) => {
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
      return [
        selectedUser?.id === user.id ? 1 : 0,
        !isGroupConversation(user) && onlineUserIds.has(user.id) ? 1 : 0,
        displayName(user),
        user.avatar || '',
        state.preview || '',
        state.unread || 0,
      ].join('::');
    }

    function createUserListElement(user) {
      const item = document.createElement('li');
      const isSelected = selectedUser?.id === user.id;
      const isOnline = !isGroupConversation(user) && onlineUserIds.has(user.id);
      const state = recentActivity.get(user.id) || {
        preview: '',
        unread: 0,
      };

      item.dataset.userKey = userListKey(user);
      item.className =
        `cursor-pointer rounded-[26px] border p-2.5 transition-all ${
          isSelected
            ? 'border-blue-200 bg-blue-50 shadow-sm'
            : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white'
        }`;
      item.onclick = () => selectUser(user.id);
      item.innerHTML = `
        <div class="flex items-center gap-3 rounded-[22px] p-2">
          <div class="relative shrink-0">
            <img src="${userAvatar(user)}" loading="lazy" decoding="async" class="h-12 w-12 rounded-2xl object-cover shadow-sm">
            ${isGroupConversation(user)
              ? `<span class="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-slate-900 px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-wide text-white">G</span>`
              : `<span class="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}"></span>`}
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold text-slate-900">${escapeHtml(displayName(user))}</p>
            <p class="mt-1 truncate text-xs ${state.unread ? 'font-semibold text-slate-700' : 'text-slate-400'}">
              ${escapeHtml(state.preview || 'No recent messages yet')}
            </p>
          </div>
          ${state.unread ? `<span class="flex h-7 min-w-7 items-center justify-center rounded-full bg-blue-600 px-2 text-xs font-bold text-white">${state.unread}</span>` : ''}
        </div>
      `;

      return item;
    }

    function renderUsers() {
      const list = getById('users-list');
      const sortedUsers = getSortedUsers();
      const existingNodes = new Map(
        Array.from(list.children).map((child) => [child.dataset.userKey, child]),
      );
      const nextSignatures = new Map();

      for (const user of sortedUsers) {
        const key = userListKey(user);
        const signature = getUserRenderSignature(user);
        nextSignatures.set(key, signature);

        const existingNode = existingNodes.get(key);
        const nextNode =
          existingNode && renderedUserSignatures.get(key) === signature
            ? existingNode
            : createUserListElement(user);

        list.appendChild(nextNode);
        if (existingNode && existingNode !== nextNode) {
          existingNode.remove();
        }
        existingNodes.delete(key);
      }

      for (const [key, node] of existingNodes.entries()) {
        renderedUserSignatures.delete(key);
        node.remove();
      }

      renderedUserSignatures = nextSignatures;
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

    function connectSocket() {
      if (socket) {
        socket.disconnect();
      }

      socket = io(API_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
      });

      socket.on('onlineUsers', async (ids) => {
        onlineUserIds = new Set(ids);
        await refreshUsersForPresence(ids);
        scheduleRenderUsers();
        scheduleHeaderUpdate();
      });

      socket.on('request:update', async (payload) => {
        if (!selectedUser || !payload || isGroupConversation(selectedUser)) {
          return;
        }

        if (
          payload.senderId === selectedUser.id ||
          payload.receiverId === selectedUser.id
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
            ? normalizeUser(
              { ...user, chatTheme: payload.chatTheme ?? null },
              user,
            )
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
          payload.conversationType === 'direct'
          && selectedUser
          && !isGroupConversation(selectedUser)
          && payload.userId === selectedUser.id
        ) {
          conversationMessages.forEach((message) => {
            if (
              message.senderId === currentUser.id
              && message.receiverId === selectedUser.id
              && new Date(message.createdAt).getTime()
              <= new Date(payload.readAt).getTime()
            ) {
              message.readAt = payload.readAt;
              message.readByCount = 1;
              replaceRenderedMessage(message);
            }
          });
          return;
        }

          if (
            payload.conversationType === 'group'
            && selectedUser
            && isGroupConversation(selectedUser)
            && payload.groupId === selectedUser.id
          ) {
            await refreshSelectedConversation({ markRead: false });
          }
        });

        socket.on('conversation:refresh', async (payload) => {
          await loadUsers();
          if (selectedUser) {
            syncSelectedUser();
            if (
              !isGroupConversation(selectedUser)
              && (!payload?.otherUserId || payload.otherUserId === selectedUser.id)
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
      const hydratedMessage = await hydrateMessage(message);
      const chatUserId = message.groupId
        || (isOwnMessage ? message.receiverId : message.senderId);
      updateRecentActivity(
        chatUserId,
        hydratedMessage,
        !isOwnMessage && selectedUser?.id !== chatUserId,
      );

      if (
        !isOwnMessage &&
        (!selectedUser || selectedUser.id !== chatUserId)
      ) {
        maybeShowForegroundNotification(hydratedMessage);
      }

      if (
        selectedUser &&
        belongsToSelectedConversation(hydratedMessage)
      ) {
        appendMessage(hydratedMessage, {
          stickToBottom: isOwnMessage || isMessageContainerNearBottom(),
        });
        if (!isOwnMessage) {
          await markSelectedConversationRead();
        }
      }
    }

    async function selectUser(userId) {
      selectedUser = users.find((user) => user.id === userId) || null;
      renderedMessageIds = new Set();
      conversationMessages = new Map();
      messagePagination = {
        nextBefore: null,
        hasMore: false,
        loadingOlder: false,
        loadedForUserId: selectedUser?.id ?? null,
      };

      if (!selectedUser) return;

      if (window.innerWidth < 1024) {
        closeSidebar();
      }

      const state = recentActivity.get(userId) || {
        lastAt: 0,
        preview: '',
        unread: 0,
      };
      recentActivity.set(userId, { ...state, unread: 0 });

      document.getElementById('empty-state').classList.add('hidden');
      document.getElementById('chat-header').classList.remove('hidden');
      document.getElementById('chat-header').classList.add('flex');
      document.getElementById('message-container').classList.remove('hidden');
      document.getElementById('message-container').classList.add('flex');
      document.getElementById('input-area').classList.remove('hidden');
      document.getElementById('messages-list').innerHTML = '';
      clearAttachmentSelection();
      clearRecordedAudio();
      closeChatActionsMenu();
      closeComposerActionsMenu();

      updateSelectedUserHeader();
      applyChatTheme();
      renderUsers();

      try {
        await loadChatPermission();
        await loadMessageChunk();
        await ensureScrollableHistory();
      } catch (error) {
        alert(error.message || 'Failed to load this chat');
        return;
      }

      const container = document.getElementById('message-container');
      container.scrollTop = container.scrollHeight;

      if (!isFileOrigin) {
        history.replaceState(
          null,
          '',
          isGroupConversation(selectedUser)
            ? `/?group=${selectedUser.id}`
            : `/?chat=${selectedUser.id}`,
        );
      }
    }

    async function loadMessageChunk(
      before = null,
      prepend = false,
      options = {},
    ) {
      if (!selectedUser) {
        return;
      }

      const url = isGroupConversation(selectedUser)
        ? before
          ? `/chat/messages?groupId=${encodeURIComponent(selectedUser.id)}&before=${encodeURIComponent(before)}`
          : `/chat/messages?groupId=${encodeURIComponent(selectedUser.id)}`
        : before
          ? `/chat/messages?userId=${encodeURIComponent(selectedUser.id)}&before=${encodeURIComponent(before)}`
          : `/chat/messages?userId=${encodeURIComponent(selectedUser.id)}`;
      const res = await api(url);
      const data = await readJsonResponse(
        res,
        {},
        'Failed to load messages. The server returned an invalid response.',
      );

      if (!res.ok) {
        throw new Error(data.message || 'Failed to load messages');
      }

      const messages = await Promise.all(
        (data.messages || []).map((message) => hydrateMessage(message)),
      );
      messagePagination.nextBefore = data.nextBefore || null;
      messagePagination.hasMore = Boolean(data.hasMore);
      messagePagination.loadedForUserId = selectedUser.id;

      if (data.conversation?.id) {
        const merged = normalizeUser(data.conversation, selectedUser);
        users = users.map((user) => (user.id === merged.id ? merged : user));
        selectedUser = merged;
        groupDetailsCache.set(merged.id, merged);
      }

      if (prepend) {
        prependMessages(messages);
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
      appendMessages(messages, { stickToBottom: false });
      scheduleRenderUsers();

      if (options.markRead !== false) {
        await markSelectedConversationRead();
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
      }
    }

    async function ensureScrollableHistory() {
      if (
        !selectedUser ||
        messagePagination.loadedForUserId !== selectedUser.id
      ) {
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
      if (historyScrollFrame) {
        return;
      }

      historyScrollFrame = window.requestAnimationFrame(async () => {
        historyScrollFrame = 0;
        const container = getById('message-container');
        if (container.scrollTop > 120) {
          return;
        }

        await loadOlderMessages();
        await ensureScrollableHistory();
      });
    }

    async function loadChatPermission() {
      if (!selectedUser) return;

      if (isGroupConversation(selectedUser)) {
        chatPermission = {
          canChat: true,
          acceptedRequestId: null,
          incomingRequestId: null,
          outgoingRequestId: null,
          blockedByMe: false,
          blockedByUser: false,
        };
        updateChatAccessUI();
        return;
      }

      const res = await api(
        `/chat/permission?userId=${encodeURIComponent(selectedUser.id)}`,
      );
      const data = await readJsonResponse(
        res,
        {},
        'Failed to load chat permission.',
      );

      if (!res.ok) {
        chatPermission = {
          canChat: false,
          acceptedRequestId: null,
          incomingRequestId: null,
          outgoingRequestId: null,
          blockedByMe: false,
          blockedByUser: false,
        };
      } else {
        chatPermission = data;
      }

      updateChatAccessUI();
    }

    async function ensureChatPermissionReady() {
      if (!selectedUser) {
        return false;
      }

      if (isGroupConversation(selectedUser)) {
        return true;
      }

      if (chatPermission.canChat) {
        return true;
      }

      await loadChatPermission();
      return Boolean(chatPermission.canChat);
    }

    function updateChatAccessUI() {
      const input = document.getElementById('msg-input');
      const fileInput = document.getElementById('file-input');
      const fileLabel = document.getElementById('share-file-label');
      const composerActionsBtn = document.getElementById(
        'composer-actions-btn',
      );
      const note = document.getElementById('chat-access-note');
      const actionBtn = document.getElementById('request-action-btn');
      const rejectBtn = document.getElementById('request-reject-btn');
      const chatActionsBtn = document.getElementById('chat-actions-btn');
      const voiceCallBtn = document.getElementById('voice-call-btn');
      const videoCallBtn = document.getElementById('video-call-btn');
      const themeBtn = document.getElementById('chat-theme-btn');
      const clearThemeBtn = document.getElementById('chat-theme-clear-btn');
      const renameBtn = document.getElementById('rename-contact-btn');
      const blockBtn = document.getElementById('block-user-btn');
      const manageGroupBtn = document.getElementById('manage-group-btn');
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
      ];

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
      };

      actionBtn.classList.add('hidden');
      rejectBtn.classList.add('hidden');
      note.classList.add('hidden');
      actionBtn.disabled = false;
      blockBtn.classList.toggle(
        'hidden',
        !selectedUser || isGroupConversation(selectedUser),
      );
        manageGroupBtn.classList.toggle(
          'hidden',
          !isGroupConversation(selectedUser),
        );
      renameBtn.classList.toggle('hidden', isGroupConversation(selectedUser));
      themeBtn.classList.toggle('hidden', isGroupConversation(selectedUser));
      clearThemeBtn.classList.toggle('hidden', isGroupConversation(selectedUser));
      voiceCallBtn.classList.toggle('hidden', isGroupConversation(selectedUser));
      videoCallBtn.classList.toggle('hidden', isGroupConversation(selectedUser));

      if (!selectedUser) {
        applyGatedState(false);
        return;
      }

      if (isGroupConversation(selectedUser)) {
        blockBtn.classList.add('hidden');
        applyGatedState(true);
        note.classList.add('hidden');
        return;
      }

      blockBtn.classList.remove('hidden');
      blockBtn.innerHTML = `<span>${chatPermission.blockedByMe ? 'Unblock User' : 'Block User'}</span>`;
      blockBtn.classList.toggle('text-rose-600', !chatPermission.blockedByMe);
      blockBtn.classList.toggle('hover:bg-rose-50', !chatPermission.blockedByMe);
      blockBtn.classList.toggle('text-emerald-600', chatPermission.blockedByMe);
      blockBtn.classList.toggle('hover:bg-emerald-50', chatPermission.blockedByMe);
      chatActionsBtn.disabled = false;
      chatActionsBtn.classList.remove('opacity-50', 'cursor-not-allowed');

      if (chatPermission.blockedByMe) {
        applyGatedState(false);
        note.classList.remove('hidden');
        note.textContent = `You blocked ${displayName(selectedUser)}. Unblock them to chat again.`;
        return;
      }

      if (chatPermission.blockedByUser) {
        applyGatedState(false);
        note.classList.remove('hidden');
        note.textContent = `${displayName(selectedUser)} has blocked you.`;
        return;
      }

      if (chatPermission.canChat) {
        applyGatedState(true);
        note.classList.add('hidden');
        return;
      }

      applyGatedState(false);
      note.classList.remove('hidden');

      if (chatPermission.incomingRequestId) {
        actionBtn.textContent = 'Accept Request';
        actionBtn.classList.remove('hidden');
        rejectBtn.classList.remove('hidden');
        note.textContent = `${displayName(selectedUser)} sent you a chat request.`;
        return;
      }

      if (chatPermission.outgoingRequestId) {
        actionBtn.textContent = 'Request Pending';
        actionBtn.classList.remove('hidden');
        actionBtn.disabled = true;
        note.textContent = `Waiting for ${displayName(selectedUser)} to accept your request.`;
        return;
      }

      actionBtn.textContent = 'Send Request';
      actionBtn.classList.remove('hidden');
      actionBtn.disabled = false;
      note.textContent = 'Send a request before starting this chat.';
    }

    async function toggleBlockedUser() {
      if (!selectedUser || isGroupConversation(selectedUser)) {
        return;
      }

      const isBlockedByMe = Boolean(chatPermission.blockedByMe);
      const confirmed = window.confirm(
        isBlockedByMe
          ? `Unblock ${displayName(selectedUser)}? They will need a fresh chat request before chatting again.`
          : `Block ${displayName(selectedUser)}? Current chat access will be removed until a new request is sent after unblocking.`,
      );
      if (!confirmed) {
        return;
      }

      const res = await api(isBlockedByMe ? '/users/blocks/remove' : '/users/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id }),
      });
      const data = await readJsonResponse(
        res,
        {},
        isBlockedByMe ? 'Failed to unblock user.' : 'Failed to block user.',
      );

      if (!res.ok) {
        alert(data.message || (isBlockedByMe ? 'Failed to unblock user' : 'Failed to block user'));
        return;
      }

      await loadUsers();
      await loadBlockedUsers().catch((error) => {
        console.error('Failed to refresh blocked users', error);
      });
      await loadChatPermission();
      syncSelectedUser();
      updateSelectedUserHeader();
      alert(data.message || (isBlockedByMe ? 'User unblocked.' : 'User blocked.'));
    }

    function updateSelectedUserHeader() {
      if (!selectedUser) return;
      getById('target-name').innerText = displayName(selectedUser);
      getById('target-avatar').src = userAvatar(selectedUser);
      applyChatTheme();
      const activeTypingUsers = currentTypingUsers();
      const isOnline = !isGroupConversation(selectedUser)
        && onlineUserIds.has(selectedUser.id);
      getById('target-status').innerText = activeTypingUsers.length
        ? formatTypingStatus(activeTypingUsers)
        : isGroupConversation(selectedUser)
          ? `${selectedUser.memberCount || selectedUser.members?.length || 0} members`
          : isOnline
            ? 'Online'
            : 'Offline';
      getById('target-status').className =
        `text-sm font-medium ${activeTypingUsers.length ? 'text-blue-500' : isOnline ? 'text-emerald-500' : 'text-slate-500'}`;
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
      return message.displayText || message.content || 'Encrypted message';
    }

    function belongsToSelectedConversation(message) {
      if (!selectedUser || !message) {
        return false;
      }

      if (isGroupConversation(selectedUser)) {
        return message.groupId === selectedUser.id;
      }

      return (
        (message.senderId === currentUser.id
          && message.receiverId === selectedUser.id)
        || (message.senderId === selectedUser.id
          && message.receiverId === currentUser.id)
      );
    }

    function replaceRenderedMessage(message) {
      if (!message?.id) {
        return;
      }

      conversationMessages.set(message.id, message);
      const existing = document.getElementById(`message-${message.id}`);
      if (!existing) {
        if (belongsToSelectedConversation(message)) {
          appendMessage(message);
        }
        return;
      }

      const next = createMessageElement(message);
      existing.replaceWith(next);
    }

    function hideMessageLocally(messageId) {
      if (!messageId) {
        return;
      }

      renderedMessageIds.delete(messageId);
      conversationMessages.delete(messageId);
      document.getElementById(`message-${messageId}`)?.remove();
    }

    function handleMessageUpdated(message) {
      if (!message?.id) {
        return;
      }

      if (!belongsToSelectedConversation(message)) {
        updateRecentActivity(
          message.groupId
          || (message.senderId === currentUser.id
            ? message.receiverId
            : message.senderId),
          message,
          false,
        );
        return;
      }

      replaceRenderedMessage(message);
      updateRecentActivity(
        message.groupId
        || (message.senderId === currentUser.id
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

      renderedMessageIds = new Set();
      conversationMessages = new Map();
      document.getElementById('messages-list').innerHTML = '';
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

    function updateRecentActivity(
      userId,
      message,
      incrementUnread,
      options = {},
    ) {
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
    }

    async function sendMessage() {
      const input = document.getElementById('msg-input');
      const text = input.value.trim();
      if (!selectedUser || !socket) return;

      try {
        const canChat = await ensureChatPermissionReady();
        if (!canChat) {
          alert('Accept a chat request before sending messages.');
          return;
        }

        if (text) {
          const encryptedPayload = await encryptTextForConversation(text);
          await emitSocketEvent('sendMessage', {
            ...encryptedPayload,
            ...(isGroupConversation(selectedUser)
              ? { groupId: selectedUser.id }
              : { toUserId: selectedUser.id }),
          });
          socket.emit('typing', {
            ...(isGroupConversation(selectedUser)
              ? { groupId: selectedUser.id }
              : { toUserId: selectedUser.id }),
            isTyping: false,
          });
          input.value = '';
        }

        const fileInput = document.getElementById('file-input');
        if (fileInput.files && fileInput.files[0]) {
          await uploadAttachment(fileInput.files[0]);
          clearAttachmentSelection();
        }

        if (recordedAudioFile) {
          await uploadAttachment(recordedAudioFile);
          clearRecordedAudio();
        }
      } catch (error) {
        alert(error.message || 'Failed to send message');
      }
    }

    async function uploadAttachment(file) {
      const canChat = await ensureChatPermissionReady();
      if (!canChat) {
        throw new Error('Accept a chat request before sharing files');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append(
        isGroupConversation(selectedUser) ? 'groupId' : 'receiverId',
        selectedUser.id,
      );

      const res = await api('/chat/attachments', {
        method: 'POST',
        body: formData,
      });
      const data = await readJsonResponse(
        res,
        {},
        'Failed to upload attachment. The server returned an invalid response.',
      );

      if (!res.ok) {
        throw new Error(data.message || 'Failed to upload attachment');
      }
    }

    async function handleRequestAction() {
      if (!selectedUser) return;

      if (chatPermission.incomingRequestId) {
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
        return;
      }

      if (chatPermission.outgoingRequestId) {
        return;
      }

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
    }

    async function rejectIncomingRequest() {
      if (!chatPermission.incomingRequestId) return;

      const res = await api('/chat/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: chatPermission.incomingRequestId }),
      });
      const data = await readJsonResponse(
        res,
        {},
        'Failed to reject the chat request.',
      );
      if (!res.ok) {
        alert(data.message || 'Failed to reject request');
        return;
      }
      await loadChatPermission();
    }

    function openCreateGroupModal() {
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
        document.querySelectorAll('#create-group-members input[type="checkbox"]:checked'),
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
        acceptInvite ? '/chat/groups/invites/accept' : '/chat/groups/invites/reject',
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

      const res = await api(`/chat/groups/${encodeURIComponent(selectedUser.id)}`);
      const data = await readJsonResponse(
        res,
        {},
        'Failed to load group details.',
      );
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
      document.getElementById('manage-group-avatar-name').innerText =
        merged.avatar ? 'Current photo saved' : 'No photo selected';
      const adminCount = (merged.members || []).filter(
        (member) => member.role === 'ADMIN',
      ).length;
      document.getElementById('manage-group-leave-note').innerText =
        merged.role === 'ADMIN'
          ? adminCount <= 1 && (merged.members || []).length > 1
            ? 'If you leave now, another remaining member will automatically become admin.'
            : 'You are an admin. You can promote members or leave the group at any time.'
          : 'You can leave this group at any time.';

      const memberIds = new Set((merged.members || []).map((member) => member.userId));
      const pendingIds = new Set(
        (merged.pendingInvites || []).map((invite) => invite.invitedUserId),
      );
        document.getElementById('manage-group-members').innerHTML = (merged.members || [])
          .map(
            (member) => `
              <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <img src="${userAvatar(member)}" class="h-10 w-10 rounded-xl object-cover">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-slate-900">${escapeHtml(member.name)}</p>
                  <p class="truncate text-xs text-slate-500">${escapeHtml(member.role)}${member.userId === currentUser.id ? ' · You' : ''}</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  ${merged.role === 'ADMIN' && member.userId !== currentUser.id && member.role !== 'ADMIN'
                    ? `<button onclick="makeGroupAdmin('${member.userId}')" class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100">Make Admin</button>`
                    : ''}
                  ${merged.role === 'ADMIN' && member.userId !== currentUser.id
                    ? `<button onclick="removeMemberFromGroup('${member.userId}')" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Remove</button>`
                    : ''}
                </div>
              </div>
            `,
          )
        .join('');

      document.getElementById('manage-group-candidates').innerHTML = peopleDirectory
        .filter((person) => !memberIds.has(person.id))
        .map((person) => `
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
          `)
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

      const res = await api(`/chat/groups/${encodeURIComponent(selectedUser.id)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [userId] }),
      });
      const data = await readJsonResponse(res, {}, 'Failed to send invite.');
      if (!res.ok) {
        alert(data.message || 'Failed to invite user');
        return;
      }

      users = users.map((user) =>
        user.id === data.id ? normalizeUser({ ...data, chatType: 'group' }, user) : user,
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
      const data = await readJsonResponse(
        res,
        {},
        'Failed to remove the member.',
      );
      if (!res.ok) {
        alert(data.message || 'Failed to remove member');
        return;
      }

      users = users.map((user) =>
        user.id === data.id ? normalizeUser({ ...data, chatType: 'group' }, user) : user,
      );
      syncSelectedUser();
      await openManageGroupModal();
    }

    async function makeGroupAdmin(userId) {
      if (!selectedUser || !isGroupConversation(selectedUser)) {
        return;
      }

      const confirmed = window.confirm(
        'Make this member an admin of the group?',
      );
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
        user.id === data.id ? normalizeUser({ ...data, chatType: 'group' }, user) : user,
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
      const data = await readJsonResponse(
        res,
        {},
        'Failed to leave the group.',
      );
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
      messageActionTarget = message;
      document.getElementById('message-action-delete-all').classList.toggle(
        'hidden',
        message.senderId !== currentUser.id
        || Date.now() - new Date(message.createdAt).getTime() > 5 * 60 * 1000
        || Boolean(message.deletedForEveryoneAt),
      );
      menu.classList.remove('hidden');
      menu.style.left = '0px';
      menu.style.top = '0px';

      const rect = menu.getBoundingClientRect();
      const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding);
      const maxTop = Math.max(padding, window.innerHeight - rect.height - padding);
      const left = Math.min(Math.max(padding, x), maxLeft);
      const preferredTop = y + 8;
      const fallbackTop = y - rect.height - 8;
      const top = preferredTop <= maxTop
        ? preferredTop
        : Math.max(padding, Math.min(maxTop, fallbackTop));

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }

    function closeMessageActions() {
      const menu = document.getElementById('message-actions-menu');
      menu.classList.add('hidden');
      menu.style.left = '';
      menu.style.top = '';
      messageActionTarget = null;
    }

    async function deleteSelectedMessageForMe() {
      if (!messageActionTarget) {
        return;
      }
      const res = await api('/chat/messages/delete-for-me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: messageActionTarget.id }),
      });
      const data = await readJsonResponse(res, {}, 'Failed to delete message.');
      if (!res.ok) {
        alert(data.message || 'Failed to delete message');
        return;
      }
      hideMessageLocally(messageActionTarget.id);
      closeMessageActions();
    }

    async function deleteSelectedMessageForEveryone() {
      if (!messageActionTarget) {
        return;
      }
      const res = await api('/chat/messages/delete-for-everyone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: messageActionTarget.id }),
      });
      const data = await readJsonResponse(
        res,
        {},
        'Failed to unsend message.',
      );
      if (!res.ok) {
        alert(data.message || 'Failed to unsend message');
        return;
      }
      handleMessageUpdated(data);
      closeMessageActions();
    }

    function handleAttachmentSelected() {
      const input = document.getElementById('file-input');
      const file = input.files && input.files[0] ? input.files[0] : null;
      const preview = document.getElementById('attachment-preview');
      const previewImage = document.getElementById(
        'attachment-preview-image',
      );
      const previewNote = document.getElementById('attachment-preview-note');

      if (attachmentPreviewUrl) {
        URL.revokeObjectURL(attachmentPreviewUrl);
        attachmentPreviewUrl = null;
      }

      if (!file) {
        clearAttachmentSelection();
        return;
      }

      document.getElementById('attachment-preview-title').innerText =
        file.name;
      document.getElementById('attachment-preview-meta').innerText =
        formatAttachmentMeta(file);
      previewNote.innerText = file.type.startsWith('video/')
        ? 'This video will be sent when you press Send.'
        : 'This file will be sent when you press Send.';
      preview.classList.remove('hidden');
      closeComposerActionsMenu();

      if (file.type.startsWith('image/')) {
        attachmentPreviewUrl = URL.createObjectURL(file);
        previewImage.src = attachmentPreviewUrl;
        previewImage.classList.remove('hidden');
        previewImage.onclick = () => openImagePreview(attachmentPreviewUrl);
      } else {
        previewImage.classList.add('hidden');
        previewImage.src = '';
        previewImage.onclick = null;
      }
    }

    async function uploadMyAvatar() {
      const input = document.getElementById('avatar-input');
      if (!input.files || !input.files[0]) return;

      const formData = new FormData();
      formData.append('avatar', input.files[0]);

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

      applyCurrentUser({ ...currentUser, ...data });
      input.value = '';
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
    }

    function stopVoiceRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }

    async function sendRecordedVoiceMessage() {
      if (!recordedAudioFile) {
        return;
      }

      try {
        await uploadAttachment(recordedAudioFile);
        clearRecordedAudio();
      } catch (error) {
        alert(error.message || 'Failed to send voice message');
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

    function openActiveCallPanel(userId, callType, status) {
      const panel = document.getElementById('active-call-panel');
      const user = users.find((item) => item.id === userId) || selectedUser;
      document.getElementById('active-call-title').innerText =
        `${displayName(user)} ${callType === 'video' ? 'video call' : 'voice call'}`;
      document.getElementById('active-call-status').innerText = status || '';
      panel.classList.remove('hidden');
    }

    function cleanupActiveCall(notifyPeer = false) {
      if (notifyPeer && socket && activeCall.targetUserId) {
        socket.emit('call:end', { toUserId: activeCall.targetUserId });
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

      activeCall = {
        peer: null,
        localStream: null,
        remoteStream: null,
        targetUserId: null,
        callType: null,
      };

      document.getElementById('active-call-panel').classList.add('hidden');
      document.getElementById('local-video').classList.add('hidden');
      document.getElementById('remote-video').classList.add('hidden');
      document.getElementById('local-video').srcObject = null;
      document.getElementById('remote-video').srcObject = null;
      document.getElementById('remote-audio').srcObject = null;
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
          document.getElementById('active-call-status').innerText =
            'Connected';
        }

        if (
          ['failed', 'disconnected', 'closed'].includes(peer.connectionState)
        ) {
          cleanupActiveCall(false);
        }
      };

      return peer;
    }

    async function prepareCallStream(callType) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video',
      });

      activeCall.localStream = stream;
      document.getElementById('local-video').srcObject = stream;

      if (callType === 'video') {
        document.getElementById('local-video').classList.remove('hidden');
      } else {
        document.getElementById('local-video').classList.add('hidden');
      }

      return stream;
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
      const user = users.find((item) => item.id === payload.fromUserId);
      document.getElementById('incoming-call-title').innerText =
        displayName(user) || 'Incoming call';
      document.getElementById('incoming-call-subtitle').innerText =
        payload.callType === 'video'
          ? 'Video call request'
          : 'Voice call request';
      document
        .getElementById('incoming-call-modal')
        .classList.remove('hidden');
      document.getElementById('incoming-call-modal').classList.add('flex');
    }

    async function acceptIncomingCall() {
      if (!pendingIncomingCall) {
        return;
      }

      const { fromUserId, offer, callType } = pendingIncomingCall;
      closeIncomingCallModal();
      pendingIncomingCall = null;

      try {
        await selectUser(fromUserId);
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
      }

      pendingIncomingCall = null;
      closeIncomingCallModal();
    }

    async function handleCallAnswer(payload) {
      if (
        !activeCall.peer ||
        payload?.fromUserId !== activeCall.targetUserId
      ) {
        return;
      }

      await activeCall.peer.setRemoteDescription(payload.answer);
      document.getElementById('active-call-status').innerText = 'Connected';
    }

    async function handleCallIce(payload) {
      if (
        !activeCall.peer ||
        payload?.fromUserId !== activeCall.targetUserId
      ) {
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

      alert('Call declined');
      cleanupActiveCall(false);
    }

    function handleCallEnd(payload) {
      if (payload?.fromUserId !== activeCall.targetUserId) {
        return;
      }

      cleanupActiveCall(false);
    }

    function endCurrentCall() {
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
      const data = await readJsonResponse(
        res,
        {},
        'Failed to rename the contact.',
      );

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
      const confirmed = window.confirm(
        `Download ${fileName || 'this file'}?`,
      );
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

    function createMessageElement(message) {
      const div = document.createElement('div');
      const isSent = message.senderId === currentUser.id;
      const metaTone = isSent ? 'text-blue-100/90' : 'text-slate-500';
      div.id = `message-${message.id}`;
      div.className = `${isSent ? 'self-end' : 'self-start'} max-w-full`;

      const bubbleTone = isSent
        ? 'rounded-[24px] rounded-br-md bg-blue-600 text-white shadow-lg'
        : 'rounded-[24px] rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm';
      const eye = isSent
        ? `<span class="inline-flex items-center gap-1 ${messageWasRead(message) ? 'text-emerald-200' : 'opacity-70'}">${messageWasRead(message) ? '&#128065;' : ''}</span>`
        : '';
      const footer = `
          <div class="mt-3 flex items-center justify-end gap-2 text-[11px] ${metaTone}">
            ${eye}
            <span>${escapeHtml(formatMessageTime(message.createdAt))}</span>
          </div>
        `;

      if (message.deletedForEveryoneAt) {
        div.innerHTML = `
            <div class="${bubbleTone} w-fit max-w-[min(100%,42rem)] px-4 py-3 text-sm italic opacity-80">
              ${escapeHtml(message.senderId === currentUser.id ? 'You unsent this message.' : 'This message was deleted.')}
              ${footer}
            </div>
          `;
      } else if (message.messageType === 'IMAGE' && message.fileUrl) {
        div.innerHTML = `
            <div class="${bubbleTone} w-fit max-w-[min(100%,42rem)] overflow-hidden p-3">
              <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer">
                <img src="${API_URL}${message.fileUrl}" loading="lazy" decoding="async" class="mb-2 max-h-80 w-auto rounded-2xl border border-black/5">
              </a>
              <div class="flex flex-wrap items-center gap-3 text-xs ${metaTone}">
                <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold underline">Open image</a>
                <button class="font-semibold underline" onclick="downloadFile('${API_URL}${message.fileUrl}', '${escapeHtml(message.fileName || 'image')}')">Download</button>
              </div>
              ${footer}
            </div>
          `;
      } else if (message.messageType === 'AUDIO' && message.fileUrl) {
        div.innerHTML = `
            <div class="${bubbleTone} w-fit max-w-[min(100%,42rem)] p-4">
              <div class="space-y-3">
                <p class="font-semibold">${escapeHtml(message.fileName || 'Voice message')}</p>
                <audio controls src="${API_URL}${message.fileUrl}" class="w-full max-w-md"></audio>
              </div>
              ${footer}
            </div>
          `;
      } else if (
        message.fileUrl &&
        String(message.fileMimeType || '').startsWith('video/')
      ) {
        div.innerHTML = `
            <div class="${bubbleTone} w-fit max-w-[min(100%,42rem)] overflow-hidden p-3">
              <div class="space-y-3">
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
            </div>
          `;
      } else if (message.messageType === 'DOCUMENT' && message.fileUrl) {
        div.innerHTML = `
            <div class="${bubbleTone} w-fit max-w-[min(100%,42rem)] p-4">
              <div class="space-y-2">
                <p class="font-semibold">${escapeHtml(message.fileName || 'Document')}</p>
                <p class="text-xs ${metaTone}">${formatBytes(message.fileSize)}</p>
                <div class="flex flex-wrap items-center gap-3 text-xs ${metaTone}">
                  <a href="${API_URL}${message.fileUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold underline">Open file</a>
                  <button class="font-semibold underline" onclick="downloadFile('${API_URL}${message.fileUrl}', '${escapeHtml(message.fileName || 'file')}')">Download</button>
                </div>
              </div>
              ${footer}
            </div>
          `;
      } else {
        div.innerHTML = `
            <div class="${bubbleTone} w-fit max-w-[min(100%,42rem)] px-4 py-3 text-sm leading-7">
              ${escapeHtml(message.displayText || message.content || '[Encrypted message]')}
              ${footer}
            </div>
          `;
      }

      div.oncontextmenu = (event) => {
        event.preventDefault();
        openMessageActions(event.clientX, event.clientY, message);
      };
      div.onpointerdown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }
        const x = event.clientX;
        const y = event.clientY;
        div._holdTimer = window.setTimeout(() => {
          openMessageActions(x, y, message);
        }, 450);
      };
      div.onpointerup = () => clearTimeout(div._holdTimer);
      div.onpointerleave = () => clearTimeout(div._holdTimer);
      return div;
    }

    function isMessageContainerNearBottom(threshold = 96) {
      const container = document.getElementById('message-container');
      if (!container) {
        return true;
      }

      return (
        container.scrollHeight - container.scrollTop - container.clientHeight
        <= threshold
      );
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
        fragment.appendChild(createMessageElement(message));
        appendedCount += 1;
      }

      if (!appendedCount) {
        return;
      }

      list.appendChild(fragment);

      if (options.stickToBottom) {
        const container = document.getElementById('message-container');
        container.scrollTop = container.scrollHeight;
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
        fragment.appendChild(createMessageElement(message));
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
          console.warn(
            data.message || 'Push subscription could not be saved.',
          );
        }
      } catch (error) {
        console.warn('Push subscription unavailable', error);
      }
    }

    function maybeShowForegroundNotification(message) {
      if (Notification.permission !== 'granted') {
        return;
      }

      if (!document.hidden && document.hasFocus()) {
        return;
      }

      const sender = peopleDirectory.find((user) => user.id === message.senderId);
      const group = message.groupId
        ? users.find((user) => isGroupConversation(user) && user.id === message.groupId)
        : null;
      const notification = new Notification(
        group ? `${displayName(group)} · ${displayName(sender) || 'Member'}` : displayName(sender) || 'New message',
        {
          body: getMessagePreview(message),
          icon: group ? userAvatar(group) : sender ? userAvatar(sender) : undefined,
          tag: message.groupId ? `group-${message.groupId}` : `chat-${message.senderId}`,
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
      const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const rawData = window.atob(base64);
      return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
    }

    function forceSessionLogout(message = '') {
      if (sessionExpiryHandled) {
        return;
      }

      sessionExpiryHandled = true;
      token = null;

      if (socket) {
        socket.disconnect();
        socket = null;
      }

      localStorage.removeItem('chat_token');

      if (message) {
        alert(message);
      }

      if (isFileOrigin) {
        location.reload();
        return;
      }

      location.href = '/';
    }

    async function logout() {
      const confirmed = window.confirm(
        'Do you want to log out from this device?',
      );
      if (!confirmed) {
        return;
      }

      try {
        if (swRegistration) {
          const subscription =
            await swRegistration.pushManager.getSubscription();
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
        applyDarkMode(localStorage.getItem('chat_dark_mode') === '1');
        syncLayout();
        return;
      }
      token = savedToken;
      try {
        await startApp();
      } catch (error) {
        console.error(error);
        token = null;
        localStorage.removeItem('chat_token');
      } finally {
        syncLayout();
      }
    }

    document.addEventListener('input', (event) => {
      if (event.target?.id !== 'msg-input' || !selectedUser || !socket) {
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
      closeComposerActionsMenu();
      closeChatActionsMenu();
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
      const chatMenu = document.getElementById('chat-actions-menu');
      const chatBtn = document.getElementById('chat-actions-btn');
      const messageMenu = document.getElementById('message-actions-menu');

      if (
        composerMenu &&
        !composerMenu.contains(event.target) &&
        !composerBtn.contains(event.target)
      ) {
        closeComposerActionsMenu();
      }

      if (
        chatMenu &&
        !chatMenu.contains(event.target) &&
        !chatBtn.contains(event.target)
      ) {
        closeChatActionsMenu();
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
          scheduleViewportHeight();
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
              !['msg-input', 'rename-input'].includes(
                document.activeElement?.id,
              )
            ) {
              handleKeyboardState(false);
              scheduleViewportHeight();
            }
          }, 60);
        }
      },
      true,
    );

    window.addEventListener('resize', syncLayout);
    window.addEventListener('resize', scheduleViewportHeight);
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallAppUI();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallAppUI();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleViewportHeight);
    }

    applyViewportHeight();
    updateInstallAppUI();
    updateVoiceComposerUI();
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

