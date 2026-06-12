/* electron-main.js — 데스크톱 프로그램(윈도우/맥) 진입점 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// 중복 실행 방지 — 이미 켜져 있으면 기존 창을 앞으로
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;

  function createWindow() {
    win = new BrowserWindow({
      width: 1100,
      height: 760,
      minWidth: 360,
      minHeight: 520,
      icon: path.join(__dirname, 'icon-512.png'),
      backgroundColor: '#f6f7fb',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadFile('index.html');

    // 외부 링크(GitHub 토큰 발급 등)는 기본 브라우저로
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  Menu.setApplicationMenu(null);

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
