import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getCornerstone, makeImageId, TOOL_MAP,
  applyWLPreset, toggleInvert, resetViewport,
} from '../utils/cornerstoneSetup';
import './ImagingViewerPage.css';

const TOOLS = [
  { id: 'wwwc',     icon: '◑',  label: 'W/L',    tooltip: 'Window / Level  [W]' },
  { id: 'zoom',     icon: '🔍', label: 'Zoom',   tooltip: 'Zoom  [Z]' },
  { id: 'pan',      icon: '✋', label: 'Pan',    tooltip: 'Pan  [P]' },
  { id: 'length',   icon: '📏', label: 'Length', tooltip: 'Measure length  [L]' },
  { id: 'angle',    icon: '📐', label: 'Angle',  tooltip: 'Measure angle  [A]' },
  { id: 'freehand', icon: '✏️', label: 'ROI',    tooltip: 'Freehand ROI' },
  { id: 'arrow',    icon: '↗',  label: 'Note',   tooltip: 'Arrow annotation' },
  { id: 'ellipse',  icon: '⬭',  label: 'Ellipse',tooltip: 'Ellipse ROI' },
];

// Dental-appropriate W/L presets
// Periapical / bitewing images are typically 8-bit (0-255) grayscale.
// Panoramic (OPG) images may be 12-bit from digital sensors.
const WL_PRESETS = [
  { label: 'Default',    w: 4000, l: 2000 },  // Auto-fit starting point
  { label: 'Periapical', w: 300,  l: 150  },  // Standard intra-oral bitewing/PA
  { label: 'Caries',     w: 200,  l: 100  },  // Narrow window to highlight interproximal decay
  { label: 'Perio',      w: 600,  l: 300  },  // Wider range for bone level assessment
  { label: 'OPG',        w: 3000, l: 1500 },  // Panoramic — wide range, brighter centre
  { label: 'Implant',    w: 1500, l: 700  },  // High contrast for metalwork / bone interface
  { label: 'Endo',       w: 250,  l: 125  },  // Narrow for root canal / file visibility
];

