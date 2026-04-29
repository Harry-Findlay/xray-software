import React, { useState, useEffect } from 'react';
import { useLicenseStore } from '../store/licenseStore';
import './LicensePage.css';

const isDev = process.env.NODE_ENV === 'development';

export default function LicensePage({ onActivated }) {
  const [key,     setKey]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [info,    setInfo]    = useState('');
  const { activate, checkLicense } = useLicenseStore();

  // In dev mode, show a hint that the license server needs to be running
  useEffect(() => {
    if (isDev) {
      setInfo('Dev mode — enter a real key (license server at http://localhost:4000) or use the bypass button below.');
    }
  }, []);

  // Format as user types: DXRS-XXXX-XXXX-XXXX
  // Accepts any alphanumeric input and segments it into groups of 4
  const handleKeyChange = (e) => {
    const raw    = e.target.value.replace(/[^A-Z0-9a-z]/g, '').toUpperCase();
    const groups = [];

    // First group: up to 4 chars (for DXRS prefix)
    if (raw.length > 0) groups.push(raw.slice(0, 4));
    // Remaining: 3 groups of 4
    for (let i = 4; i < 16 && i < raw.length; i += 4) {
      groups.push(raw.slice(i, i + 4));
    }

    setKey(groups.join('-'));
    setError('');
    setInfo('');
  };

  const isKeyComplete = () => {
    // Strip dashes and check we have at least 12 chars (DXRS + 3×4 = 16 ideal, but accept partial)
    const stripped = key.replace(/-/g, '');
    return stripped.length >= 12;
  };

  const handleActivate = async () => {
    if (!isKeyComplete()) {
      setError('Please enter a complete license key (e.g. DXRS-XXXX-XXXX-XXXX)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await activate(key.trim());
      if (result?.success) {
        onActivated?.();
      } else {
        setError(result?.error || 'Activation failed. Check your key and ensure the license server is reachable.');
      }
    } catch (err) {
      setError('Could not reach license server. Check your connection.');
    }
    setLoading(false);
  };

  // Dev-only bypass — skips activation and proceeds directly
  const handleDevBypass = async () => {
    setLoading(true);
    const status = await window.electronAPI?.license?.validate();
    if (status?.active) {
      onActivated?.();
    } else {
      setError('Dev bypass failed — check licenseManager.js has the REPLACE_WITH placeholder still in place.');
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isKeyComplete()) handleActivate();
  };

  return (
    <div className="license-page">
      <div className="license-card animate-fade-in">
        <div className="license-icon">🔑</div>
        <h1>Product Activation</h1>
        <p className="license-subtitle">
          Enter your license key to activate Dental X-Ray Studio.
        </p>

        <div className="license-input-group">
          <input
            className="input license-key-input mono"
            type="text"
            value={key}
            onChange={handleKeyChange}
            onKeyDown={handleKeyDown}
            placeholder="DXRS-XXXX-XXXX-XXXX"
            maxLength={19}
            spellCheck={false}
            autoFocus
            disabled={loading}
          />
        </div>

        {error && <div className="license-error">⚠ {error}</div>}
        {info  && <div className="license-info">{info}</div>}

        <button
          className="btn btn-primary license-btn"
          onClick={handleActivate}
          disabled={loading || !isKeyComplete()}
        >
          {loading ? <span className="animate-spin">⟳</span> : '🔓'}
          {' '}{loading ? 'Activating...' : 'Activate License'}
        </button>

        {isDev && (
          <button
            className="btn btn-ghost license-btn-dev"
            onClick={handleDevBypass}
            disabled={loading}
            title="Only visible in development mode"
          >
            ⚡ Dev bypass (skip license check)
          </button>
        )}

        <div className="license-help">
          <p>
            Need help?{' '}
            <a href="#" onClick={e => { e.preventDefault(); }}>
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
