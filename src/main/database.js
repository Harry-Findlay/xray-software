/**
 * database.js
 *
 * Dual-engine database layer: PostgreSQL (recommended, bundled with server
 * installer) or Firebird (alternative, for legacy/specific installations).
 *
 * Connection config is stored encrypted via electron-store.
 * On first launch (no config), the renderer shows the DB setup wizard.
 *
 * Public API:
 *   setStore(store)                 – inject electron-store instance
 *   getStoredConfig()               – returns saved config or null
 *   saveConfig(config)              – persist config to store
 *   clearConfig()                   – wipe config (triggers wizard next launch)
 *   testConnection(config)          – test without saving → { success, error }
 *   initDatabase(config?)           – connect + run migrations
 *   closeDatabase()                 – clean shutdown
 *   query(sql, params)              – → { rows, rowCount }
 *   transaction(fn)                 – fn receives a query() fn, runs in tx
 *   ph(index)                       – $1/$2 (PG) or ? (Firebird)
 */

const log = require('electron-log');

let _pool   = null;   // pg.Pool
let _fbDb   = null;   // Firebird connection
let _engine = null;   // 'postgres' | 'firebird'
let _store  = null;   // electron-store

// ─── Store injection ──────────────────────────────────────────────────────────

function setStore(store) { _store = store; }
function getStoredConfig() { return _store?.get('dbConfig', null) || null; }
function saveConfig(config) { _store.set('dbConfig', config); }
function clearConfig() { _store.delete('dbConfig'); }

// ─── Test connection (no side effects) ───────────────────────────────────────

