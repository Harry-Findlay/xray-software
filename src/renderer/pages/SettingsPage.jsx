import React, { useEffect, useState } from 'react';
import { useLicenseStore } from '../store/licenseStore';
import DatabaseSetupPage   from './DatabaseSetupPage';
import './SettingsPage.css';

const SECTIONS = ['Practice', 'Storage', 'Database', 'License', 'Security', 'About'];

export default function SettingsPage() {
  const [section,  setSection]  = useState('Practice');
  const [settings, setSettings] = useState({});
  const [saved,    setSaved]    = useState(false);
  const [dbStatus, setDbStatus] = useState(null);
  const { status: licenseStatus, deactivate } = useLicenseStore();

  useEffect(() => {
    loadSettings();
    loadDbStatus();
  }, []);

  // Jump to DB section when triggered from app menu
  useEffect(() => {
    const off = window.electronAPI?.on('menu:db-settings', () => setSection('Database'));
    return () => off?.();
  }, []);

  async function loadSettings() {
    const s = await window.electronAPI?.settings.getAll() || {};
    setSettings(s);
  }

  async function loadDbStatus() {
    const s = await window.electronAPI?.db.status();
    setDbStatus(s);
  }

  async function handleSave(key, value) {
    await window.electronAPI?.settings.set(key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  function handleChange(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
        {saved && <span className="saved-indicator">✓ Saved</span>}
      </div>

      <div className="settings-body">
        {/* ── Side nav ── */}
        <nav className="settings-nav">
          {SECTIONS.map(s => (
            <button
              key={s}
              className={`settings-nav-item ${section === s ? 'active' : ''}`}
              onClick={() => setSection(s)}
            >
              {s === 'Database' && dbStatus && !dbStatus.connected && (
                <span className="nav-warn">⚠</span>
              )}
              {s}
            </button>
          ))}
        </nav>

        {/* ── Content ── */}
        <div className="settings-content animate-fade-in" key={section}>

          {/* Practice */}
          {section === 'Practice' && (
            <Section title="Practice Information">
              <Row label="Practice Name">
                <input className="input" value={settings.practice_name || ''}
                  onChange={e => handleChange('practice_name', e.target.value)}
                  onBlur={e => handleSave('practice_name', e.target.value)} />
              </Row>
              <Row label="Address">
                <input className="input" value={settings.practice_address || ''}
                  onChange={e => handleChange('practice_address', e.target.value)}
                  onBlur={e => handleSave('practice_address', e.target.value)} />
              </Row>
              <Row label="Phone">
                <input className="input" value={settings.practice_phone || ''}
                  onChange={e => handleChange('practice_phone', e.target.value)}
                  onBlur={e => handleSave('practice_phone', e.target.value)} />
              </Row>
              <Row label="Email">
                <input className="input" value={settings.practice_email || ''}
                  onChange={e => handleChange('practice_email', e.target.value)}
                  onBlur={e => handleSave('practice_email', e.target.value)} />
              </Row>
            </Section>
          )}

          {/* Storage */}
          {section === 'Storage' && (
            <Section title="Image Storage">
              <Row label="Image Store Path" description="Directory where imported X-ray files are kept">
                <div className="flex gap-2">
                  <input className="input" style={{ flex: 1 }}
                    value={settings.image_store_path || ''} readOnly placeholder="Not configured" />
                  <button className="btn btn-secondary" onClick={async () => {
                    const r = await window.electronAPI?.dialog.openDirectory({ title: 'Select Image Store' });
                    if (!r?.canceled && r?.filePaths?.[0]) {
                      handleChange('image_store_path', r.filePaths[0]);
                      handleSave('image_store_path', r.filePaths[0]);
                    }
                  }}>Browse</button>
                </div>
              </Row>
              <Row label="Backup Path">
                <div className="flex gap-2">
                  <input className="input" style={{ flex: 1 }}
                    value={settings.backup_path || ''} readOnly placeholder="Not configured" />
                  <button className="btn btn-secondary" onClick={async () => {
                    const r = await window.electronAPI?.dialog.openDirectory({ title: 'Select Backup Path' });
                    if (!r?.canceled && r?.filePaths?.[0]) handleSave('backup_path', r.filePaths[0]);
                  }}>Browse</button>
                </div>
              </Row>
              <Row label="DICOM Listener Port">
                <input className="input" style={{ width: 100 }} type="number"
                  value={settings.dicom_port || '4242'}
                  onChange={e => handleChange('dicom_port', e.target.value)}
                  onBlur={e => handleSave('dicom_port', e.target.value)} />
              </Row>
            </Section>
          )}

          {/* Database */}
          {section === 'Database' && (
            <div className="db-settings-section">
              {/* Status card */}
              {dbStatus && (
                <div className={`db-status-card card ${dbStatus.connected ? 'db-connected' : 'db-disconnected'}`}>
                  <div className="db-status-row">
                    <div>
                      <div className={`db-status-dot ${dbStatus.connected ? 'ok' : 'err'}`}>
                        {dbStatus.connected ? '● Connected' : '● Disconnected'}
                      </div>
                      {dbStatus.connected && (
                        <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                          {dbStatus.engine === 'postgres' ? '🐘 PostgreSQL' : '🔥 Firebird'}
                          {' · '}{dbStatus.host}
                          {' · '}{dbStatus.database}
                        </div>
                      )}
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                      const result = await window.electronAPI?.db.reconnect();
                      if (result?.success) {
                        loadDbStatus();
                        setSaved(true); setTimeout(() => setSaved(false), 2200);
                      } else {
                        window.electronAPI?.dialog.showMessage({
                          type: 'error',
                          message: 'Reconnect failed',
                          detail: result?.error || 'Unknown error',
                        });
                      }
                    }}>↺ Reconnect</button>
                  </div>
                </div>
              )}

              {/* Reconnect / reconfigure form */}
              <DatabaseSetupPage
                reconnectMode
                onConnected={() => {
                  loadDbStatus();
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2200);
                }}
              />
            </div>
          )}

          {/* License */}
          {section === 'License' && (
            <Section title="License">
              <div className="license-info-card">
                {licenseStatus?.active ? (
                  <>
                    <div className="license-ok">✓ License Active</div>
                    {licenseStatus.dev && <div className="text-muted text-sm">Development mode</div>}
                    {licenseStatus.license?.tier && (
                      <div><strong>Tier:</strong> {licenseStatus.license.tier}</div>
                    )}
                    <button className="btn btn-danger btn-sm" style={{ marginTop: 14 }} onClick={async () => {
                      const confirm = await window.electronAPI?.dialog.showMessage({
                        type: 'warning',
                        buttons: ['Deactivate', 'Cancel'],
                        defaultId: 1,
                        message: 'Deactivate license on this machine?',
                        detail: 'You will need to re-enter the license key to reactivate.',
                      });
                      if (confirm?.response === 0) deactivate();
                    }}>Deactivate License</button>
                  </>
                ) : (
                  <div className="license-none">✕ No active license</div>
                )}
              </div>
            </Section>
          )}

          {/* Security */}
          {section === 'Security' && (
            <Section title="Security">
              <Row label="Session Timeout (minutes)" description="Auto-logout after inactivity">
                <input className="input" style={{ width: 100 }} type="number"
                  value={settings.session_timeout_minutes || '30'}
                  onChange={e => handleChange('session_timeout_minutes', e.target.value)}
                  onBlur={e => handleSave('session_timeout_minutes', e.target.value)} />
              </Row>
              <Row label="Record Retention (years)" description="ICO minimum — patient records kept for at least this long">
                <input className="input" style={{ width: 100 }} type="number"
                  value={settings.gdpr_retention_years || '10'}
                  onChange={e => handleChange('gdpr_retention_years', e.target.value)}
                  onBlur={e => handleSave('gdpr_retention_years', e.target.value)} />
              </Row>
            </Section>
          )}

          {/* About */}
          {section === 'About' && (
            <Section title="About">
              <div className="about-card">
                <div style={{ fontSize: 48 }}>🦷</div>
                <h2>Dental X-Ray Studio</h2>
                <div className="text-muted">Professional Dental Imaging Software</div>
                <div className="mono text-muted text-sm" style={{ marginTop: 4 }}>v1.0.0</div>
                <button className="btn btn-secondary"
                  onClick={() => window.electronAPI?.app.openLogsDirectory()}>
                  📂 Open Logs
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      <div className="card settings-card">{children}</div>
    </div>
  );
}

function Row({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-label-group">
        <label>{label}</label>
        {description && <div className="setting-desc text-muted text-xs">{description}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
