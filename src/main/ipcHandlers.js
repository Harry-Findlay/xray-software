/**
 * ipcHandlers.js
 */

const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const log    = require('electron-log');
const { writeAuditLog } = require('./auditLog');


// ─── SERIALIZERS (FIX FOR DATE → STRING) ─────────────────────────────────────

function serializeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    out[key] = val instanceof Date ? val.toISOString() : val;
  }
  return out;
}

function serializeRows(rows) {
  return Array.isArray(rows) ? rows.map(serializeRow) : [];
}


// ─── MAIN SETUP ──────────────────────────────────────────────────────────────

function setupIpcHandlers(ipcMain, { licenseManager, store, dialog, app, db, dbReady, setDbReady }) {

  // ─── DATABASE CONNECTION ───────────────────────────────────────────────────

  ipcMain.handle('db:status', async () => {
    const config = db.getStoredConfig();
    return {
      connected: dbReady(),
      hasConfig:  !!config,
      engine:     config?.engine  || null,
      host:       config?.host    || null,
      database:   config?.database || config?.path || null,
    };
  });

  ipcMain.handle('db:test', async (event, config) => {
    return await db.testConnection(config);
  });

  ipcMain.handle('db:connect', async (event, config) => {
    try {
      const test = await db.testConnection(config);
      if (!test.success) return { success: false, error: test.error };

      await db.closeDatabase().catch(() => {});
      setDbReady(false);

      db.saveConfig(config);
      await db.initDatabase(config);
      setDbReady(true);

      log.info('DB connected via setup wizard.');
      return { success: true };
    } catch (err) {
      log.error('db:connect:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:reconnect', async () => {
    try {
      await db.closeDatabase().catch(() => {});
      setDbReady(false);
      await db.initDatabase();
      setDbReady(true);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:reset', async () => {
    await db.closeDatabase().catch(() => {});
    db.clearConfig();
    setDbReady(false);
    return { success: true };
  });

  // ─── AUTH ──────────────────────────────────────────────────────────────────

  ipcMain.handle('auth:login', async (event, username, password) => {
    try {
      if (!dbReady()) return { success: false, error: 'Database not connected' };
      const p = db.ph;

      const { rows } = await db.query(
        `SELECT * FROM users WHERE username = ${p(1)} AND is_active = ${p(2)}`,
        [username, _active()]
      );

      if (!rows.length) return { success: false, error: 'Invalid username or password' };

      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return { success: false, error: 'Invalid username or password' };

      await db.query(`UPDATE users SET last_login = NOW() WHERE id = ${p(1)}`, [user.id]).catch(() => {});

      writeAuditLog({ action: 'LOGIN', username: user.username, resource_type: 'user', resource_id: user.id });

      const { password_hash, ...safeUser } = user;

      return { success: true, user: serializeRow(safeUser) };

    } catch (err) {
      log.error('auth:login:', err.message);
      return { success: false, error: 'Login failed' };
    }
  });

  ipcMain.handle('auth:changePassword', async (event, userId, oldPassword, newPassword) => {
    if (!dbReady()) return { success: false, error: 'Database not connected' };

    const { rows } = await db.query(`SELECT password_hash FROM users WHERE id = ${db.ph(1)}`, [userId]);

    if (!rows.length) return { success: false, error: 'User not found' };

    const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!valid) return { success: false, error: 'Current password is incorrect' };

    const hash = await bcrypt.hash(newPassword, 12);

    await db.query(
      `UPDATE users SET password_hash = ${db.ph(1)}, updated_at = NOW() WHERE id = ${db.ph(2)}`,
      [hash, userId]
    );

    writeAuditLog({ action: 'UPDATE', resource_type: 'user', resource_id: userId, description: 'Password changed' });

    return { success: true };
  });

  // ─── PATIENTS ──────────────────────────────────────────────────────────────

  ipcMain.handle('patients:getAll', async (event, filters = {}) => {
    if (!dbReady()) return [];

    const p = db.ph;

    let sql = `SELECT id, patient_number, first_name, last_name, date_of_birth,
                      gender, phone, email, nhs_number, medical_alerts, is_active
               FROM patients WHERE is_active = ${p(1)}`;

    const params = [_active()];

    if (filters.search) {
      const s = `%${filters.search}%`;
      sql += ` AND (first_name ILIKE ${p(2)} OR last_name ILIKE ${p(3)} OR patient_number ILIKE ${p(4)})`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY last_name, first_name LIMIT 500';

    const { rows } = await db.query(sql, params);

    return serializeRows(rows);
  });

  ipcMain.handle('patients:getById', async (event, id) => {
    if (!dbReady()) return null;

    const { rows } = await db.query(`SELECT * FROM patients WHERE id = ${db.ph(1)}`, [id]);

    if (rows[0]) writeAuditLog({ action: 'READ', resource_type: 'patient', resource_id: id });

    return serializeRow(rows[0]) || null;
  });

  ipcMain.handle('patients:search', async (event, queryStr) => {
    if (!dbReady()) return [];

    const s = `%${queryStr}%`;
    const p = db.ph;

    const { rows } = await db.query(
      `SELECT id, patient_number, first_name, last_name, date_of_birth, phone
       FROM patients
       WHERE is_active=${p(1)}
         AND (first_name ILIKE ${p(2)} OR last_name ILIKE ${p(3)}
              OR patient_number ILIKE ${p(4)} OR nhs_number ILIKE ${p(5)})
       ORDER BY last_name, first_name LIMIT 50`,
      [_active(), s, s, s, s]
    );

    return serializeRows(rows);
  });

  // ─── IMAGING ───────────────────────────────────────────────────────────────

  ipcMain.handle('imaging:getStudies', async (event, patientId) => {
    if (!dbReady()) return [];

    const p = db.ph;

    const { rows } = await db.query(
      `SELECT s.*, COUNT(i.id)::int AS image_count
       FROM imaging_studies s
       LEFT JOIN imaging_instances i ON i.study_id = s.id
       WHERE s.patient_id = ${p(1)} AND s.status = ${p(2)}
       GROUP BY s.id
       ORDER BY s.study_date DESC NULLS LAST`,
      [patientId, 'active']
    );

    return serializeRows(rows);
  });

  ipcMain.handle('imaging:getStudy', async (event, studyId) => {
    if (!dbReady()) return null;

    const p = db.ph;

    const { rows: studyRows } = await db.query(
      `SELECT * FROM imaging_studies WHERE id=${p(1)}`,
      [studyId]
    );

    const { rows: instances } = await db.query(
      `SELECT * FROM imaging_instances WHERE study_id=${p(1)} ORDER BY is_primary DESC, created_at`,
      [studyId]
    );

    writeAuditLog({ action: 'READ', resource_type: 'study', resource_id: studyId });

    return {
      study: serializeRow(studyRows[0]) || null,
      instances: serializeRows(instances)
    };
  });

  // ─── AUDIT ────────────────────────────────────────────────────────────────

  ipcMain.handle('audit:getLogs', async (event, filters = {}) => {
    if (!dbReady()) return [];

    const p = db.ph;

    let sql = 'SELECT * FROM audit_log WHERE TRUE';
    const params = [];
    let i = 1;

    if (filters.from)   { sql += ` AND timestamp >= ${p(i++)}`; params.push(filters.from); }
    if (filters.to)     { sql += ` AND timestamp <= ${p(i++)}`; params.push(filters.to); }
    if (filters.userId) { sql += ` AND user_id = ${p(i++)}`;    params.push(filters.userId); }
    if (filters.action) { sql += ` AND action = ${p(i++)}`;     params.push(filters.action); }

    sql += ' ORDER BY timestamp DESC LIMIT 1000';

    const { rows } = await db.query(sql, params);

    return serializeRows(rows);
  });

  // ─── USERS ────────────────────────────────────────────────────────────────

  ipcMain.handle('users:getAll', async () => {
    if (!dbReady()) return [];

    const { rows } = await db.query(
      'SELECT id, username, first_name, last_name, email, role, is_active, last_login FROM users ORDER BY last_name, first_name'
    );

    return serializeRows(rows);
  });
}


// ─── HELPERS ────────────────────────────────────────────────────────────────

function _active() {
  return true;
}

async function _nextPatientNumber() {
  const db = require('./database');

  const { rows } = await db.query(
    'SELECT patient_number FROM patients ORDER BY created_at DESC LIMIT 1'
  );

  if (!rows.length) return 'P00001';

  const num = parseInt(rows[0].patient_number.replace(/\D/g, ''), 10) + 1;

  return `P${String(num).padStart(5, '0')}`;
}

async function _getSetting(key) {
  const db = require('./database');

  try {
    const { rows } = await db.query(
      `SELECT value FROM system_settings WHERE key=${db.ph(1)}`,
      [key]
    );

    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

module.exports = { setupIpcHandlers };