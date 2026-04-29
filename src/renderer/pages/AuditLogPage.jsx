import React, { useEffect, useState } from 'react';
import './AuditLogPage.css';

const ACTION_COLOURS = {
  CREATE: 'badge-green', READ: 'badge-blue', UPDATE: 'badge-yellow',
  DELETE: 'badge-red', LOGIN: 'badge-blue', LOGOUT: 'badge-blue',
  EXPORT: 'badge-yellow', PRINT: 'badge-yellow',
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', action: '' });

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    setLoading(true);
    const data = await window.electronAPI?.audit.getLogs(filters) || [];
    setLogs(data);
    setLoading(false);
  };

  return (
    <div className="audit-page">
      <div className="page-header">
        <h1>Audit Log</h1>
        <button className="btn btn-secondary" onClick={() => window.electronAPI?.audit.exportLogs()}>
          ↓ Export CSV
        </button>
      </div>

      <div className="audit-toolbar">
        <input className="input" type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} style={{ width: 160 }} />
        <span className="text-muted">to</span>
        <input className="input" type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} style={{ width: 160 }} />
        <select className="input" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} style={{ width: 140 }}>
          <option value="">All Actions</option>
          {['CREATE','READ','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button className="btn btn-secondary" onClick={loadLogs}>Apply</button>
      </div>

      <div className="audit-table-wrapper">
        {loading ? (
          <div className="empty-state"><span className="animate-spin" style={{ fontSize: 24 }}>⟳</span></div>
        ) : logs.length === 0 ? (
          <div className="empty-state"><span>No audit log entries found</span></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id}>
                  <td className="mono text-xs">{log.timestamp}</td>
                  <td>{log.username || '—'}</td>
                  <td><span className={`badge ${ACTION_COLOURS[log.action] || 'badge-blue'}`}>{log.action}</span></td>
                  <td className="text-muted text-xs">{log.resource_type}{log.resource_id ? ` #${log.resource_id.slice(0, 8)}` : ''}</td>
                  <td className="text-muted">{log.description || '—'}</td>
                  <td>{log.success ? <span className="badge badge-green">OK</span> : <span className="badge badge-red">Error</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
