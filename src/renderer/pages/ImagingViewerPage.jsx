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

const WL_PRESETS = [
  { label: 'Default',     w: 4000, l: 1000 },
  { label: 'Bone',        w: 1500, l: 400  },
  { label: 'Soft Tissue', w: 400,  l: 40   },
  { label: 'Lung',        w: 1600, l: -600 },
];

export default function ImagingViewerPage() {
  const { studyId } = useParams();
  const navigate    = useNavigate();

  const viewerRef   = useRef(null);   // DOM div — Cornerstone enables on this
  const csEnabled   = useRef(false);  // Has cornerstone.enable() been called?

  const [study,            setStudy]            = useState(null);
  const [instances,        setInstances]        = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [activeTool,       setActiveTool]       = useState('wwwc');
  const [loading,          setLoading]          = useState(true);
  const [imageLoading,     setImageLoading]     = useState(false);
  const [viewportInfo,     setViewportInfo]     = useState(null);
  const [error,            setError]            = useState('');

  // ── Load study ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadStudy();
    return () => {
      // Clean up Cornerstone on unmount
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

      // Enable the element (idempotent after first call)
      if (!csEnabled.current) {
        cornerstone.enable(element);
        csEnabled.current = true;

        // Live viewport readout (W/L / zoom overlay)
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

      // Build WADO-URI imageId — our local Express server streams the file
      const imageId = makeImageId(instance.file_path);

      const image = await cornerstone.loadAndCacheImage(imageId);
      cornerstone.displayImage(element, image);

      // Restore the active tool
      _activateTool(cornerstoneTools, activeTool);

      // Fit to viewport
      cornerstone.fitToWindow(element);

      // Restore saved annotations
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
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
              // TODO: canvas.toBlob → fs.writeFileSync
              console.log('Export to:', result.filePath);
            }
          }}>↗ Export</button>
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
              title={inst.image_type ? `${inst.image_type}${inst.tooth_number ? ' — Tooth ' + inst.tooth_number : ''}` : `Image ${idx + 1}`}
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

          {/* Cornerstone renders INTO this div — it must always be in the DOM */}
          <div
            ref={viewerRef}
            className="viewer-canvas"
            onContextMenu={e => e.preventDefault()}
            style={{ display: instances.length > 0 && !loading ? 'block' : 'none' }}
          />

          {/* States shown when canvas is hidden */}
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

          {/* Loading spinner overlay */}
          {imageLoading && (
            <div className="viewer-image-loading">
              <span className="animate-spin">⟳</span> Loading image…
            </div>
          )}

          {/* DICOM overlays — top-left, top-right, bottom-left, bottom-right */}
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
            {[['W','W/L'],['Z','Zoom'],['P','Pan'],['L','Length'],['I','Invert'],['R','Reset']].map(([k, l]) => (
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