export default function ImagingViewerPage() {
  const { studyId } = useParams();
  const navigate    = useNavigate();

  const viewerRef   = useRef(null);
  const csEnabled   = useRef(false);

  const [study,            setStudy]            = useState(null);
  const [instances,        setInstances]        = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [activeTool,       setActiveTool]       = useState('wwwc');
  const [loading,          setLoading]          = useState(true);
  const [imageLoading,     setImageLoading]     = useState(false);
  const [viewportInfo,     setViewportInfo]     = useState(null);
  const [error,            setError]            = useState('');
  const [confirmDelete,    setConfirmDelete]    = useState(false); // delete-instance confirm
  const [deleting,         setDeleting]         = useState(false);

  // ── Load study ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadStudy();
    return () => {
      if (csEnabled.current && viewerRef.current) {
        import('cornerstone-core').then(cs => {
          try { cs.disable(viewerRef.current); } catch {}
        });
        csEnabled.current = false;
      }
    };
  }, [studyId]);

  async function loadStudy() {
    setLoading(true);
    setError('');
    try {
      const data = await window.electronAPI?.imaging.getStudy(studyId);
      if (data) {
        setStudy(data.study);
        const insts = data.instances || [];
        setInstances(insts);
        if (insts.length) setSelectedInstance(insts[0]);
      }
    } catch (err) {
      setError('Failed to load study: ' + err.message);
    }
    setLoading(false);
  }

  // ── Load image into Cornerstone ───────────────────────────────────────────
  useEffect(() => {
    if (selectedInstance) loadImage(selectedInstance);
  }, [selectedInstance]);

  const loadImage = useCallback(async (instance) => {
    const element = viewerRef.current;
    if (!element) return;

    setImageLoading(true);
    setError('');

    try {
      const { cornerstone, cornerstoneTools } = await getCornerstone();

      if (!csEnabled.current) {
        cornerstone.enable(element);
        csEnabled.current = true;
        element.addEventListener('cornerstoneimagerendered', (e) => {
          const vp = e.detail?.viewport;
          if (vp?.voi) {
            setViewportInfo({
              ww:   Math.round(vp.voi.windowWidth),
              wc:   Math.round(vp.voi.windowCenter),
              zoom: (vp.scale || 1).toFixed(2),
            });
          }
        });
      }

      const imageId = makeImageId(instance.file_path);
      const image = await cornerstone.loadAndCacheImage(imageId);
      cornerstone.displayImage(element, image);
      _activateTool(cornerstoneTools, activeTool);
      cornerstone.fitToWindow(element);

      if (instance.annotations) {
        try {
          const saved = typeof instance.annotations === 'string'
            ? JSON.parse(instance.annotations) : instance.annotations;
          Object.entries(saved || {}).forEach(([toolName, data]) => {
            (Array.isArray(data) ? data : []).forEach(d =>
              cornerstoneTools.addToolState(element, toolName, d)
            );
          });
          cornerstone.updateImage(element);
        } catch {}
      }

    } catch (err) {
      console.error('Cornerstone load error:', err);
      setError(`Cannot render image: ${err.message}`);
    } finally {
      setImageLoading(false);
    }
  }, [activeTool]);

  // ── Tool switching ────────────────────────────────────────────────────────
  const handleToolSelect = async (toolId) => {
    setActiveTool(toolId);
    if (!csEnabled.current) return;
    const { cornerstoneTools } = await getCornerstone();
    _activateTool(cornerstoneTools, toolId);
  };

  function _activateTool(cornerstoneTools, toolId) {
    if (toolId === 'invert') { toggleInvert(viewerRef.current); return; }
    if (toolId === 'reset')  { resetViewport(viewerRef.current); return; }
    const name = TOOL_MAP[toolId];
    if (name) cornerstoneTools.setToolActive(name, { mouseButtonMask: 1 });
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const map = { w: 'wwwc', z: 'zoom', p: 'pan', l: 'length', a: 'angle' };
      if (map[e.key]) handleToolSelect(map[e.key]);
      if (e.key === 'r' || e.key === 'R') resetViewport(viewerRef.current);
      if (e.key === 'i' || e.key === 'I') toggleInvert(viewerRef.current);
      if (e.key === 'Delete' && selectedInstance) setConfirmDelete(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedInstance]);

  // ── Menu event: zoom/fit from app menu ────────────────────────────────────
  useEffect(() => {
    const offZoomIn  = window.electronAPI?.on('viewer:zoom-in',  () => _zoom(1.2));
    const offZoomOut = window.electronAPI?.on('viewer:zoom-out', () => _zoom(0.8));
    const offFit     = window.electronAPI?.on('viewer:fit',      () => resetViewport(viewerRef.current));
    return () => { offZoomIn?.(); offZoomOut?.(); offFit?.(); };
  }, []);

  function _zoom(delta) {
    if (!csEnabled.current) return;
    import('cornerstone-core').then(cs => {
      try {
        const vp = cs.getViewport(viewerRef.current);
        if (!vp) return;
        vp.scale = Math.min(Math.max(vp.scale * delta, 0.05), 30);
        cs.setViewport(viewerRef.current, vp);
      } catch {}
    });
  }

  // ── Save annotations ──────────────────────────────────────────────────────
  const handleSaveAnnotations = async () => {
    if (!selectedInstance || !csEnabled.current) return;
    try {
      const { cornerstoneTools } = await getCornerstone();
      const annotations = {};
      Object.values(TOOL_MAP).forEach(name => {
        const state = cornerstoneTools.getToolState(viewerRef.current, name);
        if (state?.data?.length) annotations[name] = state.data;
      });
      await window.electronAPI?.imaging.saveAnnotations(selectedInstance.id, annotations);
    } catch (err) {
      console.error('Save annotations failed:', err);
    }
  };

  // ── Delete current image ──────────────────────────────────────────────────
  const handleDeleteInstance = async () => {
    if (!selectedInstance) return;
    setDeleting(true);
    try {
      await window.electronAPI?.imaging.deleteInstance(selectedInstance.id);
      setConfirmDelete(false);
      // Reload; if no instances remain, go back
      const data = await window.electronAPI?.imaging.getStudy(studyId);
      const remaining = data?.instances || [];
      setInstances(remaining);
      if (remaining.length) {
        setSelectedInstance(remaining[0]);
      } else {
        navigate(-1);
      }
    } catch (err) {
      setError('Delete failed: ' + err.message);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  // ── Import images ─────────────────────────────────────────────────────────
  const handleImportImages = async () => {
    const result = await window.electronAPI?.dialog.openFile({
      title: 'Import Images',
      filters: [
        { name: 'DICOM',   extensions: ['dcm', 'dicom'] },
        { name: 'Images',  extensions: ['jpg', 'jpeg', 'png', 'bmp'] },
        { name: 'All',     extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (!result?.canceled && result?.filePaths?.length) {
      for (const fp of result.filePaths) {
        await window.electronAPI?.imaging.importImage(studyId, fp);
      }
      loadStudy();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="viewer-page">

      {/* ── Delete confirmation dialog ── */}
      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
        }}>
          <div className="card" style={{ width: 380, padding: 24 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Delete Image?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
              This will permanently remove the image file and cannot be undone.
              The deletion will be recorded in the audit log.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}
                disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDeleteInstance}
                disabled={deleting}>
                {deleting ? 'Deleting…' : '🗑 Delete Image'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Topbar ── */}
      <div className="viewer-topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} title="Back">←</button>
        <div className="viewer-info">
          {study && <span className="viewer-title">{study.study_description || 'Imaging Study'}</span>}
          {selectedInstance?.tooth_number && (
            <span className="badge badge-blue">Tooth {selectedInstance.tooth_number}</span>
          )}
          {selectedInstance?.image_type && (
            <span className="badge badge-blue">{selectedInstance.image_type}</span>
          )}
          {imageLoading && <span className="text-muted text-xs">Loading…</span>}
        </div>
        <div className="viewer-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleSaveAnnotations}>💾 Save</button>
          <button className="btn btn-secondary btn-sm" onClick={() => {}}>📄 Report</button>
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            const result = await window.electronAPI?.dialog.saveFile({
              title: 'Export Image',
              defaultPath: 'xray.jpg',
              filters: [{ name: 'JPEG', extensions: ['jpg'] }, { name: 'PNG', extensions: ['png'] }],
            });
            if (!result?.canceled) {
              console.log('Export to:', result.filePath);
            }
          }}>↗ Export</button>
          {selectedInstance && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmDelete(true)}
              title="Delete this image (Delete key)"
            >🗑 Delete</button>
          )}
        </div>
      </div>

      <div className="viewer-body">

        {/* ── Thumbnail strip ── */}
        <div className="thumbnail-strip">
          {instances.map((inst, idx) => (
            <div
              key={inst.id}
              className={`thumbnail ${selectedInstance?.id === inst.id ? 'active' : ''}`}
              onClick={() => setSelectedInstance(inst)}
              title={inst.image_type
                ? `${inst.image_type}${inst.tooth_number ? ' — Tooth ' + inst.tooth_number : ''}`
                : `Image ${idx + 1}`}
            >
              <div className="thumbnail-preview">
                {inst.thumbnail_path
                  ? <img src={`http://127.0.0.1:7432/thumbnail?path=${encodeURIComponent(inst.thumbnail_path)}`} alt="" />
                  : <span className="thumbnail-placeholder">🩻</span>}
              </div>
              <span className="thumbnail-label">{inst.image_type || `#${idx + 1}`}</span>
              {inst.tooth_number && <span className="thumbnail-tooth">{inst.tooth_number}</span>}
            </div>
          ))}

          {!loading && instances.length === 0 && (
            <div className="thumbnail-empty text-muted text-xs">No images</div>
          )}

          <button className="thumbnail-add" onClick={handleImportImages} title="Import image(s)">+</button>
        </div>

        {/* ── Main viewer canvas ── */}
        <div className="viewer-main">

          <div
            ref={viewerRef}
            className="viewer-canvas"
            onContextMenu={e => e.preventDefault()}
            style={{ display: instances.length > 0 && !loading ? 'block' : 'none' }}
          />

          {loading && (
            <div className="viewer-empty">
              <span className="animate-spin" style={{ fontSize: 32 }}>⟳</span>
              <span>Loading study…</span>
            </div>
          )}
          {!loading && instances.length === 0 && (
            <div className="viewer-empty">
              <span style={{ fontSize: 48 }}>🩻</span>
              <span>No images in this study</span>
              <button className="btn btn-primary btn-sm" onClick={handleImportImages}>Import Images</button>
            </div>
          )}
          {error && (
            <div className="viewer-empty">
              <span style={{ fontSize: 32 }}>⚠️</span>
              <span style={{ color: 'var(--danger)', maxWidth: 340, textAlign: 'center' }}>{error}</span>
              <button className="btn btn-secondary btn-sm"
                onClick={() => selectedInstance && loadImage(selectedInstance)}>Retry</button>
            </div>
          )}

          {imageLoading && (
            <div className="viewer-image-loading">
              <span className="animate-spin">⟳</span> Loading image…
            </div>
          )}

          {csEnabled.current && selectedInstance && (
            <>
              <div className="overlay-tl">
                <div>{study?.study_description}</div>
                <div>{selectedInstance.image_type}</div>
                {selectedInstance.tooth_number && <div>Tooth {selectedInstance.tooth_number}</div>}
              </div>
              <div className="overlay-tr">
                {selectedInstance.acquisition_date && (
                  <div>{new Date(selectedInstance.acquisition_date).toLocaleDateString()}</div>
                )}
                {selectedInstance.kvp && <div>{selectedInstance.kvp} kV</div>}
                {selectedInstance.mas && <div>{selectedInstance.mas} mAs</div>}
              </div>
              {viewportInfo && (
                <div className="overlay-bl">
                  <span>WW: {viewportInfo.ww}</span>
                  <span>WC: {viewportInfo.wc}</span>
                  <span>×{viewportInfo.zoom}</span>
                </div>
              )}
              <div className="overlay-br">
                <span className="mono text-xs text-muted">
                  {instances.indexOf(selectedInstance) + 1} / {instances.length}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ── Tool panel ── */}
        <div className="tool-panel">
          <div className="tool-section-title">Tools</div>

          {TOOLS.map(tool => (
            <button
              key={tool.id}
              className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
              onClick={() => handleToolSelect(tool.id)}
              title={tool.tooltip}
            >
              <span className="tool-icon">{tool.icon}</span>
              <span className="tool-label">{tool.label}</span>
            </button>
          ))}

          <button className="tool-btn" onClick={() => toggleInvert(viewerRef.current)} title="Invert [I]">
            <span className="tool-icon">⬛</span>
            <span className="tool-label">Invert</span>
          </button>
          <button className="tool-btn" onClick={() => resetViewport(viewerRef.current)} title="Reset [R]">
            <span className="tool-icon">↺</span>
            <span className="tool-label">Reset</span>
          </button>

          <div className="divider" />
          <div className="tool-section-title">W/L Presets</div>
          <div className="wl-presets">
            {WL_PRESETS.map(preset => (
              <button key={preset.label} className="preset-btn"
                title={`WW:${preset.w}  WC:${preset.l}`}
                onClick={() => applyWLPreset(viewerRef.current, preset.w, preset.l)}>
                {preset.label}
              </button>
            ))}
          </div>

          <div className="divider" />
          <div className="tool-section-title">Keys</div>
          <div className="key-hints">
            {[['W','W/L'],['Z','Zoom'],['P','Pan'],['L','Length'],['I','Invert'],['R','Reset'],['Del','Delete']].map(([k, l]) => (
              <div key={k} className="key-hint">
                <kbd>{k}</kbd><span>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}