async function testConnection(config) {
  try {
    if (config.engine === 'postgres')  return await _testPostgres(config);
    if (config.engine === 'firebird')  return await _testFirebird(config);
    return { success: false, error: 'Unknown engine: ' + config.engine };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Connect ──────────────────────────────────────────────────────────────────

async function initDatabase(config) {
  const cfg = config || getStoredConfig();
  if (!cfg) throw new Error('NO_DB_CONFIG');

  _engine = cfg.engine;
  log.info(`Connecting to ${_engine}…`);

  if (_engine === 'postgres')     await _connectPostgres(cfg);
  else if (_engine === 'firebird') await _connectFirebird(cfg);
  else throw new Error('Unsupported engine: ' + _engine);

  await _runMigrations();
  await _ensureAdminUser();
  log.info('Database ready.');
}

async function closeDatabase() {
  if (_pool)  { await _pool.end(); _pool = null; }
  if (_fbDb)  { _fbDb.detach();    _fbDb = null; }
  _engine = null;
  log.info('Database closed.');
}

// ─── Query API ────────────────────────────────────────────────────────────────

async function query(sql, params = []) {
  if (_engine === 'postgres') {
    const result = await _pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  }
  if (_engine === 'firebird') return _fbQuery(sql, params);
  throw new Error('Database not connected');
}

async function transaction(fn) {
  if (_engine === 'postgres') {
    const client = await _pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn((sql, p) => client.query(sql, p));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  // Firebird
  return new Promise((resolve, reject) => {
    const Firebird = require('node-firebird');
    _fbDb.transaction(Firebird.ISOLATION_READ_COMMITTED, async (err, tx) => {
      if (err) return reject(err);
      try {
        const result = await fn((sql, p) => _fbQueryTx(tx, sql, p));
        tx.commit(e => e ? reject(e) : resolve(result));
      } catch (fnErr) {
        tx.rollback(() => reject(fnErr));
      }
    });
  });
}

/** Placeholder helper — $1 for PG, ? for Firebird */
function ph(index) {
  return _engine === 'postgres' ? `$${index}` : '?';
}

// ─── PostgreSQL internals ─────────────────────────────────────────────────────

async function _testPostgres(cfg) {
  const { Pool } = require('pg');
  const pool = new Pool({ ..._pgOpts(cfg), connectionTimeoutMillis: 5000 });
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    await pool.end();
    return { success: true };
  } catch (err) {
    await pool.end().catch(() => {});
    return { success: false, error: err.message };
  }
}

async function _connectPostgres(cfg) {
  const { Pool } = require('pg');
  _pool = new Pool({ ..._pgOpts(cfg), max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  _pool.on('error', err => log.error('PG pool error:', err.message));
  const client = await _pool.connect();
  await client.query('SELECT 1');
  client.release();
  log.info(`PostgreSQL: ${cfg.host}:${cfg.port || 5432}/${cfg.database}`);
}

function _pgOpts(cfg) {
  return {
    host: cfg.host,
    port: cfg.port || 5432,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
  };
}

// ─── Firebird internals ───────────────────────────────────────────────────────

function _fbOpts(cfg) {
  return {
    host: cfg.host,
    port: cfg.port || 3050,
    database: cfg.path,
    user: cfg.user || 'SYSDBA',
    password: cfg.password || 'masterkey',
    lowercase_keys: true,
  };
}

async function _testFirebird(cfg) {
  const Firebird = require('node-firebird');
  return new Promise(resolve => {
    Firebird.attach(_fbOpts(cfg), (err, db) => {
      if (err) { resolve({ success: false, error: err.message }); return; }
      db.detach();
      resolve({ success: true });
    });
  });
}

async function _connectFirebird(cfg) {
  const Firebird = require('node-firebird');
  return new Promise((resolve, reject) => {
    Firebird.attach(_fbOpts(cfg), (err, db) => {
      if (err) { reject(err); return; }
      _fbDb = db;
      log.info(`Firebird: ${cfg.host}:${cfg.port || 3050}/${cfg.path}`);
      resolve();
    });
  });
}

function _fbQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    _fbDb.query(sql, params, (err, result) => {
      if (err) return reject(err);
      const rows = Array.isArray(result) ? result : [];
      resolve({ rows, rowCount: rows.length });
    });
  });
}

function _fbQueryTx(tx, sql, params = []) {
  return new Promise((resolve, reject) => {
    tx.query(sql, params, (err, result) => {
      if (err) return reject(err);
      const rows = Array.isArray(result) ? result : [];
      resolve({ rows, rowCount: rows.length });
    });
  });
}

// ─── Migrations ───────────────────────────────────────────────────────────────

async function _runMigrations() {
  // Ensure migrations tracking table exists
  if (_engine === 'postgres') {
    await query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } else {
    await query(`
      CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS (
        VERSION    INTEGER NOT NULL PRIMARY KEY,
        APPLIED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(() => {}); // Firebird throws if table exists
  }

  const { rows } = await query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map(r => Number(r.version)));

  const migrations = [
    { version: 1, fn: _m01_schema   },
    { version: 2, fn: _m02_audit    },
    { version: 3, fn: _m03_settings },
  ];

  for (const m of migrations) {
    if (!applied.has(m.version)) {
      log.info(`Running migration ${m.version}…`);
      await transaction(async q => {
        await m.fn(q);
        await q(
          _engine === 'postgres'
            ? 'INSERT INTO schema_migrations (version) VALUES ($1)'
            : 'INSERT INTO SCHEMA_MIGRATIONS (VERSION) VALUES (?)',
          [m.version]
        );
      });
      log.info(`Migration ${m.version} applied.`);
    }
  }
}

// ─── Migration 1: Core schema ─────────────────────────────────────────────────

async function _m01_schema(q) {
  if (_engine === 'postgres') {
    await q(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        username      VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT         NOT NULL,
        first_name    VARCHAR(100) NOT NULL,
        last_name     VARCHAR(100) NOT NULL,
        email         VARCHAR(255),
        role          VARCHAR(50)  NOT NULL
                        CHECK (role IN ('admin','dentist','hygienist','receptionist','readonly')),
        is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
        last_login    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS patients (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_number    VARCHAR(20)  UNIQUE NOT NULL,
        first_name        VARCHAR(100) NOT NULL,
        last_name         VARCHAR(100) NOT NULL,
        date_of_birth     DATE,
        gender            VARCHAR(10)  CHECK (gender IN ('M','F','Other','Unknown')),
        email             VARCHAR(255),
        phone             VARCHAR(50),
        address_line1     VARCHAR(255),
        address_line2     VARCHAR(255),
        city              VARCHAR(100),
        county            VARCHAR(100),
        postcode          VARCHAR(20),
        country           VARCHAR(10)  NOT NULL DEFAULT 'GB',
        nhs_number        VARCHAR(20),
        referring_dentist VARCHAR(255),
        medical_alerts    JSONB        NOT NULL DEFAULT '[]',
        notes             TEXT,
        is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
        created_by        UUID         REFERENCES users(id),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patients_name   ON patients(last_name, first_name);
      CREATE INDEX IF NOT EXISTS idx_patients_number ON patients(patient_number);
      CREATE INDEX IF NOT EXISTS idx_patients_dob    ON patients(date_of_birth);

      CREATE TABLE IF NOT EXISTS imaging_studies (
        id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id         UUID         NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        study_uid          VARCHAR(255),
        study_date         DATE,
        study_description  TEXT,
        modality           VARCHAR(20)  NOT NULL DEFAULT 'CR',
        body_part          VARCHAR(100),
        referring_physician VARCHAR(255),
        notes              TEXT,
        status             VARCHAR(20)  NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','archived','deleted')),
        created_by         UUID         REFERENCES users(id),
        created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_studies_patient ON imaging_studies(patient_id);
      CREATE INDEX IF NOT EXISTS idx_studies_date    ON imaging_studies(study_date);

      CREATE TABLE IF NOT EXISTS imaging_instances (
        id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        study_id         UUID         NOT NULL REFERENCES imaging_studies(id) ON DELETE CASCADE,
        instance_uid     VARCHAR(255),
        file_path        TEXT         NOT NULL,
        file_size        BIGINT,
        width            INTEGER,
        height           INTEGER,
        tooth_number     VARCHAR(10),
        image_type       VARCHAR(50),
        acquisition_date TIMESTAMPTZ,
        kvp              NUMERIC(8,2),
        mas              NUMERIC(8,2),
        exposure_time    NUMERIC(10,4),
        annotations      JSONB        NOT NULL DEFAULT '[]',
        ai_findings      JSONB,
        thumbnail_path   TEXT,
        is_primary       BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_instances_study ON imaging_instances(study_id);


      CREATE TABLE IF NOT EXISTS reports (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id   UUID        NOT NULL REFERENCES patients(id),
        study_id     UUID        REFERENCES imaging_studies(id),
        title        VARCHAR(255) NOT NULL,
        content      TEXT,
        report_type  VARCHAR(100),
        created_by   UUID        REFERENCES users(id),
        signed_by    UUID        REFERENCES users(id),
        signed_at    TIMESTAMPTZ,
        status       VARCHAR(30) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','final','amended')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } else {
    // Firebird — no UUID type, use VARCHAR(36) + application-generated UUIDs
    const stmts = [
      `CREATE TABLE USERS (
        ID            VARCHAR(36)  NOT NULL PRIMARY KEY,
        USERNAME      VARCHAR(100) NOT NULL,
        PASSWORD_HASH VARCHAR(255) NOT NULL,
        FIRST_NAME    VARCHAR(100) NOT NULL,
        LAST_NAME     VARCHAR(100) NOT NULL,
        EMAIL         VARCHAR(255),
        ROLE          VARCHAR(50)  NOT NULL,
        IS_ACTIVE     SMALLINT     DEFAULT 1 NOT NULL,
        LAST_LOGIN    TIMESTAMP,
        CREATED_AT    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UPDATED_AT    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
      `CREATE UNIQUE INDEX UQ_USERS_USERNAME ON USERS (USERNAME)`,
      `CREATE TABLE PATIENTS (
        ID                VARCHAR(36)  NOT NULL PRIMARY KEY,
        PATIENT_NUMBER    VARCHAR(20)  NOT NULL,
        FIRST_NAME        VARCHAR(100) NOT NULL,
        LAST_NAME         VARCHAR(100) NOT NULL,
        DATE_OF_BIRTH     DATE,
        GENDER            VARCHAR(10),
        EMAIL             VARCHAR(255),
        PHONE             VARCHAR(50),
        ADDRESS_LINE1     VARCHAR(255),
        ADDRESS_LINE2     VARCHAR(255),
        CITY              VARCHAR(100),
        COUNTY            VARCHAR(100),
        POSTCODE          VARCHAR(20),
        COUNTRY           VARCHAR(10)  DEFAULT 'GB' NOT NULL,
        NHS_NUMBER        VARCHAR(20),
        REFERRING_DENTIST VARCHAR(255),
        MEDICAL_ALERTS    BLOB SUB_TYPE TEXT,
        NOTES             BLOB SUB_TYPE TEXT,
        IS_ACTIVE         SMALLINT     DEFAULT 1 NOT NULL,
        CREATED_AT        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UPDATED_AT        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
      `CREATE UNIQUE INDEX UQ_PATIENTS_NUMBER ON PATIENTS (PATIENT_NUMBER)`,
      `CREATE TABLE IMAGING_STUDIES (
        ID                  VARCHAR(36) NOT NULL PRIMARY KEY,
        PATIENT_ID          VARCHAR(36) NOT NULL REFERENCES PATIENTS(ID),
        STUDY_UID           VARCHAR(255),
        STUDY_DATE          DATE,
        STUDY_DESCRIPTION   BLOB SUB_TYPE TEXT,
        MODALITY            VARCHAR(20) DEFAULT 'CR' NOT NULL,
        BODY_PART           VARCHAR(100),
        NOTES               BLOB SUB_TYPE TEXT,
        STATUS              VARCHAR(20) DEFAULT 'active' NOT NULL,
        CREATED_AT          TIMESTAMP   DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UPDATED_AT          TIMESTAMP   DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
      `CREATE TABLE IMAGING_INSTANCES (
        ID               VARCHAR(36)   NOT NULL PRIMARY KEY,
        STUDY_ID         VARCHAR(36)   NOT NULL REFERENCES IMAGING_STUDIES(ID),
        INSTANCE_UID     VARCHAR(255),
        FILE_PATH        VARCHAR(1024) NOT NULL,
        FILE_SIZE        BIGINT,
        WIDTH_PX         INTEGER,
        HEIGHT_PX        INTEGER,
        TOOTH_NUMBER     VARCHAR(10),
        IMAGE_TYPE       VARCHAR(50),
        ACQUISITION_DATE TIMESTAMP,
        KVP              NUMERIC(8,2),
        MAS              NUMERIC(8,2),
        ANNOTATIONS      BLOB SUB_TYPE TEXT,
        THUMBNAIL_PATH   VARCHAR(1024),
        IS_PRIMARY       SMALLINT      DEFAULT 0 NOT NULL,
        CREATED_AT       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    ];
    for (const stmt of stmts) {
      await q(stmt).catch(err => {
        if (!err.message?.includes('already exists')) throw err;
      });
    }
  }
}

// ─── Migration 2: Audit log ───────────────────────────────────────────────────

async function _m02_audit(q) {
  if (_engine === 'postgres') {
    await q(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id            BIGSERIAL    PRIMARY KEY,
        timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        user_id       UUID,
        username      VARCHAR(100),
        action        VARCHAR(50)  NOT NULL,
        resource_type VARCHAR(50),
        resource_id   VARCHAR(255),
        description   TEXT,
        machine_id    VARCHAR(255),
        success       BOOLEAN      NOT NULL DEFAULT TRUE,
        error_message TEXT,
        metadata      JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts       ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
    `);
  } else {
    await q(`
      CREATE TABLE AUDIT_LOG (
        ID            INTEGER      NOT NULL PRIMARY KEY,
        TIMESTAMP_    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
        USER_ID       VARCHAR(36),
        USERNAME      VARCHAR(100),
        ACTION_       VARCHAR(50)  NOT NULL,
        RESOURCE_TYPE VARCHAR(50),
        RESOURCE_ID   VARCHAR(255),
        DESCRIPTION   BLOB SUB_TYPE TEXT,
        SUCCESS_      SMALLINT     DEFAULT 1 NOT NULL,
        ERROR_MESSAGE BLOB SUB_TYPE TEXT
      )
    `).catch(e => { if (!e.message?.includes('already exists')) throw e; });
    await q(`CREATE GENERATOR GEN_AUDIT_LOG_ID`).catch(() => {});
    await q(`
      CREATE OR ALTER TRIGGER AUDIT_LOG_BI FOR AUDIT_LOG
      ACTIVE BEFORE INSERT POSITION 0
      AS BEGIN
        IF (NEW.ID IS NULL) THEN NEW.ID = GEN_ID(GEN_AUDIT_LOG_ID, 1);
      END
    `).catch(() => {});
  }
}

// ─── Migration 3: System settings ────────────────────────────────────────────

async function _m03_settings(q) {
  if (_engine === 'postgres') {
    await q(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT,
        description TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO system_settings (key, value, description) VALUES
        ('practice_name',           'My Dental Practice', 'Practice display name'),
        ('practice_address',        '',   'Practice postal address'),
        ('practice_phone',          '',   'Practice phone number'),
        ('practice_email',          '',   'Practice email address'),
        ('image_store_path',        '',   'Root directory for image files'),
        ('dicom_port',              '4242', 'DICOM listener port'),
        ('session_timeout_minutes', '30', 'Auto-logout timeout in minutes'),
        ('backup_enabled',          '1',  'Enable automatic backups'),
        ('backup_path',             '',   'Backup destination directory'),
        ('backup_frequency_hours',  '24', 'Backup interval in hours'),
        ('gdpr_retention_years',    '10', 'Minimum record retention (ICO requirement)'),
        ('license_server_url',      'https://license.yourcompany.com', 'License validation URL')
      ON CONFLICT (key) DO NOTHING;
    `);
  } else {
    await q(`
      CREATE TABLE SYSTEM_SETTINGS (
        KEY_        VARCHAR(100) NOT NULL PRIMARY KEY,
        VALUE_      BLOB SUB_TYPE TEXT,
        DESCRIPTION BLOB SUB_TYPE TEXT,
        UPDATED_AT  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `).catch(e => { if (!e.message?.includes('already exists')) throw e; });
  }
}

// ─── Seed default admin ───────────────────────────────────────────────────────

async function _ensureAdminUser() {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const { rows } = await query('SELECT id FROM users LIMIT 1');
  if (rows.length > 0) return;
  const hash = await bcrypt.hash('admin', 12);
  await query(
    `INSERT INTO users (id, username, password_hash, first_name, last_name, role)
     VALUES (${ph(1)}, ${ph(2)}, ${ph(3)}, ${ph(4)}, ${ph(5)}, ${ph(6)})`,
    [uuidv4(), 'admin', hash, 'System', 'Administrator', 'admin']
  );
  log.warn('Default admin user created — username: admin / password: admin — CHANGE IMMEDIATELY');
}

module.exports = {
  setStore, getStoredConfig, saveConfig, clearConfig,
  testConnection, initDatabase, closeDatabase,
  query, transaction, ph,
};
