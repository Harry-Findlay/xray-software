import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import './AppShell.css';

const NAV_ITEMS = [
  { path: '/dashboard', icon: '⊞', label: 'Dashboard' },
  { path: '/patients', icon: '👤', label: 'Patients' },
  { path: '/settings', icon: '⚙', label: 'Settings' },
  { path: '/audit', icon: '📋', label: 'Audit Log', role: 'admin' },
];

export default function AppShell({ children }) {
  const { user, logout, hasPermission } = useAuthStore();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="app-shell">
      {/* macOS traffic light spacer */}
      {window.electronAPI?.app.getPlatform() === 'darwin' && (
        <div className="macos-titlebar drag-region" />
      )}

      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="app-logo">
            <span className="logo-icon">🦷</span>
            {!collapsed && <span className="logo-text">DX Studio</span>}
          </div>
          <button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter(item => !item.role || hasPermission(`${item.role}:access`)).map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="user-info">
              <div className="user-avatar">{user?.firstName?.[0]}{user?.lastName?.[0]}</div>
              <div className="user-details">
                <div className="user-name">{user?.firstName} {user?.lastName}</div>
                <div className="user-role text-muted text-xs">{user?.role}</div>
              </div>
            </div>
          )}
          <button className="btn btn-ghost btn-icon" onClick={handleLogout} title="Logout">
            ⏻
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
