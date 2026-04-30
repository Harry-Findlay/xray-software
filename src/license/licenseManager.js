/**
 * License Manager
 * 
 * Strategy:
 * 1. On activation: sends machine fingerprint + license key to license server
 * 2. Server validates and returns a signed JWT
 * 3. JWT is stored encrypted locally
 * 4. On each startup: validates JWT signature locally (offline-capable)
 * 5. Periodically re-validates with server (every 24h by default)
 * 
 * License Server API (you implement this separately — see /docs/license-server.md):
 *   POST /api/v1/activate   { licenseKey, machineId, machineInfo }
 *   POST /api/v1/deactivate { licenseKey, machineId, token }
 *   POST /api/v1/validate   { licenseKey, machineId, token }
 */

const { machineIdSync } = require('node-machine-id');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const log = require('electron-log');
const os = require('os');
const crypto = require('crypto');

// This public key is used to verify JWT signatures from your license server
// Generate with: openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem
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
const GRACE_PERIOD_DAYS = 7;

class LicenseManager {
  constructor(store) {
    this.store = store;
    this.machineId = null;
    this.licenseStatus = null;
    this.revalidationTimer = null;
  }

  getMachineId() {
    if (!this.machineId) {
      try {
        const raw = machineIdSync();
        // Hash it so we don't expose the raw hardware ID
        this.machineId = crypto
          .createHash('sha256')
          .update(raw + 'dental-xray-salt')
          .digest('hex');
      } catch (err) {
        // Fallback fingerprint
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
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
    };
  }

  getStoredToken() {
    return this.store.get('license.token', null);
  }

  getStoredKey() {
    return this.store.get('license.key', null);
  }

  getLastValidated() {
    return this.store.get('license.lastValidated', null);
  }

  storeActivation(key, token) {
    this.store.set('license', {
      key,
      token,
      machineId: this.getMachineId(),
      activatedAt: new Date().toISOString(),
      lastValidated: new Date().toISOString(),
    });
  }

  clearActivation() {
    this.store.delete('license');
    this.licenseStatus = null;
  }

  /**
   * Verify JWT locally without hitting the server
   */
  verifyTokenLocally(token) {
    try {
      // Skip if no real public key configured yet
      if (LICENSE_SERVER_PUBLIC_KEY.includes('REPLACE_WITH')) {
        log.warn('License: Using development bypass (no public key configured)');
        return { valid: true, payload: { tier: 'professional', maxUsers: 5, features: ['all'] }, dev: true };
      }

      const payload = jwt.verify(token, LICENSE_SERVER_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'dental-xray-license-server',
      });

      // Check expiry
      const expiresAt = new Date(payload.exp * 1000);
      if (expiresAt < new Date()) {
        return { valid: false, reason: 'token_expired' };
      }

      // Check machine binding
      if (payload.machineId && payload.machineId !== this.getMachineId()) {
        return { valid: false, reason: 'machine_mismatch' };
      }

      return { valid: true, payload };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  /**
   * Activate a license key against the server
   */
  async activate(licenseKey) {
    const machineId = this.getMachineId();
    log.info(`License activation attempt for key: ${licenseKey.substring(0, 8)}...`);

    // Dev bypass — simulate activation without network
    if (LICENSE_SERVER_PUBLIC_KEY.includes('REPLACE_WITH')) {
      log.warn('[License] Dev mode — simulating activation');
      this.storeActivation(licenseKey, 'dev-token');
      this.licenseStatus = { active: true, dev: true, license: { tier: 'developer', seats: 99 } };
      return { success: true, license: this.licenseStatus.license };
    }

    try {
      const response = await axios.post(`${LICENSE_SERVER_URL}/api/v1/activate`, {
        licenseKey,
        machineId,
        machineInfo: this.getMachineInfo(),
        appVersion: require('electron').app.getVersion(),
      }, { timeout: 10000 });

      if (response.data.success) {
        const { token, license } = response.data;
        this.storeActivation(licenseKey, token);
        this.licenseStatus = { active: true, license, token };
        this.scheduleRevalidation();
        log.info('License activated successfully');
        return { success: true, license };
      } else {
        return { success: false, error: response.data.error || 'Activation failed' };
      }
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      log.error(`License activation error: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Deactivate and release the license seat
   */
  async deactivate() {
    const key = this.getStoredKey();
    const token = this.getStoredToken();
    if (!key) return { success: false, error: 'No active license' };

    try {
      await axios.post(`${LICENSE_SERVER_URL}/api/v1/deactivate`, {
        licenseKey: key,
        machineId: this.getMachineId(),
        token,
      }, { timeout: 10000 });
    } catch (err) {
      log.warn('Could not contact server to deactivate, clearing locally anyway');
    }

    this.clearActivation();
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    return { success: true };
  }

  /**
   * Validate license on startup - works offline within grace period
   */
  async validate() {
    // Dev bypass — fires immediately if no real public key is configured.
    // No token, no server, no network needed.
    if (LICENSE_SERVER_PUBLIC_KEY.includes('REPLACE_WITH')) {
      log.warn('[License] Dev bypass active — replace public key to enforce licensing');
      this.licenseStatus = { active: true, dev: true, license: { tier: 'developer', seats: 99, features: ['all'] } };
      return this.licenseStatus;
    }

    const token = this.getStoredToken();
    const key = this.getStoredKey();

    if (!token || !key) {
      this.licenseStatus = { active: false, reason: 'not_activated' };
      return this.licenseStatus;
    }

    // First: local validation (offline-capable)
    const localResult = this.verifyTokenLocally(token);
    
    if (localResult.dev) {
      this.licenseStatus = { active: true, dev: true, license: localResult.payload };
      return this.licenseStatus;
    }

    if (!localResult.valid) {
      // Token invalid — check grace period
      const lastValidated = this.getLastValidated();
      if (lastValidated) {
        const daysSinceValidation = (Date.now() - new Date(lastValidated).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceValidation <= GRACE_PERIOD_DAYS) {
          log.warn(`License token invalid but within grace period (${daysSinceValidation.toFixed(1)} days)`);
          this.licenseStatus = { active: true, grace: true, daysRemaining: GRACE_PERIOD_DAYS - daysSinceValidation };
          return this.licenseStatus;
        }
      }
      this.licenseStatus = { active: false, reason: localResult.reason };
      return this.licenseStatus;
    }

    // Token valid locally — try server re-validation if due
    const lastValidated = this.getLastValidated();
    const needsRevalidation = !lastValidated || 
      (Date.now() - new Date(lastValidated).getTime() > REVALIDATION_INTERVAL_MS);

    if (needsRevalidation) {
      await this.revalidateWithServer(key, token);
    }

    this.licenseStatus = { active: true, license: localResult.payload };
    this.scheduleRevalidation();
    return this.licenseStatus;
  }

  async revalidateWithServer(key, token) {
    try {
      const response = await axios.post(`${LICENSE_SERVER_URL}/api/v1/validate`, {
        licenseKey: key,
        machineId: this.getMachineId(),
        token,
      }, { timeout: 8000 });

      if (response.data.success) {
        if (response.data.token) {
          // Server issued a refreshed token
          this.store.set('license.token', response.data.token);
        }
        this.store.set('license.lastValidated', new Date().toISOString());
        log.info('License revalidated with server');
      } else {
        log.warn('Server says license is invalid:', response.data.error);
        this.clearActivation();
      }
    } catch (err) {
      // Offline — that's OK, we'll use grace period
      log.warn('Could not reach license server for revalidation:', err.message);
    }
  }

  scheduleRevalidation() {
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    this.revalidationTimer = setInterval(async () => {
      const key = this.getStoredKey();
      const token = this.getStoredToken();
      if (key && token) await this.revalidateWithServer(key, token);
    }, REVALIDATION_INTERVAL_MS);
  }

  getStatus() {
    return this.licenseStatus || { active: false, reason: 'not_checked' };
  }
}

module.exports = { LicenseManager };
