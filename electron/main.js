const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const dotenv = require('dotenv');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DESKTOP_PORT = Number(process.env.DESKTOP_PORT || 3310);
const DESKTOP_URL = `http://127.0.0.1:${DESKTOP_PORT}`;
const START_TIMEOUT_MS = 60000;
const BACKEND_SUBDIR = 'server-data';
const DESKTOP_ORIGIN = new URL(DESKTOP_URL).origin;

let mainWindow = null;
let backendProcess = null;
let backendLog = '';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function isDevelopment() {
  return !app.isPackaged;
}

function getAppRoot() {
  return isDevelopment()
    ? path.resolve(__dirname, '..')
    : path.join(process.resourcesPath, 'app.asar');
}

function getAppAssetRoot() {
  return isDevelopment()
    ? path.resolve(__dirname, '..')
    : path.join(process.resourcesPath, 'app.asar.unpacked');
}

function getUnpackedNodeModulesPath() {
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
}

function getPackedNodeModulesPath() {
  return path.join(process.resourcesPath, 'app.asar', 'node_modules');
}

function getBackendEntry() {
  return path.join(getAppAssetRoot(), 'dist', 'main.js');
}

function getPreloadPath() {
  return path.join(getAppAssetRoot(), 'electron', 'preload.js');
}

function getIconPath() {
  return path.join(getAppAssetRoot(), 'public', 'icons', 'icon-512.png');
}

function getEnvFilePath() {
  return path.join(getAppAssetRoot(), '.env');
}

function getWritableDataRoot() {
  const configuredPath = process.env.APP_DATA_DIR?.trim();
  if (configuredPath) {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }

    if (isDevelopment()) {
      return path.resolve(getAppAssetRoot(), configuredPath);
    }
  }

  return path.join(app.getPath('userData'), BACKEND_SUBDIR);
}

function isTrustedDesktopOrigin(candidate) {
  if (!candidate) {
    return false;
  }

  try {
    return new URL(candidate).origin === DESKTOP_ORIGIN;
  } catch {
    return false;
  }
}

function configureDesktopSessionPermissions(targetWindow) {
  const session = targetWindow.webContents.session;
  const isTrustedRequest = (candidate) =>
    isTrustedDesktopOrigin(candidate) ||
    isTrustedDesktopOrigin(targetWindow.webContents.getURL());

  session.setPermissionCheckHandler(
    (_webContents, _permission, requestingOrigin) =>
      isTrustedRequest(requestingOrigin),
  );
  session.setPermissionRequestHandler(
    (_webContents, _permission, callback, details) => {
      callback(isTrustedRequest(details?.requestingUrl));
    },
  );
}

function loadDesktopEnvFile() {
  const envFilePath = getEnvFilePath();
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  dotenv.config({ path: envFilePath, override: false });
}

function appendBackendLog(source, chunk) {
  const message = chunk.toString().trim();
  if (!message) {
    return;
  }

  backendLog = `${backendLog}\n[${source}] ${message}`.trim();
  if (backendLog.length > 6000) {
    backendLog = backendLog.slice(-6000);
  }
}

function ensureWritableFolders() {
  const root = getWritableDataRoot();
  const folders = [
    root,
    path.join(root, 'uploads'),
    path.join(root, 'uploads', 'avatars'),
    path.join(root, 'uploads', 'chat'),
    path.join(root, 'uploads', 'groups'),
    path.join(root, 'uploads', 'chat-themes'),
    path.join(root, 'backups'),
  ];

  for (const folder of folders) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const tryRequest = () => {
      const request = http.get(`${DESKTOP_URL}/health`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }

        retry();
      });

      request.on('error', retry);
      request.setTimeout(2500, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt >= START_TIMEOUT_MS) {
        reject(new Error('Timed out while waiting for the O-chat desktop server to start.'));
        return;
      }

      setTimeout(tryRequest, 1000);
    };

    tryRequest();
  });
}

async function startBackend() {
  if (backendProcess) {
    await waitForServer();
    return;
  }

  const backendEntry = getBackendEntry();
  if (!fs.existsSync(backendEntry)) {
    throw new Error(
      `Server build not found at ${backendEntry}. Run "npm run build" before starting the desktop app.`,
    );
  }

  ensureWritableFolders();
  backendLog = '';

  const nodePathEntries = [];
  const packedNodeModulesPath = getPackedNodeModulesPath();
  if (!isDevelopment()) {
    nodePathEntries.push(packedNodeModulesPath);
  }

  const unpackedNodeModulesPath = getUnpackedNodeModulesPath();
  if (!isDevelopment() && fs.existsSync(unpackedNodeModulesPath)) {
    nodePathEntries.push(unpackedNodeModulesPath);
  }

  if (process.env.NODE_PATH?.trim()) {
    nodePathEntries.push(process.env.NODE_PATH);
  }

  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: getWritableDataRoot(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: process.env.NODE_ENV || 'production',
      PORT: String(DESKTOP_PORT),
      APP_ORIGIN: DESKTOP_URL,
      PUBLIC_API_URL: DESKTOP_URL,
      ALLOWED_ORIGINS: DESKTOP_URL,
      APP_ROOT_DIR: getAppAssetRoot(),
      APP_DATA_DIR: getWritableDataRoot(),
      APP_ENV_FILE: getEnvFilePath(),
      NODE_PATH: nodePathEntries.join(path.delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.stdout?.on('data', (chunk) => appendBackendLog('server', chunk));
  backendProcess.stderr?.on('data', (chunk) => appendBackendLog('server', chunk));
  backendProcess.once('exit', (code, signal) => {
    backendProcess = null;
    appendBackendLog(
      'server',
      Buffer.from(`Server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`),
    );
  });

  try {
    await waitForServer();
  } catch (error) {
    stopBackend();
    throw error;
  }
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    backendProcess = null;
    return;
  }

  backendProcess.kill();
  backendProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 700,
    show: false,
    autoHideMenuBar: false,
    title: 'O-chat',
    icon: fs.existsSync(getIconPath()) ? getIconPath() : undefined,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  configureDesktopSessionPermissions(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.setAudioMuted(false);

  mainWindow.loadURL(DESKTOP_URL);
}

async function bootDesktopApp() {
  try {
    loadDesktopEnvFile();
    await startBackend();
    createWindow();
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox(
      'O-chat desktop failed to start',
      `${details}\n\nMake sure PostgreSQL and Redis are running and that your .env settings are valid.${backendLog ? `\n\nRecent server log:\n${backendLog}` : ''}`,
    );
    app.quit();
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(bootDesktopApp);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootDesktopApp();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
