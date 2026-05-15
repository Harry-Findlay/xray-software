/**
 * ipcHandlers.js
 */

const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const log    = require('electron-log');
const { writeAuditLog } = require('./auditLog');


// ─── SERIALIZERS ─────────────────────────────────────────────────────────────

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

  log.info('[IPC] Setting up handlers, licenseManager:', !!licenseManager);

  // ─── Helper: resolve image store root ──────────────────────────────────────
  function _imageStoreRoot() {
    try {
      const cached = store?.get('imageStorePath') || '';
      if (cached && fs.existsSync(cached)) return cached;
    } catch {}
    const fallback = path.join(app.getPath('userData'), 'images');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  // ─── DATABASE CONNECTION ───────────────────────────────────────────────────

  ipcMain.handle('db:status', async () => {
    const config = db.getStoredConfig();
    return {
      connected: dbReady(),
      hasConfig:  !!config,
      engine:     config?.engine   || null,
      host:       config?.host     || null,
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
      const user  = rows[0];
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
    const { rows } = await db.query(
      `SELECT password_hash FROM users WHERE id = ${db.ph(1)}`, [userId]
    );
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

  ipcMain.handle('patients:create', async (event, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p  = db.ph;
    const id = uuidv4();
    const patientNumber = await _nextPatientNumber();
    await db.query(
      `INSERT INTO patients
         (id, patient_number, first_name, last_name, date_of_birth,
          gender, phone, email, nhs_number, external_id, notes, is_active)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},${p(11)},${p(12)})`,
      [id, patientNumber, data.firstName, data.lastName,
       data.dateOfBirth || null, data.gender || null, data.phone || null,
       data.email || null, data.nhsNumber || null, data.externalId || null,
       data.notes || null, _active()]
    );
    writeAuditLog({ action: 'CREATE', resource_type: 'patient', resource_id: id });
    return { id, patient_number: patientNumber };
  });

  ipcMain.handle('patients:update', async (event, id, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p = db.ph;
    await db.query(
      `UPDATE patients SET
         first_name    = ${p(1)}, last_name     = ${p(2)}, date_of_birth = ${p(3)},
         gender        = ${p(4)}, phone         = ${p(5)}, email         = ${p(6)},
         nhs_number    = ${p(7)}, external_id   = ${p(8)}, notes         = ${p(9)},
         updated_at    = NOW()
       WHERE id = ${p(10)}`,
      [data.firstName, data.lastName, data.dateOfBirth || null, data.gender || null,
       data.phone || null, data.email || null, data.nhsNumber || null,
       data.externalId || null, data.notes || null, id]
    );
    writeAuditLog({ action: 'UPDATE', resource_type: 'patient', resource_id: id });
    return { success: true };
  });

  ipcMain.handle('patients:delete', async (event, id) => {
    if (!dbReady()) throw new Error('Database not connected');
    await db.query(
      `UPDATE patients SET is_active = ${db.ph(1)}, updated_at = NOW() WHERE id = ${db.ph(2)}`,
      [false, id]
    );
    writeAuditLog({ action: 'DELETE', resource_type: 'patient', resource_id: id });
    return { success: true };
  });

  ipcMain.handle('patients:search', async (event, queryStr) => {
    if (!dbReady()) return [];
    const s = `%${queryStr}%`;
    const p = db.ph;
    const { rows } = await db.query(
      `SELECT id, patient_number, first_name, last_name, date_of_birth, phone
       FROM patients
       WHERE is_active = ${p(1)}
         AND (first_name ILIKE ${p(2)} OR last_name ILIKE ${p(3)}
              OR patient_number ILIKE ${p(4)} OR nhs_number ILIKE ${p(5)})
       ORDER BY last_name, first_name LIMIT 50`,
      [_active(), s, s, s, s]
    );
    return serializeRows(rows);
  });

  // ─── IMAGING ───────────────────────────────────────────────────────────────
  //
  // Flat model — each imaging_instance links directly to patient_id.
  // No study abstraction in the UI.

  // Get all images for a patient, newest first
  ipcMain.handle('imaging:getImages', async (event, patientId) => {
    if (!dbReady()) return [];
    const p = db.ph;
    const { rows } = await db.query(
      `SELECT id, patient_id, file_path, thumbnail_path, file_size,
              image_type, image_category, image_date, tooth_number,
              annotations, acquisition_date, kvp, mas, created_at
       FROM imaging_instances
       WHERE patient_id = ${p(1)}
       ORDER BY created_at DESC`,
      [patientId]
    );
    writeAuditLog({ action: 'READ', resource_type: 'patient_images', resource_id: patientId });
    return serializeRows(rows);
  });

  // Get a single image by ID
  ipcMain.handle('imaging:getImage', async (event, instanceId) => {
    if (!dbReady()) return null;
    const p = db.ph;
    const { rows } = await db.query(
      `SELECT * FROM imaging_instances WHERE id = ${p(1)}`, [instanceId]
    );
    writeAuditLog({ action: 'READ', resource_type: 'imaging_instance', resource_id: instanceId });
    return serializeRow(rows[0]) || null;
  });

  // Import an image — copies into managed store, records directly against patient
  //
  // Storage: <imageStore>/<patientId>/<uuid>.<ext>
  // HIPAA/GDPR: original untouched, file_size recorded, every import audit-logged
  ipcMain.handle('imaging:importImage', async (event, patientId, sourcePath, meta = {}) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p = db.ph;

    const { rows: patientRows } = await db.query(
      `SELECT id FROM patients WHERE id = ${p(1)}`, [patientId]
    );
    if (!patientRows.length) throw new Error('Patient not found: ' + patientId);

    const resolvedSrc = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSrc)) throw new Error(`Source file not found: ${resolvedSrc}`);

    const storeRoot = _imageStoreRoot();
    const destDir   = path.join(storeRoot, patientId);
    fs.mkdirSync(destDir, { recursive: true });

    const ext      = path.extname(resolvedSrc).toLowerCase() || '.dat';
    const instId   = uuidv4();
    const destPath = path.join(destDir, `${instId}${ext}`);

    fs.copyFileSync(resolvedSrc, destPath, fs.constants.COPYFILE_EXCL);
    const stat = fs.statSync(destPath);

    await db.query(
      `INSERT INTO imaging_instances
         (id, patient_id, file_path, file_size, image_type, image_category,
          image_date, tooth_number, acquisition_date)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)})`,
      [instId, patientId, destPath, stat.size,
       meta.imageType     || null,
       meta.imageCategory || 'xray',
       meta.imageDate     || new Date().toISOString().slice(0, 10),
       meta.toothNumber   || null,
       new Date().toISOString()]
    );

    writeAuditLog({
      action: 'CREATE', resource_type: 'imaging_instance', resource_id: instId,
      details: JSON.stringify({ patient_id: patientId, file: path.basename(destPath), size: stat.size }),
    });

    log.info(`Image imported: ${resolvedSrc} → ${destPath}`);
    return { id: instId, filePath: destPath };
  });

  // Delete an image — removes file and DB record
  ipcMain.handle('imaging:deleteImage', async (event, instanceId) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p = db.ph;

    const { rows } = await db.query(
      `SELECT id, patient_id, file_path, thumbnail_path FROM imaging_instances WHERE id = ${p(1)}`,
      [instanceId]
    );
    if (!rows.length) throw new Error('Image not found: ' + instanceId);
    const inst = rows[0];

    for (const fp of [inst.file_path, inst.thumbnail_path].filter(Boolean)) {
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); }
      catch (err) { log.warn(`Could not delete file ${fp}:`, err.message); }
    }

    await db.query(`DELETE FROM imaging_instances WHERE id = ${p(1)}`, [instanceId]);

    writeAuditLog({
      action: 'DELETE', resource_type: 'imaging_instance', resource_id: instanceId,
      details: JSON.stringify({ patient_id: inst.patient_id, file: inst.file_path }),
    });

    log.info(`Image deleted: ${instanceId} (${inst.file_path})`);
    return { success: true };
  });

  // Save annotations
  ipcMain.handle('imaging:saveAnnotations', async (event, instanceId, annotations) => {
    if (!dbReady()) return;
    const p = db.ph;
    await db.query(
      `UPDATE imaging_instances SET annotations = ${p(1)} WHERE id = ${p(2)}`,
      [JSON.stringify(annotations), instanceId]
    );
    writeAuditLog({ action: 'UPDATE', resource_type: 'imaging_instance', resource_id: instanceId });
  });

  // ─── SETTINGS ─────────────────────────────────────────────────────────────

  ipcMain.handle('settings:getAll', async () => {
    if (!dbReady()) return {};
    try {
      const { rows } = await db.query('SELECT key, value FROM system_settings');
      const out = {};
      rows.forEach(r => { out[r.key] = r.value; });
      return out;
    } catch { return {}; }
  });

  ipcMain.handle('settings:get', async (event, key) => {
    if (!dbReady()) return null;
    try {
      const { rows } = await db.query(
        `SELECT value FROM system_settings WHERE key = ${db.ph(1)}`, [key]
      );
      return rows[0]?.value || null;
    } catch { return null; }
  });

  ipcMain.handle('settings:set', async (event, key, value) => {
    if (!dbReady()) return;
    const p = db.ph;
    await db.query(
      `INSERT INTO system_settings (key, value) VALUES (${p(1)},${p(2)})
       ON CONFLICT (key) DO UPDATE SET value = ${p(3)}, updated_at = NOW()`,
      [key, value, value]
    );
    if (key === 'image_store_path') store?.set('imageStorePath', value);
  });

  // ─── DIALOGS ──────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openFile', async (event, opts) => {
    return dialog.showOpenDialog(opts || {});
  });

  ipcMain.handle('dialog:saveFile', async (event, opts) => {
    return dialog.showSaveDialog(opts || {});
  });

  ipcMain.handle('dialog:openDirectory', async (event, opts) => {
    return dialog.showOpenDialog({ ...(opts || {}), properties: ['openDirectory'] });
  });

  ipcMain.handle('dialog:showMessage', async (event, opts) => {
    return dialog.showMessageBox(opts || {});
  });

  // ─── LICENSE ──────────────────────────────────────────────────────────────

  ipcMain.handle('license:getStatus', async () => {
    return licenseManager?.getStatus() || { active: false };
  });

  ipcMain.handle('license:activate', async (event, key) => {
    log.info('[IPC] license:activate called');
    return licenseManager?.activate(key) || { success: false, error: 'License manager unavailable' };
  });

  ipcMain.handle('license:deactivate', async () => {
    return licenseManager?.deactivate() || { success: false };
  });

  ipcMain.handle('license:validate', async () => {
    log.info('[IPC] license:validate called, licenseManager:', !!licenseManager);
    const result = await licenseManager?.validate();
    log.info('[IPC] license:validate result:', JSON.stringify(result));
    return result || { active: false, reason: 'no_license_manager' };
  });

  // ─── AUDIT ────────────────────────────────────────────────────────────────

  ipcMain.handle('audit:getLogs', async (event, filters = {}) => {
    if (!dbReady()) return [];
    const p = db.ph;
    let sql    = 'SELECT * FROM audit_log WHERE TRUE';
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

  ipcMain.handle('audit:exportLogs', async (event, outputPath) => {
    if (!dbReady()) return { success: false, error: 'Database not connected' };
    try {
      const { rows } = await db.query('SELECT * FROM audit_log ORDER BY timestamp DESC');
      const headers  = Object.keys(rows[0] || {}).join(',');
      const csvRows  = rows.map(r =>
        Object.values(r).map(v =>
          v == null ? '' : `"${String(v).replace(/"/g, '""')}"`
        ).join(',')
      );
      const csv = [headers, ...csvRows].join('\n');
      const dest = outputPath || path.join(app.getPath('downloads'), `audit-log-${Date.now()}.csv`);
      fs.writeFileSync(dest, csv, 'utf8');
      return { success: true, path: dest };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ─── USERS ────────────────────────────────────────────────────────────────

  ipcMain.handle('users:getAll', async () => {
    if (!dbReady()) return [];
    const { rows } = await db.query(
      'SELECT id, username, first_name, last_name, email, role, is_active, last_login FROM users ORDER BY last_name, first_name'
    );
    return serializeRows(rows);
  });

  ipcMain.handle('users:create', async (event, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p    = db.ph;
    const id   = uuidv4();
    const hash = await bcrypt.hash(data.password, 12);
    await db.query(
      `INSERT INTO users (id, username, password_hash, first_name, last_name, email, role)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)})`,
      [id, data.username, hash, data.firstName, data.lastName, data.email || null, data.role || 'readonly']
    );
    writeAuditLog({ action: 'CREATE', resource_type: 'user', resource_id: id });
    return { id };
  });

  // ─── APP ──────────────────────────────────────────────────────────────────

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('app:getInstallType', () => {
    const serverJson = path.join(process.resourcesPath || '', 'db-server.json');
    return fs.existsSync(serverJson) ? 'server' : 'client';
  });

  ipcMain.handle('app:quit', () => app.quit());

  ipcMain.handle('app:installUpdate', () => {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('app:openLogsDirectory', () => {
    const { shell } = require('electron');
    shell.openPath(path.join(app.getPath('userData'), 'logs'));
  });
}


// ─── HELPERS ─────────────────────────────────────────────────────────────────

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

module.exports = { setupIpcHandlers };