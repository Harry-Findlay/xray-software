# 🦷 Dental X-Ray Studio

Professional dental imaging software built with Electron, React, and SQLite.  
Comparable to DTX Studio Clinic / VistaSoft — open architecture, fully self-hosted.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Local Development Setup](#local-development-setup)
4. [Project Structure](#project-structure)
5. [Database](#database)
6. [DICOM / Imaging (Cornerstone.js)](#dicom--imaging)
7. [Licensing System](#licensing-system)
8. [Building Installers](#building-installers)
9. [GitHub Repository Setup](#github-repository-setup)
10. [Code Signing](#code-signing)
11. [Regulatory Compliance](#regulatory-compliance)
12. [Roadmap](#roadmap)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
│                                                         │
│  ┌───────────────┐      ┌──────────────────────────┐   │
│  │  Renderer     │ IPC  │  Main Process            │   │
│  │  (React)      │◄────►│  - Database (SQLite)     │   │
│  │  - UI         │      │  - File I/O              │   │
│  │  - Cornerstone│      │  - License Manager       │   │
│  │  - Zustand    │      │  - Local Express Server  │   │
│  └───────────────┘      └──────────────────────────┘   │
│                                    │                    │
│                         ┌──────────▼──────────┐        │
│                         │  SQLite Database     │        │
│                         │  (better-sqlite3)    │        │
│                         └─────────────────────┘        │
└─────────────────────────────────────────────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │     License Server (your API)  │
              │  POST /api/v1/activate         │
              │  POST /api/v1/validate         │
              │  POST /api/v1/deactivate       │
              └───────────────────────────────┘
```

**Install Types:**
- **Client Install** — Standalone workstation. SQLite DB stored locally.
- **Server Install** — Installs DB + client. Other workstations connect to this machine.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS | Required. [nodejs.org](https://nodejs.org) |
| npm | 10+ | Comes with Node |
| Git | Latest | |
| VS Code | Latest | Recommended |
| Python | 3.x | Required by some native modules |
| Windows Build Tools | — | Windows only: `npm install -g windows-build-tools` |

**VS Code Extensions (recommended):**
- ESLint
- Prettier
- ES7+ React/Redux/React-Native snippets
- SQLite Viewer (by qwtel)
- GitLens

---

## Local Development Setup

```bash
# 1. Clone your repository
git clone https://github.com/your-username/dental-xray-studio.git
cd dental-xray-studio

# 2. Install dependencies
npm install

# 3. Copy environment file
cp .env.example .env
# Edit .env — set STORE_ENCRYPTION_KEY to a random string

# 4. Start development server
npm start
```

This runs:
- React dev server on http://localhost:3000
- Electron app pointing to that dev server

The app will open automatically. Hot reload works for the renderer (React).  
For main process changes, restart with `npm start`.

---

## Project Structure

```
dental-xray-studio/
├── .github/
│   └── workflows/
│       └── build.yml           # GitHub Actions CI/CD
├── src/
│   ├── main/                   # Electron main process (Node.js)
│   │   ├── main.js             # Entry point, window creation
│   │   ├── preload.js          # Secure IPC bridge
│   │   ├── database.js         # SQLite init & migrations
│   │   ├── ipcHandlers.js      # All IPC handler definitions
│   │   ├── auditLog.js         # GDPR audit trail
│   │   └── localServer.js      # Express server (DICOM WADO-RS)
│   ├── renderer/               # React frontend
│   │   ├── index.js            # React entry point
│   │   ├── App.jsx             # Router, auth gate, license gate
│   │   ├── pages/              # Route-level page components
│   │   ├── components/         # Reusable UI components
│   │   ├── store/              # Zustand state stores
│   │   └── styles/             # Global CSS
│   ├── license/
│   │   └── licenseManager.js   # License activation & validation
│   └── shared/                 # Code shared between main & renderer
├── installer/
│   ├── windows/installer.nsi   # NSIS installer script
│   └── mac/                    # macOS DMG configuration
├── build/                      # Build resources (icons, entitlements)
├── docs/                       # Documentation
├── .env.example                # Environment variable template
├── package.json                # Dependencies + electron-builder config
└── electron-builder-server.json # Server-mode build config
```

---

## Database

The app uses **SQLite via better-sqlite3** — fast, serverless, no separate process needed.

### Schema (auto-migrated on startup)

| Table | Purpose |
|-------|---------|
| `users` | Staff accounts with role-based access |
| `patients` | Patient demographics, NHS number |
| `imaging_studies` | DICOM study groups per patient |
| `imaging_instances` | Individual images with annotations |
| `appointments` | Appointment scheduling |
| `reports` | Radiograph reports (draft/final) |
| `audit_log` | GDPR/HIPAA compliant access log |
| `system_settings` | Practice configuration |

### Database Location

- **Windows:** `%APPDATA%\Dental X-Ray Studio\database\dental_xray.db`
- **macOS:** `~/Library/Application Support/Dental X-Ray Studio/database/dental_xray.db`

### Viewing the Database (dev)

Install [DB Browser for SQLite](https://sqlitebrowser.org/) to inspect the database.  
Or use the VS Code extension **SQLite Viewer**.

### Upgrading to PostgreSQL / Firebird

For multi-user networked setups, swap `better-sqlite3` for `pg` (PostgreSQL).  
The migration system in `database.js` works with any SQL dialect with minor changes.  
Firebird is supported via `node-firebird` npm package.

---

## DICOM / Imaging

The viewer uses **[Cornerstone.js](https://cornerstonejs.org/)** — the industry standard for web-based DICOM viewing.

### Setup (required after project init)

```bash
npm install cornerstone-core cornerstone-tools cornerstone-wado-image-loader dicom-parser
```

### Configuration (src/renderer/utils/cornerstone.js — create this)

```js
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneTools from 'cornerstone-tools';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import dicomParser from 'dicom-parser';

export function initCornerstone() {
  cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
  cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
  cornerstoneTools.external.cornerstone = cornerstone;
  cornerstoneTools.external.cornerstoneMath = require('cornerstone-math');

  cornerstoneWADOImageLoader.configure({
    useWebWorkers: true,
    decodeConfig: { usePDFJS: false, strict: false },
  });

  cornerstoneTools.init();
}
```

Call `initCornerstone()` at app startup (in `App.jsx`).

### Supported Formats

| Format | Notes |
|--------|-------|
| DICOM (.dcm) | Full support via cornerstoneWADOImageLoader |
| JPEG / PNG | Via cornerstone-web-image-loader |
| OPG / Panoramic | DICOM DX modality |
| CBCT | Requires DICOM + volume rendering (Three.js) |
| Cephalometric | DICOM DX/CR |

---

## Licensing System

### How it works

1. User enters a license key (format: `XXXXX-XXXXX-XXXXX-XXXXX`)
2. App sends key + machine fingerprint to your license server
3. Server returns a signed **RS256 JWT**
4. JWT is stored encrypted in `electron-store`
5. On every startup, JWT is verified locally (works offline)
6. Every 24h, JWT is re-validated against server

### Setting up the License Server

You need to build/host a small API server. Minimum endpoints:

```
POST /api/v1/activate    { licenseKey, machineId, machineInfo }
                         → { success, token, license }

POST /api/v1/validate    { licenseKey, machineId, token }
                         → { success, token? }

POST /api/v1/deactivate  { licenseKey, machineId, token }
                         → { success }
```

**Recommended stack:** Node.js + Express + PostgreSQL + `jsonwebtoken`

**Generate RSA keypair:**
```bash
openssl genrsa -out license-private.pem 2048
openssl rsa -in license-private.pem -pubout -out license-public.pem
```

- Deploy `license-private.pem` to your license server (sign JWTs)
- Paste contents of `license-public.pem` into `src/license/licenseManager.js`

**License key generation:**
```js
// Example: generate a key on your license server
const crypto = require('crypto');
function generateKey() {
  const bytes = crypto.randomBytes(10);
  const hex = bytes.toString('hex').toUpperCase();
  return [0,4,8,12,16].map(i => hex.slice(i, i+4)).join('-');
}
// → e.g. "A3F2-9B1C-7DE4-82FA-3C10"
```

### License Tiers (example)

```json
{
  "tier": "professional",
  "maxUsers": 10,
  "features": ["imaging", "reports", "export"],
  "expiresAt": "2025-12-31T00:00:00Z",
  "machineId": "abc123..."
}
```

---

## Building Installers

### Prerequisites for Building

- **Windows signing:** A code signing certificate (.p12) from a CA like DigiCert or Sectigo (~£200/yr)
- **macOS signing:** Apple Developer account (£79/yr), with Developer ID Application certificate

### Local builds (unsigned, for testing)

```bash
# Build React first
npm run build:renderer

# Windows installer (requires Windows or cross-compilation)
npm run build:win

# macOS DMG (requires macOS)
npm run build:mac
```

Output is in the `dist/` folder.

### Via GitHub Actions (recommended)

Push a version tag to trigger a full build + release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will:
1. Build Windows Client installer
2. Build Windows Server installer
3. Build macOS DMG (x64 + ARM64 universal)
4. Create a Draft GitHub Release with all installers attached

---

## GitHub Repository Setup

### 1. Create the repository

```bash
cd dental-xray-studio
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/dental-xray-studio.git
git push -u origin main
```

### 2. Configure GitHub Secrets

In your repo: **Settings → Secrets and Variables → Actions → New repository secret**

| Secret Name | Description |
|-------------|-------------|
| `STORE_ENCRYPTION_KEY` | Random 32-char string for electron-store encryption |
| `WINDOWS_CERT_BASE64` | Base64-encoded Windows code signing cert `.p12` |
| `WINDOWS_CERT_PASSWORD` | Password for the Windows cert |
| `APPLE_CERT_BASE64` | Base64-encoded Apple Developer cert |
| `APPLE_CERT_PASSWORD` | Password for the Apple cert |
| `KEYCHAIN_PASSWORD` | Any random string (temp macOS keychain) |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID |

**Encode a certificate to Base64:**
```bash
# macOS/Linux
base64 -i certificate.p12 | pbcopy  # copies to clipboard

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.p12")) | clip
```

### 3. Update package.json

Replace these values in `package.json`:
```json
"publish": {
  "owner": "YOUR_GITHUB_USERNAME",
  "repo": "dental-xray-studio"
}
```

---

## Code Signing

### Why it's important

Without code signing:
- Windows shows "Windows protected your PC" SmartScreen warning
- macOS will refuse to open the app ("app is damaged") on newer versions

### Windows

Purchase a standard OV (Organization Validated) certificate from:
- DigiCert, Sectigo, GlobalSign, or SSL.com (~£150–300/yr)
- Download as `.p12` / PKCS#12 format

### macOS

1. Enroll in [Apple Developer Program](https://developer.apple.com) (£79/yr)
2. Create a **Developer ID Application** certificate in Xcode or developer.apple.com
3. Export as `.p12` from Keychain Access
4. Enable **Notarization** (required for macOS 10.15+): electron-builder handles this automatically if `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` are set

---

## Regulatory Compliance

### UK (your location — Deal, England)

| Regulation | Requirement | How addressed |
|-----------|-------------|---------------|
| **UK GDPR / Data Protection Act 2018** | Audit trail, data minimisation, retention limits | Audit log table, configurable retention period |
| **ICO guidance on medical records** | 10 year minimum retention | `gdpr_retention_years` setting (default 10) |
| **Caldicott Principles** | Justified access, minimum necessary | Role-based access control (admin/dentist/hygienist/receptionist/readonly) |
| **Cyber Essentials** | Secure configuration, access control | Encrypted store, bcrypt passwords, contextIsolation |
| **NHS Digital DSPT** | Data Security & Protection Toolkit | Audit log, user authentication, encryption at rest |

### Medical Device Regulation

Dental imaging **software as a medical device (SaMD)** may require:
- **UKCA marking** (post-Brexit UK equivalent of CE marking)
- **MHRA registration** if classified as Class IIa or above
- **ISO 13485** quality management system
- **IEC 62304** software development lifecycle

> ⚠️ Consult a regulatory consultant before commercial deployment. The classification depends on intended use — if used for diagnostic decisions, it likely requires registration.

### DICOM Compliance

For full DICOM compliance:
- Implement DICOM Store SCP (receives images from X-ray equipment)
- Implement DICOM Query/Retrieve (C-FIND, C-GET)
- Consider [dcm4che](https://www.dcm4che.org/) or [Orthanc](https://www.orthanc-server.com/) for the PACS backend

---

## Roadmap

### Phase 1 (Foundation — this codebase)
- [x] Electron + React architecture
- [x] SQLite database with migrations
- [x] Patient management
- [x] DICOM viewer shell (Cornerstone.js integration points)
- [x] License management with hardware fingerprinting
- [x] Audit logging (GDPR/ICO compliant)
- [x] Windows + macOS GitHub Actions builds

### Phase 2
- [ ] Full Cornerstone.js DICOM rendering
- [ ] DICOM SCP receiver (accept images from X-ray units)
- [ ] Tooth charting (FDI notation)
- [ ] Annotation tools (length, angle, area)
- [ ] Report generation with PDF export

### Phase 3
- [ ] Multi-user / networked mode (PostgreSQL backend)
- [ ] Worklist (DICOM MWL)
- [ ] AI-powered findings detection
- [ ] Two-factor authentication
- [ ] Patient portal

---

## Support

- Documentation: `/docs/`
- License server setup: `/docs/license-server.md`
- Cornerstone.js setup: `/docs/cornerstone-setup.md`
