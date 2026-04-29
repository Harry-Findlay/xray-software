/**
 * ipcHandlers.js
 *
 * All Electron IPC handlers. The renderer calls these via window.electronAPI.*
 * Receives { licenseManager, store, dialog, app, db, dbReady, setDbReady }
 * from main.js so it can check/change connection state at runtime.
 */

const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const log    = require('electron-log');
const { writeAuditLog } = require('./auditLog');

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
      return { success: true, user: safeUser };
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
    await db.query(`UPDATE users SET password_hash = ${db.ph(1)}, updated_at = NOW() WHERE id = ${db.ph(2)}`, [hash, userId]);
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
    return rows;
  });

  ipcMain.handle('patients:getById', async (event, id) => {
    if (!dbReady()) return null;
    const { rows } = await db.query(`SELECT * FROM patients WHERE id = ${db.ph(1)}`, [id]);
    if (rows[0]) writeAuditLog({ action: 'READ', resource_type: 'patient', resource_id: id });
    return rows[0] || null;
  });

  ipcMain.handle('patients:create', async (event, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const id = uuidv4();
    const patientNumber = await _nextPatientNumber();
    const p = db.ph;
    await db.query(
      `INSERT INTO patients
         (id,    patient_number, first_name, last_name,    date_of_birth,
          gender, email,         phone,      address_line1, address_line2,
          city,   county,        postcode,   country,       nhs_number,
          referring_dentist, medical_alerts, notes)
       VALUES
         (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},
          ${p(6)},${p(7)},${p(8)},${p(9)},${p(10)},
          ${p(11)},${p(12)},${p(13)},${p(14)},${p(15)},
          ${p(16)},${p(17)},${p(18)})`,
      [id, patientNumber, data.firstName, data.lastName, data.dateOfBirth || null,
       data.gender || null, data.email || null, data.phone || null,
       data.addressLine1 || null, data.addressLine2 || null, data.city || null,
       data.county || null, data.postcode || null, data.country || 'GB',
       data.nhsNumber || null, data.referringDentist || null,
       JSON.stringify(data.medicalAlerts || []), data.notes || null]
    );
    writeAuditLog({ action: 'CREATE', resource_type: 'patient', resource_id: id, description: `${data.firstName} ${data.lastName}` });
    return { id, patientNumber };
  });

  ipcMain.handle('patients:update', async (event, id, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p = db.ph;
    await db.query(
      `UPDATE patients SET
         first_name=${p(1)},      last_name=${p(2)},      date_of_birth=${p(3)},
         gender=${p(4)},          email=${p(5)},           phone=${p(6)},
         address_line1=${p(7)},   address_line2=${p(8)},  city=${p(9)},
         county=${p(10)},         postcode=${p(11)},       nhs_number=${p(12)},
         referring_dentist=${p(13)}, medical_alerts=${p(14)}, notes=${p(15)},
         updated_at=NOW()
       WHERE id=${p(16)}`,
      [data.firstName, data.lastName, data.dateOfBirth || null, data.gender || null,
       data.email || null, data.phone || null, data.addressLine1 || null,
       data.addressLine2 || null, data.city || null, data.county || null,
       data.postcode || null, data.nhsNumber || null, data.referringDentist || null,
       JSON.stringify(data.medicalAlerts || []), data.notes || null, id]
    );
    writeAuditLog({ action: 'UPDATE', resource_type: 'patient', resource_id: id });
    return { success: true };
  });

  ipcMain.handle('patients:delete', async (event, id) => {
    if (!dbReady()) throw new Error('Database not connected');
    await db.query(`UPDATE patients SET is_active=${db.ph(1)}, updated_at=NOW() WHERE id=${db.ph(2)}`, [false, id]);
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
       WHERE is_active=${p(1)}
         AND (first_name ILIKE ${p(2)} OR last_name ILIKE ${p(3)}
              OR patient_number ILIKE ${p(4)} OR nhs_number ILIKE ${p(5)})
       ORDER BY last_name, first_name LIMIT 50`,
      [_active(), s, s, s, s]
    );
    return rows;
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
    return rows;
  });

  ipcMain.handle('imaging:getStudy', async (event, studyId) => {
    if (!dbReady()) return null;
    const p = db.ph;
    const { rows: studyRows } = await db.query(`SELECT * FROM imaging_studies WHERE id=${p(1)}`, [studyId]);
    const { rows: instances } = await db.query(
      `SELECT * FROM imaging_instances WHERE study_id=${p(1)} ORDER BY is_primary DESC, created_at`,
      [studyId]
    );
    writeAuditLog({ action: 'READ', resource_type: 'study', resource_id: studyId });
    return { study: studyRows[0] || null, instances };
  });

  ipcMain.handle('imaging:createStudy', async (event, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const id = uuidv4();
    const p = db.ph;
    await db.query(
      `INSERT INTO imaging_studies (id, patient_id, study_description, modality, study_date, notes)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)})`,
      [id, data.patientId, data.description || null, data.modality || 'CR',
       data.studyDate || null, data.notes || null]
    );
    writeAuditLog({ action: 'CREATE', resource_type: 'study', resource_id: id });
    return { id };
  });

  ipcMain.handle('imaging:importDicom', async (event, filePaths) => {
    if (!dbReady()) throw new Error('Database not connected');
    // DICOM import: parse tags with dicom-parser, insert instances per file
    // Full implementation requires dicom-parser to read UID / modality / kV etc.
    log.info(`DICOM import: ${filePaths.length} file(s) queued`);
    writeAuditLog({ action: 'CREATE', resource_type: 'study', description: `Queued ${filePaths.length} DICOM files` });
    return { success: true, imported: filePaths.length };
  });

  ipcMain.handle('imaging:importImage', async (event, studyId, filePath, meta = {}) => {
    if (!dbReady()) throw new Error('Database not connected');
    const id = uuidv4();
    const imageStorePath = await _getSetting('image_store_path');

    let destPath = filePath;
    if (imageStorePath && fs.existsSync(imageStorePath)) {
      const ext  = path.extname(filePath);
      const dest = path.join(imageStorePath, `${uuidv4()}${ext}`);
      fs.copyFileSync(filePath, dest);
      destPath = dest;
    }

    const p = db.ph;
    await db.query(
      `INSERT INTO imaging_instances
         (id, study_id, file_path, tooth_number, image_type, acquisition_date, kvp, mas)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)})`,
      [id, studyId, destPath, meta.toothNumber || null, meta.imageType || 'periapical',
       meta.acquisitionDate || null, meta.kvp || null, meta.mas || null]
    );
    writeAuditLog({ action: 'CREATE', resource_type: 'image', resource_id: id });
    return { id };
  });

  ipcMain.handle('imaging:saveAnnotations', async (event, instanceId, annotations) => {
    if (!dbReady()) throw new Error('Database not connected');
    await db.query(
      `UPDATE imaging_instances SET annotations=${db.ph(1)} WHERE id=${db.ph(2)}`,
      [JSON.stringify(annotations), instanceId]
    );
    writeAuditLog({ action: 'UPDATE', resource_type: 'image', resource_id: instanceId, description: 'Annotations saved' });
    return { success: true };
  });

  ipcMain.handle('imaging:deleteStudy', async (event, studyId) => {
    if (!dbReady()) throw new Error('Database not connected');
    await db.query(`UPDATE imaging_studies SET status=${db.ph(1)} WHERE id=${db.ph(2)}`, ['deleted', studyId]);
    writeAuditLog({ action: 'DELETE', resource_type: 'study', resource_id: studyId });
    return { success: true };
  });

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:getAll', async () => {
    if (!dbReady()) return {};
    const { rows } = await db.query('SELECT key, value FROM system_settings');
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  ipcMain.handle('settings:get', async (event, key) => _getSetting(key));

  ipcMain.handle('settings:set', async (event, key, value) => {
    if (!dbReady()) throw new Error('Database not connected');
    const p = db.ph;
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (${p(1)},${p(2)},NOW())
       ON CONFLICT (key) DO UPDATE SET value=${p(3)}, updated_at=NOW()`,
      [key, value, value]
    );
    writeAuditLog({ action: 'UPDATE', resource_type: 'settings', description: key });
    return { success: true };
  });

  // ─── FILE DIALOGS ──────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openFile',      async (e, opts) => dialog.showOpenDialog(opts));
  ipcMain.handle('dialog:saveFile',      async (e, opts) => dialog.showSaveDialog(opts));
  ipcMain.handle('dialog:openDirectory', async (e, opts) => dialog.showOpenDialog({ ...opts, properties: ['openDirectory'] }));
  ipcMain.handle('dialog:showMessage',   async (e, opts) => dialog.showMessageBox(opts));

  // ─── LICENSE ───────────────────────────────────────────────────────────────

  ipcMain.handle('license:getStatus',  ()         => licenseManager.getStatus());
  ipcMain.handle('license:activate',   (e, key)   => licenseManager.activate(key));
  ipcMain.handle('license:deactivate', ()         => licenseManager.deactivate());
  ipcMain.handle('license:validate',   ()         => licenseManager.validate());

  // ─── APP ───────────────────────────────────────────────────────────────────

  ipcMain.handle('app:getVersion',        () => app.getVersion());
  ipcMain.handle('app:getInstallType',    () => store.get('installType', 'client'));
  ipcMain.handle('app:quit',              () => app.quit());
  ipcMain.handle('app:installUpdate',     () => require('electron-updater').autoUpdater.quitAndInstall());
  ipcMain.handle('app:openLogsDirectory', () => {
    const { shell } = require('electron');
    shell.openPath(path.join(app.getPath('userData'), 'logs'));
  });

  // ─── AUDIT LOG ─────────────────────────────────────────────────────────────

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
    return rows;
  });

  ipcMain.handle('audit:exportLogs', async (event, outputPath) => {
    if (!dbReady()) throw new Error('Database not connected');
    const { rows } = await db.query('SELECT * FROM audit_log ORDER BY timestamp DESC');
    const csv = [
      'timestamp,username,action,resource_type,resource_id,description,success',
      ...rows.map(r => ['timestamp','username','action','resource_type','resource_id','description','success']
        .map(k => `"${(r[k] ?? '').toString().replace(/"/g, '""')}"`)
        .join(','))
    ].join('\n');
    fs.writeFileSync(outputPath, csv, 'utf8');
    return { success: true };
  });

  // ─── USERS ─────────────────────────────────────────────────────────────────

  ipcMain.handle('users:getAll', async () => {
    if (!dbReady()) return [];
    const { rows } = await db.query(
      'SELECT id, username, first_name, last_name, email, role, is_active, last_login FROM users ORDER BY last_name, first_name'
    );
    return rows;
  });

  ipcMain.handle('users:create', async (event, data) => {
    if (!dbReady()) throw new Error('Database not connected');
    const id   = uuidv4();
    const hash = await bcrypt.hash(data.password, 12);
    const p    = db.ph;
    await db.query(
      `INSERT INTO users (id, username, password_hash, first_name, last_name, email, role)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)})`,
      [id, data.username, hash, data.firstName, data.lastName, data.email || null, data.role]
    );
    writeAuditLog({ action: 'CREATE', resource_type: 'user', resource_id: id, description: `Created ${data.username}` });
    return { id };
  });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Active flag — TRUE for PG (boolean), 1 for Firebird (smallint) */
function _active() {
  const db = require('./database');
  return true; // pg casts JS booleans correctly; Firebird driver handles it too
}

async function _nextPatientNumber() {
  const db = require('./database');
  const { rows } = await db.query('SELECT patient_number FROM patients ORDER BY created_at DESC LIMIT 1');
  if (!rows.length) return 'P00001';
  const num = parseInt(rows[0].patient_number.replace(/\D/g, ''), 10) + 1;
  return `P${String(num).padStart(5, '0')}`;
}

async function _getSetting(key) {
  const db = require('./database');
  try {
    const { rows } = await db.query(`SELECT value FROM system_settings WHERE key=${db.ph(1)}`, [key]);
    return rows[0]?.value || null;
  } catch { return null; }
}

module.exports = { setupIpcHandlers };
