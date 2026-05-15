import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './PatientDetailPage.css';

const tabs = ['Overview', 'Images', 'Reports'];

const IMAGE_CATEGORIES = [
  { value: 'xray',  label: 'X-Ray' },
  { value: 'opg',   label: 'OPG (Panoramic)' },
  { value: 'video', label: 'Video' },
];

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

// ── Import Image Modal ────────────────────────────────────────────────────────
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
        { name: 'DICOM',  extensions: ['dcm','dicom'] },
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
      await window.electronAPI?.imaging.importImage(patientId, filePath, {
        imageCategory: category,
        imageType: IMAGE_CATEGORIES.find(c => c.value === category)?.label || category,
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
                className={`btn ${category === c.value ? 'btn-primary' : 'btn-secondary'} btn-sm`}
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
            <input className="input" style={{ flex: 1 }} readOnly
              value={fileName || ''} placeholder="No file selected" />
            <button className="btn btn-secondary" onClick={handleBrowse}>Browse</button>
          </div>
        </div>

        {error && (
          <p style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={importing}>Cancel</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing || !filePath}>
            {importing ? 'Importing…' : 'Import Image'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Images Tab ────────────────────────────────────────────────────────────────
function ImagesTab({ patientId, images, onImport, onCapture, onRefresh, navigate }) {
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // instanceId to delete
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === images.length) setSelected(new Set());
    else setSelected(new Set(images.map(i => i.id)));
  };

  const handleOpen = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    navigate(`/imaging/${ids.join(',')}`);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await window.electronAPI?.imaging.deleteImage(confirmDelete);
      setSelected(prev => { const n = new Set(prev); n.delete(confirmDelete); return n; });
      setConfirmDelete(null);
      onRefresh();
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleting(false);
  };

  const categoryBadge = (cat) => {
    if (cat === 'opg') return 'OPG';
    if (cat === 'video') return 'Video';
    return 'X-Ray';
  };

  return (
    <div className="imaging-tab">
      {/* Toolbar */}
      <div className="imaging-toolbar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {images.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={selectAll}>
              {selected.size === images.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
          {selected.size > 0 && (
            <span className="text-muted text-xs">{selected.size} selected</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selected.size > 0 && (
            <button className="btn btn-primary btn-sm" onClick={handleOpen}>
              🔍 Open {selected.size > 1 ? `${selected.size} Images` : 'Image'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onImport}>⬆ Import Image</button>
          <button className="btn btn-primary" onClick={onCapture}>📷 Capture X-Ray</button>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
        }}>
          <div className="card" style={{ width: 360, padding: 24 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Delete Image?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
              This will permanently remove the image file and cannot be undone.
              The deletion will be recorded in the audit log.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}
                disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : '🗑 Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image grid */}
      {images.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 36 }}>🩻</span>
          <span>No images yet</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn btn-secondary btn-sm" onClick={onImport}>⬆ Import Image</button>
            <button className="btn btn-primary btn-sm" onClick={onCapture}>📷 Capture X-Ray</button>
          </div>
        </div>
      ) : (
        <div className="image-grid">
          {images.map(img => (
            <div
              key={img.id}
              className={`image-card card ${selected.has(img.id) ? 'selected' : ''}`}
              onClick={() => toggleSelect(img.id)}
              onDoubleClick={() => navigate(`/imaging/${img.id}`)}
            >
              {/* Selection indicator */}
              <div className="image-card-checkbox">
                <div className={`img-checkbox ${selected.has(img.id) ? 'checked' : ''}`}>
                  {selected.has(img.id) && '✓'}
                </div>
              </div>

              {/* Thumbnail */}
              <div className="image-card-thumb">
                {img.thumbnail_path
                  ? <img
                      src={`http://127.0.0.1:7432/thumbnail?path=${encodeURIComponent(img.thumbnail_path)}`}
                      alt=""
                    />
                  : <span className="thumb-placeholder">🩻</span>
                }
              </div>

              {/* Info */}
              <div className="image-card-info">
                <span className="badge badge-blue" style={{ fontSize: 10 }}>
                  {categoryBadge(img.image_category)}
                </span>
                {img.tooth_number && (
                  <span className="text-muted text-xs">Tooth {img.tooth_number}</span>
                )}
                <span className="text-muted text-xs" style={{ marginTop: 'auto' }}>
                  {formatDate(img.image_date || img.created_at)}
                </span>
              </div>

              {/* Delete button */}
              <button
                className="image-card-delete"
                onClick={e => { e.stopPropagation(); setConfirmDelete(img.id); }}
                title="Delete image"
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function OverviewTab({ patient }) {
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
          <DetailRow label="Patient ID"  value={patient.patient_number} />
          <DetailRow label="External ID" value={patient.external_id} />
        </div>
      </div>
      {patient.notes && (
        <div className="card">
          <h3 className="section-title">Clinical</h3>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Notes</label>
            <p style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: 13 }}>
              {patient.notes}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Patient Form ──────────────────────────────────────────────────────────────
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
                description="ID from another system for linking records">
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
  const [patient,    setPatient]    = useState(null);
  const [images,     setImages]     = useState([]);
  const [activeTab,  setActiveTab]  = useState('Overview');
  const [loading,    setLoading]    = useState(true);
  const [editing,    setEditing]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
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
      const imgs = await window.electronAPI?.imaging.getImages(id);
      setImages(imgs || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const patientToForm = p => ({
    firstName:   p?.first_name   || '',
    lastName:    p?.last_name    || '',
    dateOfBirth: p?.date_of_birth
      ? (p.date_of_birth instanceof Date
          ? p.date_of_birth.toISOString().slice(0, 10)
          : String(p.date_of_birth).slice(0, 10))
      : '',
    gender:      p?.gender      || '',
    externalId:  p?.external_id || '',
    notes:       p?.notes       || '',
  });

  const validate = form => {
    if (!form.firstName.trim()) return 'First name is required.';
    if (!form.lastName.trim())  return 'Last name is required.';
    return null;
  };

  const handleSave = async (form) => {
    const err = validate(form);
    if (err) { setError(err); return; }
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        const result = await window.electronAPI?.patients.create(form);
        navigate(`/patients/${result.id}`, { replace: true });
      } else {
        await window.electronAPI?.patients.update(id, form);
        await loadPatient();
        setEditing(false);
      }
    } catch (err) {
      setError(err.message || 'Save failed');
    }
    setSaving(false);
  };

  const handleCaptureXRay = () => {
    console.log('Capture X-Ray — integrate with acquisition hardware');
  };

  if (loading) {
    return (
      <div className="patient-detail">
        <div className="empty-state">
          <span className="animate-spin" style={{ fontSize: 24 }}>⟳</span>
          <span>Loading patient…</span>
        </div>
      </div>
    );
  }

  if (isNew || (editing && patient)) {
    return (
      <div className="patient-detail">
        <div className="page-header">
          <h1>{isNew ? 'New Patient' : 'Edit Patient'}</h1>
        </div>
        <PatientForm
          initial={patientToForm(patient)}
          onSave={handleSave}
          onCancel={() => isNew ? navigate('/patients') : setEditing(false)}
          saving={saving}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className="patient-detail">
      {showImport && (
        <ImportImageModal
          patientId={id}
          onClose={() => setShowImport(false)}
          onImported={loadPatient}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
            {activeTab === 'Overview' && <OverviewTab patient={patient} />}
            {activeTab === 'Images' && (
              <ImagesTab
                patientId={id}
                images={images}
                onImport={() => setShowImport(true)}
                onCapture={handleCaptureXRay}
                onRefresh={loadPatient}
                navigate={navigate}
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