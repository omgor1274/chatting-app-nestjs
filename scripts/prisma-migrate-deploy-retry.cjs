const { spawnSync } = require('child_process');
const { setTimeout: delay } = require('timers/promises');

const maxAttempts = Number(process.env.PRISMA_MIGRATE_DEPLOY_MAX_ATTEMPTS ?? 5);
const retryDelayMs = Number(
  process.env.PRISMA_MIGRATE_DEPLOY_RETRY_DELAY_MS ?? 15000,
);

function runMigrateDeploy() {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnSync(command, ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(
      `[prisma-migrate-deploy-retry] Attempt ${attempt}/${maxAttempts}`,
    );

    const result = runMigrateDeploy();

    if (result.status === 0) {
      return;
    }

    if (attempt === maxAttempts) {
      process.exit(result.status ?? 1);
    }

    console.log(
      `[prisma-migrate-deploy-retry] Waiting ${retryDelayMs}ms before retrying...`,
    );
    await delay(retryDelayMs);
  }
}

main().catch((error) => {
  console.error('[prisma-migrate-deploy-retry] Unexpected error', error);
  process.exit(1);
});
