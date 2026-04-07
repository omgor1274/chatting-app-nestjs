import {
  api,
  clearToken,
  clearKeyBackupUnlockMaterial,
  decryptPrivateKeyBackup,
  deriveKeyBackupUnlockMaterial,
  encryptPrivateKeyBackup,
  getAvatarUrl,
  getApiUrl,
  getToken,
  hasValidSession,
  loadPublicConfig,
  readKeyBackupUnlockMaterial,
  readJsonResponse,
} from './runtime.js?v=20260406-minimal2';

const LAST_CHAT_ROUTE_KEY = 'chat_last_route';
let currentProfileId = '';
let currentProfile = null;
let adminUsersPayload = {
  summary: {},
  users: [],
};

function getById(id) {
  return document.getElementById(id);
}

function setBlockedUsersState(message, type = 'empty') {
  const container = getById('settings-blocked-users');
  if (!container) {
    return;
  }

  const toneClass =
    type === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-dashed border-slate-200 bg-slate-50 text-slate-500';

  container.innerHTML = `
    <div class="rounded-2xl border px-4 py-6 text-sm ${toneClass}">
      ${message}
    </div>
  `;
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
      ${message}
    </div>
  `;
}

function syncAdminPanelVisibility() {
  const panel = getById('settings-admin-panel');
  if (!panel) {
    return;
  }

  panel.classList.toggle('hidden', currentProfile?.role !== 'ADMIN');
}

function formatDateTime(value) {
  if (!value) {
    return 'Not set';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not set';
  }

  return parsed.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function assetUrl(path, fallbackLabel = 'User') {
  if (!path) {
    return getAvatarUrl(fallbackLabel);
  }

  if (String(path).startsWith('http://') || String(path).startsWith('https://')) {
    return path;
  }

  return `${getApiUrl()}${path}`;
}

function filterAdminUsers(users, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return users;
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return users.filter((user) => {
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
  const users = Array.isArray(payload?.users) ? payload.users : [];
  const searchQuery = getById('settings-admin-search-input')?.value?.trim() || '';
  const filteredUsers = filterAdminUsers(users, searchQuery);

  summary.innerHTML = `
    <div class="flex flex-wrap gap-3 text-sm font-medium text-slate-700">
      <span class="rounded-full bg-white px-3 py-2">Total ${stats.totalUsers || 0}</span>
      <span class="rounded-full bg-amber-100 px-3 py-2 text-amber-800">Pending ${stats.pendingUsers || 0}</span>
      <span class="rounded-full bg-emerald-100 px-3 py-2 text-emerald-800">Active ${stats.activeUsers || 0}</span>
      <span class="rounded-full bg-rose-100 px-3 py-2 text-rose-800">Banned ${stats.bannedUsers || 0}</span>
      <span class="rounded-full bg-slate-900 px-3 py-2 text-white">Admins ${stats.adminUsers || 0}</span>
      <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">Showing ${filteredUsers.length} of ${users.length}</span>
    </div>
  `;

  if (!users.length) {
    setAdminUsersState('No users found yet.');
    return;
  }

  if (!filteredUsers.length) {
    setAdminUsersState(
      `No users match "${escapeHtml(searchQuery)}".`,
      'empty',
    );
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
      const isCurrentAdmin = user.id === currentProfileId;
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
                <p>Created: ${formatDateTime(user.createdAt)}</p>
                <p>Approved: ${formatDateTime(user.approvedAt)}</p>
                <p>Banned: ${formatDateTime(user.bannedAt)}</p>
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

function showFeedback(message, type = 'info') {
  const box = getById('settings-feedback');
  if (!box) {
    return;
  }

  box.textContent = message || '';
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

function applyDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', Boolean(enabled));
  localStorage.setItem('chat_dark_mode', enabled ? '1' : '0');
}

function getLastChatRoute() {
  const candidate = sessionStorage.getItem(LAST_CHAT_ROUTE_KEY) || '/chat';
  return candidate.startsWith('/chat') ? candidate : '/chat';
}

function updateCloseLink() {
  const link = getById('settings-close-link');
  if (!link) {
    return;
  }

  link.href = getLastChatRoute();
}

function prefetchChatShell() {
  const hrefs = [
    getLastChatRoute(),
    '/public/app.js?v=20260406-minimal2',
    '/public/runtime.js?v=20260406-minimal2',
    '/public/app.css?v=20260406-minimal2',
  ];

  hrefs.forEach((href) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  });
}

function renderBlockedUsers(blockedUsers) {
  const container = getById('settings-blocked-users');
  if (!container) {
    return;
  }

  if (!blockedUsers.length) {
    setBlockedUsersState('You have not blocked anyone.');
    return;
  }

  container.innerHTML = blockedUsers
    .map(
      (user) => `
        <div class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <img src="${
              assetUrl(user.avatar, user.name || user.email || 'Blocked user')
            }" class="h-11 w-11 rounded-2xl object-cover">
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-slate-900">${user.name || user.email || 'Blocked user'}</p>
              <p class="truncate text-xs text-slate-500">${user.email || ''}</p>
            </div>
          </div>
          <button type="button" data-unblock-user-id="${user.id}" class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 sm:w-auto">
            Unblock
          </button>
        </div>
      `,
    )
    .join('');
}

async function loadBlockedUsers() {
  const res = await api('/users/blocks');
  const data = await readJsonResponse(res, [], 'Failed to load blocked users.');

  if (!res.ok) {
    throw new Error(data.message || 'Failed to load blocked users');
  }

  renderBlockedUsers(Array.isArray(data) ? data : []);
}

async function unblockUser(userId) {
  const res = await api('/users/blocks/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to unblock user.');

  if (!res.ok) {
    throw new Error(data.message || 'Failed to unblock user');
  }

  showFeedback(data.message || 'User unblocked.', 'success');
  await loadBlockedUsers();
}

async function loadAdminUsers() {
  if (currentProfile?.role !== 'ADMIN') {
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
  const res = await api(`/users/admin/users/${encodeURIComponent(userId)}/approve`, {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to approve the user.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to approve the user');
  }

  showFeedback(data.message || 'User approved.', 'success');
  await loadAdminUsers();
}

async function banAdminUser(userId) {
  if (!window.confirm('Ban this user from O-chat? They will lose access immediately.')) {
    return;
  }

  const res = await api(`/users/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to ban the user.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to ban the user');
  }

  showFeedback(data.message || 'User banned.', 'success');
  await loadAdminUsers();
}

