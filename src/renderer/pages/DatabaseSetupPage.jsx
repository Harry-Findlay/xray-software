import React, { useState, useEffect } from 'react';
import './DatabaseSetupPage.css';

const ENGINES = [
  {
    id: 'postgres',
    name: 'PostgreSQL',
    icon: '🐘',
    description: 'Recommended. Bundled with the Server installer. Best for multi-user networks.',
  },
  {
    id: 'firebird',
    name: 'Firebird',
    icon: '🔥',
    description: 'Alternative SQL engine. Use for legacy setups or specific hardware integrations.',
  },
];

const DEFAULTS = {
  postgres: { engine: 'postgres', host: 'localhost', port: 5432, database: 'dental_xray', user: 'postgres', password: '', ssl: false },
  firebird: { engine: 'firebird', host: 'localhost', port: 3050, path: '', user: 'SYSDBA', password: 'masterkey' },
};

/**
 * DatabaseSetupPage
 *
 * Used in two modes:
 *   - First-launch (reconnectMode=false): Full wizard shown as the app's root screen
 *   - Settings reconnect (reconnectMode=true): Embedded in the Settings > Database tab
 *
 * Props:
 *   onConnected()       — called when connection is established
 *   reconnectMode       — true when embedded in settings
 */
export default function DatabaseSetupPage({ onConnected, reconnectMode = false }) {
  const [step,       setStep]       = useState(reconnectMode ? 2 : 1);
  const [engine,     setEngine]     = useState('postgres');
  const [config,     setConfig]     = useState(DEFAULTS.postgres);
  const [testing,    setTesting]    = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState(null);   // { success, error }
  const [error,      setError]      = useState('');

  useEffect(() => {
    if (reconnectMode) {
      // Pre-fill with existing engine if known
      window.electronAPI?.db.status().then(s => {
        if (s?.engine) {
          setEngine(s.engine);
          setConfig(prev => ({ ...DEFAULTS[s.engine], ...prev, engine: s.engine }));
        }
      });
    }
  }, [reconnectMode]);

  const selectEngine = (eng) => {
    setEngine(eng);
    setConfig(DEFAULTS[eng]);
    setTestResult(null);
    setError('');
  };

  const updateField = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
    setError('');
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await window.electronAPI?.db.test(config);
    setTestResult(result);
    setTesting(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    const result = await window.electronAPI?.db.connect(config);
    if (result?.success) {
      onConnected?.();
    } else {
      setError(result?.error || 'Connection failed. Check your settings and try again.');
      setConnecting(false);
    }
  };

  const handleReset = async () => {
    const confirm = await window.electronAPI?.dialog.showMessage({
      type: 'warning',
      buttons: ['Reset', 'Cancel'],
      defaultId: 1,
      title: 'Reset Database Connection',
      message: 'Clear the stored database connection?',
      detail: 'Patient data will NOT be deleted. You will need to reconnect on next launch.',
    });
    if (confirm?.response === 0) {
      await window.electronAPI?.db.reset();
      setStep(1);
      setTestResult(null);
      setError('');
    }
  };

  // ── First-launch full-screen shell ────────────────────────────────────────
  if (!reconnectMode) {
    return (
      <div className="dbsetup-page">
        <div className="dbsetup-bg" />

        <div className={`dbsetup-card ${step === 2 ? 'dbsetup-card--wide' : ''}`}>
          <div className="dbsetup-header">
            <span className="dbsetup-logo">🦷</span>
            <div>
              <h1>Database Setup</h1>
              <p className="text-muted text-sm">Connect Dental X-Ray Studio to your database</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="dbsetup-steps">
            {['Choose Engine', 'Configure', 'Connect'].map((label, i) => (
              <React.Fragment key={label}>
                <div className={`step-item ${step > i + 1 ? 'done' : ''} ${step === i + 1 ? 'active' : ''}`}>
                  <div className="step-circle">{step > i + 1 ? '✓' : i + 1}</div>
                  <span>{label}</span>
                </div>
                {i < 2 && <div className="step-line" />}
              </React.Fragment>
            ))}
          </div>

          {/* Step 1 — choose engine */}
          {step === 1 && !connecting && (
            <div className="dbsetup-body">
              <p className="dbsetup-help">
                Select your database engine. <strong>PostgreSQL</strong> is included in the Server
                installer and recommended for all new installations.
              </p>
              <div className="engine-grid">
                {ENGINES.map(eng => (
                  <button key={eng.id}
                    className={`engine-card ${engine === eng.id ? 'selected' : ''}`}
                    onClick={() => selectEngine(eng.id)}>
                    <span className="engine-icon">{eng.icon}</span>
                    <strong>{eng.name}</strong>
                    <p>{eng.description}</p>
                    {engine === eng.id && <span className="engine-tick">✓</span>}
                  </button>
                ))}
              </div>
              <div className="dbsetup-actions">
                <button className="btn btn-primary"
                  onClick={() => setStep(2)}>
                  Configure {ENGINES.find(e => e.id === engine)?.name} →
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — configure */}
          {step === 2 && !connecting && (
            <ConfigStep
              engine={engine}
              config={config}
              updateField={updateField}
              testing={testing}
              testResult={testResult}
              error={error}
              onBack={() => setStep(1)}
              onTest={handleTest}
              onConnect={handleConnect}
              showBack
            />
          )}

          {/* Connecting */}
          {connecting && <ConnectingState />}
        </div>

        <div className="dbsetup-footer">
          <span className="text-muted text-xs">
            First install? Run the <strong>Server Installer</strong> to set up PostgreSQL, then launch this client.
          </span>
        </div>
      </div>
    );
  }

  // ── Settings embed (reconnect mode) ──────────────────────────────────────
  return (
    <div className="dbsetup-embed">
      {!connecting ? (
        <ConfigStep
          engine={engine}
          config={config}
          updateField={updateField}
          testing={testing}
          testResult={testResult}
          error={error}
          onTest={handleTest}
          onConnect={handleConnect}
          showBack={false}
          engineSelector={
            <div className="engine-selector-inline">
              {ENGINES.map(eng => (
                <button key={eng.id}
                  className={`engine-pill ${engine === eng.id ? 'active' : ''}`}
                  onClick={() => selectEngine(eng.id)}>
                  {eng.icon} {eng.name}
                </button>
              ))}
            </div>
          }
        />
      ) : (
        <ConnectingState />
      )}

      <div className="dbsetup-danger-zone">
        <button className="btn btn-ghost text-danger text-sm" onClick={handleReset}>
          Reset connection config…
        </button>
      </div>
    </div>
  );
}

// ─── Shared config step ───────────────────────────────────────────────────────

function ConfigStep({ engine, config, updateField, testing, testResult, error, onBack, onTest, onConnect, showBack, engineSelector }) {
  return (
    <div className="dbsetup-body">
      {engineSelector}

      <div className="config-form">
        {engine === 'postgres'
          ? <PostgresForm config={config} onChange={updateField} />
          : <FirebirdForm config={config} onChange={updateField} />}
      </div>

      {testResult && (
        <div className={`test-result ${testResult.success ? 'success' : 'fail'}`}>
          {testResult.success
            ? '✓ Connection successful — ready to connect.'
            : `✗ ${testResult.error}`}
        </div>
      )}
      {error && <div className="test-result fail">✗ {error}</div>}

      <div className="dbsetup-actions">
        {showBack && <button className="btn btn-ghost" onClick={onBack}>← Back</button>}
        <button className="btn btn-secondary" onClick={onTest} disabled={testing}>
          {testing ? <span className="animate-spin">⟳</span> : '🔌'}
          {' '}{testing ? 'Testing…' : 'Test Connection'}
        </button>
        <button className="btn btn-primary" onClick={onConnect}>
          → Connect &amp; Save
        </button>
      </div>
    </div>
  );
}

function ConnectingState() {
  return (
    <div className="dbsetup-body dbsetup-connecting">
      <span className="animate-spin" style={{ fontSize: 36 }}>⟳</span>
      <h2>Connecting…</h2>
      <p className="text-muted text-sm">Running database migrations and verifying schema…</p>
    </div>
  );
}

// ─── PostgreSQL form ─────────────────────────────────────────────────────────

function PostgresForm({ config, onChange }) {
  return (
    <>
      <div className="form-row-2">
        <div className="field">
          <label>Host / IP Address</label>
          <input className="input" value={config.host || ''}
            onChange={e => onChange('host', e.target.value)} placeholder="localhost" />
        </div>
        <div className="field field--narrow">
          <label>Port</label>
          <input className="input" type="number" value={config.port || 5432}
            onChange={e => onChange('port', parseInt(e.target.value) || 5432)} />
        </div>
      </div>
      <div className="field">
        <label>Database Name</label>
        <input className="input" value={config.database || ''}
          onChange={e => onChange('database', e.target.value)} placeholder="dental_xray" />
      </div>
      <div className="form-row-2">
        <div className="field">
          <label>Username</label>
          <input className="input" value={config.user || ''}
            onChange={e => onChange('user', e.target.value)} placeholder="postgres"
            autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={config.password || ''}
            onChange={e => onChange('password', e.target.value)} placeholder="••••••••"
            autoComplete="current-password" />
        </div>
      </div>
      <div className="field field-inline">
        <input type="checkbox" id="pg-ssl" checked={!!config.ssl}
          onChange={e => onChange('ssl', e.target.checked)} />
        <label htmlFor="pg-ssl" style={{ margin: 0, cursor: 'pointer' }}>
          Require SSL / TLS
        </label>
      </div>
      <div className="config-preview">
        <span className="text-muted text-xs">Connection: </span>
        <code className="mono text-xs">
          postgresql://{config.user || 'user'}:***@{config.host || 'host'}:{config.port || 5432}/{config.database || 'db'}
          {config.ssl ? '?sslmode=require' : ''}
        </code>
      </div>
    </>
  );
}

// ─── Firebird form ────────────────────────────────────────────────────────────

function FirebirdForm({ config, onChange }) {
  return (
    <>
      <div className="form-row-2">
        <div className="field">
          <label>Host / IP Address</label>
          <input className="input" value={config.host || ''}
            onChange={e => onChange('host', e.target.value)} placeholder="localhost" />
        </div>
        <div className="field field--narrow">
          <label>Port</label>
          <input className="input" type="number" value={config.port || 3050}
            onChange={e => onChange('port', parseInt(e.target.value) || 3050)} />
        </div>
      </div>
      <div className="field">
        <label>Database File Path</label>
        <div className="flex gap-2">
          <input className="input" style={{ flex: 1 }} value={config.path || ''}
            onChange={e => onChange('path', e.target.value)}
            placeholder="C:\DentalXRay\dental_xray.fdb" />
          <button className="btn btn-secondary" onClick={async () => {
            const result = await window.electronAPI?.dialog.openFile({
              title: 'Select Firebird Database',
              filters: [{ name: 'Firebird Database', extensions: ['fdb', 'gdb'] }],
            });
            if (!result?.canceled && result?.filePaths?.[0]) onChange('path', result.filePaths[0]);
          }}>Browse</button>
        </div>
      </div>
      <div className="form-row-2">
        <div className="field">
          <label>Username</label>
          <input className="input" value={config.user || ''}
            onChange={e => onChange('user', e.target.value)} placeholder="SYSDBA" />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={config.password || ''}
            onChange={e => onChange('password', e.target.value)} placeholder="masterkey" />
        </div>
      </div>
    </>
  );
}
