const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { autoUpdater } = require('electron-updater');
const log  = require('electron-log');
const Store = require('electron-store');
const db   = require('./database');
const { LicenseManager } = require('../license/licenseManager');
const { setupIpcHandlers } = require('./ipcHandlers');
const { startLocalServer } = require('./localServer');

log.transports.file.level = 'info';
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log');
autoUpdater.logger = log;

const store = new Store({
  encryptionKey: process.env.STORE_ENCRYPTION_KEY || 'dental-xray-store-key-dev',
});

let mainWindow = null;
let licenseManager = null;
const isDev = process.env.NODE_ENV === 'development';

// ── Single instance ──────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── Security: block external navigation ─────────────────────────────────────
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ── Main window ──────────────────────────────────────────────────────────────
async function createMainWindow() {
  // Only add icon if the file actually exists — avoids silent crash in dev
  const iconPath = path.join(__dirname, '../../build/icon.png');
  const windowOpts = {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,           // hidden until ready-to-show OR timeout fallback
    backgroundColor: '#0b0e14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };

  // Only set icon if file exists (not needed in dev)
  if (fs.existsSync(iconPath)) windowOpts.icon = iconPath;

  mainWindow = new BrowserWindow(windowOpts);

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../../build/index.html')}`;

  // Show window as soon as it is ready — with a 3s fallback so it
  // always appears even if the event doesn't fire
  let shown = false;
  const showWindow = () => {
    if (shown) return;
    shown = true;
    mainWindow.show();
    mainWindow.focus();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  };

  mainWindow.once('ready-to-show', showWindow);

  // Fallback: show after 3 seconds regardless
  setTimeout(showWindow, 3000);

  await mainWindow.loadURL(startUrl);

  // Also show immediately after load in case event already fired
  showWindow();

  mainWindow.on('closed', () => { mainWindow = null; });
  setupMenu();
}

// ── App menu ─────────────────────────────────────────────────────────────────
function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Patient',    accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-patient') },
        { label: 'Open Patient',   accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open-patient') },
        { type: 'separator' },
        { label: 'Import DICOM',   click: () => mainWindow?.webContents.send('menu:import-dicom') },
        { label: 'Export', submenu: [
          { label: 'Export as JPEG',       click: () => mainWindow?.webContents.send('menu:export-jpeg') },
          { label: 'Export as PNG',        click: () => mainWindow?.webContents.send('menu:export-png') },
          { label: 'Export as PDF Report', click: () => mainWindow?.webContents.send('menu:export-pdf') },
        ]},
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In',           accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow?.webContents.send('viewer:zoom-in') },
        { label: 'Zoom Out',          accelerator: 'CmdOrCtrl+-',    click: () => mainWindow?.webContents.send('viewer:zoom-out') },
        { label: 'Fit to Window',     accelerator: 'CmdOrCtrl+0',    click: () => mainWindow?.webContents.send('viewer:fit') },
        { type: 'separator' },
        { label: 'Toggle Full Screen', role: 'togglefullscreen' },
        isDev ? { label: 'Dev Tools', role: 'toggleDevTools' } : null,
      ].filter(Boolean),
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation',     click: () => shell.openExternal('https://docs.yourcompany.com') },
        { label: 'License Info',      click: () => mainWindow?.webContents.send('menu:license-info') },
        { label: 'Database Settings', click: () => mainWindow?.webContents.send('menu:db-settings') },
        { label: 'Check for Updates', click: () => autoUpdater.checkForUpdatesAndNotify() },
        { type: 'separator' },
        { label: 'About Dental X-Ray Studio', click: () => mainWindow?.webContents.send('menu:about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Startup ──────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    log.info('App starting...');

    db.setStore(store);
    licenseManager = new LicenseManager(store);

    // Try DB connection — failure is non-fatal, renderer shows setup wizard
    let dbReady = false;
    if (db.getStoredConfig()) {
      try {
        await db.initDatabase();
        dbReady = true;
      } catch (err) {
        log.warn('DB connect failed:', err.message);
      }
    }

    await startLocalServer();

    setupIpcHandlers(ipcMain, {
      licenseManager, store, dialog, app, db,
      dbReady:    () => dbReady,
      setDbReady: (v) => { dbReady = v; },
    });

    await createMainWindow();

    if (!isDev) autoUpdater.checkForUpdatesAndNotify();

    log.info('App started. DB ready:', dbReady);
  } catch (err) {
    log.error('Startup error:', err);
    dialog.showErrorBox('Startup Error', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('before-quit', async () => {
  await db.closeDatabase().catch(() => {});
});

autoUpdater.on('update-available',  info => mainWindow?.webContents.send('update:available', info));
autoUpdater.on('update-downloaded', info => mainWindow?.webContents.send('update:downloaded', info));

module.exports = { mainWindow: () => mainWindow };
