import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getCornerstone, makeImageId, TOOL_MAP,
  applyWLPreset, toggleInvert, resetViewport,
} from '../utils/cornerstoneSetup';
import './ImagingViewerPage.css';

const TOOLS = [
  { id: 'wwwc',     icon: '◑',  label: 'W/L',     tooltip: 'Window / Level  [W]' },
  { id: 'zoom',     icon: '🔍', label: 'Zoom',    tooltip: 'Zoom  [Z]' },
  { id: 'pan',      icon: '✋', label: 'Pan',     tooltip: 'Pan  [P]' },
  { id: 'length',   icon: '📏', label: 'Length',  tooltip: 'Measure length  [L]' },
  { id: 'angle',    icon: '📐', label: 'Angle',   tooltip: 'Measure angle  [A]' },
  { id: 'freehand', icon: '✏️', label: 'ROI',     tooltip: 'Freehand ROI' },
  { id: 'arrow',    icon: '↗',  label: 'Note',    tooltip: 'Arrow annotation' },
  { id: 'ellipse',  icon: '⬭',  label: 'Ellipse', tooltip: 'Ellipse ROI' },
];

const WL_PRESETS = [
  { label: 'Default',    w: 4000, l: 2000 },
  { label: 'Periapical', w: 300,  l: 150  },
  { label: 'Caries',     w: 200,  l: 100  },
  { label: 'Perio',      w: 600,  l: 300  },
  { label: 'OPG',        w: 3000, l: 1500 },
  { label: 'Implant',    w: 1500, l: 700  },
  { label: 'Endo',       w: 250,  l: 125  },
];

