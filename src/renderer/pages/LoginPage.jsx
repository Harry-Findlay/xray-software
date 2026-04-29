import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import './LoginPage.css';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('Please enter username and password'); return; }
    setLoading(true);
    setError('');
    const result = await login(username, password);
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card animate-fade-in">
        <div className="login-logo">
          <span className="login-logo-icon">🦷</span>
          <h1>DX Studio</h1>
          <p>Dental Imaging Software</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label>Username</label>
            <input
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? <span className="animate-spin">⟳</span> : null}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <span className="text-muted text-xs">
            v{window.electronAPI ? '—' : 'dev'} · Secure Login
          </span>
        </div>
      </div>
    </div>
  );
}
