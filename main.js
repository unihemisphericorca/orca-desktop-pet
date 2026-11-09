// Orca desktop pet — main process.
//
// The whole pet is three window flags plus one hover rule:
//   transparent + frameless  -> no box around the animal
//   alwaysOnTop('screen-saver') -> floats above normal windows and full-screen apps
//   ignoreMouseEvents(true, {forward:true}) -> clicks fall through to whatever is behind,
//     EXCEPT when the cursor is over the orca, where we turn the flag off again.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const { Spotify } = require('./spotify');
function log(...a) {
  try {
    fs.appendFileSync(path.join(dataDir(), 'orca.log'),
      new Date().toISOString() + ' ' + a.join(' ') + '\n');
  } catch (e) { /* logging must never break the pet */ }
}

let win = null;
let tray = null;
let spotify = null;
let rebuildTrayMenu = null;   // rebuilt so the Spotify label reflects the current state

// Portable builds unpack to a temp dir, so config and tokens live next to the .exe
// instead — otherwise the Spotify login would be forgotten on every launch.
function dataDir() {
  if (!app.isPackaged) return __dirname;                       // running from source
  return process.env.PORTABLE_EXECUTABLE_DIR                    // portable .exe: its own folder
    || path.dirname(process.execPath);
}
let clickThrough = true;
let orcaRects = null;        // {x, y, w, h} in window CSS px, reported by the renderer

// Full work area of the current display: she roams the actual desktop, not a box.
// Clicks still pass through everywhere except her body and the bubble controls.

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    x: workArea.x,
    y: workArea.y,
    transparent: !process.env.ORCA_OPAQUE,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: true,           // required for Windows to deliver clicks; focus is
                              // released again immediately after a click
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  // 'screen-saver' is the highest normal level: above full-screen apps and the taskbar.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('LOAD FAILED', code, desc, url));
  win.webContents.on('render-process-gone', (_e, d) => log('RENDER GONE', JSON.stringify(d)));
  win.webContents.on('console-message', (_e, level, message) => log('RENDERER', level, message));

  win.showInactive();          // appear without stealing focus

  // Self-check screenshot: only while developing. In a packaged build it wrote into the
  // read-only asar and did nothing but waste a capture on every launch.
  if (!app.isPackaged) {
    setTimeout(() => {
      win.webContents.capturePage().then((img) => {
        fs.writeFileSync(path.join(__dirname, 'shot-window.png'), img.toPNG());
        log('captured own window', JSON.stringify(img.getSize()));
      }).catch((e) => log('capture failed', String(e)));
    }, 2500);
  }
  // Screenshot mode: ORCA_SHOT=1 renders one promo frame with a backdrop and the card open.
  if (process.env.ORCA_SHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.executeJavaScript(
          "window.__orca.setBackdrop(true); window.__orca.teleport(760, 640); window.__orca.freeze(true); window.__orca.setHeading(Math.PI); window.__orca.showCard(true);").catch(() => {});
      }, 2200);
      setTimeout(() => {
        win.webContents.capturePage().then((img) => {
          fs.writeFileSync(path.join(__dirname, 'docs', 'screenshot.png'), img.toPNG());
          log('screenshot saved');
          app.quit();
        }).catch((e) => log('shot failed', String(e)));
      }, 3600);
    });
  }

  // Test harness: ORCA_TEST=1 drives the click interaction and captures each phase, so the
  // behaviour can be verified with real frames instead of "it should work".
  if (process.env.ORCA_TEST) {
    const shots = [
      [500, "motionA", "__orca.freeze(true); __orca.setHeading(Math.PI)"],
      [640, "motionB", null],
      [700, "measure", "console.log('YAW_MEASURE ' + JSON.stringify(__orca.measureYaw()))"],
      [980, "shadowbg", "__orca.setBackdrop(true)"],
      [1100, "shadowshot", null],
      [1400, "shadowoff", "__orca.setBackdrop(false)"],
      [1200, "h0", "__orca.freeze(true); __orca.setHeading(0)"],
      [1200, "h90", "__orca.setHeading(Math.PI/2)"],
      [1700, "h180", "__orca.setHeading(Math.PI)"],
      [2200, "h270", "__orca.setHeading(Math.PI*1.5)"],
      [2700, "unfreeze", "__orca.freeze(false)"],
      [2900, "idle", null],
      [3400, "rest", "__orca.goRest()"],
      [2600, "face", "__orca.hold()"],
      [4200, "curious", null],
      [5200, "jawtest", "__orca.setJaw(1.0)"],
      [7000, "trick1", "console.log('hooks', typeof window.__orca, typeof window.__orca.nextTrick); window.__orca.nextTrick()"],
      [9600, "trick2", "__orca.nextTrick()"],
      [12200, "trick3", "__orca.nextTrick()"],
      [9200, "swim", null],
    ];
    let start = 0;
    win.webContents.on('did-finish-load', () => {
      start = Date.now();
      for (const [ms, name, code] of shots) {
        setTimeout(() => {
          if (code) win.webContents.executeJavaScript(code).catch((e) => log('test step failed', name, String(e)));
          setTimeout(() => {
            win.webContents.capturePage().then((img) => {
              fs.writeFileSync(path.join(__dirname, `test-${name}.png`), img.toPNG());
              log('test capture', name);
            }).catch((e) => log('test capture failed', name, String(e)));
          }, 600);
        }, ms);
      }
      setTimeout(() => { app.quit(); }, 17000);
    });
  }

  log('bounds', JSON.stringify(win.getBounds()), 'visible', win.isVisible(),
      'alwaysOnTop', win.isAlwaysOnTop(), 'display', JSON.stringify(screen.getPrimaryDisplay().workArea));

  win.on('closed', () => { win = null; });
}

