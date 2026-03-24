function readEnvValue(name: string) {
  return process.env[name]?.trim() || '';
}

export function getBootstrapAdminCredentials() {
  const email = readEnvValue('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = readEnvValue('BOOTSTRAP_ADMIN_PASSWORD');

  if (!email || !password) {
    return null;
  }

  return {
    name: readEnvValue('BOOTSTRAP_ADMIN_NAME') || 'O-chat Admin',
    email,
    password,
  } as const;
}
