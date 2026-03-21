import {
  getApiUrl,
  loadPublicConfig,
  readJsonResponse,
  setToken,
} from './runtime.js';

let isLogin = true;
let pendingVerificationEmail = '';
let pendingResetEmail = '';

function getById(id) {
  return document.getElementById(id);
}

function setVisible(id, visible) {
  getById(id)?.classList.toggle('hidden', !visible);
}

function showSection(activeId) {
  [
    'auth-form',
    'verification-step',
    'forgot-password-step',
    'reset-password-step',
  ].forEach((id) => setVisible(id, id === activeId));
}

function showFeedback(id, message, type = 'info') {
  const box = getById(id);
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

function sanitizeOtpValue(input) {
  if (!input) {
    return;
  }
  input.value = input.value.replace(/\D/g, '').slice(0, 6);
}

function setAuthMode(nextIsLogin) {
  isLogin = nextIsLogin;
  getById('auth-title').textContent = isLogin
    ? 'Welcome Back'
    : 'Create your account';
  getById('auth-subtitle').textContent = isLogin
    ? 'Login or create an account.'
    : 'A faster route into O-chat starts here.';
  getById('auth-btn').textContent = isLogin ? 'Login' : 'Create Account';
  getById('auth-switch').textContent = isLogin
    ? 'New here? Create an account'
    : 'Already have an account? Login';
  getById('name-input').classList.toggle('hidden', isLogin);
  getById('confirm-password-input').classList.toggle('hidden', isLogin);
  getById('forgot-password-btn').classList.toggle('hidden', !isLogin);
}

function showVerificationStep(email, message) {
  pendingVerificationEmail = email || pendingVerificationEmail;
  getById('verification-email').textContent = pendingVerificationEmail;
  getById('verification-message').textContent =
    message || 'Enter the 6-digit OTP sent to your email.';
  showFeedback('verification-feedback', '', 'info');
  showSection('verification-step');
}

function showForgotPasswordStep(email = '') {
  pendingResetEmail = email || pendingResetEmail;
  getById('forgot-email-input').value = pendingResetEmail;
  showFeedback('forgot-password-feedback', '', 'info');
  showSection('forgot-password-step');
}

function showResetPasswordStep(email, message) {
  pendingResetEmail = email || pendingResetEmail;
  getById('reset-email-input').value = pendingResetEmail;
  getById('reset-password-message').textContent =
    message || 'Use the OTP from your email and set a new password.';
  showFeedback('reset-password-feedback', '', 'info');
  showSection('reset-password-step');
}

function returnToLogin() {
  showSection('auth-form');
  showFeedback('auth-feedback', '', 'info');
  setAuthMode(true);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  await loadPublicConfig();

  const email = getById('email-input').value.trim();
  const password = getById('password-input').value.trim();
  const confirmPassword = getById('confirm-password-input').value.trim();
  const name = getById('name-input').value.trim();

  if (!isLogin && password !== confirmPassword) {
    showFeedback(
      'auth-feedback',
      'Password and confirm password must match.',
      'error',
    );
    return;
  }

  const endpoint = isLogin ? '/auth/login' : '/auth/register';
  const payload = isLogin ? { email, password } : { email, password, name };

  try {
    const res = await fetch(`${getApiUrl()}${endpoint}`, {
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
        : data.message || 'Authentication failed';

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

      if (!isLogin && String(message).toLowerCase().includes('verification')) {
        showVerificationStep(email, message);
        return;
      }

      showFeedback('auth-feedback', message, 'error');
      return;
    }

    const authToken = data.token || data.access_token;
    if (authToken) {
      setToken(authToken);
      window.location.replace('/chat');
      return;
    }

    if (!isLogin) {
      setAuthMode(true);
      showSection('auth-form');
      getById('email-input').value = email;
      getById('password-input').value = '';
      showFeedback(
        'auth-feedback',
        data.message || 'Registration successful. Please log in.',
        'success',
      );
      return;
    }

    showFeedback(
      'auth-feedback',
      'Authentication failed: No token received',
      'error',
    );
  } catch (error) {
    showFeedback(
      'auth-feedback',
      error?.message || `Cannot reach the backend at ${getApiUrl()}.`,
      'error',
    );
  }
}

async function submitVerificationOtp() {
  const otpInput = getById('verification-otp-input');
  sanitizeOtpValue(otpInput);
  const otp = otpInput.value.trim();
  if (!pendingVerificationEmail || !/^\d{6}$/.test(otp)) {
    showFeedback('verification-feedback', 'Enter the 6-digit OTP.', 'error');
    return;
  }

  const res = await fetch(`${getApiUrl()}/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingVerificationEmail, otp }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to verify email.');

  if (!res.ok) {
    showFeedback(
      'verification-feedback',
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to verify email',
      'error',
    );
    return;
  }

  setAuthMode(true);
  showSection('auth-form');
  getById('email-input').value = pendingVerificationEmail;
  getById('password-input').value = '';
  showFeedback(
    'auth-feedback',
    data.message || 'Email verified. Please log in.',
    'success',
  );
}

async function resendVerification() {
  if (!pendingVerificationEmail) {
    showFeedback(
      'verification-feedback',
      'No verification email is selected yet.',
      'error',
    );
    return;
  }

  const res = await fetch(`${getApiUrl()}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: pendingVerificationEmail }),
  });
  const data = await readJsonResponse(
    res,
    {},
    'Failed to resend verification.',
  );
  showFeedback(
    'verification-feedback',
    Array.isArray(data.message)
      ? data.message.join(', ')
      : data.message ||
          (res.ok
            ? 'Verification OTP sent.'
            : 'Failed to resend verification.'),
    res.ok ? 'success' : 'error',
  );
}

