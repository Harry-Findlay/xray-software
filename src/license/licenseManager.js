/**
 * LicenseManager
 *
 * Strategy:
 *   - Licenses NEVER expire (no exp claim in JWT)
 *   - Revocation is handled server-side only: the server can mark a key as
 *     revoked and will refuse /validate requests. The client will clear the
 *     license after the grace period lapses without a successful server check.
 *   - Offline grace period: 7 days before the client asks the user to reconnect
 *   - Machine-bound: JWT contains a hashed machineId; switching machines requires
 *     deactivation first (or admin revoke + reissue)
 *
 * License Server API:
 *   POST /api/v1/activate   { licenseKey, machineId, machineInfo, appVersion }
 *   POST /api/v1/deactivate { licenseKey, machineId, token }
 *   POST /api/v1/validate   { licenseKey, machineId, token }
 *
 * For local testing, run the license-server/ project on http://localhost:4000
 * and set LICENSE_SERVER_URL to that in development.
 */

const { machineIdSync }    = require('node-machine-id');
const jwt                  = require('jsonwebtoken');
const axios                = require('axios');
const log                  = require('electron-log');
const os                   = require('os');
const crypto               = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────
// In production replace LICENSE_SERVER_PUBLIC_KEY with your real RSA public key.
// In dev/testing, if the placeholder is present, a local bypass is used.
const LICENSE_SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
REPLACE_WITH_YOUR_RSA_PUBLIC_KEY
-----END PUBLIC KEY-----`;

// Production URL — override in .env for dev: LICENSE_SERVER_URL=http://localhost:4000
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://license.yourcompany.com';

// How often to re-check with the server (ms)
const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// How long the app works without a successful server check
const GRACE_PERIOD_DAYS = 7;

// ── LicenseManager ──────────────────────────────────────────────────────────

class LicenseManager {
  constructor(store) {
    this.store  = store;
    this._machineId       = null;
    this.licenseStatus    = null;
    this.revalidationTimer = null;
  }

  // ── Machine fingerprint ────────────────────────────────────────────────────

  getMachineId() {
    if (!this._machineId) {
      try {
        const raw = machineIdSync();
        this._machineId = crypto
          .createHash('sha256')
          .update(raw + 'dental-xray-v1')
          .digest('hex');
      } catch {
        this._machineId = crypto
          .createHash('sha256')
          .update(os.hostname() + os.platform() + os.arch())
          .digest('hex');
      }
    }
    return this._machineId;
  }

  getMachineInfo() {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch:     os.arch(),
      cpus:     os.cpus().length,
      memory:   Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
    };
  }

  // ── Stored license data ────────────────────────────────────────────────────

  _getStored(field) { return this.store.get(`license.${field}`, null); }
  _getToken()  { return this._getStored('token'); }
  _getKey()    { return this._getStored('key'); }
  _getLastOk() { return this._getStored('lastValidated'); }

  _persist(key, token) {
    this.store.set('license', {
      key,
      token,
      machineId:     this.getMachineId(),
      activatedAt:   new Date().toISOString(),
      lastValidated: new Date().toISOString(),
    });
  }

  _clear() {
    this.store.delete('license');
    this.licenseStatus = null;
  }

  // ── Local JWT verification (offline-capable) ───────────────────────────────

  _verifyLocally(token) {
    // Development bypass — no real key configured yet
    if (LICENSE_SERVER_PUBLIC_KEY.includes('REPLACE_WITH')) {
      log.warn('[License] Dev bypass active — no public key configured');
      return {
        valid: true,
        dev: true,
        payload: { tier: 'professional', seats: 5, features: ['all'], machineId: this.getMachineId() },
      };
    }

    try {
      // Licenses have no exp claim — we use revocation instead
      const payload = jwt.verify(token, LICENSE_SERVER_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer:     'dental-xray-license-server',
        ignoreExpiration: true,   // no expiry — revocation is server-side
      });

      // Machine binding check
      if (payload.machineId && payload.machineId !== this.getMachineId()) {
        return { valid: false, reason: 'machine_mismatch' };
      }

      return { valid: true, payload };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  // ── Activate ───────────────────────────────────────────────────────────────

  async activate(licenseKey) {
    log.info(`[License] Activating key: ${licenseKey.slice(0, 8)}…`);
    try {
      const response = await axios.post(
        `${LICENSE_SERVER_URL}/api/v1/activate`,
        {
          licenseKey,
          machineId:   this.getMachineId(),
          machineInfo: this.getMachineInfo(),
          appVersion:  require('electron').app.getVersion(),
        },
        { timeout: 10000 }
      );

      if (response.data.success) {
        const { token, license } = response.data;
        this._persist(licenseKey, token);
        this.licenseStatus = { active: true, license, token };
        this._scheduleRevalidation();
        log.info('[License] Activated successfully');
        return { success: true, license };
      }
      return { success: false, error: response.data.error || 'Activation failed' };
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      log.error('[License] Activate error:', msg);
      return { success: false, error: msg };
    }
  }

  // ── Deactivate (release seat) ──────────────────────────────────────────────

  async deactivate() {
    const key   = this._getKey();
    const token = this._getToken();
    if (!key) return { success: false, error: 'No active license' };

    try {
      await axios.post(
        `${LICENSE_SERVER_URL}/api/v1/deactivate`,
        { licenseKey: key, machineId: this.getMachineId(), token },
        { timeout: 8000 }
      );
    } catch (err) {
      log.warn('[License] Could not reach server to deactivate — clearing locally anyway');
    }

    this._clear();
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    return { success: true };
  }

  // ── Validate (called at startup + periodically) ────────────────────────────

  async validate() {
    const token = this._getToken();
    const key   = this._getKey();

    if (!token || !key) {
      this.licenseStatus = { active: false, reason: 'not_activated' };
      return this.licenseStatus;
    }

    // 1. Local JWT check (no network required)
    const local = this._verifyLocally(token);

    // Dev bypass
    if (local.dev) {
      this.licenseStatus = { active: true, dev: true, license: local.payload };
      return this.licenseStatus;
    }

    // Signature invalid — clear immediately
    if (!local.valid && local.reason !== 'grace') {
      // Don't clear immediately — check grace period first
      const lastOk = this._getLastOk();
      if (lastOk) {
        const days = (Date.now() - new Date(lastOk).getTime()) / 86400000;
        if (days <= GRACE_PERIOD_DAYS) {
          log.warn(`[License] Token check failed but in grace period (${days.toFixed(1)}d / ${GRACE_PERIOD_DAYS}d)`);
          this.licenseStatus = { active: true, grace: true, daysRemaining: Math.ceil(GRACE_PERIOD_DAYS - days), license: local.payload };
          return this.licenseStatus;
        }
      }
      log.warn('[License] Token invalid and grace period lapsed');
      this._clear();
      this.licenseStatus = { active: false, reason: local.reason };
      return this.licenseStatus;
    }

    // 2. Server re-validation if due
    const lastOk = this._getLastOk();
    const needsCheck = !lastOk || (Date.now() - new Date(lastOk).getTime() > REVALIDATION_INTERVAL_MS);
    if (needsCheck) {
      await this._revalidateWithServer(key, token);
    }

    // Re-read in case server revoked
    if (!this._getToken()) {
      this.licenseStatus = { active: false, reason: 'revoked' };
      return this.licenseStatus;
    }

    this.licenseStatus = { active: true, license: local.payload };
    this._scheduleRevalidation();
    return this.licenseStatus;
  }

  // ── Server re-validation ───────────────────────────────────────────────────

  async _revalidateWithServer(key, token) {
    try {
      const response = await axios.post(
        `${LICENSE_SERVER_URL}/api/v1/validate`,
        { licenseKey: key, machineId: this.getMachineId(), token },
        { timeout: 8000 }
      );

      if (response.data.success) {
        // Server may issue a refreshed token
        if (response.data.token) {
          this.store.set('license.token', response.data.token);
        }
        this.store.set('license.lastValidated', new Date().toISOString());
        log.info('[License] Server revalidation OK');
      } else {
        // Server says revoked
        log.warn('[License] Server says revoked:', response.data.error);
        this._clear();
      }
    } catch (err) {
      log.warn('[License] Server unreachable for revalidation (will use grace period):', err.message);
      // Do NOT clear — offline is allowed within grace period
    }
  }

  _scheduleRevalidation() {
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    this.revalidationTimer = setInterval(async () => {
      const key = this._getKey(); const token = this._getToken();
      if (key && token) await this._revalidateWithServer(key, token);
    }, REVALIDATION_INTERVAL_MS);
  }

  // ── Public status ──────────────────────────────────────────────────────────

  getStatus() {
    return this.licenseStatus || { active: false, reason: 'not_checked' };
  }
}

module.exports = { LicenseManager };
