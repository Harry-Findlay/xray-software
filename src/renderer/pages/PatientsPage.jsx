import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './PatientsPage.css';

export default function PatientsPage() {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadPatients = useCallback(async (searchTerm = '') => {
    setLoading(true);
    try {
      const data = searchTerm.length >= 2
        ? await window.electronAPI?.patients.search(searchTerm)
        : await window.electronAPI?.patients.getAll();
      setPatients(data || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadPatients(search), 300);
    return () => clearTimeout(timer);
  }, [search, loadPatients]);

  return (
    <div className="patients-page">
      <div className="page-header">
        <h1>Patients</h1>
        <button className="btn btn-primary" onClick={() => navigate('/patients/new')}>
          + New Patient
        </button>
      </div>

      <div className="patients-toolbar">
        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            className="input search-input"
            type="text"
            placeholder="Search by name, patient number, or NHS number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
        <span className="text-muted text-sm">{patients.length} patient{patients.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="patients-table-wrapper">
        {loading ? (
          <div className="empty-state">
            <span className="animate-spin" style={{ fontSize: 24 }}>⟳</span>
            <span>Loading patients...</span>
          </div>
        ) : patients.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 40 }}>👤</span>
            <span>{search ? 'No patients found' : 'No patients yet'}</span>
            {!search && (
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/patients/new')}>
                Add First Patient
              </button>
            )}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient #</th>
                <th>Name</th>
                <th>Date of Birth</th>
                <th>Phone</th>
                <th>NHS Number</th>
                <th>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const alerts = p.medical_alerts ? JSON.parse(p.medical_alerts) : [];
                return (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                    <td><span className="mono text-xs badge badge-blue">{p.patient_number}</span></td>
                    <td><strong>{p.last_name}</strong>, {p.first_name}</td>
                    <td className="text-muted">{p.date_of_birth || '—'}</td>
                    <td className="text-muted">{p.phone || '—'}</td>
                    <td className="mono text-xs text-muted">{p.nhs_number || '—'}</td>
                    <td>
                      {alerts.length > 0 && (
                        <span className="badge badge-yellow" title={alerts.join(', ')}>
                          ⚠ {alerts.length}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