async function unbanAdminUser(userId) {
  if (!window.confirm('Unban this user and restore website access?')) {
    return;
  }

  const res = await api(`/users/admin/users/${encodeURIComponent(userId)}/unban`, {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to unban the user.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to unban the user');
  }

  showFeedback(data.message || 'User unbanned.', 'success');
  await loadAdminUsers();
}

async function removeAdminRoleFromUser(userId) {
  if (!window.confirm('Remove admin access from this account?')) {
    return;
  }

  const res = await api(`/users/admin/users/${encodeURIComponent(userId)}/remove-admin`, {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to remove the admin role.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to remove the admin role');
  }

  showFeedback(data.message || 'Admin role removed.', 'success');
  await loadAdminUsers();
}

async function deleteAdminUserPermanently(userId) {
  if (
    !window.confirm(
      'Delete this account permanently? This removes the user and related stored data and cannot be undone.',
    )
  ) {
    return;
  }

  const res = await api(`/users/admin/users/${encodeURIComponent(userId)}/delete`, {
    method: 'POST',
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to permanently delete the account.',
  );

  if (!res.ok) {
    throw new Error(data.message || 'Failed to permanently delete the account');
  }

  showFeedback(data.message || 'Account deleted permanently.', 'success');
  await loadAdminUsers();
}

async function uploadAvatar() {
  const input = getById('avatar-input');
  const button = getById('change-avatar-btn');
  if (!input?.files || !input.files[0]) {
    return;
  }

  const formData = new FormData();
  formData.append('avatar', input.files[0]);

  if (button) {
    button.disabled = true;
    button.textContent = 'Uploading...';
    button.classList.add('opacity-70', 'cursor-wait');
  }

  try {
    const res = await api('/users/profile/avatar', {
      method: 'POST',
      body: formData,
    });
    const data = await readJsonResponse(res, {}, 'Failed to upload avatar.');

    input.value = '';

    if (!res.ok) {
      showFeedback(data.message || 'Failed to upload avatar.', 'error');
      return;
    }

    showFeedback(data.message || 'Profile picture updated.', 'success');
    await loadProfile();
  } finally {
    input.value = '';
    if (button) {
      button.disabled = false;
      button.textContent = 'Change Profile Picture';
      button.classList.remove('opacity-70', 'cursor-wait');
    }
  }
}

async function removeAvatar() {
  const button = getById('remove-avatar-btn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Removing...';
    button.classList.add('opacity-70', 'cursor-wait');
  }

  try {
    const res = await api('/users/profile/avatar/remove', {
      method: 'POST',
    });
    const data = await readJsonResponse(
      res,
      {},
      'Failed to remove avatar.',
    );

    if (!res.ok) {
      showFeedback(data.message || 'Failed to remove avatar.', 'error');
      return;
    }

    showFeedback('Profile picture removed.', 'success');
    await loadProfile();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Remove Profile Picture';
      button.classList.remove('opacity-70', 'cursor-wait');
    }
  }
}

function openAvatarPicker() {
  const input = getById('avatar-input');
  if (!input) {
    return;
  }

  input.value = '';
  input.click();
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

  currentProfile = data;
  currentProfileId = data.id;
  syncAdminPanelVisibility();

  getById('settings-current-name').textContent = data.name || 'Your profile';
  getById('settings-current-email').textContent = data.email || '';
  getById('settings-avatar').src = assetUrl(
    data.avatar,
    data.name || data.email || 'User',
  );

  getById('profile-name-input').value = data.name || '';
  getById('profile-email-input').value = data.email || '';
  getById('settings-darkmode-input').checked = Boolean(data.darkMode);
  getById('settings-backup-input').checked = Boolean(data.backupEnabled);
  getById('settings-backup-images-input').checked = Boolean(data.backupImages);
  getById('settings-backup-videos-input').checked = Boolean(data.backupVideos);
  getById('settings-backup-files-input').checked = Boolean(data.backupFiles);
  applyDarkMode(Boolean(data.darkMode));

  if (data.role === 'ADMIN') {
    setAdminUsersState('Loading admin users...');
  }
}

async function resolveCurrentProfilePrivateKey() {
  if (!currentProfileId) {
    return '';
  }

  const storedPrivateKey = localStorage.getItem(
    `chat_private_key_${currentProfileId}`,
  );
  if (storedPrivateKey) {
    return storedPrivateKey;
  }

  if (
    !currentProfile?.privateKeyBackupCiphertext ||
    !currentProfile?.privateKeyBackupIv
  ) {
    return '';
  }

  const unlockMaterial = readKeyBackupUnlockMaterial(currentProfileId);
  if (!unlockMaterial) {
    return '';
  }

  try {
    return (
      (await decryptPrivateKeyBackup(
        currentProfile.privateKeyBackupCiphertext,
        currentProfile.privateKeyBackupIv,
        unlockMaterial,
      )) || ''
    );
  } catch (error) {
    console.warn(
      'Failed to restore your message key before changing password',
      error,
    );
    return '';
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const name = getById('profile-name-input').value.trim();
  const email = getById('profile-email-input').value.trim();

  const res = await api('/users/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to update profile.');

  if (!res.ok) {
    showFeedback(
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to update profile',
      'error',
    );
    return;
  }

  showFeedback(data.message || 'Profile updated.', 'success');
  await loadProfile();
}

async function savePreferences(event) {
  event.preventDefault();
  const payload = {
    darkMode: getById('settings-darkmode-input').checked,
    backupEnabled: getById('settings-backup-input').checked,
    backupImages: getById('settings-backup-images-input').checked,
    backupVideos: getById('settings-backup-videos-input').checked,
    backupFiles: getById('settings-backup-files-input').checked,
  };

  const res = await api('/users/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readJsonResponse(res, {}, 'Failed to save settings.');

  if (!res.ok) {
    showFeedback(data.message || 'Failed to save settings', 'error');
    return;
  }

  applyDarkMode(Boolean(payload.darkMode));
  showFeedback('Settings saved.', 'success');
}

async function changePassword(event) {
  event.preventDefault();
  const currentPassword = getById('current-password-input').value.trim();
  const newPassword = getById('new-password-input').value.trim();
  const confirmNewPassword = getById('confirm-new-password-input').value.trim();

  if (newPassword !== confirmNewPassword) {
    showFeedback('New password and confirm password must match.', 'error');
    return;
  }

  let keyBackupPayload = null;
  if (currentProfileId && newPassword) {
    const hasStoredPrivateKeyBackup = Boolean(
      currentProfile?.privateKeyBackupCiphertext &&
        currentProfile?.privateKeyBackupIv,
    );
    const privateKey = await resolveCurrentProfilePrivateKey();
    if (hasStoredPrivateKeyBackup && !privateKey) {
      showFeedback(
        'Please log in again on this device before changing your password so O-chat can refresh your encrypted message key backup.',
        'error',
      );
      return;
    }
    if (privateKey) {
      try {
        const unlockMaterial = await deriveKeyBackupUnlockMaterial(
          newPassword,
          currentProfileId,
        );
        keyBackupPayload = await encryptPrivateKeyBackup(
          privateKey,
          unlockMaterial,
        );
      } catch (error) {
        console.warn('Failed to refresh message key backup for password change', error);
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
  const data = await readJsonResponse(res, {}, 'Failed to update password.');

  if (!res.ok) {
    showFeedback(data.message || 'Failed to update password', 'error');
    return;
  }

  clearKeyBackupUnlockMaterial(currentProfileId);
  clearToken();
  showFeedback(
    data.message || 'Password updated. Please log in again.',
    'success',
  );
  setTimeout(() => {
    window.location.replace('/auth');
  }, 400);
}

async function logout() {
  const confirmed = window.confirm('Do you want to log out from this device?');
  if (!confirmed) {
    return;
  }

  clearKeyBackupUnlockMaterial(currentProfileId);
  clearToken();
  window.location.replace('/auth');
}

async function boot() {
  applyDarkMode(localStorage.getItem('chat_dark_mode') === '1');
  updateCloseLink();
  prefetchChatShell();
  await loadPublicConfig();
  if (!getToken()) {
    window.location.replace('/auth');
    return;
  }

  if (!(await hasValidSession({ allowStaleToken: true }))) {
    window.location.replace('/auth');
    return;
  }

  getById('profile-form').addEventListener('submit', saveProfile);
  getById('preferences-form').addEventListener('submit', savePreferences);
  getById('password-form').addEventListener('submit', changePassword);
  getById('logout-btn').addEventListener('click', logout);
  getById('change-avatar-btn').addEventListener('click', openAvatarPicker);
  getById('remove-avatar-btn').addEventListener('click', removeAvatar);
  getById('avatar-input').addEventListener('change', uploadAvatar);
  getById('settings-darkmode-input').addEventListener('change', (event) => {
    applyDarkMode(Boolean(event.target?.checked));
  });
  getById('settings-blocked-users').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-unblock-user-id]');
    if (!button) {
      return;
    }

    try {
      await unblockUser(button.dataset.unblockUserId);
    } catch (error) {
      showFeedback(error?.message || 'Failed to unblock user.', 'error');
    }
  });
  getById('settings-admin-refresh-btn')?.addEventListener('click', async () => {
    try {
      await loadAdminUsers();
    } catch (error) {
      console.error(error);
      setAdminUsersState(
        error?.message || 'Failed to load admin users.',
        'error',
      );
      showFeedback(error?.message || 'Failed to load admin users.', 'error');
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
      showFeedback(error?.message || 'Failed to update the user.', 'error');
    }
  });
  setBlockedUsersState('Loading blocked users...');
  const [profileResult, blockedUsersResult] = await Promise.allSettled([
    loadProfile(),
    loadBlockedUsers(),
  ]);

  if (profileResult.status === 'rejected') {
    throw profileResult.reason;
  }

  if (blockedUsersResult.status === 'rejected') {
    console.error(blockedUsersResult.reason);
    setBlockedUsersState(
      blockedUsersResult.reason?.message || 'Failed to load blocked users.',
      'error',
    );
  }

}

boot().catch((error) => {
  console.error(error);
  showFeedback(error?.message || 'Failed to load settings.', 'error');
});
