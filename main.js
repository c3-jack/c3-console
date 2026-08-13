import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { startServer } from './server.mjs';

const { autoUpdater } = electronUpdater;

const PORT = 4870;

app.setName('c3-console');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow;

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  await startServer({ port: PORT, stateDir: app.getPath('userData') });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'c3-console',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);

  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on('window-all-closed', () => {
  app.quit();
});
