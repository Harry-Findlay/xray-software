import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './PatientDetailPage.css';

const tabs = ['Overview', 'Imaging', 'Reports', 'Appointments'];

export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [studies, setStudies] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const isNew = id === 'new';

  useEffect(() => {
    if (!isNew) loadPatient();
    else setLoading(false);
  }, [id]);

  const loadPatient = async () => {
    try {
      const p = await window.electronAPI?.patients.getById(id);
      setPatient(p);
      const s = await window.electronAPI?.imaging.getStudies(id);
      setStudies(s || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="animate-spin" style={{ fontSize: 28 }}>⟳</span>
    </div>
  );

  return (
    <div className="patient-detail animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-icon" onClick={() => navigate('/patients')}>←</button>
          <div>
            {patient ? (
              <>
                <h1>{patient.last_name}, {patient.first_name}</h1>
                <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                  <span className="mono text-xs badge badge-blue">{patient.patient_number}</span>
                  {patient.date_of_birth && <span className="text-muted text-xs">DOB: {patient.date_of_birth}</span>}
                  {patient.nhs_number && <span className="text-muted text-xs">NHS: {patient.nhs_number}</span>}
                </div>
              </>
            ) : (
              <h1>New Patient</h1>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => {}}>Edit Patient</button>
          <button className="btn btn-primary" onClick={() => {}}>New Study</button>
        </div>
      </div>

      {patient && (
        <>
          {/* Medical Alerts Banner */}
          {(() => {
            const alerts = patient.medical_alerts ? JSON.parse(patient.medical_alerts) : [];
            return alerts.length > 0 ? (
              <div className="alerts-banner">
                ⚠ Medical Alerts: {alerts.join(' · ')}
              </div>
            ) : null;
          })()}

          <div className="patient-tabs">
            {tabs.map(tab => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="patient-content">
            {activeTab === 'Overview' && <OverviewTab patient={patient} />}
            {activeTab === 'Imaging' && <ImagingTab studies={studies} onOpen={(study) => navigate(`/imaging/${study.id}`)} />}
            {activeTab === 'Reports' && <div className="coming-soon">Reports coming soon</div>}
            {activeTab === 'Appointments' && <div className="coming-soon">Appointments coming soon</div>}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewTab({ patient }) {
  return (
    <div className="overview-grid">
      <div className="card">
        <h3 className="section-title">Personal Details</h3>
        <div className="detail-grid">
          <DetailRow label="First Name" value={patient.first_name} />
          <DetailRow label="Last Name" value={patient.last_name} />
          <DetailRow label="Date of Birth" value={patient.date_of_birth} />
          <DetailRow label="Gender" value={patient.gender} />
          <DetailRow label="Phone" value={patient.phone} />
          <DetailRow label="Email" value={patient.email} />
        </div>
      </div>
      <div className="card">
        <h3 className="section-title">Address</h3>
        <div className="detail-grid">
          <DetailRow label="Address" value={patient.address_line1} />
          <DetailRow label="City" value={patient.city} />
          <DetailRow label="County" value={patient.county} />
          <DetailRow label="Postcode" value={patient.postcode} />
        </div>
      </div>
      <div className="card">
        <h3 className="section-title">Clinical</h3>
        <div className="detail-grid">
          <DetailRow label="NHS Number" value={patient.nhs_number} />
          <DetailRow label="Referring Dentist" value={patient.referring_dentist} />
        </div>
        {patient.notes && (
          <div style={{ marginTop: 12 }}>
            <label>Notes</label>
            <p style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 13 }}>{patient.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value || '—'}</span>
    </div>
  );
}

function ImagingTab({ studies, onOpen }) {
  return (
    <div className="imaging-tab">
      {studies.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 40 }}>🩻</span>
          <span>No imaging studies yet</span>
          <button className="btn btn-primary btn-sm">Import DICOM / Image</button>
        </div>
      ) : (
        <div className="studies-grid">
          {studies.map(study => (
            <div key={study.id} className="study-card card" onClick={() => onOpen(study)}>
              <div className="study-header">
                <span className="badge badge-blue">{study.modality}</span>
                <span className="text-muted text-xs">{study.study_date}</span>
              </div>
              <div className="study-desc">{study.study_description || 'Untitled Study'}</div>
              <div className="study-meta text-muted text-xs">{study.image_count} image{study.image_count !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
