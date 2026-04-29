# Dental X-Ray Studio — Drop-in Update

## Changed / New Files

Drop these files into your project at the paths shown.
**Do not merge** — replace the whole file each time.

```
package.json                                          ← replace
installer/windows/installer.nsi                       ← replace

src/main/main.js                                      ← replace
src/main/database.js                                  ← replace (SQLite → PostgreSQL/Firebird)
src/main/ipcHandlers.js                               ← replace
src/main/preload.js                                   ← replace
src/main/auditLog.js                                  ← replace
src/main/localServer.js                               ← replace

src/renderer/App.jsx                                  ← replace
src/renderer/store/authStore.js                       ← replace
src/renderer/utils/cornerstoneSetup.js                ← NEW FILE

src/renderer/pages/DatabaseSetupPage.jsx              ← NEW FILE
src/renderer/pages/DatabaseSetupPage.css              ← NEW FILE
src/renderer/pages/ImagingViewerPage.jsx              ← replace
src/renderer/pages/ImagingViewerPage.css              ← replace
src/renderer/pages/SettingsPage.jsx                   ← replace
src/renderer/pages/SettingsPage.css                   ← replace
```

---

## After dropping files in

```bash
npm install          # installs pg, node-firebird, cornerstone-math, hammerjs
npm start            # dev mode
```

---

## What changed

### 1 — Database: SQLite removed, PostgreSQL + Firebird added

`src/main/database.js` is completely rewritten. It now supports two engines:

| Engine | npm package | When to use |
|--------|-------------|-------------|
| **PostgreSQL** | `pg` | Default. Bundled with Server installer. Multi-user network. |
| **Firebird** | `node-firebird` | Legacy environments or specific hardware. |

Connection config is stored encrypted via `electron-store`. The config is
**never** hard-coded.

### 2 — First-launch DB setup wizard

If no database connection is configured, the app shows `DatabaseSetupPage`
instead of the normal UI:

1. Choose engine (PostgreSQL / Firebird)
2. Fill in host, port, credentials
3. Test connection
4. Connect & save

The wizard is skipped on subsequent launches if the stored config still works.

### 3 — Database settings in Settings page

Settings → **Database** tab shows:
- Live connection status (Connected / Disconnected)
- Engine + host + database name
- **Reconnect** button (retries with stored config)
- Embedded reconfigure form (change host/credentials and reconnect)
- **Reset connection config** (clears stored config — triggers wizard on next launch)

This page is also reachable from **Help → Database Settings** in the menu bar.

### 4 — Cornerstone.js fully wired

`src/renderer/utils/cornerstoneSetup.js` initialises:
- `cornerstone-core`
- `cornerstone-tools` (W/L, Zoom, Pan, Length, Angle, Freehand, Arrow, Ellipse)
- `cornerstone-wado-image-loader` + web worker pool

`ImagingViewerPage.jsx` now:
- Calls `cornerstone.enable(element)` on the viewer `<div>`
- Loads images via `wadouri:http://127.0.0.1:7432/wado?filePath=<path>`
- Switches tools with `cornerstoneTools.setToolActive()`
- Saves/restores per-image annotations via the DB
- Shows live W/W, W/C, zoom overlay
- Responds to keyboard shortcuts (W, Z, P, L, A, I, R)
- Responds to View menu events (zoom-in, zoom-out, fit)

### 5 — WADO server (localServer.js)

The local Express server on `127.0.0.1:7432` now:
- Streams any allowed local file via `GET /wado?filePath=<path>`
- Serves thumbnails via `GET /thumbnail?path=<path>`
- Enforces an allowlist of directories (no arbitrary file access)
- Sets correct `Content-Type` for `.dcm`, `.jpg`, `.png` etc.

### 6 — Windows NSIS installer: Server option bundles PostgreSQL

`installer/windows/installer.nsi` now:
- Presents a **Client** vs **Server** choice on install
- Server option:
  1. Extracts bundled PostgreSQL binaries from `resources/postgres/`
  2. Runs `initdb` to create a database cluster
  3. Creates the `dental_xray` database and `dental` user
  4. Registers PostgreSQL as a Windows service (`DentalXRayDB`)
  5. Opens firewall ports 5432 (PG) and 4242 (DICOM)
  6. Writes `db-server.json` so the setup wizard can pre-fill fields

**To bundle PostgreSQL binaries:** download the PostgreSQL Windows zip
(not installer) from https://www.enterprisedb.com/download-postgresql-binaries
and extract it to `resources/postgres/` in your project root before building.

---

## Default credentials

| What | Value |
|------|-------|
| App admin login | `admin` / `admin` |
| PostgreSQL superuser | `postgres` / (set during installer) |
| PostgreSQL app user | `dental` / (set during installer) |

**Change the app admin password immediately after first login.**

---

## Architecture summary

```
Renderer (React)
  │
  │  window.electronAPI.*  (contextBridge)
  ▼
Main process (Node.js)
  │
  ├── database.js   ──→  PostgreSQL (pg) or Firebird (node-firebird)
  ├── ipcHandlers.js
  ├── localServer.js  ──→  127.0.0.1:7432  (WADO-URI for Cornerstone)
  └── licenseManager.js

App state machine:
  loading → license? → dbSetup? → ready
    ready → LoginPage (if not authenticated)
    ready + auth → AppShell + routes
```