// The renderer tells us when the cursor is over the orca's body vs empty space.
let rectLogged = false;
ipcMain.on('orca-rect', (_evt, rects) => {
  orcaRects = rects;
  if (!rectLogged && rects) {
    rectLogged = true;
    log('orca screen rect', JSON.stringify(rects));
  }
});

ipcMain.on('hit-test', (_evt, overOrca) => {
  if (!win || win.isDestroyed()) return;
  const wantClickThrough = !overOrca;
  if (wantClickThrough === clickThrough) return;
  clickThrough = wantClickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
});

// A full-screen click-through window does not reliably deliver mousemove, so hit testing is
// driven from the OS cursor position compared against the orca's reported screen rectangle.
function startHitTesting() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !orcaRects) return;
    let inside = false;
    try {
      const pt = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const lx = pt.x - b.x;
      const ly = pt.y - b.y;
      const within = (r, pad) => !!r &&
        lx >= r.x - pad && lx <= r.x + r.w + pad &&
        ly >= r.y - pad && ly <= r.y + r.h + pad;
      // Tight to her body and to the card — anything else stays click-through, so the
      // desktop behind the overlay keeps working normally.
      inside = within(orcaRects.body, 8) || within(orcaRects.card, 4);
    } catch (_) {
      inside = false;
    }
    if (inside === clickThrough) {          // clickThrough true means "ignore"
      clickThrough = !inside;
      win.setIgnoreMouseEvents(clickThrough, { forward: true });
      log('click zone', clickThrough ? 'click-through' : 'interactive');
    }
  }, 45);
}

ipcMain.on('release-focus', () => { if (win && !win.isDestroyed()) win.blur(); });

ipcMain.handle('spotify-connect', async () => {
  if (!spotify) return { ok: false, reason: 'not-ready' };
  if (!spotify.hasClientId()) return { ok: false, reason: 'no-client-id' };
  return spotify.connect((url) => shell.openExternal(url));
});

ipcMain.handle('spotify-status', () => ({
  connected: spotify ? spotify.isConnected() : false,
  hasClientId: spotify ? spotify.hasClientId() : false,
  configPath: spotify ? spotify.cfgFile : null
}));

ipcMain.handle('spotify-control', async (_e, act) => (spotify ? spotify.control(act) : { ok: false }));

ipcMain.on('quit', () => app.quit());

ipcMain.on('move-by', (_evt, dx, dy) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

app.whenReady().then(() => {
  createWindow();
  startHitTesting();

  spotify = new Spotify(dataDir(), log);
  spotify.onUpdate = (data) => {
    if (win && !win.isDestroyed()) win.webContents.send('spotify-update', data);
  };
  spotify.startPolling();

  // Tray icon so the pet can always be quit or paused, even while click-through is on.
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (!icon.isEmpty()) {
    tray = new Tray(icon);
    tray.setToolTip('Orca');
    buildTrayMenu();
    function buildTrayMenu() {
      tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Natural colours (uncheck for pearl skin)',
        type: 'checkbox',
        checked: true,
        click: (item) => { if (win && !win.isDestroyed()) win.webContents.send('natural-mode', item.checked); }
      },
      { type: 'separator' },
      {
        label: spotify && spotify.isConnected() ? 'Reconnect Spotify…' : 'Connect Spotify…',
        click: async () => {
          if (!spotify) return;
          if (!spotify.hasClientId()) {
            dialog.showMessageBox({
              type: 'info',
              title: 'Spotify Client ID missing',
              message: 'No Spotify Client ID found.',
              detail: `Create ${spotify.cfgFile} containing:\n\n{ "clientId": "your-id" }\n\n` +
                      'You can copy spotify.json.example and fill it in. Full walkthrough is in the README.'
            });
            return;
          }
          const r = await spotify.connect((url) => shell.openExternal(url));
          log('spotify: connect result', JSON.stringify(r));
          if (!r || !r.ok) {
            dialog.showMessageBox({
              type: 'error',
              title: 'Spotify connection failed',
              message: 'Could not connect to Spotify.',
              detail: `Reason: ${(r && (r.reason || r.error)) || 'unknown'}\n\n` +
                      'Most common cause: the Redirect URI in your Spotify app must be exactly\n' +
                      'http://127.0.0.1:8888/callback\n\n' +
                      `A log with the details is at ${path.join(dataDir(), 'orca.log')}.`
            });
          } else {
            if (rebuildTrayMenu) rebuildTrayMenu();
            dialog.showMessageBox({ type: 'info', title: 'Spotify connected', message: 'She can see your music now 🐋' });
          }
        }
      },
      { label: 'Disconnect Spotify', click: () => { if (spotify) spotify.disconnect(); if (rebuildTrayMenu) rebuildTrayMenu(); } },
      { type: 'separator' },
      {
        label: 'Credits: Orca model by Lippanen (CC BY 4.0)',
        enabled: false
      },
      { type: 'separator' },
      { label: 'Quit Orca', click: () => app.quit() }
      ]));
    }
    rebuildTrayMenu = buildTrayMenu;
  }

  const refit = () => {
    if (!win || win.isDestroyed()) return;
    const { workArea } = screen.getPrimaryDisplay();
    win.setBounds(workArea);
    log('refit to display', JSON.stringify(workArea));
  };
  screen.on('display-metrics-changed', refit);
  screen.on('display-added', refit);
  screen.on('display-removed', refit);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
