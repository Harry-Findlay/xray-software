import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore }    from './store/authStore';
import { useLicenseStore } from './store/licenseStore';
import { initCornerstone } from './utils/cornerstoneSetup';

import AppShell           from './components/layout/AppShell';
import LoadingScreen      from './components/layout/LoadingScreen';
import LoginPage          from './pages/LoginPage';
import LicensePage        from './pages/LicensePage';
import DatabaseSetupPage  from './pages/DatabaseSetupPage';
import DashboardPage      from './pages/DashboardPage';
import PatientsPage       from './pages/PatientsPage';
import PatientDetailPage  from './pages/PatientDetailPage';
import ImagingViewerPage  from './pages/ImagingViewerPage';
import SettingsPage       from './pages/SettingsPage';
import AuditLogPage       from './pages/AuditLogPage';

/**
 * App-level state machine:
 *
 *   loading
 *     → license  (if not activated)           → LicensePage
 *     → dbSetup  (no DB config / connection)   → DatabaseSetupPage
 *     → ready
 *         → LoginPage          (if not authenticated)
 *         → AppShell + routes  (authenticated)
 */
export default function App() {
  const [appState, setAppState] = useState('loading');
  const { isAuthenticated, checkSession } = useAuthStore();
  const { checkLicense }                  = useLicenseStore();

  useEffect(() => {
    initCornerstone().catch(err => console.warn('Cornerstone init error:', err));
    init();
  }, []);

  async function init() {
    setAppState('loading');

    // 1. License check
    const licenseOk = await checkLicense();
    if (!licenseOk) { setAppState('license'); return; }

    // 2. Database connection check
    // FIX: window.electronAPI may exist but db.status() can still return
    // undefined if the preload bridge isn't fully wired yet (e.g. during
    // hot-reload in dev). Treat any non-true connected value as needing setup.
    let dbConnected = false;
    try {
      if (window.electronAPI?.db?.status) {
        const dbStatus = await window.electronAPI.db.status();
        dbConnected = dbStatus?.connected === true;
      }
    } catch (err) {
      console.warn('db.status() call failed:', err);
      dbConnected = false;
    }

    if (!dbConnected) { setAppState('dbSetup'); return; }

    // 3. Restore any prior session
    await checkSession();
    setAppState('ready');
  }

  if (appState === 'loading') return <LoadingScreen />;
  if (appState === 'license') return <LicensePage  onActivated={init} />;
  if (appState === 'dbSetup') return <DatabaseSetupPage onConnected={init} />;
  if (!isAuthenticated)       return <LoginPage />;

  return (
    <AppShell>
      <Routes>
        <Route path="/"                 element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"        element={<DashboardPage />} />
        <Route path="/patients"         element={<PatientsPage />} />
        <Route path="/patients/:id"     element={<PatientDetailPage />} />
        <Route path="/imaging/:studyId" element={<ImagingViewerPage />} />
        <Route path="/settings"         element={<SettingsPage />} />
        <Route path="/audit"            element={<AuditLogPage />} />
        <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}