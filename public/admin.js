import {
  api,
  clearToken,
  getApiUrl,
  getAvatarUrl,
  loadPublicConfig,
  readJsonResponse,
} from './runtime.js?v=20260406-minimal2';

let currentUser = null;
let userOverview = { summary: {}, users: [] };
let reportOverview = { summary: {}, reports: [] };
let selectedUserIds = new Set();
let isRefreshing = false;

function getById(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let normalized = value;
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }

  return `${normalized.toFixed(normalized >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function assetUrl(path) {
  if (!path) {
    return getAvatarUrl();
  }

  if (String(path).startsWith('http://') || String(path).startsWith('https://')) {
    return path;
  }

  return `${getApiUrl()}${path}`;
}

function avatarFor(entity) {
  if (entity?.avatar) {
    return assetUrl(entity.avatar);
  }

  return getAvatarUrl(entity?.name || entity?.email || 'User');
}

function showFeedback(message, type = 'info') {
  const box = getById('admin-feedback');
  if (!box) {
    return;
  }

  box.textContent = message || '';
  box.className =
    'mt-5 rounded-2xl border px-4 py-3 text-sm ' +
    (type === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : type === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-700');
  box.classList.toggle('hidden', !message);
}

function getUserSearchTokens() {
  return String(getById('admin-user-search')?.value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function getVisibleUsers() {
  const filterValue = getById('admin-user-filter')?.value || 'all';
  const sortValue = getById('admin-user-sort')?.value || 'newest';
  const tokens = getUserSearchTokens();

  return [...(Array.isArray(userOverview.users) ? userOverview.users : [])]
    .filter((user) => {
      if (filterValue === 'pending' && user.status !== 'pending') {
        return false;
      }
      if (filterValue === 'banned' && user.status !== 'banned') {
        return false;
      }
      if (filterValue === 'admins' && user.role !== 'ADMIN') {
        return false;
      }
      if (
        filterValue === 'scheduled-deletion' &&
        !user.isScheduledForDeletion
      ) {
        return false;
      }

      if (!tokens.length) {
        return true;
      }

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
    })
    .sort((left, right) => {
      if (sortValue === 'oldest') {
        return (
          new Date(left.createdAt || 0).getTime() -
          new Date(right.createdAt || 0).getTime()
        );
      }

      if (sortValue === 'updated') {
        return (
          new Date(right.updatedAt || 0).getTime() -
          new Date(left.updatedAt || 0).getTime()
        );
      }

      return (
        new Date(right.createdAt || 0).getTime() -
        new Date(left.createdAt || 0).getTime()
      );
    });
}

function getVisibleReports() {
  const filterValue = getById('admin-report-filter')?.value || 'all';
  const reports = Array.isArray(reportOverview.reports)
    ? reportOverview.reports
    : [];

  if (filterValue === 'all') {
    return reports;
  }

  return reports.filter((report) => report.status === filterValue);
}

function renderAnalytics() {
  const grid = getById('admin-analytics-grid');
  if (!grid) {
    return;
  }

  const userSummary = userOverview.summary || {};
  const reportSummary = reportOverview.summary || {};
  const cards = [
    {
      label: 'Users',
      value: userSummary.totalUsers || 0,
      note: `${userSummary.pendingUsers || 0} pending approvals`,
      tone: 'border-slate-200 bg-white text-slate-900',
    },
    {
      label: 'Active Chats',
      value: userSummary.activeChats || 0,
      note: `${userSummary.adminUsers || 0} admins, ${userSummary.bannedUsers || 0} bans`,
      tone: 'border-blue-200 bg-blue-50 text-blue-950',
    },
    {
      label: 'Uploads',
      value: userSummary.uploadsCount || 0,
      note: `${formatBytes(userSummary.storageUsageBytes)} stored`,
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    },
    {
      label: 'Moderation',
      value: reportSummary.openReports || 0,
      note: `${reportSummary.inReviewReports || 0} in review`,
      tone: 'border-amber-200 bg-amber-50 text-amber-950',
    },
    {
      label: 'Soft Delete',
      value: userSummary.scheduledDeletionUsers || 0,
      note: 'Accounts inside the 7-day grace period',
      tone: 'border-rose-200 bg-rose-50 text-rose-950',
    },
    {
      label: 'Cleanup Window',
      value: `${userSummary.retentionWindowDays || 0}d`,
      note: `${userSummary.expiredMessagesPendingCleanup || 0} expired messages waiting`,
      tone: 'border-slate-200 bg-slate-50 text-slate-900',
    },
    {
      label: 'Theme Cleanup',
      value: userSummary.expiredThemesPendingCleanup || 0,
      note: 'Custom themes queued for retention cleanup',
      tone: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-950',
    },
    {
      label: 'Resolved Reports',
      value: reportSummary.resolvedReports || 0,
      note: `${reportSummary.dismissedReports || 0} dismissed`,
      tone: 'border-teal-200 bg-teal-50 text-teal-950',
    },
  ];

  grid.innerHTML = cards
    .map(
      (card) => `
        <article class="rounded-[28px] border px-5 py-5 shadow-sm ${card.tone}">
          <p class="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">${escapeHtml(card.label)}</p>
          <p class="mt-3 text-3xl font-bold tracking-tight">${escapeHtml(card.value)}</p>
          <p class="mt-2 text-sm opacity-80">${escapeHtml(card.note)}</p>
        </article>
      `,
    )
    .join('');
}

function renderUserBulkBar() {
  const bar = getById('admin-user-bulk-bar');
  if (!bar) {
    return;
  }

  const visibleUsers = getVisibleUsers();
  const selectedVisibleCount = visibleUsers.filter((user) =>
    selectedUserIds.has(user.id),
  ).length;

  bar.innerHTML = `
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div class="text-sm text-slate-600">
        <p class="font-semibold text-slate-900">
          ${selectedVisibleCount} selected
        </p>
        <p class="mt-1">
          Bulk actions work on the users you check below.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          data-bulk-helper="visible"
          class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          Select Visible
        </button>
        <button
          type="button"
          data-bulk-helper="clear"
          class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          Clear
        </button>
        <button
          type="button"
          data-bulk-action="approve"
          class="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          ${selectedVisibleCount ? '' : 'disabled'}
        >
          Approve Selected
        </button>
        <button
          type="button"
          data-bulk-action="ban"
          class="rounded-2xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          ${selectedVisibleCount ? '' : 'disabled'}
        >
          Ban Selected
        </button>
        <button
          type="button"
          data-bulk-action="unban"
          class="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          ${selectedVisibleCount ? '' : 'disabled'}
        >
          Unban Selected
        </button>
      </div>
    </div>
  `;
}

function renderUsers() {
  const list = getById('admin-user-list');
  const lastSync = getById('admin-user-last-sync');
  if (!list || !lastSync) {
    return;
  }

  const visibleUsers = getVisibleUsers();
  lastSync.textContent = `Users synced ${new Date().toLocaleTimeString()}`;
  renderUserBulkBar();

  if (!visibleUsers.length) {
    list.innerHTML = `
      <div class="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">
        No users match the current search or filter.
      </div>
    `;
    return;
  }

  list.innerHTML = visibleUsers
    .map((user) => {
      const statusTone =
        user.status === 'banned'
          ? 'bg-rose-100 text-rose-700'
          : user.status === 'pending'
            ? 'bg-amber-100 text-amber-800'
            : user.status === 'scheduled-deletion'
              ? 'bg-fuchsia-100 text-fuchsia-700'
              : 'bg-emerald-100 text-emerald-700';
      const isAdmin = user.role === 'ADMIN';
      const isCurrentAdmin = user.id === currentUser?.id;
      const isProtectedBootstrapAdmin = Boolean(user.isProtectedBootstrapAdmin);
      const checked = selectedUserIds.has(user.id) ? 'checked' : '';
      const disableDelete = isCurrentAdmin || isProtectedBootstrapAdmin;

      return `
        <article class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-4">
                <label class="mt-1 inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    data-user-checkbox="${user.id}"
                    class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    ${checked}
                  />
                </label>
                <img src="${escapeHtml(avatarFor(user))}" class="h-12 w-12 rounded-2xl object-cover" alt="${escapeHtml(user.name || user.email || 'User')}" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate text-base font-bold text-slate-900">${escapeHtml(user.name || user.email || 'User')}</p>
                    <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}">${escapeHtml(user.status)}</span>
                    <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">${escapeHtml(user.role)}</span>
                    ${isCurrentAdmin ? '<span class="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">You</span>' : ''}
                    ${isProtectedBootstrapAdmin ? '<span class="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">Bootstrap Admin</span>' : ''}
                  </div>
                  <p class="mt-2 truncate text-sm text-slate-500">${escapeHtml(user.email || '')}</p>
                  <p class="mt-1 truncate text-xs text-slate-400">User ID: ${escapeHtml(user.id || '')}</p>
                  <div class="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                    <p>Created: ${escapeHtml(formatDateTime(user.createdAt))}</p>
                    <p>Updated: ${escapeHtml(formatDateTime(user.updatedAt))}</p>
                    <p>Approved: ${escapeHtml(formatDateTime(user.approvedAt))}</p>
                    <p>Banned: ${escapeHtml(formatDateTime(user.bannedAt))}</p>
                    <p>Deletion: ${escapeHtml(formatDateTime(user.deletionScheduledFor))}</p>
                    <p>Email verified: ${user.emailVerified ? 'Yes' : 'No'}</p>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              ${
                !isAdmin && !user.isApproved
                  ? `<button type="button" data-user-action="approve" data-user-id="${user.id}" class="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700">Approve</button>`
                  : ''
              }
              ${
                !isAdmin
                  ? user.isBanned
                    ? `<button type="button" data-user-action="unban" data-user-id="${user.id}" class="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50">Unban</button>`
                    : `<button type="button" data-user-action="ban" data-user-id="${user.id}" class="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">Ban</button>`
                  : ''
              }
              ${
                isAdmin && !isCurrentAdmin && !isProtectedBootstrapAdmin
                  ? `<button type="button" data-user-action="remove-admin" data-user-id="${user.id}" class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100">Remove Admin</button>`
                  : ''
              }
              <button
                type="button"
                data-user-action="delete"
                data-user-id="${user.id}"
                class="rounded-2xl border border-slate-300 bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 ${disableDelete ? 'cursor-not-allowed opacity-50' : ''}"
                ${disableDelete ? 'disabled' : ''}
              >
                Delete Account
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function describeReportTarget(report) {
  if (report.targetUser) {
    return `User: ${report.targetUser.name || report.targetUser.email}`;
  }

  if (report.group) {
    return `Group: ${report.group.name}`;
  }

  return 'Message report';
}

