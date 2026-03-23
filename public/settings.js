import {
  api,
  clearToken,
  getAvatarUrl,
  getApiUrl,
  getToken,
  hasValidSession,
  loadPublicConfig,
  readJsonResponse,
} from './runtime.js?v=20260323-smooth1';

const LAST_CHAT_ROUTE_KEY = 'chat_last_route';

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
    '/public/app.js?v=20260323-smooth8',
    '/public/runtime.js?v=20260323-smooth1',
    '/public/app.css?v=20260323-smooth7',
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
              user.avatar
                ? `${getApiUrl()}${user.avatar}`
                : getAvatarUrl(user.name || user.email || 'Blocked user')
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

  getById('settings-current-name').textContent = data.name || 'Your profile';
  getById('settings-current-email').textContent = data.email || '';
  getById('settings-avatar').src = data.avatar
    ? `${getApiUrl()}${data.avatar}`
    : getAvatarUrl(data.name || data.email || 'User');

  getById('profile-name-input').value = data.name || '';
  getById('profile-email-input').value = data.email || '';
  getById('settings-darkmode-input').checked = Boolean(data.darkMode);
  getById('settings-backup-input').checked = Boolean(data.backupEnabled);
  getById('settings-backup-images-input').checked = Boolean(data.backupImages);
  getById('settings-backup-videos-input').checked = Boolean(data.backupVideos);
  getById('settings-backup-files-input').checked = Boolean(data.backupFiles);
  applyDarkMode(Boolean(data.darkMode));
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

  const res = await api('/users/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to update password.');

  if (!res.ok) {
    showFeedback(data.message || 'Failed to update password', 'error');
    return;
  }

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
