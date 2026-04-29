const log = require('electron-log');

let _currentUser = null;

function setCurrentUser(user) { _currentUser = user; }

/**
 * Write an audit record. Never throws — audit failure must not crash the app.
 */
async function writeAuditLog({ action, resource_type, resource_id, description, username, success = true, error_message }) {
  try {
    const db = require('./database');
    const p  = db.ph;
    await db.query(
      `INSERT INTO audit_log
         (user_id, username, action, resource_type, resource_id, description, success, error_message)
       VALUES (${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)})`,
      [
        _currentUser?.id       || null,
        username || _currentUser?.username || 'system',
        action,
        resource_type  || null,
        resource_id    || null,
        description    || null,
        success,
        error_message  || null,
      ]
    );
  } catch (err) {
    log.warn('Audit log write failed (non-fatal):', err.message);
  }
}

module.exports = { writeAuditLog, setCurrentUser };
