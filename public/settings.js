import {
  api,
  clearToken,
  getAvatarUrl,
  getApiUrl,
  loadPublicConfig,
  readJsonResponse,
} from './runtime.js';

function getById(id) {
  return document.getElementById(id);
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
  await loadPublicConfig();
  if (!localStorage.getItem('chat_token')) {
    window.location.replace('/auth');
    return;
  }

  getById('profile-form').addEventListener('submit', saveProfile);
  getById('preferences-form').addEventListener('submit', savePreferences);
  getById('password-form').addEventListener('submit', changePassword);
  getById('logout-btn').addEventListener('click', logout);
  await loadProfile();
}

boot().catch((error) => {
  console.error(error);
  showFeedback(error?.message || 'Failed to load settings.', 'error');
});