function renderReports() {
  const list = getById('admin-report-list');
  if (!list) {
    return;
  }

  const reports = getVisibleReports();
  if (!reports.length) {
    list.innerHTML = `
      <div class="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">
        No reports match the current moderation filter.
      </div>
    `;
    return;
  }

  list.innerHTML = reports
    .map((report) => {
      const statusTone =
        report.status === 'OPEN'
          ? 'bg-rose-100 text-rose-700'
          : report.status === 'IN_REVIEW'
            ? 'bg-amber-100 text-amber-800'
            : report.status === 'DISMISSED'
              ? 'bg-slate-100 text-slate-700'
              : 'bg-emerald-100 text-emerald-700';

      return `
        <article class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-col gap-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}">${escapeHtml(report.status)}</span>
              <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">${escapeHtml(report.reason)}</span>
              <span class="text-xs text-slate-400">${escapeHtml(formatDateTime(report.createdAt))}</span>
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-900">${escapeHtml(describeReportTarget(report))}</p>
              <p class="mt-1 text-xs text-slate-500">Reporter: ${escapeHtml(report.reporter?.name || report.reporter?.email || 'Unknown')}</p>
              ${
                report.message?.preview
                  ? `<p class="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">Message: ${escapeHtml(report.message.preview)}</p>`
                  : ''
              }
              ${
                report.details
                  ? `<p class="mt-2 text-sm leading-6 text-slate-600">${escapeHtml(report.details)}</p>`
                  : '<p class="mt-2 text-sm text-slate-400">No extra reporter notes.</p>'
              }
              ${
                report.adminNote
                  ? `<p class="mt-2 text-xs text-slate-500">Admin note: ${escapeHtml(report.adminNote)}</p>`
                  : ''
              }
              ${
                report.handledBy
                  ? `<p class="mt-1 text-xs text-slate-400">Handled by ${escapeHtml(report.handledBy.name || report.handledBy.email)} on ${escapeHtml(formatDateTime(report.handledAt))}</p>`
                  : ''
              }
            </div>
            <div class="flex flex-wrap gap-2">
              ${
                report.status !== 'IN_REVIEW'
                  ? `<button type="button" data-report-action="review" data-report-id="${report.id}" class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100">Mark In Review</button>`
                  : ''
              }
              ${
                report.status !== 'RESOLVED'
                  ? `<button type="button" data-report-action="resolve" data-report-id="${report.id}" class="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700">Resolve</button>`
                  : ''
              }
              ${
                report.status !== 'DISMISSED'
                  ? `<button type="button" data-report-action="dismiss" data-report-id="${report.id}" class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100">Dismiss</button>`
                  : ''
              }
              ${
                report.targetUser && !report.targetUser.isBanned
                  ? `<button type="button" data-report-action="ban" data-report-id="${report.id}" class="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">Ban And Resolve</button>`
                  : ''
              }
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadCurrentUser() {
  const res = await api('/users/me');
  const data = await readJsonResponse(res, {}, 'Failed to load your account.');
  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.replace('/auth');
    return false;
  }
  if (!res.ok || !data?.id) {
    throw new Error(data.message || 'Failed to load your account.');
  }
  if (data.role !== 'ADMIN') {
    window.location.replace('/chat');
    return false;
  }

  currentUser = data;
  return true;
}

async function loadUserOverview() {
  const res = await api('/users/admin/users');
  const data = await readJsonResponse(
    res,
    { summary: {}, users: [] },
    'Failed to load admin users.',
  );
  if (!res.ok) {
    throw new Error(data.message || 'Failed to load admin users.');
  }

  userOverview = data;
  const visibleIds = new Set((data.users || []).map((user) => user.id));
  selectedUserIds = new Set(
    Array.from(selectedUserIds).filter((userId) => visibleIds.has(userId)),
  );
  renderAnalytics();
  renderUsers();
}

async function loadReportOverview() {
  const res = await api('/users/admin/reports');
  const data = await readJsonResponse(
    res,
    { summary: {}, reports: [] },
    'Failed to load moderation queue.',
  );
  if (!res.ok) {
    throw new Error(data.message || 'Failed to load moderation queue.');
  }

  reportOverview = data;
  renderAnalytics();
  renderReports();
}

async function loadDashboard() {
  if (isRefreshing) {
    return;
  }

  const refreshButton = getById('admin-refresh-btn');
  isRefreshing = true;
  refreshButton?.setAttribute('disabled', 'disabled');
  refreshButton?.classList.add('opacity-70', 'cursor-wait');
  if (refreshButton) {
    refreshButton.textContent = 'Refreshing...';
  }

  try {
    const hasAccess = await loadCurrentUser();
    if (!hasAccess) {
      return;
    }

    await Promise.all([loadUserOverview(), loadReportOverview()]);
    showFeedback('Dashboard refreshed.', 'success');
  } finally {
    isRefreshing = false;
    refreshButton?.removeAttribute('disabled');
    refreshButton?.classList.remove('opacity-70', 'cursor-wait');
    if (refreshButton) {
      refreshButton.textContent = 'Refresh Dashboard';
    }
  }
}

async function runUserAction(userId, action) {
  const actionConfig = {
    approve: {
      path: `/users/admin/users/${encodeURIComponent(userId)}/approve`,
      confirm: '',
    },
    ban: {
      path: `/users/admin/users/${encodeURIComponent(userId)}/ban`,
      confirm: 'Ban this user from O-chat? They will lose access immediately.',
    },
    unban: {
      path: `/users/admin/users/${encodeURIComponent(userId)}/unban`,
      confirm: 'Unban this user and restore account access?',
    },
    'remove-admin': {
      path: `/users/admin/users/${encodeURIComponent(userId)}/remove-admin`,
      confirm: 'Remove admin access from this account?',
    },
    delete: {
      path: `/users/admin/users/${encodeURIComponent(userId)}/delete`,
      confirm:
        'Delete this account permanently? This also removes related stored data and cannot be undone.',
    },
  }[action];

  if (!actionConfig) {
    return;
  }

  if (actionConfig.confirm && !window.confirm(actionConfig.confirm)) {
    return;
  }

  const res = await api(actionConfig.path, {
    method: 'POST',
  });
  const data = await readJsonResponse(res, {}, 'User action failed.');
  if (!res.ok) {
    throw new Error(data.message || 'User action failed.');
  }

  if (action === 'delete') {
    selectedUserIds.delete(userId);
    await Promise.all([loadUserOverview(), loadReportOverview()]);
  } else {
    await loadUserOverview();
  }

  showFeedback(data.message || 'User updated successfully.', 'success');
}

async function runBulkAction(action) {
  const userIds = Array.from(selectedUserIds);
  if (!userIds.length) {
    return;
  }

  const confirms = {
    approve: 'Approve every selected user?',
    ban: 'Ban every selected user? They will lose access immediately.',
    unban: 'Unban every selected user?',
  };

  if (confirms[action] && !window.confirm(confirms[action])) {
    return;
  }

  const res = await api('/users/admin/users/bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      userIds,
    }),
  });
  const data = await readJsonResponse(res, {}, 'Bulk action failed.');
  if (!res.ok) {
    throw new Error(data.message || 'Bulk action failed.');
  }

  await loadUserOverview();
  showFeedback(data.message || 'Bulk action completed.', 'success');
}

