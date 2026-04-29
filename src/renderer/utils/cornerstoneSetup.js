/**
 * cornerstoneSetup.js
 *
 * Initialises Cornerstone core, tools, and WADO-URI image loader.
 * Call initCornerstone() once at app startup (App.jsx useEffect).
 *
 * Images are served by the local Express server (port 7432) using imageIds like:
 *   wadouri:http://127.0.0.1:7432/wado?filePath=/absolute/path/to/scan.dcm
 */

let _initialised = false;

export async function initCornerstone() {
  if (_initialised) return;

  const cornerstone           = await import('cornerstone-core');
  const cornerstoneTools      = await import('cornerstone-tools');
  const cornerstoneMath       = await import('cornerstone-math');
  const Hammer                = (await import('hammerjs')).default;
  const cornerstoneWADOLoader = await import('cornerstone-wado-image-loader');
  const dicomParser           = await import('dicom-parser');

  // Wire external dependencies
  cornerstoneWADOLoader.external.cornerstone  = cornerstone;
  cornerstoneWADOLoader.external.dicomParser  = dicomParser;
  cornerstoneTools.external.cornerstone       = cornerstone;
  cornerstoneTools.external.cornerstoneMath   = cornerstoneMath;
  cornerstoneTools.external.Hammer            = Hammer;

  // Web Worker pool for DICOM decoding (keeps UI thread responsive)
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

  // Init tools library
  cornerstoneTools.init({ globalToolSyncEnabled: true, showSVGCursors: true });

  // Register every tool we expose in the viewer UI
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

  // Mouse-wheel scrolls through stack by default
  cornerstoneTools.setToolActive('StackScrollMouseWheel', {});

  _initialised = true;
  console.log('[Cornerstone] Initialised OK');
}

/**
 * Returns { cornerstone, cornerstoneTools } after ensuring they are imported.
 * Always call after initCornerstone() has resolved.
 */
export async function getCornerstone() {
  const cornerstone      = await import('cornerstone-core');
  const cornerstoneTools = await import('cornerstone-tools');
  return { cornerstone, cornerstoneTools };
}

/**
 * Build a WADO-URI imageId pointing at our local Express server.
 * @param {string} filePath  Absolute path on disk
 */
export function makeImageId(filePath) {
  return `wadouri:http://127.0.0.1:7432/wado?filePath=${encodeURIComponent(filePath)}`;
}

/**
 * Map of our UI tool IDs → Cornerstone tool names
 */
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

/** Apply a window/level preset to a Cornerstone-enabled element */
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

/** Toggle image inversion on a Cornerstone-enabled element */
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

/** Reset viewport to default fit */
export function resetViewport(element) {
  if (!element) return;
  import('cornerstone-core').then(cs => {
    try { cs.reset(element); } catch {}
  });
}