// ── Single viewer pane ────────────────────────────────────────────────────────
function ViewerPane({ image, isActive, activeTool, onActivate, onDeleted }) {
  const viewerRef  = useRef(null);
  const csEnabled  = useRef(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [viewportInfo, setViewportInfo] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]    = useState(false);

  useEffect(() => {
    if (image) loadImage();
    return () => {
      if (csEnabled.current && viewerRef.current) {
        import('cornerstone-core').then(cs => {
          try { cs.disable(viewerRef.current); } catch {}
        });
        csEnabled.current = false;
      }
    };
  }, [image?.id]);

  // Re-apply tool when active tool changes and this pane is active
  useEffect(() => {
    if (!isActive || !csEnabled.current) return;
    getCornerstone().then(({ cornerstoneTools }) => {
      _activateTool(cornerstoneTools, activeTool);
    });
  }, [activeTool, isActive]);

  const loadImage = async () => {
    const element = viewerRef.current;
    if (!element || !image) return;
    setLoading(true);
    setError('');
    try {
      const { cornerstone, cornerstoneTools } = await getCornerstone();

      if (!csEnabled.current) {
        cornerstone.enable(element);
        csEnabled.current = true;

        // ArrowAnnotate needs a text prompt — override the default which
        // uses prompt() (blocked in Electron with contextIsolation).
        // window.prompt does work in Electron renderer via the dialog system.
        cornerstoneTools.store.state.textCallback = (doneCallback) => {
          const text = window.prompt('Annotation text:') || '';
          doneCallback(text);
        };

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

      const imageId = makeImageId(image.file_path);
      const img     = await cornerstone.loadAndCacheImage(imageId);
      cornerstone.displayImage(element, img);
      _activateTool(cornerstoneTools, activeTool);
      cornerstone.fitToWindow(element);

      // Restore annotations
      if (image.annotations) {
        try {
          const saved = typeof image.annotations === 'string'
            ? JSON.parse(image.annotations) : image.annotations;
          Object.entries(saved || {}).forEach(([toolName, data]) => {
            (Array.isArray(data) ? data : []).forEach(d =>
              cornerstoneTools.addToolState(element, toolName, d)
            );
          });
          cornerstone.updateImage(element);
        } catch {}
      }
    } catch (err) {
      console.error('Pane load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  function _activateTool(cornerstoneTools, toolId) {
    if (toolId === 'invert') { toggleInvert(viewerRef.current); return; }
    if (toolId === 'reset')  { resetViewport(viewerRef.current); return; }
    const name = TOOL_MAP[toolId];
    if (name) cornerstoneTools.setToolActive(name, { mouseButtonMask: 1 });
  }

  const handleSaveAnnotations = async () => {
    if (!image || !csEnabled.current) return;
    try {
      const { cornerstoneTools } = await getCornerstone();
      const annotations = {};
      Object.values(TOOL_MAP).forEach(name => {
        const state = cornerstoneTools.getToolState(viewerRef.current, name);
        if (state?.data?.length) annotations[name] = state.data;
      });
      await window.electronAPI?.imaging.saveAnnotations(image.id, annotations);
    } catch (err) {
      console.error('Save annotations failed:', err);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await window.electronAPI?.imaging.deleteImage(image.id);
      setConfirmDelete(false);
      onDeleted(image.id);
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleting(false);
  };

  return (
    <div
      className={`viewer-pane ${isActive ? 'active' : ''}`}
      onClick={onActivate}
    >
      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="pane-confirm-overlay" onClick={e => e.stopPropagation()}>
          <div className="pane-confirm-box">
            <p>Permanently delete this image?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm"
                onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger btn-sm"
                onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cornerstone canvas */}
      <div
        ref={viewerRef}
        className="viewer-canvas"
        onContextMenu={e => e.preventDefault()}
        style={{ display: !loading && !error ? 'block' : 'none' }}
      />

      {loading && (
        <div className="pane-state">
          <span className="animate-spin" style={{ fontSize: 24 }}>⟳</span>
          <span>Loading…</span>
        </div>
      )}
      {!loading && error && (
        <div className="pane-state">
          <span style={{ fontSize: 24 }}>⚠️</span>
          <span style={{ color: 'var(--danger)', textAlign: 'center', maxWidth: 200, fontSize: 12 }}>
            {error}
          </span>
        </div>
      )}

      {/* DICOM overlays */}
      {csEnabled.current && image && !loading && !error && (
        <>
          <div className="overlay-tl">
            <div>{image.image_type || image.image_category}</div>
            {image.tooth_number && <div>Tooth {image.tooth_number}</div>}
          </div>
          <div className="overlay-tr">
            {image.acquisition_date && (
              <div>{new Date(image.acquisition_date).toLocaleDateString()}</div>
            )}
            {image.kvp && <div>{image.kvp} kV</div>}
            {image.mas && <div>{image.mas} mAs</div>}
          </div>
          {viewportInfo && (
            <div className="overlay-bl">
              <span>WW: {viewportInfo.ww}</span>
              <span>WC: {viewportInfo.wc}</span>
              <span>×{viewportInfo.zoom}</span>
            </div>
          )}
        </>
      )}

      {/* Per-pane action buttons — shown when pane is active */}
      {isActive && !loading && !error && (
        <div className="pane-actions">
          <button className="btn btn-ghost btn-sm pane-btn"
            onClick={e => { e.stopPropagation(); handleSaveAnnotations(); }}
            title="Save annotations">💾</button>
          <button className="btn btn-ghost btn-sm pane-btn"
            onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
            title="Delete image">🗑</button>
        </div>
      )}

      {/* Active pane border indicator */}
      {isActive && <div className="pane-active-indicator" />}
    </div>
  );
}

// ── Main viewer page ──────────────────────────────────────────────────────────
export default function ImagingViewerPage() {
  // Route param is comma-separated image IDs e.g. /imaging/id1,id2,id3
  const { studyId: rawIds } = useParams();
  const navigate = useNavigate();

  const imageIds = rawIds ? rawIds.split(',').filter(Boolean) : [];

  const [images,     setImages]     = useState([]);
  const [activePaneIdx, setActivePaneIdx] = useState(0);
  const [activeTool,    setActiveTool]    = useState('wwwc');
  const [loading,       setLoading]       = useState(true);

  useEffect(() => { loadImages(); }, [rawIds]);

  const loadImages = async () => {
    setLoading(true);
    try {
      const loaded = await Promise.all(
        imageIds.map(id => window.electronAPI?.imaging.getImage(id))
      );
      setImages(loaded.filter(Boolean));
    } catch (err) {
      console.error('Failed to load images:', err);
    }
    setLoading(false);
  };

  const handleDeleted = (deletedId) => {
    const remaining = images.filter(img => img.id !== deletedId);
    if (remaining.length === 0) {
      navigate(-1);
    } else {
      setImages(remaining);
      setActivePaneIdx(Math.min(activePaneIdx, remaining.length - 1));
    }
  };

  // Menu events — apply to active pane
  useEffect(() => {
    const offZoomIn  = window.electronAPI?.on('viewer:zoom-in',  () => _zoomActive(1.2));
    const offZoomOut = window.electronAPI?.on('viewer:zoom-out', () => _zoomActive(0.8));
    const offFit     = window.electronAPI?.on('viewer:fit',      () => _fitActive());
    return () => { offZoomIn?.(); offZoomOut?.(); offFit?.(); };
  }, [activePaneIdx]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const map = { w: 'wwwc', z: 'zoom', p: 'pan', l: 'length', a: 'angle' };
      if (map[e.key]) setActiveTool(map[e.key]);
      if (e.key === 'r' || e.key === 'R') _fitActive();
      if (e.key === 'i' || e.key === 'I') {
        import('cornerstone-core').then(cs => {
          try {
            const el = document.querySelectorAll('.viewer-pane')[activePaneIdx]
              ?.querySelector('.viewer-canvas');
            if (el) toggleInvert(el);
          } catch {}
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activePaneIdx]);

  function _zoomActive(delta) {
    import('cornerstone-core').then(cs => {
      try {
        const el = document.querySelectorAll('.viewer-pane')[activePaneIdx]
          ?.querySelector('.viewer-canvas');
        if (!el) return;
        const vp = cs.getViewport(el);
        if (!vp) return;
        vp.scale = Math.min(Math.max(vp.scale * delta, 0.05), 30);
        cs.setViewport(el, vp);
      } catch {}
    });
  }

  function _fitActive() {
    import('cornerstone-core').then(cs => {
      try {
        const el = document.querySelectorAll('.viewer-pane')[activePaneIdx]
          ?.querySelector('.viewer-canvas');
        if (el) cs.reset(el);
      } catch {}
    });
  }

  // Compute grid layout based on number of images
  const getGridStyle = (count) => {
    if (count === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    if (count === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    if (count === 3) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr' };
    if (count === 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    // 5-6
    return { gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' };
  };

  const activeImage = images[activePaneIdx];

  return (
    <div className="viewer-page">

      {/* Topbar */}
      <div className="viewer-topbar">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} title="Back">←</button>
        <div className="viewer-info">
          {activeImage && (
            <>
              <span className="viewer-title">
                {activeImage.image_type || activeImage.image_category || 'Image'}
              </span>
              {activeImage.tooth_number && (
                <span className="badge badge-blue">Tooth {activeImage.tooth_number}</span>
              )}
              {images.length > 1 && (
                <span className="text-muted text-xs">
                  Pane {activePaneIdx + 1} of {images.length}
                </span>
              )}
            </>
          )}
        </div>
        <div className="viewer-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => {
            // Save all pane annotations
            document.querySelectorAll('.pane-btn[title="Save annotations"]').forEach(b => b.click());
          }}>💾 Save All</button>
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            const result = await window.electronAPI?.dialog.saveFile({
              title: 'Export Image',
              defaultPath: 'xray.jpg',
              filters: [{ name: 'JPEG', extensions: ['jpg'] }, { name: 'PNG', extensions: ['png'] }],
            });
            if (!result?.canceled) console.log('Export to:', result.filePath);
          }}>↗ Export</button>
        </div>
      </div>

      <div className="viewer-body">

        {/* Multi-pane viewer */}
        <div className="viewer-main">
          {loading ? (
            <div className="pane-state">
              <span className="animate-spin" style={{ fontSize: 32 }}>⟳</span>
              <span>Loading…</span>
            </div>
          ) : (
            <div className="pane-grid" style={getGridStyle(images.length)}>
              {images.map((img, idx) => (
                <ViewerPane
                  key={img.id}
                  image={img}
                  isActive={idx === activePaneIdx}
                  activeTool={activeTool}
                  onActivate={() => setActivePaneIdx(idx)}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )}
        </div>

        {/* Tool panel */}
        <div className="tool-panel">
          <div className="tool-section-title">Tools</div>

          {TOOLS.map(tool => (
            <button
              key={tool.id}
              className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
              onClick={() => setActiveTool(tool.id)}
              title={tool.tooltip}
            >
              <span className="tool-icon">{tool.icon}</span>
              <span className="tool-label">{tool.label}</span>
            </button>
          ))}

          <button className="tool-btn" title="Invert [I]"
            onClick={() => {
              import('cornerstone-core').then(cs => {
                try {
                  const el = document.querySelectorAll('.viewer-pane')[activePaneIdx]
                    ?.querySelector('.viewer-canvas');
                  if (el) toggleInvert(el);
                } catch {}
              });
            }}>
            <span className="tool-icon">⬛</span>
            <span className="tool-label">Invert</span>
          </button>
          <button className="tool-btn" title="Reset [R]" onClick={_fitActive}>
            <span className="tool-icon">↺</span>
            <span className="tool-label">Reset</span>
          </button>

          <div className="divider" />
          <div className="tool-section-title">W/L Presets</div>
          <div className="wl-presets">
            {WL_PRESETS.map(preset => (
              <button key={preset.label} className="preset-btn"
                title={`WW:${preset.w}  WC:${preset.l}`}
                onClick={() => {
                  import('cornerstone-core').then(cs => {
                    try {
                      const el = document.querySelectorAll('.viewer-pane')[activePaneIdx]
                        ?.querySelector('.viewer-canvas');
                      if (el) applyWLPreset(el, preset.w, preset.l);
                    } catch {}
                  });
                }}>
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