async function sendForgotPassword() {
  const email = getById('forgot-email-input').value.trim();
  if (!email) {
    showFeedback(
      'forgot-password-feedback',
      'Enter your email first.',
      'error',
    );
    return;
  }

  const res = await fetch(`${getApiUrl()}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to send reset OTP.');

  if (!res.ok) {
    showFeedback(
      'forgot-password-feedback',
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to send reset OTP.',
      'error',
    );
    return;
  }

  showResetPasswordStep(
    email,
    data.message || 'Reset OTP sent. Enter it below with your new password.',
  );
}

async function submitResetPassword() {
  const email = getById('reset-email-input').value.trim();
  const otpInput = getById('reset-otp-input');
  sanitizeOtpValue(otpInput);
  const otp = otpInput.value.trim();
  const newPassword = getById('reset-password-page-input').value.trim();

  if (!email || !/^\d{6}$/.test(otp) || !newPassword) {
    showFeedback(
      'reset-password-feedback',
      'Enter email, OTP, and a new password.',
      'error',
    );
    return;
  }

  const res = await fetch(`${getApiUrl()}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp, newPassword }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to reset password.');

  if (!res.ok) {
    showFeedback(
      'reset-password-feedback',
      Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message || 'Failed to reset password.',
      'error',
    );
    return;
  }

  returnToLogin();
  getById('email-input').value = email;
  showFeedback(
    'auth-feedback',
    data.message || 'Password updated. Please log in.',
    'success',
  );
}

async function resendResetPasswordOtp() {
  const email = getById('reset-email-input').value.trim();
  if (!email) {
    showFeedback(
      'reset-password-feedback',
      'Enter the email for the reset request.',
      'error',
    );
    return;
  }

  const res = await fetch(`${getApiUrl()}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await readJsonResponse(res, {}, 'Failed to resend reset OTP.');
  showFeedback(
    'reset-password-feedback',
    Array.isArray(data.message)
      ? data.message.join(', ')
      : data.message ||
          (res.ok ? 'Reset OTP sent.' : 'Failed to resend reset OTP.'),
    res.ok ? 'success' : 'error',
  );
}

function bindEvents() {
  getById('auth-btn').addEventListener('click', handleAuthSubmit);
  getById('auth-switch').addEventListener('click', () => {
    setAuthMode(!isLogin);
    showFeedback('auth-feedback', '', 'info');
  });
  getById('forgot-password-btn').addEventListener('click', () =>
    showForgotPasswordStep(getById('email-input').value.trim()),
  );
  getById('verify-email-btn').addEventListener('click', submitVerificationOtp);
  getById('resend-verification-btn').addEventListener(
    'click',
    resendVerification,
  );
  getById('send-forgot-btn').addEventListener('click', sendForgotPassword);
  getById('submit-reset-btn').addEventListener('click', submitResetPassword);
  getById('resend-reset-btn').addEventListener('click', resendResetPasswordOtp);
  getById('change-reset-email-btn').addEventListener('click', () =>
    showForgotPasswordStep(getById('reset-email-input').value.trim()),
  );
  document.querySelectorAll('.return-login-btn').forEach((button) => {
    button.addEventListener('click', returnToLogin);
  });
  ['verification-otp-input', 'reset-otp-input'].forEach((id) => {
    getById(id).addEventListener('input', (event) =>
      sanitizeOtpValue(event.target),
    );
  });
}

async function boot() {
  await loadPublicConfig();
  if (localStorage.getItem('chat_token')) {
    window.location.replace('/chat');
    return;
  }
  setAuthMode(true);
  showSection('auth-form');
  bindEvents();
}

boot().catch((error) => {
  console.error(error);
  showFeedback(
    'auth-feedback',
    error?.message || 'Failed to start auth page.',
    'error',
  );
});
