import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './DashboardPage.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ patients: 0, studiesThisMonth: 0, recentPatients: [] });

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    try {
      const patients = await window.electronAPI?.patients.getAll() || [];
      setStats(prev => ({
        ...prev,
        patients: patients.length,
        recentPatients: patients.slice(0, 5),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="dashboard animate-fade-in">
      <div className="page-header">
        <h1>Dashboard</h1>
        <button className="btn btn-primary" onClick={() => navigate('/patients/new')}>
          + New Patient
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card card">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{stats.patients}</div>
          <div className="stat-label text-muted">Total Patients</div>
        </div>
        <div className="stat-card card">
          <div className="stat-icon">🩻</div>
          <div className="stat-value">{stats.studiesThisMonth}</div>
          <div className="stat-label text-muted">Studies This Month</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h2 className="section-title">Recent Patients</h2>
          {stats.recentPatients.length === 0 ? (
            <div className="empty-state">
              <span>No patients yet</span>
              <button className="btn btn-primary btn-sm"
                onClick={() => navigate('/patients/new')}>
                Add First Patient
              </button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient #</th>
                  <th>Name</th>
                  <th>DOB</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentPatients.map(p => (
                  <tr key={p.id}
                    onClick={() => navigate(`/patients/${p.id}`)}
                    className="clickable">
                    <td className="mono text-xs">{p.patient_number}</td>
                    <td>{p.last_name}, {p.first_name}</td>
                    <td className="text-muted">
                      {p.date_of_birth
                        ? (p.date_of_birth instanceof Date
                          ? p.date_of_birth.toLocaleDateString('en-GB')
                          : p.date_of_birth)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 className="section-title">Quick Actions</h2>
          <div className="quick-actions">
            <button className="quick-action-btn" onClick={() => navigate('/patients/new')}>
              <span className="qa-icon">👤</span>
              <span>New Patient</span>
            </button>
            <button className="quick-action-btn" onClick={() => navigate('/patients')}>
              <span className="qa-icon">🔍</span>
              <span>Search Patients</span>
            </button>
            <button className="quick-action-btn" onClick={() => window.electronAPI?.dialog.openFile({
              filters: [{ name: 'DICOM', extensions: ['dcm', 'dicom'] }],
              properties: ['openFile', 'multiSelections'],
            })}>
              <span className="qa-icon">📂</span>
              <span>Import DICOM</span>
            </button>
            <button className="quick-action-btn" onClick={() => navigate('/settings')}>
              <span className="qa-icon">⚙</span>
              <span>Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}