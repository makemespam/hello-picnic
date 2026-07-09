const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

let serverProcess = null;
let mainWindow = null;
let logFile = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  console.log(message);
  if (logFile) fs.appendFileSync(logFile, line, 'utf8');
}

function findFreePort(startPort = 3210) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      if (startPort >= 3299) reject(new Error('Geen vrije lokale poort gevonden.'));
      else resolve(findFreePort(startPort + 1));
    });
    server.listen(startPort, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function getServerPath() {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'desktop-dist', 'server.js');
  }
  return path.join(__dirname, '..', 'desktop-dist', 'server.js');
}

async function startNextServer() {
  const port = await findFreePort();
  const serverPath = getServerPath();
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  logFile = path.join(userData, 'desktop-startup.log');
  fs.writeFileSync(logFile, '', 'utf8');
  log(`Hello Picnic desktop start`);
  log(`Packaged: ${app.isPackaged}`);
  log(`Resources path: ${process.resourcesPath}`);
  log(`Server path: ${serverPath}`);
  log(`Data dir: ${userData}`);

  if (!fs.existsSync(serverPath)) {
    throw new Error(`Next server niet gevonden: ${serverPath}`);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    HELLO_PICNIC_DATA_DIR: userData,
    ELECTRON_RUN_AS_NODE: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    NO_COLOR: '1',
  };

  serverProcess = spawn(process.execPath, [serverPath], {
    env,
    cwd: path.dirname(serverPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  log(`Spawned Next server PID: ${serverProcess.pid}`);
  serverProcess.stdout?.on('data', (data) => log(`[next stdout] ${data.toString().trimEnd()}`));
  serverProcess.stderr?.on('data', (data) => log(`[next stderr] ${data.toString().trimEnd()}`));
  serverProcess.on('exit', (code, signal) => log(`Next server exited code=${code} signal=${signal}`));
  serverProcess.on('error', (err) => log(`Next server process error: ${err.message}`));

  await waitForServer(port, 90000);
  return `http://127.0.0.1:${port}`;
}

function waitForServer(port, timeoutMs = 90000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryRequest = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2500 }, (res) => {
        res.resume();
        log(`Next server responded with HTTP ${res.statusCode}`);
        resolve();
      });
      req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          const extra = logFile ? `\n\nLogbestand: ${logFile}` : '';
          reject(new Error(`De lokale appserver startte niet op tijd.${extra}`));
        } else {
          setTimeout(tryRequest, 500);
        }
      });
    };
    tryRequest();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 960,
    minHeight: 700,
    title: 'Hello Picnic',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const url = await startNextServer();
    await mainWindow.loadURL(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Startup failed: ${message}`);
    dialog.showErrorBox('Hello Picnic kon niet starten', message);
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
