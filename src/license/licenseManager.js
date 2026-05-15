/**
 * licenseManager.js
 *
 * Validation flow on every startup:
 *   1. Try to verify the stored JWT locally (offline-capable, instant)
 *   2. If local verification fails for ANY reason → fall back to server
 *   3. If server also unreachable → grace period (7 days)
 *   4. Every 24h, re-validate with server in the background
 */

const { machineIdSync } = require('node-machine-id');
const jwt    = require('jsonwebtoken');
const axios  = require('axios');
const log    = require('electron-log');
const os     = require('os');
const crypto = require('crypto');

const LICENSE_SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlYUfTxTvdUxz4Rml7ETN
1kmoFXmdWequcG9Zwtlx6I+W7RqeOG/gWLbf1Bcyd2g+mWkXtlcg5TnyHeoHvdi3
PPKiNZdYF8Zp473+8hCeAYGvrUfPz2qXl6vNNubi5fA3rElntzAe/NVc+0Piu3hO
vS1CnuvRsDBtj1gpG5w7EhMG71oB18u1fFRwVFA1O376qMMyjW5e0bYPJrLalxDH
0lrCHLY4UeCp2FF1eXuTxC5mIOI90dEIYdKRf4AFcaLH626R7d655PEiTz1JKBQz
xSAcDOPXtneLnuymS3Y48ZoFV9X8sMCLCVHBF58tz0UDN155EuCFlJjQxFHGbPeo
5QIDAQAB
-----END PUBLIC KEY-----`;

const _isDev = process.env.NODE_ENV === 'development';

const LICENSE_SERVER_URL = _isDev
  ? 'http://localhost:4000'
  : (process.env.LICENSE_SERVER_URL || 'https://license.yourcompany.com');

const REVALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GRACE_PERIOD_DAYS        = 7;

class LicenseManager {
  constructor(store) {
    this.store             = store;
    this.machineId         = null;
    this.licenseStatus     = null;
    this.revalidationTimer = null;
  }

  // ── Machine fingerprint ───────────────────────────────────────────────────

  getMachineId() {
    if (!this.machineId) {
      try {
        const raw = machineIdSync();
        this.machineId = crypto
          .createHash('sha256')
          .update(raw + 'dental-xray-salt')
          .digest('hex');
      } catch {
        this.machineId = crypto
          .createHash('sha256')
          .update(os.hostname() + os.platform() + os.arch())
          .digest('hex');
      }
    }
    return this.machineId;
  }

  getMachineInfo() {
    return {
      hostname:    os.hostname(),
      platform:    os.platform(),
      arch:        os.arch(),
      cpus:        os.cpus().length,
      totalMemory: os.totalmem(),
    };
  }

  // ── Store helpers ─────────────────────────────────────────────────────────

  getStoredToken()   { return this.store.get('license.token',         null); }
  getStoredKey()     { return this.store.get('license.key',           null); }
  getLastValidated() { return this.store.get('license.lastValidated', null); }

  storeActivation(key, token) {
    this.store.set('license', {
      key,
      token,
      machineId:     this.getMachineId(),
      activatedAt:   new Date().toISOString(),
      lastValidated: new Date().toISOString(),
    });
  }

  clearActivation() {
    this.store.delete('license');
    this.licenseStatus = null;
  }

  // ── Local JWT verification ────────────────────────────────────────────────
  // Returns { valid: true, payload } or { valid: false, reason }
  // Uses ignoreExpiration because the server issues non-expiring tokens
  // and relies on server-side revocation instead.

  verifyTokenLocally(token) {
    try {
      const payload = jwt.verify(token, LICENSE_SERVER_PUBLIC_KEY, {
        algorithms:       ['RS256'],
        issuer:           'dental-xray-license-server',
        ignoreExpiration: true,
      });

      if (payload.machineId && payload.machineId !== this.getMachineId()) {
        log.warn('[License] Machine ID mismatch in local token');
        return { valid: false, reason: 'machine_mismatch' };
      }

      return { valid: true, payload };

    } catch (err) {
      log.warn('[License] Local JWT verification failed:', err.message);
      return { valid: false, reason: err.message };
    }
  }

  // ── Server validation ─────────────────────────────────────────────────────
  // Calls /api/v1/validate and returns { active, license? } or throws.

  async validateWithServer(key, token) {
    const response = await axios.post(`${LICENSE_SERVER_URL}/api/v1/validate`, {
      licenseKey: key,
      machineId:  this.getMachineId(),
      token,
    }, { timeout: 8000 });

    if (response.data.success) {
      // Server may issue a fresh token — store it
      if (response.data.token) {
        this.store.set('license.token', response.data.token);
      }
      this.store.set('license.lastValidated', new Date().toISOString());
      log.info('[License] Server validation passed');
      return { active: true, license: response.data.license || {} };
    }

    log.warn('[License] Server rejected license:', response.data.error);
    return { active: false, reason: response.data.error };
  }

  // ── Activate ──────────────────────────────────────────────────────────────

  async activate(licenseKey) {
    log.info(`[License] Activation attempt: ${licenseKey.substring(0, 8)}…`);

    try {
      const response = await axios.post(`${LICENSE_SERVER_URL}/api/v1/activate`, {
        licenseKey,
        machineId:   this.getMachineId(),
        machineInfo: this.getMachineInfo(),
        appVersion:  require('electron').app.getVersion(),
      }, { timeout: 10000 });

      if (response.data.success) {
        const { token, license } = response.data;
        this.storeActivation(licenseKey, token);
        this.licenseStatus = { active: true, license };
        this.scheduleRevalidation();
        log.info('[License] Activated successfully');
        return { success: true, license };
      }

      return { success: false, error: response.data.error || 'Activation failed' };

    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      log.error('[License] Activation error:', msg);
      return { success: false, error: msg };
    }
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  async deactivate() {
    const key   = this.getStoredKey();
    const token = this.getStoredToken();
    if (!key) return { success: false, error: 'No active license' };

    try {
      await axios.post(`${LICENSE_SERVER_URL}/api/v1/deactivate`, {
        licenseKey: key,
        machineId:  this.getMachineId(),
        token,
      }, { timeout: 10000 });
    } catch (err) {
      log.warn('[License] Could not contact server to deactivate — clearing locally anyway');
    }

    this.clearActivation();
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    return { success: true };
  }

  // ── Validate (called on every startup) ───────────────────────────────────

  async validate() {
    const token = this.getStoredToken();
    const key   = this.getStoredKey();

    log.info('[License] Validating — key present:', !!key, '/ token present:', !!token);

    if (!token || !key) {
      log.info('[License] No stored credentials — not activated');
      this.licenseStatus = { active: false, reason: 'not_activated' };
      return this.licenseStatus;
    }

    // ── Try local verification first ────────────────────────────────────────
    const localResult = this.verifyTokenLocally(token);

    if (localResult.valid) {
      log.info('[License] Local verification passed');

      // Re-validate with server if overdue (non-blocking on result)
      const lastValidated     = this.getLastValidated();
      const needsRevalidation = !lastValidated ||
        (Date.now() - new Date(lastValidated).getTime() > REVALIDATION_INTERVAL_MS);

      if (needsRevalidation) {
        // Fire and forget — don't block startup on this
        this.validateWithServer(key, token).catch(err =>
          log.warn('[License] Background revalidation failed:', err.message)
        );
      }

      this.licenseStatus = { active: true, license: localResult.payload };
      this.scheduleRevalidation();
      return this.licenseStatus;
    }

    // ── Local failed — try server ───────────────────────────────────────────
    log.warn('[License] Local verification failed:', localResult.reason, '— trying server');

    try {
      const serverResult = await this.validateWithServer(key, token);

      if (serverResult.active) {
        this.licenseStatus = { active: true, license: serverResult.license };
        this.scheduleRevalidation();
        return this.licenseStatus;
      }

      // Server explicitly rejected — clear stored credentials
      this.clearActivation();
      this.licenseStatus = { active: false, reason: serverResult.reason };
      return this.licenseStatus;

    } catch (serverErr) {
      // Server unreachable — apply grace period
      log.warn('[License] Server unreachable:', serverErr.message);

      const lastValidated = this.getLastValidated();
      if (lastValidated) {
        const daysSince = (Date.now() - new Date(lastValidated).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= GRACE_PERIOD_DAYS) {
          log.warn(`[License] Grace period active — ${daysSince.toFixed(1)} of ${GRACE_PERIOD_DAYS} days used`);
          this.licenseStatus = {
            active:        true,
            grace:         true,
            daysRemaining: Math.ceil(GRACE_PERIOD_DAYS - daysSince),
          };
          return this.licenseStatus;
        }
      }

      log.warn('[License] Grace period expired or never validated — denying access');
      this.licenseStatus = { active: false, reason: 'server_unreachable' };
      return this.licenseStatus;
    }
  }

  // ── Background revalidation ───────────────────────────────────────────────

  scheduleRevalidation() {
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    this.revalidationTimer = setInterval(async () => {
      const key   = this.getStoredKey();
      const token = this.getStoredToken();
      if (!key || !token) return;
      try {
        await this.validateWithServer(key, token);
      } catch (err) {
        log.warn('[License] Scheduled revalidation failed:', err.message);
      }
    }, REVALIDATION_INTERVAL_MS);
  }

  getStatus() {
    return this.licenseStatus || { active: false, reason: 'not_checked' };
  }
}

module.exports = { LicenseManager };