import React from 'react';

export default function LoadingScreen() {
  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)', gap: 16,
    }}>
      <span style={{ fontSize: 48 }}>🦷</span>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>DX Studio</div>
      <span className="animate-spin" style={{ fontSize: 24, color: 'var(--accent)' }}>⟳</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Starting up...</span>
    </div>
  );
}
