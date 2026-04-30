import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './PatientDetailPage.css';

const tabs = ['Overview', 'Images', 'Reports'];

// Image categories
const IMAGE_CATEGORIES = [
  { value: 'xray',  label: 'X-Ray' },
  { value: 'opg',   label: 'OPG (Panoramic)' },
  { value: 'video', label: 'Video Image' },
];

function parseAlerts(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function formatDate(val) {
  if (!val) return '—';
  if (val instanceof Date) return val.toLocaleDateString('en-GB');
  if (typeof val === 'string') return val.slice(0, 10);
  return String(val);
}

function FormField({ label, description, children, wide, required }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500,
        color: 'var(--text-secondary)', marginBottom: 4 }}>
        {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
      </label>
      {description && (
        <p style={{ fontSize: 11, color: 'var(--text-secondary)',
          margin: '0 0 4px', opacity: 0.7 }}>{description}</p>
      )}
      {children}
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

// ── Import Image modal ────────────────────────────────────────────────────────
function ImportImageModal({ patientId, onClose, onImported }) {
  const [category, setCategory] = useState('xray');
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const handleBrowse = async () => {
    const result = await window.electronAPI?.dialog.openFile({
      title: 'Select Image to Import',
      filters: [
        { name: 'All Supported Images',
          extensions: ['jpg','jpeg','png','bmp','tif','tiff','gif','webp','dcm','dicom'] },
        { name: 'Photos', extensions: ['jpg','jpeg','png','bmp','tif','tiff','gif','webp'] },
        { name: 'DICOM', extensions: ['dcm','dicom'] },
      ],
      properties: ['openFile'],
    });
    if (!result?.canceled && result?.filePaths?.[0]) {
      setFilePath(result.filePaths[0]);
      setFileName(result.filePaths[0].split(/[\\/]/).pop());
      setError('');
    }
  };

  const handleImport = async () => {
    if (!filePath) { setError('Please select a file first.'); return; }
    setImporting(true);
    setError('');
    try {
      // Create a study for this patient then import the image into it
      const study = await window.electronAPI?.imaging.createStudy({
        patientId,
        description: IMAGE_CATEGORIES.find(c => c.value === category)?.label || category,
        modality: category === 'opg' ? 'DX' : category === 'video' ? 'ES' : 'CR',
        studyDate: new Date().toISOString().slice(0, 10),
      });
      if (!study?.id) throw new Error('Failed to create image record');
      await window.electronAPI?.imaging.importImage(study.id, filePath, {
        imageType: category,
      });
      onImported();
      onClose();
    } catch (err) {
      setError(err.message || 'Import failed');
    }
    setImporting(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div className="card" style={{ width: 460, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Import Image</h2>

        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
            display: 'block', marginBottom: 6 }}>Image Category</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {IMAGE_CATEGORIES.map(c => (
              <button key={c.value}
                className={`btn ${category === c.value ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setCategory(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)',
            display: 'block', marginBottom: 6 }}>File</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }}
              value={fileName} readOnly placeholder="No file selected" />
            <button className="btn btn-secondary" onClick={handleBrowse}>Browse</button>
          </div>
          {fileName && (
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              {filePath}
            </p>
          )}
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
            color: 'var(--danger)', fontSize: 13 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={importing}>Cancel</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing || !filePath}>
            {importing ? 'Importing…' : 'Import Image'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Patient form (shared by New and Edit) ─────────────────────────────────────
function PatientForm({ initial, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(initial);
  const set = (f, v) => setForm(prev => ({ ...prev, [f]: v }));



  return (
    <>
      {error && (
        <div style={{ margin: '0 24px 16px', padding: '10px 14px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 6, color: 'var(--danger)', fontSize: 13 }}>{error}</div>
      )}
      <div className="patient-content" style={{ padding: 24, overflowY: 'auto' }}>
        <div className="overview-grid">

          <div className="card">
            <h3 className="section-title">Personal Details</h3>
            <div className="form-grid">
              <FormField label="First Name" required>
                <input className="input" value={form.firstName}
                  onChange={e => set('firstName', e.target.value)} autoFocus />
              </FormField>
              <FormField label="Last Name" required>
                <input className="input" value={form.lastName}
                  onChange={e => set('lastName', e.target.value)} />
              </FormField>
              <FormField label="Date of Birth">
                <input className="input" type="date" value={form.dateOfBirth}
                  onChange={e => set('dateOfBirth', e.target.value)} />
              </FormField>
              <FormField label="Gender">
                <select className="input" value={form.gender}
                  onChange={e => set('gender', e.target.value)}>
                  <option value="">— Select —</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="Other">Other</option>
                  <option value="Unknown">Prefer not to say</option>
                </select>
              </FormField>
            </div>
          </div>

          <div className="card">
            <h3 className="section-title">Identifiers</h3>
            <div className="form-grid">

              <FormField label="External System Reference"
                description="ID from another system (PMS, referral software, etc.) for linking records">
                <input className="input" value={form.externalId}
                  onChange={e => set('externalId', e.target.value)}
                  placeholder="e.g. EXACT-00123" />
              </FormField>

            </div>
          </div>

          <div className="card">
            <h3 className="section-title">Notes</h3>
            <div className="form-grid">
              <FormField label="Notes" wide>
                <textarea className="input" rows={3} value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  style={{ resize: 'vertical' }} />
              </FormField>

            </div>
          </div>

        </div>
      </div>
      <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(form)} disabled={saving}>
          {saving ? 'Saving…' : 'Save Patient'}
        </button>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient]     = useState(null);
  const [studies, setStudies]     = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [showImport, setShowImport] = useState(false);
  const isNew = id === 'new';

  useEffect(() => {
    if (!isNew) loadPatient();
    else setLoading(false);
  }, [id]);

  const loadPatient = async () => {
    setLoading(true);
    try {
      const p = await window.electronAPI?.patients.getById(id);
      setPatient(p);
      // Images are linked by patient UUID (patient_id FK in imaging_studies)
      const s = await window.electronAPI?.imaging.getStudies(id);
      setStudies(s || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const patientToForm = p => ({
    firstName:        p?.first_name        || '',
    lastName:         p?.last_name         || '',
    dateOfBirth:      p?.date_of_birth
      ? (p.date_of_birth instanceof Date
          ? p.date_of_birth.toISOString().slice(0, 10)
          : String(p.date_of_birth).slice(0, 10))
      : '',
    gender:           p?.gender            || '',
    externalId:       p?.external_id       || '',
    notes:            p?.notes             || '',
  });

  const validate = form => {
    if (!form.firstName.trim()) return 'First name is required.';
    if (!form.lastName.trim())  return 'Last name is required.';
    return null;
  };

  const handleCreate = async form => {
    const err = validate(form);
    if (err) { setError(err); return; }
    setSaving(true); setError('');
    try {
      const result = await window.electronAPI?.patients.create({
        ...form,
      });
      if (result?.id) navigate(`/patients/${result.id}`, { replace: true });
    } catch (err) { setError(err.message || 'Failed to create patient.'); }
    setSaving(false);
  };

  const handleUpdate = async form => {
    const err = validate(form);
    if (err) { setError(err); return; }
    setSaving(true); setError('');
    try {
      await window.electronAPI?.patients.update(id, {
        ...form,
      });
      setEditing(false); setError('');
      await loadPatient();
    } catch (err) { setError(err.message || 'Failed to save changes.'); }
    setSaving(false);
  };

  // TWAIN capture placeholder — will be wired to native TWAIN bridge
  const handleCaptureXRay = async () => {
    // TODO: invoke window.electronAPI?.twain.capture({ patientId: id })
    // For now show a placeholder alert
    await window.electronAPI?.dialog.showMessage({
      type: 'info',
      title: 'Capture X-Ray',
      message: 'TWAIN capture integration coming soon.',
      detail: 'This will connect to your X-ray capture device via the TWAIN protocol.',
    });
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="animate-spin" style={{ fontSize: 28 }}>⟳</span>
    </div>
  );

  if (isNew) return (
    <div className="patient-detail animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-icon" onClick={() => navigate('/patients')}>←</button>
          <h1>New Patient</h1>
        </div>
      </div>
      <PatientForm
        initial={{ firstName:'', lastName:'', dateOfBirth:'', gender:'',
          externalId:'', notes:'' }}
        onSave={handleCreate} onCancel={() => navigate('/patients')}
        saving={saving} error={error}
      />
    </div>
  );

  if (editing) return (
    <div className="patient-detail animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-icon"
            onClick={() => { setEditing(false); setError(''); }}>←</button>
          <h1>Edit Patient</h1>
        </div>
      </div>
      <PatientForm
        initial={patientToForm(patient)}
        onSave={handleUpdate} onCancel={() => { setEditing(false); setError(''); }}
        saving={saving} error={error}
      />
    </div>
  );

  return (
    <div className="patient-detail animate-fade-in">
      {showImport && (
        <ImportImageModal
          patientId={id}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadPatient(); }}
        />
      )}

      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-icon" onClick={() => navigate('/patients')}>←</button>
          <div>
            {patient ? (
              <>
                <h1>{patient.last_name}, {patient.first_name}</h1>
                <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                  {patient.patient_number && (
                    <span className="mono text-xs badge badge-blue">ID: {patient.patient_number}</span>
                  )}
                  {patient.date_of_birth && (
                    <span className="text-muted text-xs">DOB: {formatDate(patient.date_of_birth)}</span>
                  )}
                  {patient.external_id && (
                    <span className="text-muted text-xs">Ext: {patient.external_id}</span>
                  )}
                </div>
              </>
            ) : <h1>Patient Not Found</h1>}
          </div>
        </div>

        {patient && (
          <div className="flex gap-2">
            <button className="btn btn-secondary"
              onClick={() => { setEditing(true); setError(''); }}>
              Edit Patient
            </button>
            <button className="btn btn-secondary" onClick={() => setShowImport(true)}>
              ⬆ Import Image
            </button>
            <button className="btn btn-primary" onClick={handleCaptureXRay}>
              📷 Capture X-Ray
            </button>
          </div>
        )}
      </div>



      {patient && (
        <>
          <div className="patient-tabs">
            {tabs.map(tab => (
              <button key={tab}
                className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}>{tab}</button>
            ))}
          </div>
          <div className="patient-content">
            {activeTab === 'Overview' && (
              <OverviewTab patient={patient} formatDate={formatDate} />
            )}
            {activeTab === 'Images' && (
              <ImagesTab
                studies={studies}
                onOpen={s => navigate(`/imaging/${s.id}`)}
                onCapture={handleCaptureXRay}
                onImport={() => setShowImport(true)}
              />
            )}
            {activeTab === 'Reports' && (
              <div className="coming-soon">Reports coming soon</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewTab({ patient, formatDate }) {
  return (
    <div className="overview-grid">
      <div className="card">
        <h3 className="section-title">Personal Details</h3>
        <div className="detail-grid">
          <DetailRow label="First Name"    value={patient.first_name} />
          <DetailRow label="Last Name"     value={patient.last_name} />
          <DetailRow label="Date of Birth" value={formatDate(patient.date_of_birth)} />
          <DetailRow label="Gender"        value={patient.gender} />
        </div>
      </div>
      <div className="card">
        <h3 className="section-title">Identifiers</h3>
        <div className="detail-grid">
          <DetailRow label="Patient ID"   value={patient.patient_number} />
          <DetailRow label="External ID"  value={patient.external_id} />
        </div>
      </div>
      {patient.notes && (
        <div className="card">
          <h3 className="section-title">Clinical</h3>

          {patient.notes && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Notes</label>
              <p style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 13 }}>
                {patient.notes}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImagesTab({ studies, onOpen, onCapture, onImport }) {
  const categoryLabel = modality => {
    if (modality === 'DX') return 'OPG';
    if (modality === 'ES') return 'Video';
    return 'X-Ray';
  };

  return (
    <div className="imaging-tab">
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-secondary" onClick={onImport}>⬆ Import Image</button>
        <button className="btn btn-primary" onClick={onCapture}>📷 Capture X-Ray</button>
      </div>

      {studies.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 36 }}>🩻</span>
          <span>No images yet</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn btn-secondary btn-sm" onClick={onImport}>⬆ Import Image</button>
            <button className="btn btn-primary btn-sm" onClick={onCapture}>📷 Capture X-Ray</button>
          </div>
        </div>
      ) : (
        <div className="studies-list">
          {studies.map(s => (
            <div key={s.id} className="study-card card clickable" onClick={() => onOpen(s)}>
              <div className="study-info">
                <span className="badge badge-blue">{categoryLabel(s.modality)}</span>
                <span>{s.study_description || 'Image set'}</span>
                <span className="text-muted text-xs">{s.study_date || '—'}</span>
              </div>
              <span className="text-muted text-xs">
                {s.image_count} image{s.image_count !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}