async function reviewReport(reportId, payload) {
  const res = await api(
    `/users/admin/reports/${encodeURIComponent(reportId)}/review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const data = await readJsonResponse(res, {}, 'Failed to review report.');
  if (!res.ok) {
    throw new Error(data.message || 'Failed to review report.');
  }

  await Promise.all([loadReportOverview(), payload.banTargetUser ? loadUserOverview() : Promise.resolve()]);
  showFeedback(data.message || 'Report updated.', 'success');
}

function bindEvents() {
  getById('admin-refresh-btn')?.addEventListener('click', () => {
    void loadDashboard().catch((error) => {
      console.error(error);
      showFeedback(error.message || 'Failed to refresh dashboard.', 'error');
    });
  });

  ['admin-user-search', 'admin-user-filter', 'admin-user-sort'].forEach((id) => {
    getById(id)?.addEventListener('input', () => {
      renderUsers();
    });
    getById(id)?.addEventListener('change', () => {
      renderUsers();
    });
  });

  getById('admin-report-filter')?.addEventListener('change', () => {
    renderReports();
  });

  getById('admin-user-bulk-bar')?.addEventListener('click', (event) => {
    const bulkHelper = event.target.closest('[data-bulk-helper]');
    if (bulkHelper) {
      if (bulkHelper.dataset.bulkHelper === 'visible') {
        getVisibleUsers().forEach((user) => selectedUserIds.add(user.id));
        renderUsers();
      } else if (bulkHelper.dataset.bulkHelper === 'clear') {
        selectedUserIds.clear();
        renderUsers();
      }
      return;
    }

    const bulkAction = event.target.closest('[data-bulk-action]');
    if (!bulkAction) {
      return;
    }

    void runBulkAction(bulkAction.dataset.bulkAction).catch((error) => {
      console.error(error);
      showFeedback(error.message || 'Bulk action failed.', 'error');
    });
  });

  getById('admin-user-list')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-user-checkbox]');
    if (!checkbox) {
      return;
    }

    if (checkbox.checked) {
      selectedUserIds.add(checkbox.dataset.userCheckbox);
    } else {
      selectedUserIds.delete(checkbox.dataset.userCheckbox);
    }
    renderUserBulkBar();
  });

  getById('admin-user-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-user-action]');
    if (!button) {
      return;
    }

    void runUserAction(button.dataset.userId, button.dataset.userAction).catch(
      (error) => {
        console.error(error);
        showFeedback(error.message || 'User action failed.', 'error');
      },
    );
  });

  getById('admin-report-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-report-action]');
    if (!button) {
      return;
    }

    const action = button.dataset.reportAction;
    const reportId = button.dataset.reportId;

    const payload =
      action === 'review'
        ? { status: 'IN_REVIEW' }
        : action === 'resolve'
          ? { status: 'RESOLVED' }
          : action === 'dismiss'
            ? { status: 'DISMISSED' }
            : action === 'ban'
              ? { status: 'RESOLVED', banTargetUser: true }
              : null;

    if (!payload) {
      return;
    }

    if (
      action === 'ban' &&
      !window.confirm('Ban the reported user and resolve this report?')
    ) {
      return;
    }

    void reviewReport(reportId, payload).catch((error) => {
      console.error(error);
      showFeedback(error.message || 'Failed to update the report.', 'error');
    });
  });
}

async function init() {
  try {
    await loadPublicConfig();
    bindEvents();
    await loadDashboard();
  } catch (error) {
    console.error(error);
    showFeedback(error.message || 'Failed to load the admin dashboard.', 'error');
  }
}

void init();
