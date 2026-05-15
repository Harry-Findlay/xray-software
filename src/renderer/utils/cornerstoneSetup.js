/**
 * cornerstoneSetup.js
 *
 * Initialises Cornerstone core, tools, WADO-URI loader (DICOM), and
 * a custom 'web:' loader for JPEG/PNG/BMP files.
 *
 * Image IDs:
 *   DICOM  → wadouri:http://127.0.0.1:7432/wado?filePath=<path>
 *   Web    → web:http://127.0.0.1:7432/wado?filePath=<path>
 */

let _initialised = false;

const DICOM_EXTENSIONS = new Set(['.dcm', '.dicom', '.dic']);

export async function initCornerstone() {
  if (_initialised) return;

  const cornerstone           = await import('cornerstone-core');
  const cornerstoneTools      = await import('cornerstone-tools');
  const cornerstoneMath       = await import('cornerstone-math');
  const Hammer                = (await import('hammerjs')).default;
  const cornerstoneWADOLoader = await import('cornerstone-wado-image-loader');
  const dicomParser           = await import('dicom-parser');

  // Wire WADO loader
  cornerstoneWADOLoader.external.cornerstone  = cornerstone;
  cornerstoneWADOLoader.external.dicomParser  = dicomParser;
  cornerstoneTools.external.cornerstone       = cornerstone;
  cornerstoneTools.external.cornerstoneMath   = cornerstoneMath;
  cornerstoneTools.external.Hammer            = Hammer;

  // Register custom 'web:' loader for JPEG/PNG/BMP
  cornerstone.registerImageLoader('web', _webImageLoader.bind(null, cornerstone));

  // Web Worker pool for DICOM decoding
  cornerstoneWADOLoader.webWorkerManager.initialize({
    maxWebWorkers: Math.max((navigator.hardwareConcurrency || 2) - 1, 1),
    startWebWorkersOnDemand: true,
    taskConfiguration: {
      decodeTask: {
        initializeCodecsOnStartup: false,
        usePDFJS: false,
        strict: false,
      },
    },
  });

  // Init tools
  cornerstoneTools.init({ globalToolSyncEnabled: true, showSVGCursors: true });

  const toolClasses = [
    cornerstoneTools.WwwcTool,
    cornerstoneTools.ZoomTool,
    cornerstoneTools.PanTool,
    cornerstoneTools.LengthTool,
    cornerstoneTools.AngleTool,
    cornerstoneTools.FreehandRoiTool,
    cornerstoneTools.ArrowAnnotateTool,
    cornerstoneTools.EllipticalRoiTool,
    cornerstoneTools.RectangleRoiTool,
    cornerstoneTools.StackScrollMouseWheelTool,
  ];
  toolClasses.forEach(T => cornerstoneTools.addTool(T));
  cornerstoneTools.setToolActive('StackScrollMouseWheel', {});

  // Override the ArrowAnnotate text prompt so it works in Electron
  // (prompt() is blocked in contextIsolation mode)
  cornerstoneTools.store.state.textCallback = (doneCallback) => {
    const text = window._pendingAnnotationText || 'Annotation';
    window._pendingAnnotationText = null;
    doneCallback(text);
  };

  _initialised = true;
  console.log('[Cornerstone] Initialised OK');
}

/**
 * Custom loader for the 'web:' scheme.
 * Strips the 'web:' prefix, fetches the image URL, renders to canvas,
 * and returns a Cornerstone image object.
 *
 * Uses RGBA color rendering — no lossy grayscale conversion.
 */
function _webImageLoader(cornerstone, imageId) {
  // imageId = "web:http://127.0.0.1:7432/wado?filePath=..."
  const url = imageId.slice(4); // strip 'web:'

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, w, h);
      const pixelData = new Uint8Array(imageData.data.buffer);

      const csImage = {
        imageId,
        minPixelValue:      0,
        maxPixelValue:      255,
        slope:              1,
        intercept:          0,
        windowCenter:       128,
        windowWidth:        255,
        render:             cornerstone.renderColorImage,
        getPixelData:       () => pixelData,
        getCanvas:          () => {
          // Return a fresh canvas each time Cornerstone asks
          const c = document.createElement('canvas');
          c.width  = w;
          c.height = h;
          c.getContext('2d').putImageData(imageData, 0, 0);
          return c;
        },
        rows:               h,
        columns:            w,
        height:             h,
        width:              w,
        color:              true,
        rgba:               false,
        columnPixelSpacing: 1,
        rowPixelSpacing:    1,
        invert:             false,
        sizeInBytes:        w * h * 4,
      };

      resolve(csImage);
    };

    img.onerror = (e) => reject(new Error(`web loader: failed to load ${url}`));
    img.src = url;
  });

  return { promise };
}

/**
 * Returns { cornerstone, cornerstoneTools }.
 * Always call after initCornerstone() has resolved.
 */
export async function getCornerstone() {
  const cornerstone      = await import('cornerstone-core');
  const cornerstoneTools = await import('cornerstone-tools');
  return { cornerstone, cornerstoneTools };
}

/**
 * Build the correct imageId for a file path.
 * DICOM → wadouri:  Web images → web:
 */
export function makeImageId(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const url  = `http://127.0.0.1:7432/wado?filePath=${encodeURIComponent(filePath)}`;
  return DICOM_EXTENSIONS.has(ext) ? `wadouri:${url}` : `web:${url}`;
}

/** Map of UI tool IDs → Cornerstone tool names */
export const TOOL_MAP = {
  wwwc:     'Wwwc',
  zoom:     'Zoom',
  pan:      'Pan',
  length:   'Length',
  angle:    'Angle',
  freehand: 'FreehandRoi',
  arrow:    'ArrowAnnotate',
  ellipse:  'EllipticalRoi',
  rect:     'RectangleRoi',
};

/** Apply a W/L preset to a Cornerstone-enabled element */
export function applyWLPreset(element, windowWidth, windowCenter) {
  if (!element) return;
  import('cornerstone-core').then(cs => {
    try {
      const vp = cs.getViewport(element);
      if (!vp) return;
      vp.voi = { windowWidth, windowCenter };
      cs.setViewport(element, vp);
    } catch {}
  });
}

/** Toggle inversion */
export function toggleInvert(element) {
  if (!element) return;
  import('cornerstone-core').then(cs => {
    try {
      const vp = cs.getViewport(element);
      if (!vp) return;
      vp.invert = !vp.invert;
      cs.setViewport(element, vp);
    } catch {}
  });
}

/** Reset viewport to fit */
export function resetViewport(element) {
  if (!element) return;
  import('cornerstone-core').then(cs => {
    try { cs.reset(element); } catch {}
  });
}